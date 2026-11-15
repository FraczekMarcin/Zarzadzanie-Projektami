import React from 'react';
import { Copy, Check } from 'lucide-react';
import { INSTALL_COMMAND, UPDATE_COMMAND } from '../../data/dockerConfig';

export interface DockerTabProps {
  copiedKey: string | null;
  onCopyCode: (text: string, key: string) => void;
}

export const DockerTab: React.FC<DockerTabProps> = ({ copiedKey, onCopyCode }) => {
  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h4 className="font-bold text-slate-900 dark:text-white text-base">
          Konfiguracja Wdrożenia Docker na Serwerze
        </h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs">
          Skrypty instalacji i pliki konfiguracyjne dla środowiska produkcyjnego Linux / Docker Compose.
        </p>
      </div>

      <div className="space-y-4">
        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">
              Pierwsza instalacja na serwerze (Linux)
            </span>
            <button
              type="button"
              onClick={() => onCopyCode(INSTALL_COMMAND, 'install-cmd')}
              className="flex items-center gap-1 text-[11px] text-sky-700 dark:text-sky-400 hover:underline"
            >
              {copiedKey === 'install-cmd' ? <Check className="w-3 h-3 text-emerald-700 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
              <span>{copiedKey === 'install-cmd' ? 'Skopiowano' : 'Kopiuj komendę'}</span>
            </button>
          </div>
          <pre className="text-xs font-mono bg-slate-900 text-emerald-400 p-2.5 rounded border border-slate-700 overflow-x-auto select-all">
            {INSTALL_COMMAND}
          </pre>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            Weryfikuje środowisko Docker, tworzy bezpieczny plik .env z kluczem APP_SECRET, katalog backups, zadanie crona dla kopii zapasowych oraz uruchamia aplikację.
          </p>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">
              Bezpieczna aktualizacja aplikacji
            </span>
            <button
              type="button"
              onClick={() => onCopyCode(UPDATE_COMMAND, 'update-cmd')}
              className="flex items-center gap-1 text-[11px] text-sky-700 dark:text-sky-400 hover:underline"
            >
              {copiedKey === 'update-cmd' ? <Check className="w-3 h-3 text-emerald-700 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
              <span>{copiedKey === 'update-cmd' ? 'Skopiowano' : 'Kopiuj komendę'}</span>
            </button>
          </div>
          <pre className="text-xs font-mono bg-slate-900 text-emerald-400 p-2.5 rounded border border-slate-700 overflow-x-auto select-all">
            {UPDATE_COMMAND}
          </pre>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            Wykonuje kopię zapasową stanu bazy, pobiera najnowszy kod z GitHub i przebudowuje kontener z zachowaniem trwałego wolumenu danych.
          </p>
        </div>
      </div>
    </div>
  );
};

export default DockerTab;
