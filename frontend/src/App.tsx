import { useState, useEffect } from 'react';
import './index.css';
import { ToastProvider, useToast } from './ToastContext';
import { WalletProvider, useWallet } from './useWallet';
import { ErrorBoundary } from './ErrorBoundary';
import { DAO_CONFIGS } from './daos';
import type { DaoConfig } from './daos';
import { prefetchAddresses } from './opnet';
import {
    useDaoStats,
    useProposals,
    useStakedBalance,
    useTokenBalance,
    useTokenAllowance,
    useAllStakedBalances,
    useDaoActions,
    useTokenDecimals,
} from './useDao';
import type { Proposal } from './useDao';
import type { Address } from '@btc-vision/transaction';

// Pre-warm address cache for all known contracts
prefetchAddresses(DAO_CONFIGS.flatMap((d) => [d.daoP2op, d.tokenP2op]));

// ── Error helper ────────────────────────────────────────────────────────────

function txError(e: unknown): string {
    const msg = (e as Error)?.message ?? String(e);
    if (msg.startsWith('NO_UTXOS:')) {
        return 'No UTXOs on OPNet testnet. Get tBTC from the OPNet faucet: discord.gg/opnet → #faucet';
    }
    return msg;
}

// ── Formatters ──────────────────────────────────────────────────────────────

function fmt(n: bigint, decimals = 8): string {
    if (n === 0n) return '0';
    const d     = 10n ** BigInt(decimals);
    const whole = n / d;
    const frac  = (n % d).toString().padStart(decimals, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
}

function shortAddr(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function votePercent(p: Proposal): number {
    const total = p.yesVotes + p.noVotes;
    if (total === 0n) return 0;
    return Number((p.yesVotes * 100n) / total);
}

// ── Wallet bar ──────────────────────────────────────────────────────────────

function WalletBar() {
    const { connected, btcAddress, connect, disconnect } = useWallet();
    return connected ? (
        <div className="wallet-info">
            <span className="address-pill">{shortAddr(btcAddress)}</span>
            <button className="btn-outline btn-sm" onClick={disconnect}>Disconnect</button>
        </div>
    ) : (
        <button onClick={connect}>Connect OP_WALLET</button>
    );
}

// ── Home page ───────────────────────────────────────────────────────────────

function HomePage({ onSelectDao }: { onSelectDao: (dao: DaoConfig) => void }) {
    const { connected, address } = useWallet();
    const stakedIn = useAllStakedBalances(DAO_CONFIGS, address);

    const myDaos   = DAO_CONFIGS.filter((d) => (stakedIn[d.id] ?? 0n) > 0n);
    const allDaos  = DAO_CONFIGS;

    return (
        <>
            {connected && myDaos.length > 0 && (
                <section>
                    <div className="section-header">
                        <span className="section-title">Your DAOs</span>
                    </div>
                    <div className="dao-grid">
                        {myDaos.map((dao) => (
                            <DaoCard
                                key={dao.id}
                                dao={dao}
                                staked={stakedIn[dao.id] ?? 0n}
                                onClick={() => onSelectDao(dao)}
                                highlight
                            />
                        ))}
                    </div>
                    <hr />
                </section>
            )}

            <div className="section-header">
                <span className="section-title">All DAOs</span>
                {!connected && <span className="muted-note">Connect wallet to stake</span>}
            </div>
            <div className="dao-grid">
                {allDaos.map((dao) => (
                    <DaoCard
                        key={dao.id}
                        dao={dao}
                        staked={stakedIn[dao.id] ?? 0n}
                        onClick={() => onSelectDao(dao)}
                        highlight={false}
                    />
                ))}
            </div>
        </>
    );
}

function DaoCard({
    dao, staked, onClick, highlight,
}: {
    dao: DaoConfig;
    staked: bigint;
    onClick: () => void;
    highlight: boolean;
}) {
    const { stats } = useDaoStats(dao);
    const decimals  = useTokenDecimals(dao);
    return (
        <button
            className={`dao-card${highlight ? ' dao-card-highlight' : ''}`}
            style={{ '--dao-color': dao.color } as React.CSSProperties}
            onClick={onClick}
        >
            <div className="dao-icon">{dao.icon}</div>
            <div className="dao-card-body">
                <div className="dao-card-name">{dao.name}</div>
                <div className="dao-card-symbol">{dao.symbol}</div>
                {stats && (
                    <div className="dao-card-stats">
                        <span>{String(stats.proposalCount)} proposals</span>
                        <span>{fmt(stats.totalStaked, decimals)} staked</span>
                    </div>
                )}
                {staked > 0n && (
                    <div className="dao-card-yours">
                        Your stake: <strong>{fmt(staked, decimals)} {dao.symbol}</strong>
                    </div>
                )}
            </div>
            <div className="dao-card-arrow">→</div>
        </button>
    );
}

// ── DAO detail page ─────────────────────────────────────────────────────────

function DaoPage({ dao, onBack }: { dao: DaoConfig; onBack: () => void }) {
    const { connected, address, btcAddress } = useWallet();
    const { stats, loading: statsLoading, refresh } = useDaoStats(dao);
    const { proposals, loading: propsLoading } = useProposals(dao, stats?.proposalCount ?? 0n);
    const decimals = useTokenDecimals(dao);
    const [tab, setTab] = useState<'proposals' | 'stake' | 'create'>('proposals');

    return (
        <div>
            {/* Back + header */}
            <div className="dao-page-header">
                <button className="btn-outline btn-sm back-btn" onClick={onBack}>← Back</button>
                <div className="dao-page-title" style={{ '--dao-color': dao.color } as React.CSSProperties}>
                    <span className="dao-page-icon">{dao.icon}</span>
                    <div>
                        <div className="dao-page-name">{dao.name}</div>
                        <div className="dao-page-token">staking {dao.symbol}</div>
                    </div>
                </div>
            </div>

            {/* Stats */}
            {statsLoading
                ? <div className="loading">Loading…</div>
                : stats && (
                    <div className="stats" style={{ marginBottom: 24 }}>
                        <div className="stat">
                            <div className="stat-label">Total Staked</div>
                            <div className="stat-value">{fmt(stats.totalStaked, decimals)}</div>
                        </div>
                        <div className="stat">
                            <div className="stat-label">Proposals</div>
                            <div className="stat-value">{String(stats.proposalCount)}</div>
                        </div>
                        {connected && address && (
                            <StakedStatCell dao={dao} walletAddr={address} decimals={decimals} />
                        )}
                    </div>
                )
            }

            {/* Tabs */}
            <div className="tabs">
                <button className={`tab${tab === 'proposals' ? ' active' : ''}`} onClick={() => setTab('proposals')}>
                    Proposals
                </button>
                <button
                    className={`tab${tab === 'stake' ? ' active' : ''}`}
                    onClick={() => { if (connected) setTab('stake'); }}
                    disabled={!connected}
                >
                    Stake
                </button>
                <button
                    className={`tab${tab === 'create' ? ' active' : ''}`}
                    onClick={() => { if (connected) setTab('create'); }}
                    disabled={!connected}
                >
                    Create
                </button>
            </div>

            {tab === 'proposals' && (
                <>
                    <div className="section-header">
                        <span className="section-title">Governance Proposals</span>
                        <button className="btn-outline btn-sm" onClick={refresh}>Refresh</button>
                    </div>
                    {propsLoading
                        ? <div className="loading">Loading proposals…</div>
                        : proposals.length === 0
                            ? <div className="empty">No proposals yet. Create the first one!</div>
                            : (
                                <div className="proposal-list">
                                    {[...proposals].reverse().map((p) => (
                                        <ProposalCard
                                            key={String(p.id)}
                                            proposal={p}
                                            dao={dao}
                                            decimals={decimals}
                                            connected={connected}
                                            walletAddr={address}
                                            btcAddress={btcAddress}
                                            onRefresh={refresh}
                                        />
                                    ))}
                                </div>
                            )
                    }
                </>
            )}

            {tab === 'stake' && (
                !connected
                    ? <div className="empty">Connect your OP_WALLET to stake.</div>
                    : !address
                        ? <div className="loading">Loading wallet info…</div>
                        : <StakePanel dao={dao} walletAddr={address} btcAddress={btcAddress} decimals={decimals} />
            )}

            {tab === 'create' && (
                !connected
                    ? <div className="empty">Connect your OP_WALLET to create proposals.</div>
                    : !address
                        ? <div className="loading">Loading wallet info…</div>
                        : <CreateProposalPanel dao={dao} walletAddr={address} btcAddress={btcAddress} decimals={decimals} />
            )}
        </div>
    );
}

function StakedStatCell({ dao, walletAddr, decimals }: { dao: DaoConfig; walletAddr: Address; decimals: number }) {
    const staked = useStakedBalance(dao, walletAddr);
    return (
        <div className="stat">
            <div className="stat-label">Your Stake</div>
            <div className="stat-value">{fmt(staked, decimals)}</div>
        </div>
    );
}

// ── Proposal card ────────────────────────────────────────────────────────────

function ProposalCard({
    proposal, dao, decimals, connected, walletAddr, btcAddress, onRefresh,
}: {
    proposal: Proposal;
    dao: DaoConfig;
    decimals: number;
    connected: boolean;
    walletAddr: Address | null;
    btcAddress: string;
    onRefresh: () => void;
}) {
    const { show } = useToast();
    const { signer } = useWallet();
    const { vote, executeProposal } = useDaoActions(dao, walletAddr, btcAddress, signer);
    const pct    = votePercent(proposal);
    const active = !proposal.executed;

    const handleVote = async (support: boolean) => {
        try {
            await vote(proposal.id, support);
            show(`Vote ${support ? 'YES' : 'NO'} submitted`, 'success');
            onRefresh();
        } catch (e) { show(`Vote failed: ${txError(e)}`, 'error'); }
    };
    const handleExecute = async () => {
        try {
            await executeProposal(proposal.id);
            show('Execution submitted', 'success');
            onRefresh();
        } catch (e) { show(`Execute failed: ${txError(e)}`, 'error'); }
    };

    return (
        <div className="proposal">
            <div className="proposal-header">
                <span className="proposal-id">#{String(proposal.id)}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                    <span className={`badge badge-${proposal.proposalType === 0 ? 'text' : 'treasury'}`}>
                        {proposal.proposalType === 0 ? 'Text' : 'Treasury'}
                    </span>
                    {proposal.executed
                        ? <span className={`badge ${pct > 50 ? 'badge-passed' : 'badge-failed'}`}>{pct > 50 ? 'Passed' : 'Failed'}</span>
                        : <span className="badge badge-active">Active</span>
                    }
                </div>
            </div>
            <div className="hash-display">Hash: 0x{proposal.descriptionHash}</div>
            {proposal.proposalType === 1 && proposal.amount > 0n && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    Transfer: {fmt(proposal.amount, decimals)} {dao.symbol}
                </div>
            )}
            <div className="vote-bar">
                <div className="vote-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="vote-counts">
                <span className="vote-yes">YES {fmt(proposal.yesVotes, decimals)} ({pct}%)</span>
                <span className="vote-no">NO {fmt(proposal.noVotes, decimals)}</span>
            </div>
            {connected && active && (
                <div className="proposal-actions">
                    <button className="btn-yes btn-sm"     onClick={() => handleVote(true)}>Vote YES</button>
                    <button className="btn-no btn-sm"      onClick={() => handleVote(false)}>Vote NO</button>
                    <button className="btn-outline btn-sm" onClick={handleExecute}>Execute</button>
                </div>
            )}
        </div>
    );
}

// ── Stake / Unstake panel ────────────────────────────────────────────────────

function StakePanel({ dao, walletAddr, btcAddress, decimals }: { dao: DaoConfig; walletAddr: Address; btcAddress: string; decimals: number }) {
    const { show }      = useToast();
    const { signer } = useWallet();
    const { approve, stake, unstake } = useDaoActions(dao, walletAddr, btcAddress, signer);
    const walletBal = useTokenBalance(dao, walletAddr);
    const stakedBal = useStakedBalance(dao, walletAddr);
    const { allowance, refreshAllowance } = useTokenAllowance(dao, walletAddr);
    const [amount, setAmount] = useState('');
    const [busy,   setBusy]   = useState(false);
    const [step,   setStep]   = useState('');

    const amountSats = (): bigint | null => {
        const n = Number(amount);
        if (!amount || isNaN(n) || n <= 0) return null;
        return BigInt(Math.round(n * (10 ** decimals)));
    };

    const handleApprove = async () => {
        setBusy(true); setStep('Approving…');
        try {
            await approve();
            show('Approval submitted! Wait for confirmation, then stake.', 'success');
            setTimeout(refreshAllowance, 4000);
        } catch (e) { show(`Approve failed: ${txError(e)}`, 'error'); }
        finally { setBusy(false); setStep(''); }
    };

    const handleStake = async () => {
        const sats = amountSats();
        if (!sats) { show('Enter a valid amount', 'error'); return; }
        setBusy(true); setStep('Staking…');
        try {
            await stake(sats);
            show('Stake submitted! Wait for confirmation.', 'success');
            setAmount('');
        } catch (e) { show(`Stake failed: ${txError(e)}`, 'error'); }
        finally { setBusy(false); setStep(''); }
    };

    const handleUnstake = async () => {
        const sats = amountSats();
        if (!sats) { show('Enter a valid amount', 'error'); return; }
        setBusy(true); setStep('Unstaking…');
        try {
            await unstake(sats);
            show('Unstake submitted! Wait for confirmation.', 'success');
            setAmount('');
        } catch (e) { show(`Unstake failed: ${txError(e)}`, 'error'); }
        finally { setBusy(false); setStep(''); }
    };

    const needsApprove = allowance === 0n;
    const sats         = amountSats() ?? 0n;

    return (
        <div className="card">
            <div className="card-title">Stake / Unstake {dao.symbol}</div>

            <div className="balance-row">
                <div className="balance-item">
                    <span className="balance-label">Wallet balance</span>
                    <span className="balance-value">{fmt(walletBal, decimals)} {dao.symbol}</span>
                </div>
                <div className="balance-item">
                    <span className="balance-label">Staked</span>
                    <span className="balance-value" style={{ color: 'var(--accent)' }}>{fmt(stakedBal, decimals)} {dao.symbol}</span>
                </div>
            </div>

            <div className="form-group" style={{ marginTop: 16 }}>
                <label>Amount ({dao.symbol})</label>
                <input
                    type="number" min="0" step="any" placeholder="0.0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={busy}
                />
            </div>

            {needsApprove && (
                <div className="approve-notice">
                    Step 1 — Approve the DAO to spend your {dao.symbol} (one-time):
                    <button onClick={handleApprove} disabled={busy} style={{ marginLeft: 10 }}>
                        {busy && step === 'Approving…' ? 'Approving…' : `Approve ${dao.symbol}`}
                    </button>
                </div>
            )}

            <div className="row" style={{ marginTop: 12 }}>
                <button onClick={handleStake} disabled={busy || needsApprove || sats === 0n}>
                    {busy && step === 'Staking…' ? 'Staking…' : 'Stake'}
                </button>
                <button className="btn-outline" onClick={handleUnstake} disabled={busy || sats === 0n}>
                    {busy && step === 'Unstaking…' ? 'Unstaking…' : 'Unstake'}
                </button>
            </div>

            {busy && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>{step}</p>}
        </div>
    );
}

// ── Create proposal panel ────────────────────────────────────────────────────

function CreateProposalPanel({ dao, walletAddr, btcAddress, decimals }: { dao: DaoConfig; walletAddr: Address; btcAddress: string; decimals: number }) {
    const { show } = useToast();
    const { signer } = useWallet();
    const { createProposal } = useDaoActions(dao, walletAddr, btcAddress, signer);
    const [type,      setType]      = useState<0 | 1>(0);
    const [desc,      setDesc]      = useState('');
    const [amount,    setAmount]    = useState('');
    const [recipient, setRecipient] = useState('');
    const [token,     setToken]     = useState('');
    const [busy,      setBusy]      = useState(false);

    const submit = async () => {
        if (!desc.trim()) { show('Enter a description', 'error'); return; }
        setBusy(true);
        try {
            const enc = new TextEncoder().encode(desc.slice(0, 32).padEnd(32, '\0'));
            let hash = 0n;
            for (const b of enc) hash = (hash << 8n) | BigInt(b);
            const amountSats = amount ? BigInt(Math.round(Number(amount) * (10 ** decimals))) : 0n;
            await createProposal(type, hash, amountSats, recipient, token);
            show('Proposal submitted! Wait for confirmation.', 'success');
            setDesc(''); setAmount(''); setRecipient(''); setToken('');
        } catch (e) { show(`Failed: ${txError(e)}`, 'error'); }
        finally { setBusy(false); }
    };

    return (
        <div className="card">
            <div className="card-title">Create Proposal</div>
            <div className="form-group">
                <label>Type</label>
                <select value={type} onChange={(e) => setType(Number(e.target.value) as 0 | 1)} disabled={busy}>
                    <option value={0}>Text — informational, simple majority</option>
                    <option value={1}>Treasury — token transfer, requires quorum</option>
                </select>
            </div>
            <div className="form-group">
                <label>Description</label>
                <textarea
                    placeholder="Describe the proposal…"
                    value={desc} onChange={(e) => setDesc(e.target.value)} disabled={busy}
                />
            </div>
            {type === 1 && (
                <>
                    <div className="form-group">
                        <label>Amount ({dao.symbol})</label>
                        <input type="number" min="0" step="any" placeholder="0.0"
                            value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
                    </div>
                    <div className="form-group">
                        <label>Recipient (opt1...)</label>
                        <input placeholder="opt1..."
                            value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={busy} />
                    </div>
                    <div className="form-group">
                        <label>Token (blank = {dao.symbol})</label>
                        <input placeholder="opt1... or leave blank"
                            value={token} onChange={(e) => setToken(e.target.value)} disabled={busy} />
                    </div>
                </>
            )}
            <button onClick={submit} disabled={busy}>
                {busy ? 'Submitting…' : 'Create Proposal'}
            </button>
        </div>
    );
}

// ── Root with hash routing ───────────────────────────────────────────────────

function DaoApp() {
    const [selectedDao, setSelectedDao] = useState<DaoConfig | null>(null);

    // Sync with URL hash so back/forward works
    useEffect(() => {
        const onHash = () => {
            const hash = window.location.hash;
            if (hash.startsWith('#/dao/')) {
                const id  = hash.slice(6);
                const dao = DAO_CONFIGS.find((d) => d.id === id) ?? null;
                setSelectedDao(dao);
            } else {
                setSelectedDao(null);
            }
        };
        window.addEventListener('hashchange', onHash);
        onHash(); // handle initial load
        return () => window.removeEventListener('hashchange', onHash);
    }, []);

    const goHome = () => { window.location.hash = '#/'; };
    const goDao  = (dao: DaoConfig) => { window.location.hash = `#/dao/${dao.id}`; };

    return (
        <div className="app">
            <header>
                <div className="logo" style={{ cursor: 'pointer' }} onClick={goHome}>
                    Vibing<span>DAO</span>
                </div>
                <WalletBar />
            </header>

            {selectedDao
                ? <DaoPage dao={selectedDao} onBack={goHome} />
                : <HomePage onSelectDao={goDao} />
            }
        </div>
    );
}

export default function App() {
    return (
        <ErrorBoundary>
            <WalletProvider>
                <ToastProvider>
                    <DaoApp />
                </ToastProvider>
            </WalletProvider>
        </ErrorBoundary>
    );
}
