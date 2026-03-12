/**
 * DAO + OP20 hooks.
 * walletAddr  — full Address object from @btc-vision/walletconnect (ML-DSA hash + legacyPublicKey).
 * btcAddress  — opt1p... p2tr string used only for refundTo in sendTransaction.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Address, UnisatSigner } from '@btc-vision/transaction';
import { OPNetLimitedProvider } from '@btc-vision/transaction';
import {
    getDaoReadContract,
    getDaoWriteContract,
    getTokenReadContract,
    getTokenWriteContract,
    resolveP2op,
    NETWORK,
    RPC_URL,
} from './opnet';
import type { DaoConfig } from './daos';

// ── Shared types ────────────────────────────────────────────────────────────

export interface Proposal {
    id: bigint;
    proposalType: number;
    yesVotes: bigint;
    noVotes: bigint;
    deadline: bigint;
    executed: boolean;
    amount: bigint;
    descriptionHash: string;
}

export interface DaoStats {
    totalStaked: bigint;
    proposalCount: bigint;
    stakingToken: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseProposalBytes(bytes: Uint8Array, id: bigint): Proposal {
    if (!bytes || bytes.length < 162) {
        return { id, proposalType: 0, yesVotes: 0n, noVotes: 0n, deadline: 0n, executed: false, amount: 0n, descriptionHash: '' };
    }
    let offset = 0;
    const proposalType = bytes[offset++];
    const readU256 = (): bigint => {
        let val = 0n;
        for (let i = 0; i < 32; i++) val = (val << 8n) | BigInt(bytes[offset++]);
        return val;
    };
    const yesVotes = readU256();
    const noVotes  = readU256();
    const deadline = readU256();
    const executed = bytes[offset++] !== 0;
    const amount   = readU256();
    const descHash = Array.from(bytes.slice(offset, offset + 32))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
    return { id, proposalType, yesVotes, noVotes, deadline, executed, amount, descriptionHash: descHash };
}

function bigVal(r: unknown): bigint {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (r as any)?.properties;
    if (v) {
        const first = Object.values(v)[0];
        if (first !== undefined) return BigInt(first as string | number | bigint);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (r as any)?.result;
    if (res !== undefined) return BigInt(res);
    return 0n;
}

// ── DAO Stats ───────────────────────────────────────────────────────────────

export function useDaoStats(dao: DaoConfig) {
    const [stats,   setStats]   = useState<DaoStats | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const c = await getDaoReadContract(dao.daoP2op);
            const [ts, pc, st] = await Promise.all([
                c.getTotalStaked(),
                c.getProposalCount(),
                c.getStakingToken(),
            ]);
            setStats({
                totalStaked:   bigVal(ts),
                proposalCount: bigVal(pc),
                stakingToken:  String((st as {properties?: {token?: unknown}; result?: unknown})?.properties?.token ?? (st as {result?: unknown})?.result ?? ''),
            });
        } catch {
            setStats({ totalStaked: 0n, proposalCount: 0n, stakingToken: 'Not deployed' });
        } finally {
            setLoading(false);
        }
    }, [dao.daoP2op]);

    useEffect(() => { refresh(); }, [refresh]);
    return { stats, loading, refresh };
}

// ── Proposals ───────────────────────────────────────────────────────────────

export function useProposals(dao: DaoConfig, count: bigint) {
    const [proposals, setProposals] = useState<Proposal[]>([]);
    const [loading,   setLoading]   = useState(false);

    useEffect(() => {
        if (count === 0n) { setProposals([]); return; }
        setLoading(true);
        const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

        getDaoReadContract(dao.daoP2op).then((c) =>
            Promise.all(ids.map(async (id) => {
                try {
                    const res = await c.getProposal(id);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const bytes: Uint8Array = (res as any)?.properties?.data ?? (res as any)?.result ?? new Uint8Array(0);
                    return parseProposalBytes(bytes, id);
                } catch { return null; }
            }))
        ).then((results) => {
            setProposals(results.filter(Boolean) as Proposal[]);
        }).catch(() => {
            setProposals([]);
        }).finally(() => {
            setLoading(false);
        });
    }, [dao.daoP2op, count]);

    return { proposals, loading };
}

// ── Staked balance in a specific DAO ────────────────────────────────────────

export function useStakedBalance(dao: DaoConfig, walletAddr: Address | null) {
    const [balance, setBalance] = useState(0n);

    useEffect(() => {
        if (!walletAddr) return;
        let cancelled = false;
        async function fetch() {
            try {
                const c = await getDaoReadContract(dao.daoP2op);
                const r = await c.stakedBalance(walletAddr);
                if (!cancelled) setBalance(bigVal(r));
            } catch { if (!cancelled) setBalance(0n); }
        }
        fetch();
        return () => { cancelled = true; };
    }, [dao.daoP2op, walletAddr]);

    return balance;
}

// ── OP20 token wallet balance ────────────────────────────────────────────────

export function useTokenBalance(dao: DaoConfig, walletAddr: Address | null) {
    const [balance, setBalance] = useState(0n);

    useEffect(() => {
        if (!walletAddr) return;
        let cancelled = false;
        async function fetch() {
            try {
                const c = await getTokenReadContract(dao.tokenP2op);
                const r = await c.balanceOf(walletAddr);
                if (!cancelled) setBalance(bigVal(r));
            } catch { if (!cancelled) setBalance(0n); }
        }
        fetch();
        return () => { cancelled = true; };
    }, [dao.tokenP2op, walletAddr]);

    return balance;
}

// ── Staked balance across all DAOs (for home page) ──────────────────────────

export function useAllStakedBalances(daos: DaoConfig[], walletAddr: Address | null) {
    const [balances, setBalances] = useState<Record<string, bigint>>({});

    useEffect(() => {
        if (!walletAddr) { setBalances({}); return; }
        let cancelled = false;
        async function fetch() {
            try {
                const entries = await Promise.all(
                    daos.map(async (dao) => {
                        try {
                            const c = await getDaoReadContract(dao.daoP2op);
                            const r = await c.stakedBalance(walletAddr);
                            return [dao.id, bigVal(r)] as const;
                        } catch { return [dao.id, 0n] as const; }
                    })
                );
                if (!cancelled) setBalances(Object.fromEntries(entries));
            } catch { if (!cancelled) setBalances({}); }
        }
        fetch();
        return () => { cancelled = true; };
    }, [daos, walletAddr]);

    return balances;
}

// ── Token allowance ─────────────────────────────────────────────────────────

export function useTokenAllowance(dao: DaoConfig, walletAddr: Address | null) {
    const [allowance, setAllowance] = useState(0n);

    const refresh = useCallback(async () => {
        if (!walletAddr) return;
        try {
            const [c, daoAddr] = await Promise.all([
                getTokenReadContract(dao.tokenP2op),
                resolveP2op(dao.daoP2op),
            ]);
            const r = await c.allowance(walletAddr, daoAddr);
            setAllowance(bigVal(r));
        } catch { setAllowance(0n); }
    }, [dao.tokenP2op, dao.daoP2op, walletAddr]);

    useEffect(() => { refresh(); }, [refresh]);
    return { allowance, refreshAllowance: refresh };
}

// ── Token decimals ───────────────────────────────────────────────────────────

export function useTokenDecimals(dao: DaoConfig): number {
    const [decimals, setDecimals] = useState<number>(dao.decimals);

    useEffect(() => {
        let cancelled = false;
        getTokenReadContract(dao.tokenP2op).then(async (c) => {
            try {
                const r = await c.decimals();
                const d = Number(bigVal(r));
                if (!cancelled && d > 0) setDecimals(d);
            } catch { /* keep config default */ }
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [dao.tokenP2op, dao.decimals]);

    return decimals;
}

// ── Write actions ────────────────────────────────────────────────────────────

const MAX_U256 = (1n << 256n) - 1n;

/**
 * Fetch UTXOs via OPNetLimitedProvider (REST /api/v1/address/utxos).
 * Queries both p2tr AND p2wpkh addresses so UTXOs on either are found.
 */
const _limitedProvider = new OPNetLimitedProvider(RPC_URL);

export const NO_UTXOS_ERROR =
    'NO_UTXOS: Your address has no UTXOs on OPNet testnet. ' +
    'Get testnet BTC from the OPNet faucet in Discord (discord.gg/opnet → #faucet).';

async function fetchUTXOs(btcAddress: string, signer: UnisatSigner | null): Promise<unknown[]> {
    // Collect all candidate addresses: signer gives [p2wpkh, p2tr], plus btcAddress as fallback
    const signerAddresses = signer?.addresses ?? [];
    const addresses = signerAddresses.length
        ? Array.from(new Set([...signerAddresses, btcAddress].filter(Boolean)))
        : [btcAddress];

    console.debug('[VibingDAO] fetchUTXOs: querying addresses', addresses);

    // Try each address individually so we can log which one has UTXOs
    const allUtxos: unknown[] = [];
    for (const addr of addresses) {
        try {
            const url = `${RPC_URL}/api/v1/address/utxos?address=${encodeURIComponent(addr)}&optimize=false`;
            console.debug('[VibingDAO] fetchUTXOs: GET', url);
            const res  = await fetch(url);
            const json = await res.json() as { confirmed?: unknown[]; pending?: unknown[]; raw?: unknown[] };
            console.debug('[VibingDAO] fetchUTXOs: response for', addr, {
                confirmed: json.confirmed?.length ?? 0,
                pending:   json.pending?.length   ?? 0,
                raw:       json.raw?.length        ?? 0,
            });
            if ((json.confirmed?.length ?? 0) > 0 || (json.pending?.length ?? 0) > 0) {
                // Found UTXOs — use OPNetLimitedProvider to get properly-parsed UTXO objects
                const found = await _limitedProvider.fetchUTXOMultiAddr({
                    addresses:      [addr],
                    minAmount:      330n,
                    requestedAmount: 1_000_000n,
                });
                allUtxos.push(...found);
            }
        } catch (err) {
            console.debug('[VibingDAO] fetchUTXOs: error for', addr, err);
        }
    }

    console.debug('[VibingDAO] fetchUTXOs: total UTXOs found:', allUtxos.length);
    return allUtxos;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendViaWallet(sim: any, btcAddress: string, signer: UnisatSigner | null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opnet = (window as any).opnet;
    if (!opnet?.web3) throw new Error('OP_WALLET not found');

    // Also query any accounts the wallet knows about (may differ from walletconnect address)
    let extraAddresses: string[] = [];
    try {
        extraAddresses = (await opnet.getAccounts()) ?? [];
        console.debug('[VibingDAO] opnet.getAccounts():', extraAddresses);
    } catch { /* ignore */ }

    // Build a signer-like object with extra addresses appended
    const signerWithExtras = extraAddresses.length
        ? { addresses: [...(signer?.addresses ?? [btcAddress]), ...extraAddresses] } as unknown as UnisatSigner
        : signer;

    const utxos = await fetchUTXOs(btcAddress, signerWithExtras);
    if (utxos.length === 0) throw new Error(NO_UTXOS_ERROR);

    return opnet.web3.signAndBroadcastInteraction({
        contract:                    sim.address.toHex(),
        calldata:                    sim.calldata,
        priorityFee:                 0n,
        gasSatFee:                   sim.estimatedSatGas ?? 1000n,
        feeRate:                     10,
        from:                        btcAddress,
        utxos,
        to:                          sim.to,
        network:                     NETWORK,
        optionalInputs:              [],
        optionalOutputs:             [],
        txVersion:                   2,
        linkMLDSAPublicKeyToAddress: true,
        revealMLDSAPublicKey:        false,
    });
}

export function useDaoActions(
    dao: DaoConfig,
    walletAddr: Address | null,
    btcAddress: string,
    signer: UnisatSigner | null,
) {
    const approve = useCallback(async () => {
        if (!walletAddr) throw new Error('Wallet not connected');
        const c       = await getTokenWriteContract(dao.tokenP2op, walletAddr);
        const daoAddr = await resolveP2op(dao.daoP2op);
        // OP20 uses increaseAllowance, not approve
        const sim     = await c.increaseAllowance(daoAddr, MAX_U256);
        return sendViaWallet(sim, btcAddress, signer);
    }, [dao, walletAddr, btcAddress, signer]);

    const stake = useCallback(async (amount: bigint) => {
        if (!walletAddr) throw new Error('Wallet not connected');
        const c   = await getDaoWriteContract(dao.daoP2op, walletAddr);
        const sim = await c.stake(amount);
        return sendViaWallet(sim, btcAddress, signer);
    }, [dao.daoP2op, walletAddr, btcAddress, signer]);

    const unstake = useCallback(async (amount: bigint) => {
        if (!walletAddr) throw new Error('Wallet not connected');
        const c   = await getDaoWriteContract(dao.daoP2op, walletAddr);
        const sim = await c.unstake(amount);
        return sendViaWallet(sim, btcAddress, signer);
    }, [dao.daoP2op, walletAddr, btcAddress, signer]);

    const vote = useCallback(async (proposalId: bigint, support: boolean) => {
        if (!walletAddr) throw new Error('Wallet not connected');
        const c   = await getDaoWriteContract(dao.daoP2op, walletAddr);
        const sim = await c.vote(proposalId, support);
        return sendViaWallet(sim, btcAddress, signer);
    }, [dao.daoP2op, walletAddr, btcAddress, signer]);

    const executeProposal = useCallback(async (proposalId: bigint) => {
        if (!walletAddr) throw new Error('Wallet not connected');
        const c   = await getDaoWriteContract(dao.daoP2op, walletAddr);
        const sim = await c.executeProposal(proposalId);
        return sendViaWallet(sim, btcAddress, signer);
    }, [dao.daoP2op, walletAddr, btcAddress, signer]);

    const createProposal = useCallback(async (
        proposalType: number,
        descriptionHash: bigint,
        amount: bigint,
        recipient: string,
        token: string,
    ) => {
        if (!walletAddr) throw new Error('Wallet not connected');
        const zeroAddr = await resolveP2op('opt1sqqtee6htq8t5pgtwa2rgnlrts2v95wsa7g7tz0wl').catch(
            () => { throw new Error('Cannot resolve zero address'); }
        );
        const recipientAddr = recipient ? await resolveP2op(recipient).catch(() => zeroAddr) : zeroAddr;
        const tokenAddr     = token     ? await resolveP2op(token).catch(() => zeroAddr)     : zeroAddr;
        const c   = await getDaoWriteContract(dao.daoP2op, walletAddr);
        const sim = await c.createProposal(proposalType, descriptionHash, amount, recipientAddr, tokenAddr);
        return sendViaWallet(sim, btcAddress, signer);
    }, [dao.daoP2op, walletAddr, btcAddress, signer]);

    return { approve, stake, unstake, vote, executeProposal, createProposal };
}
