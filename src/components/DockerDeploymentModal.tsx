import React, { useState, useId, useRef } from 'react';
import { 
  GITHUB_REPO_URL,
  CURRENT_APP_VERSION,
  INSTALL_TARGET_DIR,
  INSTALL_COMMAND,
  UPDATE_COMMAND
} from '../data/dockerConfig';
import { copyToClipboard } from '../utils/clipboard';
import { useFocusTrap } from '../utils/useFocusTrap';
import { 
  X, 
  Copy, 
  Check, 
  Server, 
  Database, 
  ShieldCheck, 
  RefreshCw,
  AlertTriangle,
  Zap,
  Lock
} from 'lucide-react';

interface DockerDeploymentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DockerDeploymentModal: React.FC<DockerDeploymentModalProps> = ({ isOpen, onClose }) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'commands' | 'persistence' | 'backup'>('commands');
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useFocusTrap({ isOpen, onClose, containerRef });

  if (!isOpen) return null;

  const handleCopy = async (cmd: string, key: string) => {
    const success = await copyToClipboard(cmd);
    if (success) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const gitCloneAndInstall = `git clone ${GITHUB_REPO_URL}.git ${INSTALL_TARGET_DIR} && cd ${INSTALL_TARGET_DIR} && ${INSTALL_COMMAND}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-100 rounded-lg text-sky-700">
              <Server className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 id={titleId} className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>Wdrożenie Self-Hosted: Zarządzanie Projektami</span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full border border-emerald-300">
                  {CURRENT_APP_VERSION}
                </span>
              </h3>
              <p className="text-xs text-slate-600">
                Lokalizacja docelowa na serwerze: <code className="font-mono text-slate-800 font-semibold">{INSTALL_TARGET_DIR}</code>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno wdrożenia Docker"
            className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-slate-200 bg-white flex items-center gap-3 text-xs font-medium" role="tablist" aria-label="Sekcje wdrożenia">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'commands'}
            onClick={() => setActiveTab('commands')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'commands'
                ? 'border-emerald-600 text-emerald-800 font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="w-4 h-4 text-emerald-700" aria-hidden="true" />
            <span>Instalacja & Aktualizacja</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'persistence'}
            onClick={() => setActiveTab('persistence')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'persistence'
                ? 'border-sky-600 text-sky-800 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Database className="w-4 h-4 text-sky-700" aria-hidden="true" />
            <span>Trwałość danych (Wolumen)</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'backup'}
            onClick={() => setActiveTab('backup')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'backup'
                ? 'border-sky-600 text-sky-800 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-sky-700" aria-hidden="true" />
            <span>Kopie zapasowe i Disaster Recovery</span>
          </button>
        </div>

        {/* Tab Content: Commands */}
        {activeTab === 'commands' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-slate-50">
            {/* 1. Pierwsza instalacja */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs">
                    1
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Pierwsza instalacja na serwerze (Linux)
                  </h4>
                </div>
                <span className="text-[11px] text-slate-600">Jedno polecenie</span>
              </div>
              <p className="text-xs text-slate-600">
                Uruchom w katalogu projektu na serwerze. Skrypt sprawdza Docker i Docker Compose, tworzy plik <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-semibold">.env</code> z losowym <code className="font-mono text-slate-800 font-semibold">APP_SECRET</code> (uprawnienia 600), katalog kopii, wpis w cronie oraz uruchamia kontenery.
              </p>
              <div className="bg-slate-900 rounded-lg p-3.5 flex items-center justify-between gap-3 font-mono text-xs text-emerald-400">
                <code className="select-all break-all">{INSTALL_COMMAND}</code>
                <button
                  type="button"
                  onClick={() => handleCopy(INSTALL_COMMAND, 'install')}
                  className="shrink-0 flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded transition-all shadow-xs"
                >
                  {copiedKey === 'install' ? <Check className="w-3.5 h-3.5 text-white" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span>{copiedKey === 'install' ? 'Skopiowano!' : 'Kopiuj'}</span>
                </button>
              </div>

              <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200">
                <strong>Pełne klonowanie z Git (na świeżym serwerze):</strong>
                <div className="font-mono text-slate-700 mt-1 select-all break-all">
                  {gitCloneAndInstall}
                </div>
              </div>
            </div>

            {/* 2. Bezpieczna aktualizacja */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-sky-100 text-sky-800 font-bold flex items-center justify-center text-xs">
                    2
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Aktualizacja aplikacji do najnowszej wersji
                  </h4>
                </div>
                <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" aria-hidden="true" /> Bezpieczna
                </span>
              </div>
              <p className="text-xs text-slate-600">
                Pojedyncza komenda wykonuje natychmiastową kopię zapasową pliku bazy, pobiera najnowszy kod z GitHub i bezpiecznie przebudowuje kontener.
              </p>
              <div className="bg-slate-900 rounded-lg p-3.5 flex items-center justify-between gap-3 font-mono text-xs text-emerald-400">
                <code className="select-all break-all">{UPDATE_COMMAND}</code>
                <button
                  type="button"
                  onClick={() => handleCopy(UPDATE_COMMAND, 'update')}
                  className="shrink-0 flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium px-3 py-1.5 rounded transition-all shadow-xs"
                >
                  {copiedKey === 'update' ? <Check className="w-3.5 h-3.5 text-white" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span>{copiedKey === 'update' ? 'Skopiowano!' : 'Kopiuj'}</span>
                </button>
              </div>
            </div>

            {/* Ważne ostrzeżenie o down -v */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-900">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <span className="font-bold text-sm block mb-0.5">Wskazówka bezpieczeństwa</span>
                Nigdy nie używaj polecenia <code className="font-mono font-bold bg-amber-100 px-1 rounded">docker compose down -v</code>. Flaga <code className="font-mono font-bold">-v</code> kasuje trwałe wolumeny danych. Do zwykłego zatrzymania kontenera wystarczy <code className="font-mono bg-white px-1 py-0.5 rounded border border-amber-300 font-semibold">docker compose down</code>.
              </div>
            </div>
          </div>
        )}

        {/* Tab Content: Persistence */}
        {activeTab === 'persistence' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-5 text-xs text-slate-700 bg-slate-50">
            <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-5 flex items-start gap-4 shadow-xs">
              <div className="w-9 h-9 rounded-full bg-emerald-700 text-white flex items-center justify-center shrink-0 font-bold text-base shadow-sm" aria-hidden="true">
                ✓
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-emerald-900">
                  Gwarancja trwałości danych przy kolejnych aktualizacjach
                </h4>
                <p className="text-emerald-800 text-xs leading-relaxed">
                  Baza danych zapisywana jest w wolumenie Docker <code className="bg-emerald-100 px-1 py-0.5 rounded font-mono text-emerald-950 font-bold">zarzadzanie_app_data</code> montowanym w <code className="font-mono text-emerald-950 font-bold">/app/data</code>. Aktualizacja kontenera nowszym kodem nie narusza stanu projektów, zadań ani kont użytkowników.
                </p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h5 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Database className="w-4 h-4 text-sky-700" aria-hidden="true" />
                <span>Model zapisu danych i bezpieczeństwo</span>
              </h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <span className="font-bold text-slate-900">Atomowy zapis JSON</span>
                  <p className="text-slate-600 text-[11px]">
                    Zapis z debouncem 300 ms, kolejką obietnic i asynchronicznym przemianowaniem pliku tymczasowego chroni przed uszkodzeniem przy nagłym wyłączeniu zasilania.
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <span className="font-bold text-slate-900">Izolacja kontenera</span>
                  <p className="text-slate-600 text-[11px]">
                    Tryb read-only systemu plików kontenera, brak uprawnień roota (użytkownik <code className="font-mono">appuser</code>), brak uprawnień jądra (<code className="font-mono">cap_drop: ALL</code>) i limit pamięci 512 MB.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content: Backup & Disaster Recovery */}
        {activeTab === 'backup' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-5 text-xs text-slate-700 bg-slate-50">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h5 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                <span>Automatyczny harmonogram kopii zapasowych (backup.sh)</span>
              </h5>
              <p className="text-slate-600 text-xs">
                Instalator dodaje zadanie w <code className="font-mono text-slate-800 bg-slate-100 px-1 rounded">/etc/cron.d/zarzadzanie-projektami-backup</code>, które codziennie o 02:00 wykonuje kompresję gzip, walidację integralności oraz rotację starych kopii z zachowaniem minimum 7 ostatnich zrzutów.
              </p>
              <div className="bg-slate-900 text-slate-200 rounded-lg p-3 font-mono text-xs flex items-center justify-between">
                <code>/opt/zarzadzanie-projektami/backup.sh</code>
                <button
                  type="button"
                  onClick={() => handleCopy('/opt/zarzadzanie-projektami/backup.sh', 'cron-backup')}
                  className="flex items-center gap-1 text-sky-400 hover:text-sky-300 text-xs"
                >
                  {copiedKey === 'cron-backup' ? <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span>{copiedKey === 'cron-backup' ? 'Skopiowano' : 'Kopiuj'}</span>
                </button>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Lock className="w-4 h-4 text-amber-700" aria-hidden="true" />
                <span>Ochrona klucza APP_SECRET i Disaster Recovery</span>
              </div>
              <p className="text-slate-600 text-xs leading-relaxed">
                Plik <code className="font-mono bg-slate-100 px-1 rounded text-slate-800 font-semibold">.env</code> zawiera klucz szyfrujący <code className="font-mono text-slate-800 font-semibold">APP_SECRET</code>. Ze względów bezpieczeństwa plik ten nie wchodzi w skład archiwum backup.sh. Zapisz wartość klucza poza serwerem w menedżerze haseł. Na nowym serwerze odtwórz najpierw plik .env z tym samym kluczem przed startem aplikacji.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <span>Repozytorium: {GITHUB_REPO_URL}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded transition-colors font-medium text-xs"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
