/**
 * OPNet provider + contract factories.
 * All contract addresses are stored as opt1... bech32 strings;
 * resolveP2op() calls getPublicKeysInfoRaw() to get the 32-byte tweaked pubkey
 * and constructs an Address object.  Results are cached so RPC is only hit once.
 */
import { getContract, JSONRpcProvider } from 'opnet';
import type { BitcoinInterfaceAbi } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
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
// Works for opt1sq... (p2op contracts) and opt1p... (p2tr wallets).

const _addrCache = new Map<string, Address>(); // p2op → resolved Address

export async function resolveP2op(p2op: string): Promise<Address> {
    if (!p2op) throw new Error('Empty address');
    if (_addrCache.has(p2op)) return _addrCache.get(p2op)!;
    const info = await getProvider().getPublicKeysInfoRaw(p2op);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entry = info[p2op] as any;
    if (!entry || 'error' in entry) throw new Error(`Cannot resolve: ${p2op}`);
    // Use mldsaHashedPublicKey when present (ML-DSA wallet/contract), else fall back to tweakedPubkey.
    // Always pass tweakedPubkey as the second (legacy/secp256k1) param so address.p2tr() works.
    const addrContent: string = entry.mldsaHashedPublicKey ?? entry.tweakedPubkey;
    const legacyKey:   string = entry.tweakedPubkey;
    if (!addrContent || !legacyKey) throw new Error(`Cannot resolve address content for: ${p2op}`);
    const addr = Address.fromString('0x' + addrContent, '0x' + legacyKey);
    _addrCache.set(p2op, addr);
    return addr;
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
