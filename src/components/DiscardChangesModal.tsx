import React, { useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useFocusTrap } from '../utils/useFocusTrap';

interface DiscardChangesModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const DiscardChangesModal: React.FC<DiscardChangesModalProps> = ({
  isOpen,
  onCancel,
  onConfirm,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  useFocusTrap({
    isOpen,
    onClose: onCancel,
    containerRef: dialogRef,
    initialFocusRef: keepEditingRef,
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-xs"
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 shrink-0">
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h3 id={titleId} className="text-sm font-bold text-slate-900 dark:text-white">
              Odrzucić niezapisane zmiany?
            </h3>
            <p id={descId} className="text-slate-600 dark:text-slate-300 leading-relaxed">
              W formularzu wprowadzono zmiany, które nie zostały jeszcze zapisane. Jeśli zamkniesz to okno teraz, zmiany zostaną utracone.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            ref={keepEditingRef}
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold transition-colors"
          >
            Wróć do edycji
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold transition-colors"
          >
            Odrzuć zmiany
          </button>
        </div>
      </div>
    </div>
  );
};
