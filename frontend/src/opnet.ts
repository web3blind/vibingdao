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
 * Address.fromString(first, second):
 *   first  = ML-DSA hash (mldsaHashedPublicKey) when present, else secp256k1 tweaked key.
 *            This is what OP20 contracts use for storage — must match what the contract sees.
 *   second = secp256k1 tweaked pubkey (legacyPublicKey).
 *            Required by address.p2tr() / tweakedPublicKeyToBuffer() during TX building.
 *
 * Strategy:
 *   1. Always try RPC (getPublicKeysInfoRaw) — returns both keys for indexed addresses.
 *   2. If the address is p2tr (opt1p...) and RPC returns "not found" (brand-new wallet),
 *      fall back to decoding the bech32 witness program which IS the secp256k1 tweaked key.
 */
export async function resolveP2op(addr: string): Promise<Address> {
    if (!addr) throw new Error('Empty address');
    if (_addrCache.has(addr)) return _addrCache.get(addr)!;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let entry: any = null;
    try {
        const info = await getProvider().getPublicKeysInfoRaw(addr);
        entry = info[addr];
        if ('error' in entry) entry = null;
    } catch { /* fall through to bech32 fallback */ }

    let tweakedHex: string;
    let addrContent: string;

    if (entry?.tweakedPubkey) {
        tweakedHex  = entry.tweakedPubkey as string;
        addrContent = (entry.mldsaHashedPublicKey ?? tweakedHex) as string;
    } else if (addr.startsWith('opt1p')) {
        // Fallback: p2tr witness program = x-only secp256k1 tweaked key (32 bytes)
        const decoded = fromBech32(addr);
        tweakedHex   = Buffer.from(decoded.data).toString('hex');
        addrContent  = tweakedHex;
    } else {
        throw new Error(`Cannot resolve: ${addr}`);
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

// ── getProposal raw bytes (bypasses ABI BYTES length-prefix decoder) ─────────
//
// The ABI defines getProposal as returning BYTES, but the contract writes raw
// bytes with no length prefix.  The SDK's BYTES decoder reads the first 4 bytes
// as the length → returns 0 bytes (text proposals) or throws (treasury).
//
// Fix: use an ABI with outputs:[] so decodeOutput skips entirely and
// response.result (a BinaryReader) keeps the untouched raw bytes.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GET_PROPOSAL_RAW_ABI: any[] = [{
    name:    'getProposal',
    type:    'function',
    inputs:  [{ name: 'proposalId', type: 'UINT256' }],
    outputs: [],
}];

const _proposalRawContracts = new Map<string, unknown>();

export async function getProposalRaw(daoP2op: string, proposalId: bigint): Promise<Uint8Array> {
    if (!_proposalRawContracts.has(daoP2op)) {
        const addr = await resolveP2op(daoP2op);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _proposalRawContracts.set(daoP2op, getContract(addr, GET_PROPOSAL_RAW_ABI as any, getProvider(), NETWORK));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = _proposalRawContracts.get(daoP2op) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await c.getProposal(proposalId);
    // result is a BinaryReader; .buffer is a DataView over the contract's raw return bytes
    const dv: DataView | undefined = res?.result?.buffer;
    if (!dv || !(dv instanceof DataView)) return new Uint8Array(0);
    return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
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
export async function getDaoWriteContract(daoP2op: string, sender: Address): Promise<any> {
    const key = `${daoP2op}:${sender.toHex()}`;
    if (!_daoWrite.has(key)) {
        const daoAddr = await resolveP2op(daoP2op);
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
export async function getTokenWriteContract(tokenP2op: string, sender: Address): Promise<any> {
    const key = `${tokenP2op}:${sender.toHex()}`;
    if (!_tokenWrite.has(key)) {
        const tokenAddr = await resolveP2op(tokenP2op);
        _tokenWrite.set(key, getContract(tokenAddr, OP20_ABI, getProvider(), NETWORK, sender));
    }
    return _tokenWrite.get(key);
}
