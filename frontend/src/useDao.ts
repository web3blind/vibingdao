/**
 * DAO read/write hooks — all contract interactions live here.
 * Rules enforced:
 *   - signer: null / mldsaSigner: null in sendTransaction (wallet signs)
 *   - always simulate before send
 *   - never raw PSBT
 */
import { useCallback, useEffect, useState } from 'react';
import { Address } from '@btc-vision/transaction';
import { getDaoContract, getProvider, NETWORK } from './opnet';

// ── Types ──────────────────────────────────────────────────────────────────

export interface Proposal {
    id: bigint;
    proposalType: number;   // 0 = text, 1 = treasury
    yesVotes: bigint;
    noVotes: bigint;
    deadline: bigint;
    executed: boolean;
    amount: bigint;
    descriptionHash: string; // hex
}

export interface DaoStats {
    totalStaked: bigint;
    proposalCount: bigint;
    stakingToken: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse the packed `getProposal` BYTES response into a typed Proposal. */
function parseProposalBytes(bytes: Uint8Array, id: bigint): Proposal {
    let offset = 0;
    const proposalType = bytes[offset++];

    const readU256 = (): bigint => {
        let val = 0n;
        for (let i = 0; i < 32; i++) val = (val << 8n) | BigInt(bytes[offset++]);
        return val;
    };

    const yesVotes = readU256();
    const noVotes = readU256();
    const deadline = readU256();
    const executed = bytes[offset++] !== 0;
    const amount = readU256();
    const descHashBuf = bytes.slice(offset, offset + 32);
    const descriptionHash = Array.from(descHashBuf).map((b) => b.toString(16).padStart(2, '0')).join('');

    return { id, proposalType, yesVotes, noVotes, deadline, executed, amount, descriptionHash };
}

function addrFromStr(s: string): Address {
    // Accept both op1... and 0x... formats
    return Address.fromString(s);
}

// ── Stats hook ─────────────────────────────────────────────────────────────

export function useDaoStats() {
    const [stats, setStats] = useState<DaoStats | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const contract = getDaoContract();
            const [ts, pc, st] = await Promise.all([
                contract.getTotalStaked(),
                contract.getProposalCount(),
                contract.getStakingToken(),
            ]);
            setStats({
                totalStaked: BigInt(ts.properties?.total ?? ts.result ?? 0),
                proposalCount: BigInt(pc.properties?.count ?? pc.result ?? 0),
                stakingToken: String(st.properties?.token ?? st.result ?? ''),
            });
        } catch {
            // RPC not reachable / contract not deployed yet — show zeros
            setStats({ totalStaked: 0n, proposalCount: 0n, stakingToken: 'Not deployed' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);
    return { stats, loading, refresh };
}

// ── Proposals hook ─────────────────────────────────────────────────────────

export function useProposals(count: bigint) {
    const [proposals, setProposals] = useState<Proposal[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (count === 0n) { setProposals([]); return; }

        setLoading(true);
        const contract = getDaoContract();
        const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

        Promise.all(
            ids.map(async (id) => {
                try {
                    const res = await contract.getProposal(id);
                    // result is raw bytes from BYTES return type
                    const bytes: Uint8Array =
                        res.properties?.data ?? res.result ?? new Uint8Array(0);
                    return parseProposalBytes(bytes, id);
                } catch {
                    return null;
                }
            }),
        ).then((results) => {
            setProposals(results.filter(Boolean) as Proposal[]);
            setLoading(false);
        });
    }, [count]);

    return { proposals, loading };
}

// ── Staked balance hook ────────────────────────────────────────────────────

export function useStakedBalance(address: string) {
    const [balance, setBalance] = useState(0n);

    useEffect(() => {
        if (!address) return;
        getDaoContract()
            .stakedBalance(addrFromStr(address))
            .then((r: { properties?: { amount?: bigint }; result?: bigint }) => {
                setBalance(BigInt(r.properties?.amount ?? r.result ?? 0));
            })
            .catch(() => {});
    }, [address]);

    return balance;
}

// ── Write actions ──────────────────────────────────────────────────────────

export function useDaoActions(address: string) {
    const contract = useCallback(
        () => getDaoContract(address ? addrFromStr(address) : undefined),
        [address],
    );

    const stake = useCallback(
        async (amount: bigint) => {
            const c = contract();
            const sim = await c.stake(amount);
            return sim.sendTransaction({
                signer: null,
                mldsaSigner: null,
                provider: getProvider(),
                network: NETWORK,
            });
        },
        [contract],
    );

    const unstake = useCallback(
        async (amount: bigint) => {
            const c = contract();
            const sim = await c.unstake(amount);
            return sim.sendTransaction({
                signer: null,
                mldsaSigner: null,
                provider: getProvider(),
                network: NETWORK,
            });
        },
        [contract],
    );

    const createProposal = useCallback(
        async (
            proposalType: number,
            descriptionHash: bigint,
            amount: bigint,
            recipient: string,
            token: string,
        ) => {
            const recipientAddr = recipient
                ? addrFromStr(recipient)
                : Address.fromString('0x' + '00'.repeat(32));
            const tokenAddr = token
                ? addrFromStr(token)
                : Address.fromString('0x' + '00'.repeat(32));

            const c = contract();
            const sim = await c.createProposal(
                proposalType,
                descriptionHash,
                amount,
                recipientAddr,
                tokenAddr,
            );
            return sim.sendTransaction({
                signer: null,
                mldsaSigner: null,
                provider: getProvider(),
                network: NETWORK,
            });
        },
        [contract],
    );

    const vote = useCallback(
        async (proposalId: bigint, support: boolean) => {
            const c = contract();
            const sim = await c.vote(proposalId, support);
            return sim.sendTransaction({
                signer: null,
                mldsaSigner: null,
                provider: getProvider(),
                network: NETWORK,
            });
        },
        [contract],
    );

    const executeProposal = useCallback(
        async (proposalId: bigint) => {
            const c = contract();
            const sim = await c.executeProposal(proposalId);
            return sim.sendTransaction({
                signer: null,
                mldsaSigner: null,
                provider: getProvider(),
                network: NETWORK,
            });
        },
        [contract],
    );

    return { stake, unstake, createProposal, vote, executeProposal };
}
