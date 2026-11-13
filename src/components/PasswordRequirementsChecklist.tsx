import React from 'react';
import { Check, Circle } from 'lucide-react';
import {
  PasswordPolicyContext,
  getPasswordPolicyChecks,
  validatePassword,
} from '../utils/passwordPolicy';

interface PasswordRequirementsChecklistProps {
  password: string;
  context?: PasswordPolicyContext;
  variant?: 'dark' | 'auto';
}

export const PasswordRequirementsChecklist: React.FC<PasswordRequirementsChecklistProps> = ({
  password,
  context,
  variant = 'auto',
}) => {
  const checks = getPasswordPolicyChecks(password, context);
  const validation = validatePassword(password, context);
  const hasInput = password.length > 0;

  const containerCls =
    variant === 'dark'
      ? 'mt-2 p-2.5 rounded-lg bg-slate-900/80 border border-slate-700/80 space-y-1.5'
      : 'mt-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5';

  const headerTextCls =
    variant === 'dark'
      ? 'text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between'
      : 'text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center justify-between';

  return (
    <div className={containerCls} aria-live="polite">
      <div className={headerTextCls}>
        <span>Wymagania wobec hasła</span>
        <span
          className={`font-mono ${
            hasInput
              ? validation.ok
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-400'
              : ''
          }`}
        >
          {password.length}/12–128
        </span>
      </div>
      <ul className="space-y-1">
        {checks.map((item) => {
          const textColor = item.met
            ? variant === 'dark'
              ? 'text-emerald-300'
              : 'text-emerald-700 dark:text-emerald-300'
            : hasInput
            ? variant === 'dark'
              ? 'text-rose-300/90'
              : 'text-rose-700 dark:text-rose-400'
            : variant === 'dark'
            ? 'text-slate-400'
            : 'text-slate-600 dark:text-slate-400';

          return (
            <li key={item.id} className={`flex items-center gap-1.5 text-[11px] leading-tight ${textColor}`}>
              {item.met ? (
                <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              ) : (
                <Circle className="w-3 h-3 opacity-60 shrink-0" aria-hidden="true" />
              )}
              <span>{item.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
