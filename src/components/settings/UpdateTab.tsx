import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';
import { CURRENT_APP_VERSION, UPDATE_COMMAND } from '../../data/dockerConfig';
import { isNewerVersion } from '../../utils/versionCheck';

export interface UpdateTabProps {
  isOpen: boolean;
  hasUpdateAvailable: boolean;
  onToggleUpdateSimulation?: (val: boolean) => void;
  copiedKey: string | null;
  onCopyCode: (text: string, key: string) => void;
}

export const UpdateTab: React.FC<UpdateTabProps> = ({
  isOpen,
  hasUpdateAvailable,
  onToggleUpdateSimulation,
  copiedKey,
  onCopyCode,
}) => {
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isUpdatingServer, setIsUpdatingServer] = useState(false);
  const [updateServerMessage, setUpdateServerMessage] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<{
    status: 'latest' | 'update_available' | 'error';
    message: string;
    lastChecked: string;
    latestSha?: string;
    remoteVersion?: string;
  } | null>(null);

  useEffect(() => {
    const lastCheckStr = localStorage.getItem('oph_last_update_check_time');
    if (lastCheckStr) {
      setUpdateResult({
        status: hasUpdateAvailable ? 'update_available' : 'latest',
        message: hasUpdateAvailable
          ? `Dostępna jest nowa wersja oprogramowania w repozytorium GitHub!`
          : `Wersja ${CURRENT_APP_VERSION} jest aktualna.`,
        lastChecked: new Date(Number(lastCheckStr)).toLocaleString('pl-PL'),
      });
    }
  }, [isOpen, hasUpdateAvailable]);

  const handleCheckUpdateNow = async () => {
    setIsCheckingUpdate(true);
    setUpdateResult(null);
    setUpdateServerMessage(null);

    try {
      // Wyłącznie serwerowy endpoint /api/system/check-update (z pamięcią podręczną 6h)
      const sResp = await fetch(`/api/system/check-update?t=${Date.now()}`, { credentials: 'same-origin' }).catch(() => null);
      if (sResp && sResp.ok) {
        const sData = await sResp.json();
        const remoteVer = (sData.remoteVersion || '').trim() || CURRENT_APP_VERSION;
        const hasUp = isNewerVersion(remoteVer, CURRENT_APP_VERSION);

        if (onToggleUpdateSimulation) {
          onToggleUpdateSimulation(hasUp);
        }
        localStorage.setItem('oph_update_available', hasUp ? 'true' : 'false');
        localStorage.setItem('oph_last_update_check_time', String(Date.now()));

        const cacheNote = sData.cached ? ' (dane z pamięci podręcznej serwera, cache 6h)' : '';
        setUpdateResult({
          status: hasUp ? 'update_available' : 'latest',
          remoteVersion: remoteVer,
          message: hasUp
            ? `Wykryto nowsze wydanie na GitHub: ${remoteVer} (Twoja wersja: ${sData.localVersion || CURRENT_APP_VERSION}).`
            : `Twoja wersja (${sData.localVersion || CURRENT_APP_VERSION}) jest zgodna z najnowszym zatwierdzeniem w gałęzi main (${sData.latestSha || 'main'}). Brak nowszych aktualizacji${cacheNote}.`,
          lastChecked: new Date(sData.checkedAt || Date.now()).toLocaleString('pl-PL'),
          latestSha: sData.latestSha,
        });
      } else {
        setUpdateResult({
          status: 'error',
          message: 'Nie udało się połączyć z serwerem aktualizacji. Sprawdź połączenie z serwerem.',
          lastChecked: new Date().toLocaleString('pl-PL'),
        });
      }
    } catch {
      setUpdateResult({
        status: 'error',
        message: 'Wystąpił błąd podczas weryfikacji aktualizacji na serwerze.',
        lastChecked: new Date().toLocaleString('pl-PL'),
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleRunUpdateNow = async () => {
    setIsUpdatingServer(true);
    setUpdateServerMessage('Aktualizacja ze względów bezpieczeństwa wykonywana jest bezpośrednio w terminalu serwera (polecenie poniżej).');
    setTimeout(() => {
      setIsUpdatingServer(false);
    }, 600);
  };

  const RECOMMENDED_UPDATE_COMMAND = UPDATE_COMMAND;
  const isUpdateDetected = updateResult?.remoteVersion
    ? isNewerVersion(updateResult.remoteVersion, CURRENT_APP_VERSION)
    : (hasUpdateAvailable && updateResult?.status === 'update_available');

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-bold text-slate-900 dark:text-white text-base">
            Status Wersji i Aktualizacje Oprogramowania
          </h4>
          <p className="text-slate-600 dark:text-slate-400 text-xs">
            Zainstalowane wydanie: <strong className="font-mono text-emerald-700 dark:text-emerald-400">{CURRENT_APP_VERSION}</strong>
          </p>
        </div>

        <button
          type="button"
          onClick={handleCheckUpdateNow}
          disabled={isCheckingUpdate}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-sky-700 hover:bg-sky-800 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>{isCheckingUpdate ? 'Weryfikacja GitHub...' : 'Sprawdź aktualizacje teraz'}</span>
        </button>
      </div>

      {/* Status Banner */}
      <div role="status" className={`p-4 rounded-xl border flex items-start gap-3.5 ${
        isUpdateDetected
          ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 ring-2 ring-rose-500/30'
          : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
      }`}>
        {isUpdateDetected ? (
          <AlertTriangle className="w-6 h-6 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5 animate-bounce" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="w-6 h-6 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
        )}
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-900 dark:text-white text-sm">
              {isUpdateDetected ? '🚀 Dostępna nowa aktualizacja oprogramowania!' : '✅ System jest w pełni zaktualizowany'}
            </span>
            <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono font-bold">
              Wydanie: {CURRENT_APP_VERSION}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {updateResult ? updateResult.message : `Wersja ${CURRENT_APP_VERSION} jest zainstalowana na Twoim serwerze.`}
          </p>
          {updateResult?.lastChecked && (
            <span className="text-[10px] text-slate-600 dark:text-slate-400 block pt-0.5">
              Ostatnie sprawdzenie: {updateResult.lastChecked}
            </span>
          )}

          {isUpdateDetected && (
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRunUpdateNow}
                disabled={isUpdatingServer}
                className="px-4 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-lg text-xs font-bold shadow-md transition-colors flex items-center gap-2"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isUpdatingServer ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>{isUpdatingServer ? 'Aktualizowanie...' : 'Zaktualizuj z GitHub teraz'}</span>
              </button>
              <button
                type="button"
                onClick={() => onCopyCode(RECOMMENDED_UPDATE_COMMAND, 'rec-update')}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
              >
                {copiedKey === 'rec-update' ? <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                <span>{copiedKey === 'rec-update' ? 'Skopiowano polecenie!' : 'Kopiuj komendę terminala'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {updateServerMessage && (
        <div role="status" className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700">
          {updateServerMessage}
        </div>
      )}

      {/* Recommended Terminal Update Command */}
      <div className="p-4 bg-slate-900 text-slate-100 rounded-xl space-y-3 border border-slate-800">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono font-bold text-sky-400 flex items-center gap-1.5">
            <Terminal className="w-4 h-4" aria-hidden="true" />
            <span>Oficjalne polecenie aktualizacji na serwerze Linux:</span>
          </span>
          <button
            type="button"
            onClick={() => onCopyCode(RECOMMENDED_UPDATE_COMMAND, 'rec-update')}
            className="flex items-center gap-1.5 text-xs bg-sky-700 hover:bg-sky-600 px-3 py-1.5 rounded-lg text-white font-semibold transition-colors shadow-xs cursor-pointer"
          >
            {copiedKey === 'rec-update' ? <Check className="w-3.5 h-3.5 text-white" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
            <span>{copiedKey === 'rec-update' ? 'Skopiowano do schowka!' : 'Kopiuj polecenie'}</span>
          </button>
        </div>
        <pre className="font-mono text-xs bg-black/60 p-3 rounded-lg overflow-x-auto text-emerald-300 border border-slate-800 select-all">
          {RECOMMENDED_UPDATE_COMMAND}
        </pre>
        <p className="text-[11px] text-slate-300">
          Polecenie pobiera najnowsze zatwierdzenia z gałęzi main i natychmiastowo przebudowuje kontener bez utraty danych w pliku bazy JSON.
        </p>
      </div>

      {/* Post-update Docker cleanup */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h5 className="text-xs font-bold text-slate-900 dark:text-white">
              Sprzątanie po udanej aktualizacji (oszczędność miejsca na dysku)
            </h5>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
              Po weryfikacji, że nowa wersja działa poprawnie, usuń nieużywane obrazy Docker oraz starszą pamięć podręczną budowania. Wolumen z danymi aplikacji pozostaje nienaruszony.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onCopyCode(
                'docker image prune -f && docker builder prune -f --filter until=72h',
                'post-update-cleanup'
              )
            }
            className="flex items-center gap-1.5 text-xs bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1.5 rounded-lg text-slate-800 dark:text-slate-200 font-semibold border border-slate-300 dark:border-slate-700 transition-colors cursor-pointer"
          >
            {copiedKey === 'post-update-cleanup' ? (
              <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            ) : (
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>{copiedKey === 'post-update-cleanup' ? 'Skopiowano!' : 'Kopiuj polecenie'}</span>
          </button>
        </div>

        <pre className="font-mono text-xs bg-slate-900 text-emerald-300 p-3 rounded-lg overflow-x-auto border border-slate-800 select-all">
{`docker image prune -f
# Opcjonalnie (usuwa cache budowania starszy niż 72 godziny):
docker builder prune -f --filter until=72h`}
        </pre>
      </div>
    </div>
  );
};

export default UpdateTab;
