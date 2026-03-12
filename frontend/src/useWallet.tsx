/**
 * Thin wrapper around @btc-vision/walletconnect so the rest of the app
 * works with a simple { connected, address, btcAddress, connect, disconnect }.
 *
 * address    — full Address object (ML-DSA hash + legacyPublicKey set).
 *              Use this for contract calls (balanceOf, approve, etc.).
 * btcAddress — Bitcoin p2tr string (opt1p...).
 *              Use this for refundTo in sendTransaction.
 */
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { WalletConnectProvider } from '@btc-vision/walletconnect/browser';
import { useWalletConnect } from '@btc-vision/walletconnect';
import type { Address } from '@btc-vision/transaction';

export interface WalletState {
    connected:  boolean;
    address:    Address | null;   // full Address: ML-DSA hash + legacyPublicKey
    btcAddress: string;           // opt1p... p2tr — for refundTo / display
    connect:    () => void;
    disconnect: () => void;
}

const WalletContext = createContext<WalletState>({
    connected:  false,
    address:    null,
    btcAddress: '',
    connect:    () => {},
    disconnect: () => {},
});

function InnerProvider({ children }: { children: ReactNode }) {
    const wc = useWalletConnect();

    const value: WalletState = {
        connected:  !!wc.address,
        address:    wc.address,
        btcAddress: wc.walletAddress ?? '',
        connect:    wc.openConnectModal,
        disconnect: wc.disconnect,
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
