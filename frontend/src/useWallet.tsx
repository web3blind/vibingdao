/**
 * Wallet integration.
 *
 * Uses @btc-vision/walletconnect for session management, but builds the Address
 * object ourselves to be resilient to getMLDSAPublicKey() timing issues.
 *
 * connected  — true as soon as walletAddress (p2tr) is known (not gated on MLDSA fetch).
 * address    — Address with both mldsaHash + legacyPublicKey set (null while resolving).
 * btcAddress — opt1p... p2tr string for refundTo in sendTransaction.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { WalletConnectProvider } from '@btc-vision/walletconnect/browser';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { Address } from '@btc-vision/transaction';
import { resolveP2op } from './opnet';

export interface WalletState {
    connected:    boolean;
    address:      Address | null;   // Address with both keys — null while resolving
    btcAddress:   string;           // opt1p... — for refundTo / display
    connect:      () => void;
    disconnect:   () => void;
}

const WalletContext = createContext<WalletState>({
    connected:    false,
    address:      null,
    btcAddress:   '',
    connect:      () => {},
    disconnect:   () => {},
});

function InnerProvider({ children }: { children: ReactNode }) {
    const wc = useWalletConnect();
    const [resolvedAddr, setResolvedAddr] = useState<Address | null>(null);
    const reconnectAttempted = useRef(false);

    const p2tr = wc.walletAddress ?? '';

    // ── Build Address object ────────────────────────────────────────────────
    // Strategy 1: use hashedMLDSAKey (SHA256 of MLDSA key) + secp256k1 publicKey
    //             — both come from the wallet context, no extra RPC needed.
    // Strategy 2: use wc.address if it already has legacyPublicKey set.
    // Strategy 3: fall back to RPC getPublicKeysInfoRaw → resolveP2op.
    useEffect(() => {
        if (!p2tr) {
            setResolvedAddr(null);
            return;
        }

        // Strategy 1 ──────────────────────────────────────────────────────
        // wc.hashedMLDSAKey = SHA256(fullMLDSAKey) — matches what OP20 uses for storage
        // wc.publicKey      = compressed 33-byte secp256k1 key (autoFormat → tweaked)
        if (wc.hashedMLDSAKey && wc.publicKey) {
            try {
                const addr = Address.fromString(
                    '0x' + wc.hashedMLDSAKey,
                    '0x' + wc.publicKey,
                );
                setResolvedAddr(addr);
                return;
            } catch { /* fall through */ }
        }

        // Strategy 2: RPC ─────────────────────────────────────────────────
        // resolveP2op hits getPublicKeysInfoRaw → gets mldsaHashedPublicKey + tweakedPubkey
        resolveP2op(p2tr)
            .then(setResolvedAddr)
            .catch(() => setResolvedAddr(null));
    }, [p2tr, wc.hashedMLDSAKey, wc.publicKey, wc.address]);

    // ── Manual reconnect fallback ──────────────────────────────────────────
    // WalletConnectProvider's auto-reconnect can fail if the extension injects
    // after pageLoaded fires (walletBase is null → canAutoConnect returns false).
    // We poll for window.opnet and retry connectToWallet ourselves.
    useEffect(() => {
        const saved = localStorage.getItem('WC_SelectedWallet');
        if (!saved || reconnectAttempted.current) return;

        let attempts = 0;
        let timer: ReturnType<typeof setTimeout>;

        const tryReconnect = () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((window as any).opnet) {
                if (!wc.walletAddress) {
                    reconnectAttempted.current = true;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    wc.connectToWallet(saved as any);
                }
            } else if (attempts < 20) {
                attempts++;
                timer = setTimeout(tryReconnect, 300);
            }
        };

        // Give WalletConnectProvider ~1 s to reconnect on its own first
        timer = setTimeout(tryReconnect, 1000);
        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const value: WalletState = {
        connected:    !!p2tr,
        address:      resolvedAddr,
        btcAddress:   p2tr,
        connect:      wc.openConnectModal,
        disconnect:   wc.disconnect,
    };

    return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
    return (
        <WalletConnectProvider theme="dark">
            <InnerProvider>{children}</InnerProvider>
        </WalletConnectProvider>
    );
}

export const useWallet = () => useContext(WalletContext);
