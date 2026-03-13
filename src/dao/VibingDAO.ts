import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    ADDRESS_BYTE_LENGTH,
    Address,
    AddressMemoryMap,
    Blockchain,
    BytesWriter,
    Calldata,
    EMPTY_POINTER,
    encodeSelector,
    MapOfMap,
    OP20,
    OP20InitParameters,
    Revert,
    SafeMath,
    Selector,
    StoredAddress,
    StoredMapU256,
    StoredU256,
    U256_BYTE_LENGTH,
} from '@btc-vision/btc-runtime/runtime';

import {
    ProposalCreatedEvent,
    ProposalExecutedEvent,
    StakedEvent,
    UnstakedEvent,
    VotedEvent,
} from './events/DAOEvents';

// ─────────────────────────────────────────────────────────
//  Module-level pointer constants
//  Must be declared here (outside the class), allocated in
//  a fixed order so every call sees the same pointer IDs.
// ─────────────────────────────────────────────────────────
const stakingTokenPtr: u16 = Blockchain.nextPointer;
const votingDurationPtr: u16 = Blockchain.nextPointer;
const quorumPercentPtr: u16 = Blockchain.nextPointer;
const proposalCountPtr: u16 = Blockchain.nextPointer;
const totalStakedPtr: u16 = Blockchain.nextPointer;
const stakedBalancesPtr: u16 = Blockchain.nextPointer;
const proposalYesVotesPtr: u16 = Blockchain.nextPointer;
const proposalNoVotesPtr: u16 = Blockchain.nextPointer;
const proposalDeadlinePtr: u16 = Blockchain.nextPointer;
const proposalExecutedPtr: u16 = Blockchain.nextPointer;
const proposalTypePtr: u16 = Blockchain.nextPointer;
const proposalAmountPtr: u16 = Blockchain.nextPointer;
const proposalRecipientPtr: u16 = Blockchain.nextPointer;
const proposalTokenPtr: u16 = Blockchain.nextPointer;
const proposalDescHashPtr: u16 = Blockchain.nextPointer;
const voteWeightPtr: u16 = Blockchain.nextPointer;

// ─────────────────────────────────────────────────────────
//  Proposal type constants (stored as u256 in StoredMapU256)
// ─────────────────────────────────────────────────────────
const PROPOSAL_TYPE_TEXT: u256 = u256.Zero;
const PROPOSAL_TYPE_TREASURY: u256 = u256.One;

// Vote record sentinel values
const VOTED_YES: u256 = u256.One;
const VOTED_NO: u256 = u256.fromU32(2);

// Default DAO parameters
const DEFAULT_VOTING_DURATION: u256 = u256.fromU32(144); // ~1 Bitcoin day
const DEFAULT_QUORUM_PERCENT: u256 = u256.fromU32(10); // 10 % quorum for treasury
const PERCENT_DENOMINATOR: u256 = u256.fromU32(100);

// ─────────────────────────────────────────────────────────
//  VibingDAO — DAO contract with integrated VIBE governance token
//
//  Deployment calldata (read in order):
//    u256  maxSupply      — governance token max supply  (0 → 21 000 000 × 10^8)
//    u8    decimals       — token decimals               (0 → 8)
//    u256  votingDuration — blocks per voting window     (0 → 144)
//    u256  quorumPercent  — quorum % for treasury        (0 → 10)
//    addr  stakingToken   — OP_20 token users stake;
//                          Address.zero() → use VIBE itself
//
//  Governance token: symbol = VIBE  |  name = VibingDAO
// ─────────────────────────────────────────────────────────
@final
export class VibingDAO extends OP20 {
    // ── Selectors for cross-contract OP_20 calls ─────────────────────
    private readonly transferFromSelector: Selector = encodeSelector(
        'transferFrom(address,address,uint256)',
    );
    private readonly transferSelector: Selector = encodeSelector('transfer(address,uint256)');

    // ── Persistent storage instances ─────────────────────────────────
    private readonly stakingToken: StoredAddress;
    private readonly votingDuration: StoredU256;
    private readonly quorumPercent: StoredU256;
    private readonly proposalCount: StoredU256;
    private readonly totalStaked: StoredU256;

    private readonly stakedBalances: AddressMemoryMap; // staker → u256 staked amount

    // Per-proposal scalar fields (proposalId u256 → u256 value)
    private readonly proposalYesVotes: StoredMapU256;
    private readonly proposalNoVotes: StoredMapU256;
    private readonly proposalDeadline: StoredMapU256;
    private readonly proposalExecutedMap: StoredMapU256;
    private readonly proposalTypeMap: StoredMapU256;
    private readonly proposalAmountMap: StoredMapU256;
    private readonly proposalRecipientMap: StoredMapU256; // recipient address as u256
    private readonly proposalTokenMap: StoredMapU256; // treasury token address as u256
    private readonly proposalDescHashMap: StoredMapU256; // off-chain description hash

    // 2-D vote tracking: voter (Address) → proposalId bytes → vote record u256
    //   0 = not voted | 1 = voted YES | 2 = voted NO
    private readonly voteWeight: MapOfMap<u256>;

    public constructor() {
        super();

        this.stakingToken = new StoredAddress(stakingTokenPtr);
        this.votingDuration = new StoredU256(votingDurationPtr, EMPTY_POINTER);
        this.quorumPercent = new StoredU256(quorumPercentPtr, EMPTY_POINTER);
        this.proposalCount = new StoredU256(proposalCountPtr, EMPTY_POINTER);
        this.totalStaked = new StoredU256(totalStakedPtr, EMPTY_POINTER);

        this.stakedBalances = new AddressMemoryMap(stakedBalancesPtr);

        this.proposalYesVotes = new StoredMapU256(proposalYesVotesPtr);
        this.proposalNoVotes = new StoredMapU256(proposalNoVotesPtr);
        this.proposalDeadline = new StoredMapU256(proposalDeadlinePtr);
        this.proposalExecutedMap = new StoredMapU256(proposalExecutedPtr);
        this.proposalTypeMap = new StoredMapU256(proposalTypePtr);
        this.proposalAmountMap = new StoredMapU256(proposalAmountPtr);
        this.proposalRecipientMap = new StoredMapU256(proposalRecipientPtr);
        this.proposalTokenMap = new StoredMapU256(proposalTokenPtr);
        this.proposalDescHashMap = new StoredMapU256(proposalDescHashPtr);

        this.voteWeight = new MapOfMap<u256>(voteWeightPtr);
    }

    // ════════════════════════════════════════════════════════
    //  Deployment (runs ONCE on first deployment)
    // ════════════════════════════════════════════════════════

    public override onDeployment(calldata: Calldata): void {
        // ── Governance token parameters ──────────────────────
        let maxSupply = calldata.readU256();
        if (maxSupply == u256.Zero) {
            maxSupply = u256.fromString('2100000000000000'); // 21 000 000 × 10^8
        }

        let decimals = calldata.readU8();
        if (decimals == 0) {
            decimals = 8;
        }

        this.instantiate(new OP20InitParameters(maxSupply, decimals, 'VibingDAO', 'VIBE'));

        // ── DAO governance parameters ────────────────────────
        const duration = calldata.readU256();
        this.votingDuration.set(duration == u256.Zero ? DEFAULT_VOTING_DURATION : duration);

        const quorum = calldata.readU256();
        this.quorumPercent.set(quorum == u256.Zero ? DEFAULT_QUORUM_PERCENT : quorum);

        // ── Staking token ────────────────────────────────────
        const stakingTokenAddr = calldata.readAddress();
        this.stakingToken.value = stakingTokenAddr.isZero()
            ? Blockchain.contractAddress
            : stakingTokenAddr;

        // Mint full initial supply to deployer
        this._mint(Blockchain.tx.sender, maxSupply);
    }

    // ════════════════════════════════════════════════════════
    //  Staking — deposit tokens, earn voting power
    // ════════════════════════════════════════════════════════

    /**
     * Stake OP_20 tokens to acquire voting weight.
     * The caller must first approve this contract on the staking token.
     */
    @method({ name: 'amount', type: ABIDataTypes.UINT256 })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    @emit('Staked')
    public stake(calldata: Calldata): BytesWriter {
        const caller: Address = Blockchain.tx.sender;
        const amount: u256 = calldata.readU256();

        if (amount == u256.Zero) {
            throw new Revert('VIBE: stake amount is zero');
        }

        const token: Address = this.stakingToken.value;

        // Pull tokens in — use internal path for self-token, cross-call for external
        if (token == Blockchain.contractAddress) {
            this._spendAllowance(caller, Blockchain.contractAddress, amount);
            this._transfer(caller, Blockchain.contractAddress, amount);
        } else {
            this._externalTransferFrom(token, caller, Blockchain.contractAddress, amount);
        }

        // Update staked balance and total
        const currentStake: u256 = this.stakedBalances.get(caller);
        this.stakedBalances.set(caller, SafeMath.add(currentStake, amount));
        this.totalStaked.set(SafeMath.add(this.totalStaked.value, amount));

        this.emitEvent(new StakedEvent(caller, amount));

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    /**
     * Unstake tokens and return them to the caller.
     */
    @method({ name: 'amount', type: ABIDataTypes.UINT256 })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    @emit('Unstaked')
    public unstake(calldata: Calldata): BytesWriter {
        const caller: Address = Blockchain.tx.sender;
        const amount: u256 = calldata.readU256();

        if (amount == u256.Zero) {
            throw new Revert('VIBE: unstake amount is zero');
        }

        const currentStake: u256 = this.stakedBalances.get(caller);
        if (u256.lt(currentStake, amount)) {
            throw new Revert('VIBE: insufficient staked balance');
        }

        // Effects before interactions (CEI pattern)
        this.stakedBalances.set(caller, SafeMath.sub(currentStake, amount));
        this.totalStaked.set(SafeMath.sub(this.totalStaked.value, amount));

        // Return tokens to caller
        const token: Address = this.stakingToken.value;
        if (token == Blockchain.contractAddress) {
            this._transfer(Blockchain.contractAddress, caller, amount);
        } else {
            this._externalTransfer(token, caller, amount);
        }

        this.emitEvent(new UnstakedEvent(caller, amount));

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    // ════════════════════════════════════════════════════════
    //  Proposals
    // ════════════════════════════════════════════════════════

    /**
     * Create a new governance proposal.
     *
     * proposalType    0 = text      — informational, passes by simple majority
     *                 1 = treasury  — spending proposal, requires quorum + majority
     * descriptionHash SHA-256 hash of off-chain proposal description (stored for auditability)
     * amount          Treasury only: token amount to transfer on execution
     * recipient       Treasury only: recipient of the transferred tokens
     * token           Treasury only: OP_20 contract to transfer from;
     *                 Address.zero() → defaults to the DAO's staking token
     */
    @method(
        { name: 'proposalType', type: ABIDataTypes.UINT8 },
        { name: 'descriptionHash', type: ABIDataTypes.UINT256 },
        { name: 'amount', type: ABIDataTypes.UINT256 },
        { name: 'recipient', type: ABIDataTypes.ADDRESS },
        { name: 'token', type: ABIDataTypes.ADDRESS },
    )
    @returns({ name: 'proposalId', type: ABIDataTypes.UINT256 })
    @emit('ProposalCreated')
    public createProposal(calldata: Calldata): BytesWriter {
        const caller: Address = Blockchain.tx.sender;
        const proposalType: u8 = calldata.readU8();
        const descriptionHash: u256 = calldata.readU256();
        const amount: u256 = calldata.readU256();
        const recipient: Address = calldata.readAddress();
        const tokenArg: Address = calldata.readAddress();

        if (this.stakedBalances.get(caller) == u256.Zero) {
            throw new Revert('VIBE: must stake tokens to create a proposal');
        }
        if (proposalType > 1) {
            throw new Revert('VIBE: invalid proposal type (0=text, 1=treasury)');
        }

        // Allocate sequential proposal ID (1-based)
        const newId: u256 = SafeMath.add(this.proposalCount.value, u256.One);
        this.proposalCount.set(newId);

        // Voting deadline = current block + configured window
        const deadline: u256 = SafeMath.add(Blockchain.block.numberU256, this.votingDuration.value);

        // Resolve token address: zero → staking token
        const resolvedToken: Address = tokenArg.isZero() ? this.stakingToken.value : tokenArg;

        // Persist all proposal fields
        this.proposalTypeMap.set(newId, u256.fromU32(proposalType as u32));
        this.proposalDeadline.set(newId, deadline);
        this.proposalAmountMap.set(newId, amount);
        this.proposalRecipientMap.set(newId, this.addrToU256(recipient));
        this.proposalTokenMap.set(newId, this.addrToU256(resolvedToken));
        this.proposalDescHashMap.set(newId, descriptionHash);
        // yesVotes, noVotes, executed default to 0

        this.emitEvent(new ProposalCreatedEvent(newId, proposalType, descriptionHash));

        const response = new BytesWriter(U256_BYTE_LENGTH);
        response.writeU256(newId);
        return response;
    }

    /**
     * Cast a weighted vote on an active proposal.
     * Weight = caller's staked token balance at the time of voting.
     */
    @method(
        { name: 'proposalId', type: ABIDataTypes.UINT256 },
        { name: 'support', type: ABIDataTypes.BOOL },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    @emit('Voted')
    public vote(calldata: Calldata): BytesWriter {
        const caller: Address = Blockchain.tx.sender;
        const proposalId: u256 = calldata.readU256();
        const support: bool = calldata.readBoolean();

        this.requireProposalExists(proposalId);
        this.requireVotingOpen(proposalId);

        // Use the big-endian bytes of the proposal ID as the Nested inner key
        const proposalBytes: Uint8Array = proposalId.toUint8Array(true);

        // Prevent double voting
        const voterMap = this.voteWeight.get(caller);
        if (voterMap.get(proposalBytes) != u256.Zero) {
            throw new Revert('VIBE: already voted on this proposal');
        }

        const weight: u256 = this.stakedBalances.get(caller);
        if (weight == u256.Zero) {
            throw new Revert('VIBE: no staked balance — cannot vote');
        }

        // Record vote and update tally
        voterMap.set(proposalBytes, support ? VOTED_YES : VOTED_NO);
        this.voteWeight.set(caller, voterMap);

        if (support) {
            this.proposalYesVotes.set(
                proposalId,
                SafeMath.add(this.proposalYesVotes.get(proposalId), weight),
            );
        } else {
            this.proposalNoVotes.set(
                proposalId,
                SafeMath.add(this.proposalNoVotes.get(proposalId), weight),
            );
        }

        this.emitEvent(new VotedEvent(proposalId, caller, support, weight));

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    /**
     * Execute a proposal after its voting period has ended.
     *
     * - text proposals:     passes by simple majority (yes > no); emits event only
     * - treasury proposals: requires quorum + majority; transfers tokens on pass
     */
    @method({ name: 'proposalId', type: ABIDataTypes.UINT256 })
    @returns({ name: 'passed', type: ABIDataTypes.BOOL })
    @emit('ProposalExecuted')
    public executeProposal(calldata: Calldata): BytesWriter {
        const proposalId: u256 = calldata.readU256();

        this.requireProposalExists(proposalId);
        this.requireVotingEnded(proposalId);

        if (this.proposalExecutedMap.get(proposalId) != u256.Zero) {
            throw new Revert('VIBE: proposal already executed');
        }

        const yesVotes: u256 = this.proposalYesVotes.get(proposalId);
        const noVotes: u256 = this.proposalNoVotes.get(proposalId);
        const pType: u256 = this.proposalTypeMap.get(proposalId);

        let passed: bool;

        if (pType == PROPOSAL_TYPE_TEXT) {
            // Simple majority
            passed = u256.gt(yesVotes, noVotes);
        } else {
            // Treasury: quorum + majority
            const totalVotes: u256 = SafeMath.add(yesVotes, noVotes);
            const staked: u256 = this.totalStaked.value;
            let quorumMet: bool = false;

            if (staked != u256.Zero) {
                const threshold: u256 = SafeMath.div(
                    SafeMath.mul(staked, this.quorumPercent.value),
                    PERCENT_DENOMINATOR,
                );
                quorumMet = totalVotes >= threshold;
            }

            passed = quorumMet && u256.gt(yesVotes, noVotes);
        }

        // Mark executed BEFORE any external interaction (CEI)
        this.proposalExecutedMap.set(proposalId, u256.One);

        if (passed && pType == PROPOSAL_TYPE_TREASURY) {
            const amount: u256 = this.proposalAmountMap.get(proposalId);

            if (amount != u256.Zero) {
                const recipient: Address = this.u256ToAddr(
                    this.proposalRecipientMap.get(proposalId),
                );
                const token: Address = this.u256ToAddr(this.proposalTokenMap.get(proposalId));

                if (token == Blockchain.contractAddress) {
                    this._transfer(Blockchain.contractAddress, recipient, amount);
                } else {
                    this._externalTransfer(token, recipient, amount);
                }
            }
        }

        this.emitEvent(new ProposalExecutedEvent(proposalId, passed));

        const response = new BytesWriter(1);
        response.writeBoolean(passed);
        return response;
    }

    // ════════════════════════════════════════════════════════
    //  View methods
    // ════════════════════════════════════════════════════════

    @method({ name: 'staker', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'amount', type: ABIDataTypes.UINT256 })
    @view
    public stakedBalance(calldata: Calldata): BytesWriter {
        const response = new BytesWriter(U256_BYTE_LENGTH);
        response.writeU256(this.stakedBalances.get(calldata.readAddress()));
        return response;
    }

    // Returns packed bytes: u8 proposalType | u256 yesVotes | u256 noVotes |
    //   u256 deadline | bool executed | u256 amount | u256 descriptionHash
    @method({ name: 'proposalId', type: ABIDataTypes.UINT256 })
    @returns({ name: 'data', type: ABIDataTypes.BYTES })
    @view
    public getProposal(calldata: Calldata): BytesWriter {
        const proposalId: u256 = calldata.readU256();
        this.requireProposalExists(proposalId);

        // 1 (u8) + 5×32 (u256) + 1 (bool) + 3×32 (u256) = 226 bytes
        // Fields: type | yesVotes | noVotes | deadline | executed | amount | descHash | recipient
        const response = new BytesWriter(1 + 5 * U256_BYTE_LENGTH + 1 + 3 * U256_BYTE_LENGTH);
        response.writeU8(this.proposalTypeMap.get(proposalId).toU32() as u8);
        response.writeU256(this.proposalYesVotes.get(proposalId));
        response.writeU256(this.proposalNoVotes.get(proposalId));
        response.writeU256(this.proposalDeadline.get(proposalId));
        response.writeBoolean(this.proposalExecutedMap.get(proposalId) != u256.Zero);
        response.writeU256(this.proposalAmountMap.get(proposalId));
        response.writeU256(this.proposalDescHashMap.get(proposalId));
        response.writeU256(this.proposalRecipientMap.get(proposalId));
        return response;
    }

    @method()
    @returns({ name: 'count', type: ABIDataTypes.UINT256 })
    @view
    public getProposalCount(_calldata: Calldata): BytesWriter {
        const response = new BytesWriter(U256_BYTE_LENGTH);
        response.writeU256(this.proposalCount.value);
        return response;
    }

    @method()
    @returns({ name: 'total', type: ABIDataTypes.UINT256 })
    @view
    public getTotalStaked(_calldata: Calldata): BytesWriter {
        const response = new BytesWriter(U256_BYTE_LENGTH);
        response.writeU256(this.totalStaked.value);
        return response;
    }

    @method()
    @returns({ name: 'token', type: ABIDataTypes.ADDRESS })
    @view
    public getStakingToken(_calldata: Calldata): BytesWriter {
        const response = new BytesWriter(ADDRESS_BYTE_LENGTH);
        response.writeAddress(this.stakingToken.value);
        return response;
    }

    @method(
        { name: 'proposalId', type: ABIDataTypes.UINT256 },
        { name: 'voter', type: ABIDataTypes.ADDRESS },
    )
    @returns({ name: 'voted', type: ABIDataTypes.BOOL })
    @view
    public hasVoted(calldata: Calldata): BytesWriter {
        const proposalId: u256 = calldata.readU256();
        const voter: Address = calldata.readAddress();

        const voterMap = this.voteWeight.get(voter);
        const record: u256 = voterMap.get(proposalId.toUint8Array(true));

        const response = new BytesWriter(1);
        response.writeBoolean(record != u256.Zero);
        return response;
    }

    // ════════════════════════════════════════════════════════
    //  Guard helpers
    // ════════════════════════════════════════════════════════

    private requireProposalExists(proposalId: u256): void {
        if (proposalId == u256.Zero || u256.gt(proposalId, this.proposalCount.value)) {
            throw new Revert('VIBE: proposal does not exist');
        }
    }

    private requireVotingOpen(proposalId: u256): void {
        if (Blockchain.block.numberU256 > this.proposalDeadline.get(proposalId)) {
            throw new Revert('VIBE: voting period has ended');
        }
        if (this.proposalExecutedMap.get(proposalId) != u256.Zero) {
            throw new Revert('VIBE: proposal already executed');
        }
    }

    private requireVotingEnded(proposalId: u256): void {
        if (Blockchain.block.numberU256 <= this.proposalDeadline.get(proposalId)) {
            throw new Revert('VIBE: voting period is still active');
        }
    }

    // ════════════════════════════════════════════════════════
    //  Cross-contract OP_20 call helpers
    // ════════════════════════════════════════════════════════

    private _externalTransferFrom(token: Address, from: Address, to: Address, amount: u256): void {
        const writer = new BytesWriter(100); // 4 + 32 + 32 + 32
        writer.writeSelector(this.transferFromSelector);
        writer.writeAddress(from);
        writer.writeAddress(to);
        writer.writeU256(amount);

        const result = Blockchain.call(token, writer, false);
        if (!result.success) {
            throw new Revert('VIBE: external transferFrom failed');
        }
        if (result.data.byteLength > 0 && !result.data.readBoolean()) {
            throw new Revert('VIBE: external transferFrom returned false');
        }
    }

    private _externalTransfer(token: Address, to: Address, amount: u256): void {
        const writer = new BytesWriter(68); // 4 + 32 + 32
        writer.writeSelector(this.transferSelector);
        writer.writeAddress(to);
        writer.writeU256(amount);

        const result = Blockchain.call(token, writer, false);
        if (!result.success) {
            throw new Revert('VIBE: external transfer failed');
        }
        if (result.data.byteLength > 0 && !result.data.readBoolean()) {
            throw new Revert('VIBE: external transfer returned false');
        }
    }

    // ════════════════════════════════════════════════════════
    //  Address ↔ u256 encoding helpers
    // ════════════════════════════════════════════════════════

    /** Encode an Address into a u256 for persistent scalar storage. */
    private addrToU256(addr: Address): u256 {
        return u256.fromUint8ArrayBE(addr);
    }

    /** Decode a previously encoded u256 back into an Address. */
    private u256ToAddr(val: u256): Address {
        return Address.fromUint8Array(val.toUint8Array(true));
    }
}
