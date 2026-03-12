#!/usr/bin/env node
/**
 * VibingDAO — OPNet Testnet Deployment Script
 * Deploys build/VibingDAO.wasm to OPNet testnet (Signet fork).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALLET_FILE = path.join(__dirname, 'testnet.wallet');
const WASM_FILE   = path.join(__dirname, 'build', 'VibingDAO.wasm');

const {
    Mnemonic,
    MnemonicStrength,
    MLDSASecurityLevel,
    TransactionFactory,
} = await import('@btc-vision/transaction');

// Use the transaction package's bundled bitcoin which has opnetTestnet
const { networks } = await import('./node_modules/@btc-vision/transaction/node_modules/@btc-vision/bitcoin/build/index.js');
const { JSONRpcProvider } = await import('opnet');

const NETWORK  = networks.opnetTestnet;
const RPC_URL  = 'https://testnet.opnet.org';
const FEE_RATE = 5;        // sat/vB
const GAS_FEE  = 10_000n;  // satoshis

// ── Wallet ─────────────────────────────────────────────────────────────────

function loadWallet() {
    const phrase = fs.readFileSync(WALLET_FILE, 'utf8').trim();
    const mnemonic = new Mnemonic(phrase, '', NETWORK, MLDSASecurityLevel.LEVEL2);
    return mnemonic.derive(0);
}

// ── Calldata (all zeros → defaults) ────────────────────────────────────────

function buildCalldata() {
    // u256 maxSupply | u8 decimals | u256 duration | u256 quorum | address stakingToken
    // All zeros = 21M VIBE, 8 decimals, 144 blocks, 10% quorum, VIBE itself
    return new Uint8Array(32 + 1 + 32 + 32 + 32); // 129 bytes
}

// ── Main ───────────────────────────────────────────────────────────────────

const wallet  = loadWallet();
const address = wallet.p2tr;

console.log('══════════════════════════════════════════════');
console.log(' VibingDAO — OPNet Testnet Deployment');
console.log('══════════════════════════════════════════════');
console.log('Wallet:', address);
console.log('WASM:  ', WASM_FILE, `(${fs.statSync(WASM_FILE).size} bytes)`);
console.log();

const provider = new JSONRpcProvider(RPC_URL, NETWORK);

// Get UTXOs
console.log('Fetching UTXOs…');
const utxos = await provider.utxoManager.getUTXOs({ address });
if (!utxos || utxos.length === 0) {
    console.error('No UTXOs found. Fund the wallet first:');
    console.error(' ', address);
    process.exit(1);
}
const total = utxos.reduce((s, u) => s + BigInt(u.value), 0n);
console.log(`Found ${utxos.length} UTXO(s), total ${total} sats`);
console.log();

// Read WASM
const bytecode = new Uint8Array(fs.readFileSync(WASM_FILE).buffer);
const calldata = buildCalldata();

// Challenge (PoW)
console.log('Fetching epoch challenge…');
const challenge = await provider.getChallenge();
console.log(`Challenge: reward=${challenge.reward} difficulty=${challenge.difficulty}`);
console.log();

// Sign deployment
console.log('Building deployment transactions…');
const factory    = new TransactionFactory();
const deployment = await factory.signDeployment({
    from:                        address,
    utxos,
    signer:                      wallet.keypair,
    mldsaSigner:                 wallet.mldsaKeypair,
    network:                     NETWORK,
    feeRate:                     FEE_RATE,
    priorityFee:                 0n,
    gasSatFee:                   GAS_FEE,
    bytecode,
    calldata,
    challenge,
    linkMLDSAPublicKeyToAddress: true,
    revealMLDSAPublicKey:        true,
});

console.log('Contract address (deterministic):');
console.log(' ', deployment.contractAddress);
console.log();

// Broadcast
console.log('Broadcasting funding transaction…');
const r1 = await provider.sendRawTransaction(deployment.transaction[0]);
const fundingTxId = r1.result ?? r1.txid ?? String(r1);
console.log(' Funding TX:', fundingTxId);

// Small delay to let the funding tx propagate
await new Promise((r) => setTimeout(r, 2000));

console.log('Broadcasting reveal transaction…');
const r2 = await provider.sendRawTransaction(deployment.transaction[1]);
const revealTxId = r2.result ?? r2.txid ?? String(r2);
console.log(' Reveal TX: ', revealTxId);

// Save
const result = {
    contractAddress: deployment.contractAddress,
    fundingTxId,
    revealTxId,
    deployedAt: new Date().toISOString(),
    network: 'opnetTestnet',
};
fs.writeFileSync(path.join(__dirname, 'deployment.json'), JSON.stringify(result, null, 2));

console.log();
console.log('══════════════════════════════════════════════');
console.log(' Deployment complete!');
console.log(' Contract:', deployment.contractAddress);
console.log(' Saved to: deployment.json');
console.log();
console.log(' Next step: update DAO_ADDRESS_HEX in frontend/src/opnet.ts');
console.log('══════════════════════════════════════════════');
