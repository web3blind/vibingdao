/**
 * Wallet state — shared via React context so every component sees the same
 * connection state. Call useWallet() anywhere; wrap the app in <WalletProvider>.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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

/**
 * Wait up to `timeoutMs` for window.opnet to be injected by the extension.
 * Browser extensions inject after page load, so a short poll is needed.
 */
function waitForOpnet(timeoutMs = 3000): Promise<typeof window.opnet> {
    return new Promise((resolve) => {
        if (window.opnet) { resolve(window.opnet); return; }
        const interval = setInterval(() => {
            if (window.opnet) { clearInterval(interval); clearTimeout(timer); resolve(window.opnet); }
        }, 100);
        const timer = setTimeout(() => { clearInterval(interval); resolve(undefined); }, timeoutMs);
    });
}

export function WalletProvider({ children }: { children: ReactNode }) {
    const [address, setAddress] = useState('');
    const listenerAttached = useRef(false);

    const connect = useCallback(async () => {
        const opnet = await waitForOpnet();
        if (!opnet) {
            alert('OP_WALLET extension not found. Install it from https://opnet.org');
            return;
        }
        try {
            const accounts = await opnet.requestAccounts();
            if (accounts.length > 0) setAddress(accounts[0]);
        } catch (e) {
            console.error('Wallet connect error:', e);
        }
    }, []);

    const disconnect = useCallback(() => {
        window.opnet?.disconnect?.();
        setAddress('');
    }, []);

    // Restore session if wallet already unlocked — wait for extension to inject first
    useEffect(() => {
        waitForOpnet().then((opnet) => {
            if (!opnet) return;

            opnet.getAccounts()
                .then((accounts) => { if (accounts.length > 0) setAddress(accounts[0]); })
                .catch(() => {});

            // Only attach account-change listener once
            if (!listenerAttached.current) {
                listenerAttached.current = true;
                opnet.on?.('accountsChanged', () => {
                    opnet.getAccounts()
                        .then((accounts) => setAddress(accounts[0] ?? ''))
                        .catch(() => setAddress(''));
                });
            }
        });
    }, []);

    return (
        <WalletContext.Provider value={{ connected: address !== '', address, connect, disconnect }}>
            {children}
        </WalletContext.Provider>
    );
}

export const useWallet = () => useContext(WalletContext);
