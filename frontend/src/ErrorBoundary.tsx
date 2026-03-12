import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('VibingDAO render error:', error, info.componentStack);
    }

    render() {
        if (this.state.error) {
            return (
                <div style={{ padding: 32, maxWidth: 600, margin: '60px auto', fontFamily: 'monospace' }}>
                    <h2 style={{ color: '#ef4444', marginBottom: 12 }}>Something went wrong</h2>
                    <pre style={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: 8, padding: 16, fontSize: 12, overflowX: 'auto', color: '#e8e8e8', whiteSpace: 'pre-wrap' }}>
                        {this.state.error.message}
                    </pre>
                    <button
                        style={{ marginTop: 16 }}
                        onClick={() => this.setState({ error: null })}
                    >
                        Try again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
