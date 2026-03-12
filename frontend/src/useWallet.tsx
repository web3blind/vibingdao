/**
 * Wallet state — shared via React context so every component sees the same
 * connection state. Call useWallet() anywhere; wrap the app in <WalletProvider>.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export interface WalletState {
    connected: boolean;
    address: string;
    connect: () => Promise<void>;
    disconnect: () => void;
}

declare global {
    interface Window {
        opnet?: {
            requestAccounts: () => Promise<string[]>;
            getAccounts: () => Promise<string[]>;
            disconnect?: () => void;
            on?: (event: string, cb: (...args: unknown[]) => void) => void;
        };
    }
}

const WalletContext = createContext<WalletState>({
    connected: false,
    address: '',
    connect: async () => {},
    disconnect: () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
    const [address, setAddress] = useState('');

    const connect = useCallback(async () => {
        if (!window.opnet) {
            alert('OP_WALLET extension not found. Install it from https://opnet.org');
            return;
        }
        try {
            const accounts = await window.opnet.requestAccounts();
            if (accounts.length > 0) setAddress(accounts[0]);
        } catch (e) {
            console.error('Wallet connect error:', e);
        }
    }, []);

    const disconnect = useCallback(() => {
        window.opnet?.disconnect?.();
        setAddress('');
    }, []);

    // Restore if wallet already unlocked on page load
    useEffect(() => {
        window.opnet
            ?.getAccounts()
            .then((accounts) => { if (accounts.length > 0) setAddress(accounts[0]); })
            .catch(() => {});

        // Listen for account changes from the extension
        window.opnet?.on?.('accountsChanged', () => {
            window.opnet?.getAccounts()
                .then((accounts) => setAddress(accounts[0] ?? ''))
                .catch(() => setAddress(''));
        });
    }, []);

    return (
        <WalletContext.Provider value={{ connected: address !== '', address, connect, disconnect }}>
            {children}
        </WalletContext.Provider>
    );
}

export const useWallet = () => useContext(WalletContext);
