/**
 * DAO registry — add a new entry here to support another staking token.
 * Each entry requires:
 *   - A deployed VibingDAO contract (daoP2op)
 *   - The OP20 staking token contract (tokenP2op) — may equal daoP2op for VIBE
 */
import { ABIDataTypes } from '@btc-vision/transaction';
import type { BitcoinInterfaceAbi } from 'opnet';

export interface DaoConfig {
    id: string;
    name: string;
    symbol: string;
    icon: string;
    color: string;       // CSS colour for accent / border
    daoP2op: string;     // opt1... bech32 DAO contract address
    tokenP2op: string;   // opt1... bech32 staking token (= daoP2op for VIBE)
    decimals: number;
}

export const DAO_CONFIGS: DaoConfig[] = [
    {
        id: 'vibe',
        name: 'VibingDAO',
        symbol: 'VIBE',
        icon: '🎵',
        color: '#7c3aed',
        daoP2op:   'opt1sqqtee6htq8t5pgtwa2rgnlrts2v95wsa7g7tz0wl',
        tokenP2op: 'opt1sqqtee6htq8t5pgtwa2rgnlrts2v95wsa7g7tz0wl', // VIBE = DAO contract
        decimals: 8,
    },
    {
        id: 'moto',
        name: 'Motoswap DAO',
        symbol: 'MOTO',
        icon: '🏍',
        color: '#ea580c',
        daoP2op:   'opt1sqqgnnyefd03744zeqq2v0f9zendw0pjmu5z5w652',
        tokenP2op: 'opt1sqzkx6wm5acawl9m6nay2mjsm6wagv7gazcgtczds',
        decimals: 8,
    },
    // Add PILL and tBTC entries here once contract addresses are known:
    // {
    //     id: 'pill',
    //     name: 'Orange Pill DAO',
    //     symbol: 'PILL',
    //     icon: '💊',
    //     color: '#e11d48',
    //     daoP2op:   'opt1...',   // deploy with: node deploy.mjs --token <PILL_P2OP>
    //     tokenP2op: 'opt1...',
    //     decimals: 8,
    // },
];

/** Minimal OP20 ABI: balanceOf + allowance + approve */
export const OP20_ABI: BitcoinInterfaceAbi = [
    {
        name: 'balanceOf',
        type: 'function' as const,
        inputs:  [{ name: 'account', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'balance', type: ABIDataTypes.UINT256 }],
    },
    {
        name: 'allowance',
        type: 'function' as const,
        inputs:  [
            { name: 'owner',   type: ABIDataTypes.ADDRESS },
            { name: 'spender', type: ABIDataTypes.ADDRESS },
        ],
        outputs: [{ name: 'remaining', type: ABIDataTypes.UINT256 }],
    },
    {
        name: 'approve',
        type: 'function' as const,
        inputs:  [
            { name: 'spender', type: ABIDataTypes.ADDRESS },
            { name: 'value',   type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
] as unknown as BitcoinInterfaceAbi;
