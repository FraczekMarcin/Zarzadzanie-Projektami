import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/plus-jakarta-sans/latin-400.css';
import '@fontsource/plus-jakarta-sans/latin-ext-400.css';
import '@fontsource/plus-jakarta-sans/latin-500.css';
import '@fontsource/plus-jakarta-sans/latin-ext-500.css';
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-ext-600.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/plus-jakarta-sans/latin-ext-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-ext-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-ext-500.css';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const IFRAME_BEARER_KEY = 'oph_iframe_bearer';

if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const isSameOriginApi =
      rawUrl.startsWith('/api/') ||
      rawUrl === '/api' ||
      (typeof window.location?.origin === 'string' && rawUrl.startsWith(`${window.location.origin}/api/`));

    let nextInit = init;
    if (isSameOriginApi) {
      try {
        const storedBearer = sessionStorage.getItem(IFRAME_BEARER_KEY);
        if (storedBearer) {
          const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
          if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${storedBearer}`);
            nextInit = { ...init, headers };
          }
        }
      } catch {}
    }

    const res = await nativeFetch(input, nextInit);

    if (isSameOriginApi) {
      try {
        if (rawUrl.includes('/api/auth/logout')) {
          sessionStorage.removeItem(IFRAME_BEARER_KEY);
        } else if (
          res.ok &&
          (rawUrl.includes('/api/auth/login') ||
            rawUrl.includes('/api/auth/setup-admin') ||
            rawUrl.includes('/api/auth/device-login'))
        ) {
          const cloned = res.clone();
          const data = await cloned.json().catch(() => null);
          if (data && typeof data.sessionToken === 'string' && data.sessionToken) {
            sessionStorage.setItem(IFRAME_BEARER_KEY, data.sessionToken);
          }
        }
      } catch {}
    }

    return res;
  };
}

class RootErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[RootErrorBoundary] Caught React error:', error, errorInfo);
  }

  handleReset = () => {
    try {
      localStorage.removeItem('oph_is_authenticated');
      localStorage.removeItem('oph_current_user');
      sessionStorage.removeItem(IFRAME_BEARER_KEY);
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md p-6 bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto text-xl font-bold">
              !
            </div>
            <h1 className="text-lg font-bold text-white">Wystąpił problem podczas renderowania</h1>
            <p className="text-xs text-slate-300">
              {this.state.error?.message || 'Nieoczekiwany błąd aplikacji. Kliknij poniżej, aby zresetować sesję i przejść do logowania.'}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="w-full py-2.5 px-4 bg-sky-700 hover:bg-sky-600 text-white font-semibold rounded-lg text-xs transition-colors shadow-lg"
            >
              Przejdź do strony logowania
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

if (typeof document !== 'undefined' && typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
  document.title = `Zarządzanie Projektami - ${__APP_VERSION__}`;
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
