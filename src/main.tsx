import {StrictMode, Component, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Professional Error Boundary for catching and displaying render/initialization errors
interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
}

class RootErrorBoundary extends Component<any, any> {
  props: any;
  state: any;
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): any {
    return { hasError: true, error, errorInfo: error.stack || null };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("Uncaught application error:", error?.message || String(error));
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-stone-900 text-stone-100 flex flex-col items-center justify-center p-6 font-sans">
          <div className="max-w-2xl w-full bg-stone-950 border border-red-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <svg className="w-8 h-8 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-stone-100">ตรวจพบข้อผิดพลาดขณะรันแอปพลิเคชัน</h1>
                <p className="text-xs text-stone-400">Application Initialization Error</p>
              </div>
            </div>

            <div className="bg-red-950/20 border border-red-900/30 rounded-xl p-4 font-mono text-xs text-red-200 overflow-auto max-h-48">
              <span className="font-extrabold text-red-400">[Error Message]:</span> {this.state.error?.toString()}
            </div>

            {this.state.errorInfo && (
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Stack Trace:</span>
                <pre className="bg-stone-900 border border-stone-800 rounded-xl p-4 font-mono text-[11px] text-stone-300 overflow-auto max-h-60 leading-relaxed">
                  {this.state.errorInfo}
                </pre>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-100 rounded-xl text-xs font-bold transition flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 15H19" />
                </svg>
                <span>โหลดหน้าเว็บใหม่ (Reload)</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Catch window-level unhandled errors too
window.addEventListener("error", (event) => {
  const errMsg = event.error instanceof Error ? event.error.stack || event.error.message : String(event.error || event.message);
  console.error("Global captured error:", errMsg);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  if (!reason) return;
  
  let reasonMsg: string;
  let reasonStack: string | undefined;
  
  if (reason instanceof Error) {
    reasonMsg = reason.message;
    reasonStack = reason.stack;
  } else if (typeof reason === 'string') {
    reasonMsg = reason;
  } else {
    try {
      reasonMsg = JSON.stringify(reason);
    } catch {
      reasonMsg = String(reason);
    }
  }
  
  if (reasonMsg.includes("vite") || reasonMsg.includes("websocket")) return;
  console.error("Global captured promise rejection:", reasonMsg, reasonStack ? `\nStack: ${reasonStack}` : "");
  console.error("Raw promise rejection object:", reason);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);

