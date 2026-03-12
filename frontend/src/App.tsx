import { useState } from 'react';
import './index.css';
import { ToastProvider, useToast } from './ToastContext';
import { useWallet } from './useWallet';
import { useDaoStats, useProposals, useStakedBalance, useDaoActions } from './useDao';
import type { Proposal } from './useDao';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: bigint, decimals = 8): string {
    if (n === 0n) return '0';
    const d = 10n ** BigInt(decimals);
    const whole = n / d;
    const frac = (n % d).toString().padStart(decimals, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
}

function shortAddr(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function isActive(p: Proposal, currentBlock: bigint): boolean {
    return !p.executed && p.deadline >= currentBlock;
}

function votePercent(p: Proposal): number {
    const total = p.yesVotes + p.noVotes;
    if (total === 0n) return 0;
    return Number((p.yesVotes * 100n) / total);
}

// ── Wallet header ──────────────────────────────────────────────────────────

function WalletBar() {
    const { connected, address, connect, disconnect } = useWallet();
    return connected ? (
        <div className="wallet-info">
            <span className="address-pill">{shortAddr(address)}</span>
            <button className="btn-outline btn-sm" onClick={disconnect}>Disconnect</button>
        </div>
    ) : (
        <button onClick={connect}>Connect OP_WALLET</button>
    );
}

// ── Stats row ──────────────────────────────────────────────────────────────

function StatsRow({ stats, loading }: { stats: ReturnType<typeof useDaoStats>['stats']; loading: boolean }) {
    if (loading) return <div className="loading">Loading stats…</div>;
    return (
        <div className="stats">
            <div className="stat">
                <div className="stat-label">Total Staked</div>
                <div className="stat-value">{stats ? fmt(stats.totalStaked) : '–'}</div>
            </div>
            <div className="stat">
                <div className="stat-label">Proposals</div>
                <div className="stat-value">{stats ? String(stats.proposalCount) : '–'}</div>
            </div>
            <div className="stat">
                <div className="stat-label">Staking Token</div>
                <div className="stat-value" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                    {stats ? shortAddr(stats.stakingToken) : '–'}
                </div>
            </div>
        </div>
    );
}

// ── Single proposal card ───────────────────────────────────────────────────

function ProposalCard({
    proposal,
    onVote,
    onExecute,
    connected,
}: {
    proposal: Proposal;
    onVote: (id: bigint, support: boolean) => void;
    onExecute: (id: bigint) => void;
    connected: boolean;
}) {
    const active = isActive(proposal, 0n); // simplified: use deadline vs current block
    const pct = votePercent(proposal);

    return (
        <div className="proposal">
            <div className="proposal-header">
                <span className="proposal-id">#{String(proposal.id)}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                    <span className={`badge badge-${proposal.proposalType === 0 ? 'text' : 'treasury'}`}>
                        {proposal.proposalType === 0 ? 'Text' : 'Treasury'}
                    </span>
                    {proposal.executed ? (
                        <span className={`badge ${pct > 50 ? 'badge-passed' : 'badge-failed'}`}>
                            {pct > 50 ? 'Passed' : 'Failed'}
                        </span>
                    ) : (
                        <span className="badge badge-active">Active</span>
                    )}
                </div>
            </div>

            <div className="hash-display">Hash: 0x{proposal.descriptionHash}</div>
            {proposal.proposalType === 1 && proposal.amount > 0n && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    Transfer: {fmt(proposal.amount)} tokens
                </div>
            )}

            <div className="vote-bar">
                <div className="vote-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="vote-counts">
                <span className="vote-yes">YES {fmt(proposal.yesVotes)} ({pct}%)</span>
                <span className="vote-no">NO {fmt(proposal.noVotes)}</span>
            </div>

            {connected && !proposal.executed && (
                <div className="proposal-actions">
                    {active && (
                        <>
                            <button className="btn-yes btn-sm" onClick={() => onVote(proposal.id, true)}>
                                Vote YES
                            </button>
                            <button className="btn-no btn-sm" onClick={() => onVote(proposal.id, false)}>
                                Vote NO
                            </button>
                        </>
                    )}
                    {!active && (
                        <button className="btn-sm" onClick={() => onExecute(proposal.id)}>
                            Execute
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Stake / Unstake panel ──────────────────────────────────────────────────

function StakePanel({ address }: { address: string }) {
    const { show } = useToast();
    const { stake, unstake } = useDaoActions(address);
    const balance = useStakedBalance(address);
    const [amount, setAmount] = useState('');
    const [busy, setBusy] = useState(false);

    const handle = async (fn: (n: bigint) => Promise<unknown>, label: string) => {
        if (!amount || isNaN(Number(amount))) { show('Enter a valid amount', 'error'); return; }
        setBusy(true);
        try {
            const satoshis = BigInt(Math.round(Number(amount) * 1e8));
            await fn(satoshis);
            show(`${label} submitted!`, 'success');
            setAmount('');
        } catch (e) {
            show(`${label} failed: ${(e as Error).message}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="card">
            <div className="card-title">Stake / Unstake</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                Staked: {fmt(balance)} VIBE
            </div>
            <div className="row">
                <div className="form-group" style={{ margin: 0 }}>
                    <input
                        type="number"
                        placeholder="Amount (VIBE)"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        disabled={busy}
                    />
                </div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
                <button onClick={() => handle(stake, 'Stake')} disabled={busy}>
                    Stake
                </button>
                <button
                    className="btn-outline"
                    onClick={() => handle(unstake, 'Unstake')}
                    disabled={busy}
                >
                    Unstake
                </button>
            </div>
        </div>
    );
}

// ── Create proposal panel ──────────────────────────────────────────────────

function CreateProposalPanel({ address }: { address: string }) {
    const { show } = useToast();
    const { createProposal } = useDaoActions(address);
    const [type, setType] = useState<0 | 1>(0);
    const [desc, setDesc] = useState('');
    const [amount, setAmount] = useState('');
    const [recipient, setRecipient] = useState('');
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (!desc.trim()) { show('Enter a description', 'error'); return; }
        setBusy(true);
        try {
            // Simple hash: encode description as UTF-8 and take first 32 bytes as big-endian u256
            const enc = new TextEncoder().encode(desc.slice(0, 32).padEnd(32, '\0'));
            let hash = 0n;
            for (const b of enc) hash = (hash << 8n) | BigInt(b);

            const amountSats = amount ? BigInt(Math.round(Number(amount) * 1e8)) : 0n;
            await createProposal(type, hash, amountSats, recipient, token);
            show('Proposal created!', 'success');
            setDesc(''); setAmount(''); setRecipient(''); setToken('');
        } catch (e) {
            show(`Failed: ${(e as Error).message}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="card">
            <div className="card-title">Create Proposal</div>
            <div className="form-group">
                <label>Type</label>
                <select value={type} onChange={(e) => setType(Number(e.target.value) as 0 | 1)}>
                    <option value={0}>Text — informational, simple majority</option>
                    <option value={1}>Treasury — token transfer, requires quorum</option>
                </select>
            </div>
            <div className="form-group">
                <label>Description</label>
                <textarea
                    placeholder="Describe the proposal…"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    disabled={busy}
                />
            </div>
            {type === 1 && (
                <>
                    <div className="row">
                        <div className="form-group">
                            <label>Amount (tokens)</label>
                            <input
                                type="number"
                                placeholder="0.0"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                disabled={busy}
                            />
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Recipient address</label>
                        <input
                            placeholder="op1... or 0x..."
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            disabled={busy}
                        />
                    </div>
                    <div className="form-group">
                        <label>Token address (blank = staking token)</label>
                        <input
                            placeholder="op1... or 0x..."
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            disabled={busy}
                        />
                    </div>
                </>
            )}
            <button onClick={submit} disabled={busy || !address}>
                {busy ? 'Submitting…' : 'Create Proposal'}
            </button>
        </div>
    );
}

// ── Root App ───────────────────────────────────────────────────────────────

function DaoApp() {
    const { show } = useToast();
    const { connected, address } = useWallet();
    const { stats, loading: statsLoading, refresh } = useDaoStats();
    const { proposals, loading: propsLoading } = useProposals(stats?.proposalCount ?? 0n);
    const { vote, executeProposal } = useDaoActions(address);
    const [tab, setTab] = useState<'proposals' | 'stake' | 'create'>('proposals');

    const handleVote = async (id: bigint, support: boolean) => {
        try {
            await vote(id, support);
            show(`Vote ${support ? 'YES' : 'NO'} submitted`, 'success');
            refresh();
        } catch (e) {
            show(`Vote failed: ${(e as Error).message}`, 'error');
        }
    };

    const handleExecute = async (id: bigint) => {
        try {
            await executeProposal(id);
            show('Execution submitted', 'success');
            refresh();
        } catch (e) {
            show(`Execute failed: ${(e as Error).message}`, 'error');
        }
    };

    return (
        <div className="app">
            <header>
                <div className="logo">Vibing<span>DAO</span></div>
                <WalletBar />
            </header>

            <StatsRow stats={stats} loading={statsLoading} />

            <div className="tabs">
                <button className={`tab${tab === 'proposals' ? ' active' : ''}`} onClick={() => setTab('proposals')}>
                    Proposals
                </button>
                <button
                    className={`tab${tab === 'stake' ? ' active' : ''}`}
                    onClick={() => setTab('stake')}
                    disabled={!connected}
                >
                    Stake
                </button>
                <button
                    className={`tab${tab === 'create' ? ' active' : ''}`}
                    onClick={() => setTab('create')}
                    disabled={!connected}
                >
                    Create
                </button>
            </div>

            {tab === 'proposals' && (
                <>
                    <div className="section-header">
                        <span className="section-title">Governance Proposals</span>
                        <button className="btn-outline btn-sm" onClick={refresh}>
                            Refresh
                        </button>
                    </div>
                    {propsLoading ? (
                        <div className="loading">Loading proposals…</div>
                    ) : proposals.length === 0 ? (
                        <div className="empty">No proposals yet. Connect wallet and create the first one.</div>
                    ) : (
                        <div className="proposal-list">
                            {[...proposals].reverse().map((p) => (
                                <ProposalCard
                                    key={String(p.id)}
                                    proposal={p}
                                    onVote={handleVote}
                                    onExecute={handleExecute}
                                    connected={connected}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}

            {tab === 'stake' && connected && <StakePanel address={address} />}
            {tab === 'create' && connected && <CreateProposalPanel address={address} />}

            {!connected && tab !== 'proposals' && (
                <div className="empty">Connect your OP_WALLET to continue.</div>
            )}
        </div>
    );
}

export default function App() {
    return (
        <ToastProvider>
            <DaoApp />
        </ToastProvider>
    );
}
