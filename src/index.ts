import { Blockchain } from '@btc-vision/btc-runtime/runtime';
import { revertOnError } from '@btc-vision/btc-runtime/runtime/abort/abort';
import { VibingDAO } from './dao/VibingDAO';

// DO NOT ADD LOGIC HERE — only wire the contract factory.
Blockchain.contract = (): VibingDAO => {
    return new VibingDAO();
};

// REQUIRED: runtime exports
export * from '@btc-vision/btc-runtime/runtime/exports';

// REQUIRED: abort handler
export function abort(message: string, fileName: string, line: u32, column: u32): void {
    revertOnError(message, fileName, line, column);
}
