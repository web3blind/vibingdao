/**
 * OPNet provider + contract factories.
 * resolveP2op() handles two address formats:
 *   opt1p...  (p2tr wallet)  — tweaked pubkey decoded directly from bech32, NO RPC needed
 *   opt1sq... (p2op contract) — tweaked pubkey fetched via getPublicKeysInfoRaw()
 * Both produce an Address with legacyPublicKey set so address.p2tr() works.
 */
import { getContract, JSONRpcProvider } from 'opnet';
import type { BitcoinInterfaceAbi } from 'opnet';
import { networks, fromBech32 } from '@btc-vision/bitcoin';
import { Address } from '@btc-vision/transaction';
import VIBINGDAO_ABI_RAW from './VibingDAO.abi.json';
import { OP20_ABI } from './daos';

export const NETWORK = networks.opnetTestnet;
export const RPC_URL  = 'https://testnet.opnet.org';

// ── ABI normalisation ───────────────────────────────────────────────────────

function normaliseAbi(): BitcoinInterfaceAbi {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fns  = (VIBINGDAO_ABI_RAW.functions as any[]).map((f) => ({ ...f, type: 'function' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evts = (VIBINGDAO_ABI_RAW.events   as any[]).map((e) => ({ ...e, type: 'event'    }));
    return [...fns, ...evts] as unknown as BitcoinInterfaceAbi;
}
const VIBINGDAO_ABI = normaliseAbi();

// ── Provider singleton ──────────────────────────────────────────────────────

let _provider: JSONRpcProvider | null = null;
export function getProvider(): JSONRpcProvider {
    if (!_provider) _provider = new JSONRpcProvider(RPC_URL, NETWORK);
    return _provider;
}

// ── Address resolution ──────────────────────────────────────────────────────

const _addrCache = new Map<string, Address>();

/**
 * Resolve any OPNet address string to a full Address object with legacyPublicKey set.
 *
 * opt1p...  (p2tr / wallet) — witness program IS the tweaked pubkey; decode bech32 directly.
 *   This works even for brand-new wallets that have never sent a transaction and are
 *   therefore unknown to the OPNet indexer.
 *
 * opt1sq... (p2op / contract) — tweaked pubkey comes from getPublicKeysInfoRaw().
 *
 * legacyPublicKey (second Address param) MUST be set so that address.p2tr() and
 * address.tweakedPublicKeyToBuffer() work during transaction building.
 */
export async function resolveP2op(addr: string): Promise<Address> {
    if (!addr) throw new Error('Empty address');
    if (_addrCache.has(addr)) return _addrCache.get(addr)!;

    let tweakedHex: string;
    let addrContent: string;

    if (addr.startsWith('opt1p')) {
        // p2tr — witness program (version 1) = 32-byte x-only tweaked pubkey
        const decoded = fromBech32(addr);
        tweakedHex   = Buffer.from(decoded.data).toString('hex');
        addrContent  = tweakedHex; // no ML-DSA hash available; use secp256k1 key as identity
    } else {
        // p2op contract — must query the indexer
        const info = await getProvider().getPublicKeysInfoRaw(addr);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const entry = info[addr] as any;
        if (!entry || 'error' in entry) throw new Error(`Cannot resolve: ${addr}`);
        tweakedHex  = entry.tweakedPubkey as string;
        addrContent = (entry.mldsaHashedPublicKey ?? tweakedHex) as string;
        if (!tweakedHex) throw new Error(`No tweaked pubkey for: ${addr}`);
    }

    const resolved = Address.fromString('0x' + addrContent, '0x' + tweakedHex);
    _addrCache.set(addr, resolved);
    return resolved;
}

// Pre-warm the cache for all known addresses so UI doesn't wait on first render.
export function prefetchAddresses(p2ops: string[]): void {
    for (const p of p2ops) {
        if (!_addrCache.has(p)) resolveP2op(p).catch(() => { /* ignore */ });
    }
}

// ── DAO contract factories (VibingDAO ABI) ──────────────────────────────────

const _daoRead  = new Map<string, unknown>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDaoReadContract(daoP2op: string): Promise<any> {
    if (!_daoRead.has(daoP2op)) {
        const addr = await resolveP2op(daoP2op);
        _daoRead.set(daoP2op, getContract(addr, VIBINGDAO_ABI, getProvider(), NETWORK));
    }
    return _daoRead.get(daoP2op);
}

const _daoWrite = new Map<string, unknown>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDaoWriteContract(daoP2op: string, senderP2op: string): Promise<any> {
    const key = `${daoP2op}:${senderP2op}`;
    if (!_daoWrite.has(key)) {
        const daoAddr = await resolveP2op(daoP2op);
        const sender  = senderP2op
            ? await resolveP2op(senderP2op).catch(() => undefined)
            : undefined;
        _daoWrite.set(key, getContract(daoAddr, VIBINGDAO_ABI, getProvider(), NETWORK, sender));
    }
    return _daoWrite.get(key);
}

// ── OP20 token contract factories (for balanceOf / approve / allowance) ─────

const _tokenRead  = new Map<string, unknown>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getTokenReadContract(tokenP2op: string): Promise<any> {
    if (!_tokenRead.has(tokenP2op)) {
        const addr = await resolveP2op(tokenP2op);
        _tokenRead.set(tokenP2op, getContract(addr, OP20_ABI, getProvider(), NETWORK));
    }
    return _tokenRead.get(tokenP2op);
}

const _tokenWrite = new Map<string, unknown>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getTokenWriteContract(tokenP2op: string, senderP2op: string): Promise<any> {
    const key = `${tokenP2op}:${senderP2op}`;
    if (!_tokenWrite.has(key)) {
        const tokenAddr = await resolveP2op(tokenP2op);
        const sender    = senderP2op
            ? await resolveP2op(senderP2op).catch(() => undefined)
            : undefined;
        _tokenWrite.set(key, getContract(tokenAddr, OP20_ABI, getProvider(), NETWORK, sender));
    }
    return _tokenWrite.get(key);
}
