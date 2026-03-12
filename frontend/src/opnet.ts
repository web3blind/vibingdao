/**
 * OPNet provider + contract singleton utilities.
 * One provider and one contract instance — never re-create them per render.
 */
import { getContract, JSONRpcProvider } from 'opnet';
import type { BitcoinInterfaceAbi } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { Address } from '@btc-vision/transaction';
import VIBINGDAO_ABI_RAW from './VibingDAO.abi.json';

export const NETWORK = networks.opnetTestnet;
export const RPC_URL = 'https://testnet.opnet.org';

// ── Replace with your deployed contract address ───────────────────────────
export const DAO_ADDRESS_HEX = 'opt1sqze6skcwhe2jju5znavldlldcr4mugrgtgkcncq7';
// ─────────────────────────────────────────────────────────────────────────

// The OPNetTransform ABI uses "Function"/"Event" (capital) but opnet SDK
// expects lowercase "function"/"event".  Normalise at runtime.
function normaliseAbi(): BitcoinInterfaceAbi {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fns = (VIBINGDAO_ABI_RAW.functions as any[]).map((f) => ({ ...f, type: 'function' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evts = (VIBINGDAO_ABI_RAW.events as any[]).map((e) => ({ ...e, type: 'event' }));
    return [...fns, ...evts] as unknown as BitcoinInterfaceAbi;
}

const VIBINGDAO_ABI = normaliseAbi();

let _provider: JSONRpcProvider | null = null;
export function getProvider(): JSONRpcProvider {
    if (!_provider) {
        _provider = new JSONRpcProvider(RPC_URL, NETWORK);
    }
    return _provider;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _contract: any | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDaoContract(senderAddress?: Address): any {
    if (!_contract || senderAddress) {
        const addr = Address.fromString(DAO_ADDRESS_HEX);
        _contract = getContract(addr, VIBINGDAO_ABI, getProvider(), NETWORK, senderAddress);
    }
    return _contract;
}
