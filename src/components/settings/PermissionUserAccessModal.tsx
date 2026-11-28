import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import type {
  Company,
  Permission,
  PermissionConfig,
  User,
  UserRole,
} from '../../types';
import {
  PERMISSION_CATALOG,
  USER_ROLES,
  type PermissionCatalogEntry,
} from '../../utils/permissions';
import { useFocusTrap } from '../../utils/useFocusTrap';
import { useDismissOnOutsideClick } from '../../hooks/useDismissOnOutsideClick';
import { parseApiErrorResponse, useFormSubmit } from '../../hooks/useFormSubmit';
import { FormError } from '../FormError';

export interface PermissionAdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  initials: string;
  isApproved?: boolean;
  groupIds?: string[];
  companyIds?: string[];
  permissionGrants?: Permission[];
  permissionDenials?: Permission[];
  effectivePermissions?: Permission[];
}

export const ROLE_LABELS_PL: Record<UserRole, string> = {
  admin: 'Administrator',
  project_manager: 'Kierownik projektu',
  developer: 'Projektant / Inżynier',
  tester: 'Weryfikator',
  viewer: 'Obserwator',
};

export const ROLE_SHORT_LABELS_PL: Record<UserRole, string> = {
  admin: 'Admin',
  project_manager: 'Kierownik',
  developer: 'Projektant',
  tester: 'Weryfikator',
  viewer: 'Obserwator',
};

const CATALOG_CATEGORIES: readonly PermissionCatalogEntry['category'][] = [
  'Projekty i zadania',
  'Finanse i kontrahenci',
  'Przetargi i zasoby',
  'System i raporty',
];

export interface PermissionUserAccessModalProps {
  isOpen: boolean;
  user: PermissionAdminUser | null;
  currentUser: User | null;
  permissionConfig: PermissionConfig;
  companies: Company[];
  approvedAdminCount: number;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export const PermissionUserAccessModal: React.FC<PermissionUserAccessModalProps> = ({
  isOpen,
  user,
  currentUser,
  permissionConfig,
  companies,
  approvedAdminCount,
  onClose,
  onSaved,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();

  const [role, setRole] = useState<UserRole>('developer');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [permissionGrants, setPermissionGrants] = useState<Permission[]>([]);
  const [permissionDenials, setPermissionDenials] = useState<Permission[]>([]);

  const submitState = useFormSubmit();

  useEffect(() => {
    if (!isOpen || !user) return;
    setRole(user.role);
    setGroupIds(Array.isArray(user.groupIds) ? [...user.groupIds] : []);
    setCompanyIds(Array.isArray(user.companyIds) ? [...user.companyIds] : []);
    setPermissionGrants(
      Array.isArray(user.permissionGrants) ? [...user.permissionGrants] : []
    );
    setPermissionDenials(
      Array.isArray(user.permissionDenials) ? [...user.permissionDenials] : []
    );
    submitState.clearError();
  }, [isOpen, user, submitState.clearError]);

  const { backdropProps, flashClassName } = useDismissOnOutsideClick({
    isOpen: isOpen && Boolean(user),
    mode: 'form',
    panelRef: modalRef,
    onDismiss: onClose,
    disabled: submitState.isSubmitting,
    cancelButtonRef: cancelBtnRef,
  });

  useFocusTrap({
    isOpen: isOpen && Boolean(user),
    onClose,
    containerRef: modalRef,
    disableEscape: submitState.isSubmitting,
  });

  const isLastApprovedAdmin = Boolean(
    user &&
      user.role === 'admin' &&
      user.isApproved !== false &&
      approvedAdminCount <= 1
  );

  const groupedCatalog = useMemo(
    () =>
      CATALOG_CATEGORIES.map((category) => ({
        category,
        items: PERMISSION_CATALOG.filter((entry) => entry.category === category),
      })),
    []
  );

  const effectivePreview = useMemo(() => {
    const rolePerms = new Set(permissionConfig.rolePermissions[role] || []);
    const selectedGroups = permissionConfig.permissionGroups.filter((g) =>
      groupIds.includes(g.id)
    );
    const companyPerms = new Set(permissionConfig.companyMemberPermissions || []);
    const grantSet = new Set(permissionGrants);
    const denialSet = new Set(permissionDenials);

    return PERMISSION_CATALOG.map((entry) => {
      if (role === 'admin') {
        return {
          entry,
          status: 'global' as const,
          sources: [{ kind: 'rola' as const, detail: ROLE_LABELS_PL.admin }],
        };
      }

      const sources: Array<{
        kind: 'rola' | 'grupa' | 'firma' | 'nadanie' | 'odmowa';
        detail?: string;
      }> = [];

      if (rolePerms.has(entry.key)) {
        sources.push({ kind: 'rola', detail: ROLE_LABELS_PL[role] });
      }
      const matchingGroups = selectedGroups.filter((g) =>
        g.permissions.includes(entry.key)
      );
      if (matchingGroups.length > 0) {
        sources.push({
          kind: 'grupa',
          detail: matchingGroups.map((g) => g.name).join(', '),
        });
      }
      if (companyIds.length > 0 && entry.companyScoped && companyPerms.has(entry.key)) {
        sources.push({
          kind: 'firma',
          detail: `członkostwo (${companyIds.length})`,
        });
      }
      if (grantSet.has(entry.key)) {
        sources.push({ kind: 'nadanie', detail: 'indywidualne' });
      }
      if (denialSet.has(entry.key)) {
        sources.push({ kind: 'odmowa', detail: 'blokada nadrzędna' });
      }

      const hasDenial = denialSet.has(entry.key);
      const hasGlobal =
        !hasDenial &&
        (rolePerms.has(entry.key) ||
          matchingGroups.length > 0 ||
          grantSet.has(entry.key));
      const hasCompanyOnly =
        !hasDenial &&
        !hasGlobal &&
        companyIds.length > 0 &&
        entry.companyScoped &&
        companyPerms.has(entry.key);

      const status: 'global' | 'company' | 'denied' | 'none' = hasDenial
        ? 'denied'
        : hasGlobal
          ? 'global'
          : hasCompanyOnly
            ? 'company'
            : 'none';

      return { entry, status, sources };
    });
  }, [role, groupIds, companyIds, permissionGrants, permissionDenials, permissionConfig]);

  if (!isOpen || !user) return null;

  const toggleGroup = (gid: string) => {
    setGroupIds((prev) =>
      prev.includes(gid) ? prev.filter((id) => id !== gid) : [...prev, gid]
    );
  };

  const toggleCompany = (cid: string) => {
    setCompanyIds((prev) =>
      prev.includes(cid) ? prev.filter((id) => id !== cid) : [...prev, cid]
    );
  };

  const toggleGrant = (perm: Permission) => {
    setPermissionGrants((prev) => {
      if (prev.includes(perm)) {
        return prev.filter((p) => p !== perm);
      }
      setPermissionDenials((d) => d.filter((p) => p !== perm));
      return [...prev, perm];
    });
  };

  const toggleDenial = (perm: Permission) => {
    setPermissionDenials((prev) => {
      if (prev.includes(perm)) {
        return prev.filter((p) => p !== perm);
      }
      setPermissionGrants((g) => g.filter((p) => p !== perm));
      return [...prev, perm];
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    submitState.clearError();

    const result = await submitState.submit(
      async () => {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/access`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role,
            groupIds,
            companyIds,
            permissionGrants,
            permissionDenials,
          }),
        });
        if (!res.ok) {
          const parsed = await parseApiErrorResponse(
            res,
            'Nie udało się zapisać dostępu użytkownika.'
          );
          return { ok: false, status: res.status, ...parsed };
        }
        return { ok: true, status: res.status };
      },
      { fallbackError: 'Nie udało się zapisać dostępu użytkownika.' }
    );

    if (result.ok) {
      await onSaved();
      onClose();
    }
  };

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-[70] bg-slate-950/75 backdrop-blur-2xs flex items-center justify-center p-3 sm:p-5"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
        className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-xs text-slate-900 dark:text-slate-100 ${flashClassName}`}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800 flex items-center justify-center font-bold text-xs shrink-0">
              {user.initials}
            </div>
            <div className="min-w-0">
              <h3 id={`${baseId}-title`} className="text-sm font-bold text-slate-900 dark:text-white truncate">
                Dostęp i uprawnienia: {user.name}
              </h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                {user.email} · {user.department || 'Brak działu'}
                {currentUser?.id === user.id ? ' (Twoje konto)' : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitState.isSubmitting}
            aria-label="Zamknij edycję uprawnień użytkownika"
            className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-5">
          <FormError
            id={`${baseId}-error`}
            error={submitState.submitError}
            alertRef={submitState.alertRef}
            onDismiss={submitState.clearError}
          />

          {/* Rola + Grupy + Firmy */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Rola */}
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 space-y-2">
              <label
                htmlFor={`${baseId}-role`}
                className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white text-xs"
              >
                <KeyRound className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                <span>Rola systemowa</span>
              </label>
              <select
                id={`${baseId}-role`}
                value={role}
                disabled={isLastApprovedAdmin || submitState.isSubmitting}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-60"
              >
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS_PL[r]} ({r})
                  </option>
                ))}
              </select>
              {isLastApprovedAdmin ? (
                <p className="text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-1">
                  <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Ostatni zatwierdzony administrator nie może zostać zdegradowany.</span>
                </p>
              ) : role === 'admin' ? (
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Rola administratora zawsze posiada pełen dostęp do systemu i wszystkich firm.
                </p>
              ) : null}
            </div>

            {/* Grupy uprawnień */}
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white text-xs">
                  <Users className="w-3.5 h-3.5 text-indigo-700 dark:text-indigo-400" aria-hidden="true" />
                  <span>Grupy uprawnień ({groupIds.length})</span>
                </span>
              </div>
              {permissionConfig.permissionGroups.length === 0 ? (
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Brak utworzonych grup. Utwórz grupę w podzakładce „Grupy”.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {permissionConfig.permissionGroups.map((grp) => {
                    const checked = groupIds.includes(grp.id);
                    return (
                      <label
                        key={grp.id}
                        className="flex items-start gap-2 p-1.5 rounded hover:bg-white dark:hover:bg-slate-900 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={submitState.isSubmitting}
                          onChange={() => toggleGroup(grp.id)}
                          className="mt-0.5 rounded border-slate-300 dark:border-slate-700"
                        />
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-900 dark:text-white block truncate">
                            {grp.name}
                          </span>
                          <span className="text-[10px] text-slate-600 dark:text-slate-400">
                            Uprawnienia: {grp.permissions.length}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Firmy */}
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white text-xs">
                  <Building2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                  <span>Przypisane firmy ({companyIds.length})</span>
                </span>
              </div>
              {companies.length === 0 ? (
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Brak zdefiniowanych firm w systemie.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {companies.map((comp) => {
                    const checked = companyIds.includes(comp.id);
                    return (
                      <label
                        key={comp.id}
                        className="flex items-center gap-2 p-1.5 rounded hover:bg-white dark:hover:bg-slate-900 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={submitState.isSubmitting}
                          onChange={() => toggleCompany(comp.id)}
                          className="rounded border-slate-300 dark:border-slate-700"
                        />
                        <span className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                          {comp.letter}
                        </span>
                        <span className="font-medium text-slate-900 dark:text-white truncate">
                          {comp.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Indywidualne nadania i odmowy */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                  Indywidualne nadania i odmowy oraz podgląd: Efektywne uprawnienia
                </h4>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Odmowa ma najwyższy priorytet i blokuje nawet uprawnienie z roli, grupy lub firmy.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <span className="px-2 py-0.5 rounded border bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800 font-semibold">
                  Nadania: {permissionGrants.length}
                </span>
                <span className="px-2 py-0.5 rounded border bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-800 font-semibold">
                  Odmowy: {permissionDenials.length}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100/70 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th scope="col" className="py-2 px-3 font-semibold">Uprawnienie</th>
                    <th scope="col" className="py-2 px-3 font-semibold text-center w-24">Nadanie</th>
                    <th scope="col" className="py-2 px-3 font-semibold text-center w-24">Odmowa</th>
                    <th scope="col" className="py-2 px-3 font-semibold">Efektywne uprawnienia i źródło</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {groupedCatalog.map((group) => (
                    <React.Fragment key={group.category}>
                      <tr className="bg-slate-50 dark:bg-slate-800/60">
                        <td
                          colSpan={4}
                          className="py-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                        >
                          {group.category}
                        </td>
                      </tr>
                      {group.items.map((entry) => {
                        const previewRow = effectivePreview.find(
                          (r) => r.entry.key === entry.key
                        )!;
                        const isGrantedIndiv = permissionGrants.includes(entry.key);
                        const isDeniedIndiv = permissionDenials.includes(entry.key);
                        const isAdminUser = role === 'admin';

                        return (
                          <tr
                            key={entry.key}
                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                          >
                            <td className="py-2 px-3">
                              <div className="font-semibold text-slate-900 dark:text-white">
                                {entry.label}
                              </div>
                              <div className="text-[10px] font-mono text-slate-600 dark:text-slate-400">
                                {entry.key}
                              </div>
                            </td>

                            <td className="py-2 px-3 text-center">
                              <input
                                type="checkbox"
                                aria-label={`Nadanie indywidualne: ${entry.label}`}
                                checked={isGrantedIndiv}
                                disabled={isAdminUser || submitState.isSubmitting}
                                onChange={() => toggleGrant(entry.key)}
                                className="rounded border-slate-300 dark:border-slate-700 disabled:opacity-40"
                              />
                            </td>

                            <td className="py-2 px-3 text-center">
                              <input
                                type="checkbox"
                                aria-label={`Odmowa indywidualna: ${entry.label}`}
                                checked={isDeniedIndiv}
                                disabled={isAdminUser || submitState.isSubmitting}
                                onChange={() => toggleDenial(entry.key)}
                                className="rounded border-slate-300 dark:border-slate-700 accent-rose-700 disabled:opacity-40"
                              />
                            </td>

                            <td className="py-2 px-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {previewRow.status === 'global' && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800">
                                    <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                                    <span>Dostęp pełny</span>
                                  </span>
                                )}
                                {previewRow.status === 'company' && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 border-sky-300 dark:border-sky-800">
                                    <Building2 className="w-3 h-3" aria-hidden="true" />
                                    <span>W przypisanych firmach</span>
                                  </span>
                                )}
                                {previewRow.status === 'denied' && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-800">
                                    <ShieldAlert className="w-3 h-3" aria-hidden="true" />
                                    <span>Zablokowane</span>
                                  </span>
                                )}
                                {previewRow.status === 'none' && (
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Brak dostępu
                                  </span>
                                )}

                                {previewRow.sources.map((src, idx) => {
                                  const srcStyle =
                                    src.kind === 'odmowa'
                                      ? 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-800'
                                      : src.kind === 'nadanie'
                                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800'
                                        : src.kind === 'firma'
                                          ? 'bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-200 border-sky-300 dark:border-sky-800'
                                          : src.kind === 'grupa'
                                            ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200 border-indigo-300 dark:border-indigo-800'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700';
                                  return (
                                    <span
                                      key={`${src.kind}-${idx}`}
                                      title={src.detail}
                                      className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${srcStyle}`}
                                    >
                                      {src.kind}
                                      {src.detail && src.kind === 'grupa' ? `: ${src.detail}` : ''}
                                    </span>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              ref={cancelBtnRef}
              type="button"
              disabled={submitState.isSubmitting}
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={submitState.isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{submitState.isSubmitting ? 'Zapisywanie...' : 'Zapisz uprawnienia użytkownika'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PermissionUserAccessModal;
