/**
 * OPNet provider + contract singletons.
 * Two contract instances: one anonymous (for reads), one per-sender (for writes).
 * Never re-created per render — always reuse module-level references.
 */
import { getContract, JSONRpcProvider } from 'opnet';
import type { BitcoinInterfaceAbi } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { Address } from '@btc-vision/transaction';
import VIBINGDAO_ABI_RAW from './VibingDAO.abi.json';

export const NETWORK = networks.opnetTestnet;
export const RPC_URL = 'https://testnet.opnet.org';

// Hex tweaked pubkey for the deployed VibingDAO contract.
// Use hex (0x...) — Address.fromString only accepts hex, not bech32 opt1... addresses.
// Contract: opt1sqqtee6htq8t5pgtwa2rgnlrts2v95wsa7g7tz0wl
export const DAO_ADDRESS_HEX = '0x4f12e9853e304c5667e0fbb01730d4862ed0a69d22ad0202b2e6b0dbf4209c51';

// Normalise ABI: OPNetTransform emits "Function"/"Event" (capital) but opnet
// SDK expects lowercase "function"/"event".
function normaliseAbi(): BitcoinInterfaceAbi {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fns = (VIBINGDAO_ABI_RAW.functions as any[]).map((f) => ({ ...f, type: 'function' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evts = (VIBINGDAO_ABI_RAW.events as any[]).map((e) => ({ ...e, type: 'event' }));
    return [...fns, ...evts] as unknown as BitcoinInterfaceAbi;
}

const VIBINGDAO_ABI = normaliseAbi();
// Lazy-initialised so module load never throws.
let _daoAddr: Address | null = null;
function getDaoAddr(): Address {
    if (!_daoAddr) _daoAddr = Address.fromString(DAO_ADDRESS_HEX);
    return _daoAddr;
}

let _provider: JSONRpcProvider | null = null;
export function getProvider(): JSONRpcProvider {
    if (!_provider) {
        _provider = new JSONRpcProvider(RPC_URL, NETWORK);
    }
    return _provider;
}

// Anonymous read contract — no sender, cached forever.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _readContract: any | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getReadContract(): any {
    if (!_readContract) {
        _readContract = getContract(getDaoAddr(), VIBINGDAO_ABI, getProvider(), NETWORK);
    }
    return _readContract;
}

// Write contract — bound to a sender address for accurate simulation context.
// Cached by address string; recreated only when address changes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _writeContract: any | null = null;
let _writeContractAddr = '';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getWriteContract(senderAddressStr: string): any {
    if (_writeContract && _writeContractAddr === senderAddressStr) {
        return _writeContract;
    }
    // For simulation context only — sender is passed as Address if parseable,
    // otherwise fall back to anonymous (wallet still signs correctly via signer:null).
    let sender: Address | undefined;
    try {
        sender = Address.fromString(senderAddressStr);
    } catch {
        sender = undefined;
    }
    _writeContract = getContract(getDaoAddr(), VIBINGDAO_ABI, getProvider(), NETWORK, sender);
    _writeContractAddr = senderAddressStr;
    return _writeContract;
}
