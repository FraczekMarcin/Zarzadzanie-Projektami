import React from 'react';
import { AlertCircle, X } from 'lucide-react';

export interface FormErrorProps {
  id?: string;
  error: string | null | undefined;
  onDismiss?: () => void;
  alertRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  variant?: 'default' | 'dark';
}

export const FormError: React.FC<FormErrorProps> = ({
  id,
  error,
  onDismiss,
  alertRef,
  className = '',
  variant = 'default',
}) => {
  if (!error || !error.trim()) return null;

  const paletteClasses =
    variant === 'dark'
      ? 'bg-rose-950/60 border border-rose-500/60 text-rose-200'
      : 'bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200';

  const iconClasses =
    variant === 'dark'
      ? 'w-4 h-4 text-rose-300 shrink-0 mt-0.5'
      : 'w-4 h-4 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5';

  const closeClasses =
    variant === 'dark'
      ? 'text-rose-300 hover:text-white p-0.5 rounded shrink-0'
      : 'text-rose-700 dark:text-rose-300 hover:text-rose-900 dark:hover:text-white p-0.5 rounded shrink-0';

  return (
    <div
      id={id}
      ref={alertRef}
      role="alert"
      aria-live="assertive"
      tabIndex={-1}
      className={`px-3 py-2.5 rounded-lg text-xs flex items-start justify-between gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${paletteClasses} ${className}`.trim()}
    >
      <div className="flex items-start gap-2 min-w-0">
        <AlertCircle className={iconClasses} aria-hidden="true" />
        <span className="leading-relaxed break-words">{error}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Zamknij komunikat błędu"
          className={closeClasses}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
