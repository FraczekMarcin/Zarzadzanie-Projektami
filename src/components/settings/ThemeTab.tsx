import React from 'react';
import { Sun, Moon, Laptop, Check } from 'lucide-react';
import type { ThemeMode } from '../../utils/theme';

export interface ThemeTabProps {
  currentTheme: ThemeMode;
  onSelectTheme: (mode: ThemeMode) => void;
}

export const ThemeTab: React.FC<ThemeTabProps> = ({ currentTheme, onSelectTheme }) => {
  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h4 className="font-bold text-slate-900 dark:text-white text-base">
          Motyw graficzny interfejsu
        </h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs">
          Wybierz preferowaną kolorystykę aplikacji lub dostosuj ją automatycznie do ustawień systemowych urządzenia.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-1">
        {/* Jasny */}
        <button
          type="button"
          aria-pressed={currentTheme === 'light'}
          onClick={() => onSelectTheme('light')}
          className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center text-center space-y-2 ${
            currentTheme === 'light'
              ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/30 ring-2 ring-sky-600/30'
              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
            <Sun className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <span className="font-bold text-slate-900 dark:text-white block">
              Jasny motyw
            </span>
            <span className="text-[11px] text-slate-600 dark:text-slate-400">
              Czysty, wysoki kontrast, idealny do pracy w dzień
            </span>
          </div>
          {currentTheme === 'light' && (
            <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-400 flex items-center gap-1">
              <Check className="w-3 h-3" aria-hidden="true" /> Aktywny
            </span>
          )}
        </button>

        {/* Ciemny */}
        <button
          type="button"
          aria-pressed={currentTheme === 'dark'}
          onClick={() => onSelectTheme('dark')}
          className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center text-center space-y-2 ${
            currentTheme === 'dark'
              ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/30 ring-2 ring-sky-600/30'
              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-slate-800 text-sky-400 flex items-center justify-center">
            <Moon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <span className="font-bold text-slate-900 dark:text-white block">
              Ciemny motyw (Dark Mode)
            </span>
            <span className="text-[11px] text-slate-600 dark:text-slate-400">
              Ciemne tło dla całej aplikacji, redukujące zmęczenie oczu
            </span>
          </div>
          {currentTheme === 'dark' && (
            <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-400 flex items-center gap-1">
              <Check className="w-3 h-3" aria-hidden="true" /> Aktywny
            </span>
          )}
        </button>

        {/* Zgodny z systemem */}
        <button
          type="button"
          aria-pressed={currentTheme === 'system'}
          onClick={() => onSelectTheme('system')}
          className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center text-center space-y-2 ${
            currentTheme === 'system'
              ? 'border-sky-700 bg-sky-50/50 dark:bg-sky-950/30 ring-2 ring-sky-600/30'
              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
            <Laptop className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <span className="font-bold text-slate-900 dark:text-white block">
              Zgodnie z systemem
            </span>
            <span className="text-[11px] text-slate-600 dark:text-slate-400">
              Automatycznie dopasowuje motyw do ustawień Windows/macOS/Linux
            </span>
          </div>
          {currentTheme === 'system' && (
            <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-400 flex items-center gap-1">
              <Check className="w-3 h-3" aria-hidden="true" /> Aktywny
            </span>
          )}
        </button>
      </div>
    </div>
  );
};

export default ThemeTab;
