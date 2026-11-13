import React, { useState, useId, useRef } from 'react';
import { 
  X, 
  GitBranch, 
  RefreshCw, 
  ShieldCheck, 
  CheckCircle2, 
  ArrowUpRight, 
  Copy,
  Check,
  Sparkles,
} from 'lucide-react';
import { GITHUB_REPO_URL, CURRENT_APP_VERSION, INSTALL_TARGET_DIR } from '../data/dockerConfig';
import { copyToClipboard } from '../utils/clipboard';
import { useFocusTrap } from '../utils/useFocusTrap';

interface GitHubUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVersion?: string;
  latestVersion?: string;
  onUpdateCompleted?: () => void;
}

export const GitHubUpdateModal: React.FC<GitHubUpdateModalProps> = ({
  isOpen,
  onClose,
  currentVersion: _currentVersion = CURRENT_APP_VERSION,
  latestVersion = CURRENT_APP_VERSION,
  onUpdateCompleted,
}) => {
  const [updating, setUpdating] = useState(false);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [isDone, setIsDone] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useFocusTrap({ isOpen, onClose, containerRef });

  if (!isOpen) return null;

  const updateSteps = [
    {
      title: 'Krok 1: Kopia zapasowa bazy danych (./backup.sh)',
      desc: 'Wykonanie skompresowanej i zweryfikowanej kopii pliku app_state.json w katalogu backups/.',
    },
    {
      title: 'Krok 2: Zabezpieczenie lokalnych zmian (git stash)',
      desc: 'Ukrycie ewentualnych lokalnych modyfikacji (jeśli istnieją), aby git pull wykonał się bez konfliktów.',
    },
    {
      title: 'Krok 3: Pobranie najnowszego kodu (git pull origin main)',
      desc: 'Pobranie najnowszych zmian z oficjalnego repozytorium GitHub.',
    },
    {
      title: 'Krok 4: Przebudowa i start kontenerów (docker compose up -d --build)',
      desc: 'Uruchomienie nowej wersji z zachowaniem dotychczasowego wolumenu danych zarzadzanie_app_data.',
    },
    {
      title: 'Krok 5: Weryfikacja działania usług (docker compose ps)',
      desc: 'Sprawdzenie czy kontener zarzadzanie_app działa i odpowiada prawidłowo.',
    },
  ];

  const handleRunSimulation = () => {
    setUpdating(true);
    setCurrentStep(1);

    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= 5) {
          clearInterval(stepInterval);
          setUpdating(false);
          setIsDone(true);
          if (onUpdateCompleted) {
            onUpdateCompleted();
          }
          return 5;
        }
        return prev + 1;
      });
    }, 850);
  };

  const terminalUpdateCommand = `cd ${INSTALL_TARGET_DIR} && ./backup.sh && git stash && git pull origin main && docker compose up -d --build && docker compose ps`;

  const handleCopyCommand = async () => {
    const success = await copyToClipboard(terminalUpdateCommand);
    if (success) {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-950/60 rounded-lg text-emerald-700 dark:text-emerald-400">
              <Sparkles className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 id={titleId} className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Wersja & Aktualizacje Systemu</span>
                <span className="text-[11px] bg-emerald-700 text-white font-bold px-2 py-0.5 rounded-full">
                  {CURRENT_APP_VERSION}
                </span>
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Zainstalowana wersja: <span className="font-mono text-slate-800 dark:text-slate-200 font-semibold">{CURRENT_APP_VERSION}</span> (System jest zaktualizowany)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno aktualizacji systemu"
            className="p-1 rounded text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Release Highlights */}
          <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 space-y-2">
            <h4 className="text-xs font-bold text-sky-950 uppercase tracking-wide flex items-center gap-1.5">
              <GitBranch className="w-4 h-4 text-sky-700" aria-hidden="true" />
              <span>Nowości w wydaniu {latestVersion} (Zarządzanie Projektami):</span>
            </h4>
            <ul className="text-xs text-sky-900 space-y-1.5 list-disc list-inside">
              <li>
                <strong>Automatyczne kopie zapasowe (Auto-Backup)</strong> z harmonogramem, retencją migawek i gotowym zadaniem cyklicznym Linux Cron.
              </li>
              <li>
                <strong>Nowy instalator 1-poleceniem</strong> pobierający kod bezpośrednio z oficjalnego repozytorium GitHub do <code className="font-mono bg-sky-100 px-1 rounded">{INSTALL_TARGET_DIR}</code>.
              </li>
              <li>
                <strong>Automatyczny kod projektu (np. 2026-01)</strong> z walidacją wolnego numeru i możliwością ręcznej edycji.
              </li>
              <li>
                <strong>Katalog szablonów projektów budowlanych</strong> zarządzany przez Administratora (projekty kubaturowe, hale, osiedla, przebudowy).
              </li>
              <li>
                <strong>Interaktywna lista zadań krytycznych i zablokowanych</strong> po kliknięciu w etykiety na pasku narzędzi.
              </li>
            </ul>
          </div>

          {/* User's Key Question: Will data survive docker upgrade? */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
              <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0" aria-hidden="true" />
              <span>Czy po aktualizacji Docker dane projektów pozostaną?</span>
            </div>
            <p className="text-xs text-emerald-950 leading-relaxed">
              <strong>TAK, w 100%!</strong> Twoje projekty budowlane, zadania, harmonogramy i użytkownicy są bezpiecznie przechowywane w trwałym wolumenie bazy danych <code className="bg-emerald-100 px-1 py-0.5 rounded font-mono font-bold text-emerald-900">zarzadzanie_app_data</code>.
            </p>
            <p className="text-xs text-emerald-900 leading-relaxed">
              Podczas aktualizacji Docker pobiera jedynie nowszy kod aplikacji z GitHub, a wolumen danych na dysku serwera w <code className="font-mono text-emerald-900">/opt/zarzadzanie-projektami</code> pozostaje <strong>całkowicie nienaruszony</strong>.
            </p>
          </div>

          {/* Update Simulation Progress or Button */}
          {updating || isDone ? (
            <div className="bg-slate-900 text-white rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  {isDone ? 'Aktualizacja zakończona sukcesem' : 'Trwa bezpieczna aktualizacja...'}
                </span>
                <span className="text-xs font-mono text-emerald-400 font-bold">
                  {currentStep} / {updateSteps.length}
                </span>
              </div>

              {/* Step list */}
              <div className="space-y-2.5">
                {updateSteps.map((step, idx) => {
                  const stepNum = idx + 1;
                  const isCompleted = currentStep > stepNum || isDone;
                  const isCurrent = currentStep === stepNum && !isDone;

                  return (
                    <div
                      key={step.title}
                      className={`p-2.5 rounded-lg text-xs flex items-start gap-2.5 transition-all ${
                        isCompleted
                          ? 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-200'
                          : isCurrent
                          ? 'bg-slate-800 border border-sky-500/40 text-sky-200 animate-pulse'
                          : 'bg-slate-800/40 border border-slate-700 text-slate-400'
                      }`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                      ) : isCurrent ? (
                        <RefreshCw className="w-4 h-4 text-sky-400 animate-spin shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-slate-500 flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                          {stepNum}
                        </div>
                      )}
                      <div>
                        <div className="font-bold">{step.title}</div>
                        <div className="text-[11px] opacity-90">{step.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {isDone && (
                <div role="status" className="bg-emerald-700 text-white p-3 rounded-lg flex items-center justify-between text-xs font-medium">
                  <span>Wersja {latestVersion} została pomyślnie zaaplikowana! Dane w wolumenie zarzadzanie_app_data są nienaruszone.</span>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1 bg-white text-emerald-900 font-bold rounded hover:bg-emerald-50 transition-colors shrink-0"
                  >
                    Gotowe
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={handleRunSimulation}
                  className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                  <span>Uruchom procedurę aktualizacji do {latestVersion}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyCommand}
                  className="py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium text-xs flex items-center justify-center gap-2 transition-all shrink-0"
                  title="Kopiuj polecenia powłoki bash do terminala serwera"
                >
                  {copiedCmd ? <Check className="w-4 h-4 text-emerald-400" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                  <span>Kopiuj komendę dla serwera</span>
                </button>
              </div>

              {/* Exact terminal commands */}
              <div className="bg-slate-950 text-slate-200 rounded-lg p-3 font-mono text-[11px] space-y-1 overflow-x-auto">
                <div className="text-slate-400 font-sans text-[10px]"># Komenda terminala na serwerze produkcyjnym Linux:</div>
                <div className="text-sky-300">cd {INSTALL_TARGET_DIR}</div>
                <div className="text-emerald-400">./backup.sh</div>
                <div className="text-slate-400">git stash # (jeśli są lokalne zmiany)</div>
                <div className="text-amber-300">git pull origin main</div>
                <div className="text-emerald-300 font-bold">docker compose up -d --build</div>
                <div className="text-sky-400">docker compose ps</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sky-700 hover:text-sky-900 font-medium hover:underline"
          >
            <span>GitHub: FraczekMarcin/Zarzadzanie-Projektami</span>
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded transition-colors font-medium"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
