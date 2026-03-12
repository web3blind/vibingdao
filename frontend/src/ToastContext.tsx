import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; type: ToastType }

interface ToastCtx { show: (message: string, type?: ToastType) => void }
const ToastContext = createContext<ToastCtx>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    // useRef so the counter persists across renders without resetting
    const nextId = useRef(0);

    const show = useCallback((message: string, type: ToastType = 'info') => {
        const id = ++nextId.current;
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
    }, []);

    return (
        <ToastContext.Provider value={{ show }}>
            {children}
            <div className="toast-wrapper">
                {toasts.map((t) => (
                    <div key={t.id} className={`toast toast-${t.type}`}>
                        {t.message}
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export const useToast = () => useContext(ToastContext);
