/**
 * DAO read/write hooks.
 * Rules:
 *   - signer: null / mldsaSigner: null in sendTransaction (wallet signs)
 *   - always simulate before send
 *   - never raw PSBT
 */
import { useCallback, useEffect, useState } from 'react';
import { Address } from '@btc-vision/transaction';
import { getReadContract, getWriteContract, getProvider, NETWORK } from './opnet';

// ── Types ──────────────────────────────────────────────────────────────────

export interface Proposal {
    id: bigint;
    proposalType: number;   // 0 = text, 1 = treasury
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

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse the packed `getProposal` BYTES response.
 *  Layout: u8 proposalType | u256 yes | u256 no | u256 deadline |
 *          bool executed | u256 amount | u256 descHash
 */
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
    const noVotes = readU256();
    const deadline = readU256();
    const executed = bytes[offset++] !== 0;
    const amount = readU256();
    const descHashBuf = bytes.slice(offset, offset + 32);
    const descriptionHash = Array.from(descHashBuf)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    return { id, proposalType, yesVotes, noVotes, deadline, executed, amount, descriptionHash };
}

/** Safely convert address string to Address object; returns null on failure. */
function tryAddrFromStr(s: string): Address | null {
    if (!s) return null;
    try {
        return Address.fromString(s);
    } catch {
        return null;
    }
}

// ── Stats hook ─────────────────────────────────────────────────────────────

export function useDaoStats() {
    const [stats, setStats] = useState<DaoStats | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const contract = getReadContract();
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
        const contract = getReadContract();
        const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

        Promise.all(
            ids.map(async (id) => {
                try {
                    const res = await contract.getProposal(id);
                    const bytes: Uint8Array =
                        res.properties?.data ?? res.result ?? new Uint8Array(0);
                    return parseProposalBytes(bytes, id);
                } catch {
                    return null;
                }
            }),
        )
            .then((results) => {
                setProposals(results.filter(Boolean) as Proposal[]);
            })
            .catch(() => {
                setProposals([]);
            })
            .finally(() => {
                setLoading(false);
            });
    }, [count]);

    return { proposals, loading };
}

// ── Staked balance hook ────────────────────────────────────────────────────

export function useStakedBalance(address: string) {
    const [balance, setBalance] = useState(0n);

    useEffect(() => {
        const addr = tryAddrFromStr(address);
        if (!addr) return;
        getReadContract()
            .stakedBalance(addr)
            .then((r: { properties?: { amount?: bigint }; result?: bigint }) => {
                setBalance(BigInt(r.properties?.amount ?? r.result ?? 0));
            })
            .catch(() => {});
    }, [address]);

    return balance;
}

// ── Write actions ──────────────────────────────────────────────────────────

export function useDaoActions(address: string) {
    // getWriteContract is safe — it gracefully handles non-hex bech32 addresses
    const contract = useCallback(() => getWriteContract(address), [address]);

    const stake = useCallback(
        async (amount: bigint) => {
            const sim = await contract().stake(amount);
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
            const sim = await contract().unstake(amount);
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
            const zero = Address.fromString('0x' + '00'.repeat(32));
            const recipientAddr = tryAddrFromStr(recipient) ?? zero;
            const tokenAddr = tryAddrFromStr(token) ?? zero;

            const sim = await contract().createProposal(
                proposalType, descriptionHash, amount, recipientAddr, tokenAddr,
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
            const sim = await contract().vote(proposalId, support);
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
            const sim = await contract().executeProposal(proposalId);
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
