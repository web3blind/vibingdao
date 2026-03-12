/**
 * DAO registry — add a new entry here to support another staking token.
 * Each entry requires:
 *   - A deployed VibingDAO contract (daoP2op)
 *   - The OP20 staking token contract (tokenP2op) — may equal daoP2op for VIBE
 */

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
        decimals: 18,
    },
    {
        id: 'pill',
        name: 'Orange Pill DAO',
        symbol: 'PILL',
        icon: '💊',
        color: '#e11d48',
        daoP2op:   'opt1sqpsff94rtfzfl864jpjlv8alguk8uwq6wuvcyfx4',
        tokenP2op: 'opt1sqp5gx9k0nrqph3sy3aeyzt673dz7ygtqxcfdqfle',
        decimals: 8,
    },
];

/**
 * OP20 ABI using the official opnet OP_20_ABI.
 * Key: OP20 does NOT have approve() — use increaseAllowance() instead.
 */
export { OP_20_ABI as OP20_ABI } from 'opnet';
