/**
 * Wallet state hook — wraps @btc-vision/walletconnect.
 * Returns connection state, address string, and connect/disconnect helpers.
 */
import { useEffect, useState, useCallback } from 'react';

export interface WalletState {
    connected: boolean;
    address: string;
    connect: () => Promise<void>;
    disconnect: () => void;
}

declare global {
    interface Window {
        // OP_WALLET browser extension injects this
        opnet?: {
            requestAccounts: () => Promise<string[]>;
            getAccounts: () => Promise<string[]>;
            disconnect?: () => void;
            on?: (event: string, cb: () => void) => void;
        };
    }
}

export function useWallet(): WalletState {
    const [address, setAddress] = useState('');

    const connect = useCallback(async () => {
        if (!window.opnet) {
            alert('OP_WALLET extension not found. Install it from https://opnet.org');
            return;
        }
        const accounts = await window.opnet.requestAccounts();
        if (accounts.length > 0) setAddress(accounts[0]);
    }, []);

    const disconnect = useCallback(() => {
        window.opnet?.disconnect?.();
        setAddress('');
    }, []);

    // Restore connection if wallet already unlocked
    useEffect(() => {
        window.opnet
            ?.getAccounts()
            .then((accounts) => { if (accounts.length > 0) setAddress(accounts[0]); })
            .catch(() => {});
    }, []);

    return { connected: address !== '', address, connect, disconnect };
}
