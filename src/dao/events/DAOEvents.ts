import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    ADDRESS_BYTE_LENGTH,
    Address,
    BytesWriter,
    NetEvent,
    U256_BYTE_LENGTH,
} from '@btc-vision/btc-runtime/runtime';

@final
export class StakedEvent extends NetEvent {
    constructor(staker: Address, amount: u256) {
        const data = new BytesWriter(ADDRESS_BYTE_LENGTH + U256_BYTE_LENGTH);
        data.writeAddress(staker);
        data.writeU256(amount);
        super('Staked', data);
    }
}

@final
export class UnstakedEvent extends NetEvent {
    constructor(staker: Address, amount: u256) {
        const data = new BytesWriter(ADDRESS_BYTE_LENGTH + U256_BYTE_LENGTH);
        data.writeAddress(staker);
        data.writeU256(amount);
        super('Unstaked', data);
    }
}

@final
export class ProposalCreatedEvent extends NetEvent {
    constructor(proposalId: u256, proposalType: u8, descriptionHash: u256) {
        const data = new BytesWriter(U256_BYTE_LENGTH + 1 + U256_BYTE_LENGTH);
        data.writeU256(proposalId);
        data.writeU8(proposalType);
        data.writeU256(descriptionHash);
        super('ProposalCreated', data);
    }
}

@final
export class VotedEvent extends NetEvent {
    constructor(proposalId: u256, voter: Address, support: bool, weight: u256) {
        const data = new BytesWriter(U256_BYTE_LENGTH + ADDRESS_BYTE_LENGTH + 1 + U256_BYTE_LENGTH);
        data.writeU256(proposalId);
        data.writeAddress(voter);
        data.writeBoolean(support);
        data.writeU256(weight);
        super('Voted', data);
    }
}

@final
export class ProposalExecutedEvent extends NetEvent {
    constructor(proposalId: u256, passed: bool) {
        const data = new BytesWriter(U256_BYTE_LENGTH + 1);
        data.writeU256(proposalId);
        data.writeBoolean(passed);
        super('ProposalExecuted', data);
    }
}
