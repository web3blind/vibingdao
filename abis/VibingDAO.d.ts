import { Address, AddressMap } from '@btc-vision/transaction';
import { CallResult, OPNetEvent, IOP_NETContract } from 'opnet';

// ------------------------------------------------------------------
// Event Definitions
// ------------------------------------------------------------------
export type StakedEvent = {
    readonly staker: Address;
    readonly amount: bigint;
};
export type UnstakedEvent = {
    readonly staker: Address;
    readonly amount: bigint;
};
export type ProposalCreatedEvent = {
    readonly proposalId: bigint;
    readonly proposalType: number;
    readonly descriptionHash: bigint;
};
export type VotedEvent = {
    readonly proposalId: bigint;
    readonly voter: Address;
    readonly support: boolean;
    readonly weight: bigint;
};
export type ProposalExecutedEvent = {
    readonly proposalId: bigint;
    readonly passed: boolean;
};

// ------------------------------------------------------------------
// Call Results
// ------------------------------------------------------------------

/**
 * @description Represents the result of the stake function call.
 */
export type Stake = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<StakedEvent>[]
>;

/**
 * @description Represents the result of the unstake function call.
 */
export type Unstake = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<UnstakedEvent>[]
>;

/**
 * @description Represents the result of the createProposal function call.
 */
export type CreateProposal = CallResult<
    {
        proposalId: bigint;
    },
    OPNetEvent<ProposalCreatedEvent>[]
>;

/**
 * @description Represents the result of the vote function call.
 */
export type Vote = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<VotedEvent>[]
>;

/**
 * @description Represents the result of the executeProposal function call.
 */
export type ExecuteProposal = CallResult<
    {
        passed: boolean;
    },
    OPNetEvent<ProposalExecutedEvent>[]
>;

/**
 * @description Represents the result of the stakedBalance function call.
 */
export type StakedBalance = CallResult<
    {
        amount: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getProposal function call.
 */
export type GetProposal = CallResult<
    {
        data: Uint8Array;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getProposalCount function call.
 */
export type GetProposalCount = CallResult<
    {
        count: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getTotalStaked function call.
 */
export type GetTotalStaked = CallResult<
    {
        total: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getStakingToken function call.
 */
export type GetStakingToken = CallResult<
    {
        token: Address;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the hasVoted function call.
 */
export type HasVoted = CallResult<
    {
        voted: boolean;
    },
    OPNetEvent<never>[]
>;

// ------------------------------------------------------------------
// IVibingDAO
// ------------------------------------------------------------------
export interface IVibingDAO extends IOP_NETContract {
    stake(amount: bigint): Promise<Stake>;
    unstake(amount: bigint): Promise<Unstake>;
    createProposal(
        proposalType: number,
        descriptionHash: bigint,
        amount: bigint,
        recipient: Address,
        token: Address,
    ): Promise<CreateProposal>;
    vote(proposalId: bigint, support: boolean): Promise<Vote>;
    executeProposal(proposalId: bigint): Promise<ExecuteProposal>;
    stakedBalance(staker: Address): Promise<StakedBalance>;
    getProposal(proposalId: bigint): Promise<GetProposal>;
    getProposalCount(): Promise<GetProposalCount>;
    getTotalStaked(): Promise<GetTotalStaked>;
    getStakingToken(): Promise<GetStakingToken>;
    hasVoted(proposalId: bigint, voter: Address): Promise<HasVoted>;
}
