/**
 * VibingDAO deployment script for OPNet testnet.
 *
 * Usage:
 *   node scripts/deploy.mjs           — generate wallet, show address, wait for UTXOs, deploy
 *   node scripts/deploy.mjs --dry-run — generate/show wallet only, do not broadcast
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WALLET_FILE = path.join(ROOT, '..', 'vibingdao', 'testnet.wallet');
const WASM_FILE = path.join(ROOT, '..', 'vibingdao', 'build', 'VibingDAO.wasm');

// ── Imports ────────────────────────────────────────────────────────────────

const {
    Mnemonic,
    MnemonicStrength,
    MLDSASecurityLevel,
    TransactionFactory,
    BinaryWriter,
} = await import('@btc-vision/transaction');

const { networks } = await import('@btc-vision/bitcoin');
const { JSONRpcProvider } = await import('opnet');

// ── Config ─────────────────────────────────────────────────────────────────

const NETWORK    = networks.opnetTestnet;
const RPC_URL    = 'https://testnet.opnet.org';
const FEE_RATE   = 5;          // sat/vB (testnet is relaxed)
const GAS_FEE    = 10_000n;    // satoshis
const DRY_RUN    = process.argv.includes('--dry-run');

// ── Wallet helpers ─────────────────────────────────────────────────────────

function loadOrCreateWallet() {
    if (fs.existsSync(WALLET_FILE)) {
        const phrase = fs.readFileSync(WALLET_FILE, 'utf8').trim();
        console.log('Loaded existing wallet from', WALLET_FILE);
        const mnemonic = new Mnemonic(phrase, '', NETWORK, MLDSASecurityLevel.LEVEL2);
        return mnemonic.derive(0);
    }

    console.log('Generating new wallet…');
    const mnemonic = Mnemonic.generate(
        MnemonicStrength.MAXIMUM,
        '',
        NETWORK,
        MLDSASecurityLevel.LEVEL2,
    );
    fs.writeFileSync(WALLET_FILE, mnemonic.phrase + '\n', { mode: 0o600 });
    console.log('Wallet saved to', WALLET_FILE);
    console.log('');
    console.log('⚠  BACK UP THIS SEED PHRASE — it controls your testnet funds:');
    console.log('   ', mnemonic.phrase);
    return mnemonic.derive(0);
}

// ── Calldata encoding ──────────────────────────────────────────────────────

function buildCalldata() {
    // VibingDAO onDeployment reads: u256 maxSupply | u8 decimals | u256 duration | u256 quorum | address stakingToken
    // All zeros → use all defaults (21M VIBE, 8 decimals, 144 blocks, 10% quorum, VIBE as staking token)
    const buf = new Uint8Array(32 + 1 + 32 + 32 + 32); // 129 bytes, all zeros
    return buf;
}

// ── Poll for UTXOs ─────────────────────────────────────────────────────────

async function waitForFunding(provider, address) {
    console.log('');
    console.log('Waiting for testnet BTC… (checking every 30 s)');
    for (;;) {
        const utxos = await provider.utxoManager.getUTXOs({ address });
        if (utxos.length > 0) {
            const total = utxos.reduce((s, u) => s + BigInt(u.value), 0n);
            console.log(`Funded! ${utxos.length} UTXO(s), total ${total} sats`);
            return utxos;
        }
        process.stdout.write('.');
        await new Promise((r) => setTimeout(r, 30_000));
    }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
    // 1. Wallet
    const wallet = loadOrCreateWallet();
    const address = wallet.p2tr;

    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log(' VibingDAO — OPNet Testnet Deployment');
    console.log('══════════════════════════════════════════════');
    console.log('');
    console.log(' Wallet address (fund this):');
    console.log(' ', address);
    console.log('');
    console.log(' Required funding:  0.01 tBTC  (recommended)');
    console.log(' Minimum:           0.002 tBTC');
    console.log('');
    console.log(' Faucet: https://faucet.opnet.org');
    console.log('         or ask in the OPNet Discord');
    console.log('');
    console.log(' WASM file:', WASM_FILE, '(' + Math.round(fs.statSync(WASM_FILE).size / 1024) + ' KB)');
    console.log('══════════════════════════════════════════════');

    if (DRY_RUN) {
        console.log('');
        console.log('--dry-run: stopping here. Run without --dry-run to deploy after funding.');
        return;
    }

    // 2. Provider
    const provider = new JSONRpcProvider(RPC_URL, NETWORK);

    // 3. Wait until funded
    const utxos = await waitForFunding(provider, address);

    // 4. Read WASM
    const bytecode = new Uint8Array(fs.readFileSync(WASM_FILE).buffer);
    const calldata = buildCalldata();

    // 5. Challenge (PoW)
    console.log('Fetching epoch challenge…');
    const challenge = await provider.getChallenge();
    console.log('Challenge reward:', challenge.reward, 'difficulty:', challenge.difficulty);

    // 6. Sign deployment
    console.log('Building deployment transactions…');
    const factory = new TransactionFactory();
    const deployment = await factory.signDeployment({
        from: address,
        utxos,
        signer:            wallet.keypair,
        mldsaSigner:       wallet.mldsaKeypair,
        network:           NETWORK,
        feeRate:           FEE_RATE,
        priorityFee:       0n,
        gasSatFee:         GAS_FEE,
        bytecode,
        calldata,
        challenge,
        linkMLDSAPublicKeyToAddress: true,
        revealMLDSAPublicKey:        true,
    });

    console.log('');
    console.log('Contract address (deterministic):');
    console.log(' ', deployment.contractAddress);
    console.log('');

    // 7. Broadcast
    console.log('Broadcasting funding transaction…');
    const fundingResult = await provider.sendRawTransaction(deployment.transaction[0]);
    console.log(' Funding TX:', fundingResult.txid);

    console.log('Broadcasting reveal transaction…');
    const revealResult = await provider.sendRawTransaction(deployment.transaction[1]);
    console.log(' Reveal TX: ', revealResult.txid);

    // 8. Save result
    const result = {
        contractAddress: deployment.contractAddress,
        fundingTxId: fundingResult.txid,
        revealTxId:  revealResult.txid,
        deployedAt:  new Date().toISOString(),
        network:     'opnetTestnet',
    };

    const outFile = path.join(ROOT, '..', 'vibingdao', 'deployment.json');
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log(' Deployment complete!');
    console.log(' Contract:', deployment.contractAddress);
    console.log(' Saved to:', outFile);
    console.log('');
    console.log(' Next: paste the contract address into:');
    console.log('   vibingdao-frontend/src/opnet.ts → DAO_ADDRESS_HEX');
    console.log('══════════════════════════════════════════════');

    await provider.close();
}

main().catch((e) => { console.error('Deploy failed:', e.message); process.exit(1); });
