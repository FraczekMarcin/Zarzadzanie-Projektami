import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Edit3,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  Company,
  Permission,
  PermissionConfig,
  PermissionGroup,
  RolePermissionsMap,
  User,
  UserRole,
} from '../../types';
import {
  ALL_PERMISSIONS,
  EDITABLE_USER_ROLES,
  MAX_PERMISSION_GROUPS,
  PERMISSION_CATALOG,
  PERMISSION_GROUP_DESC_MAX,
  PERMISSION_GROUP_NAME_MAX,
  USER_ROLES,
  type PermissionCatalogEntry,
} from '../../utils/permissions';
import { useFocusTrap } from '../../utils/useFocusTrap';
import { useDismissOnOutsideClick } from '../../hooks/useDismissOnOutsideClick';
import {
  normalizeSubmitError,
  parseApiErrorResponse,
  useFormSubmit,
} from '../../hooks/useFormSubmit';
import { FormError } from '../FormError';
import { useSettingsTabDirty } from './SettingsDirtyContext';
import {
  PermissionUserAccessModal,
  ROLE_LABELS_PL,
  ROLE_SHORT_LABELS_PL,
  type PermissionAdminUser,
} from './PermissionUserAccessModal';

export type PermissionsSubtab = 'roles' | 'groups' | 'users' | 'companies';

const CATALOG_CATEGORIES: readonly PermissionCatalogEntry['category'][] = [
  'Projekty i zadania',
  'Finanse i kontrahenci',
  'Przetargi i zasoby',
  'System i raporty',
];

export interface PermissionsTabProps {
  isOpen: boolean;
  currentUser: User | null;
  initialSubtab?: PermissionsSubtab;
  initialTargetUserId?: string | null;
  onConsumeTargetUser?: () => void;
  onRefreshState?: () => Promise<void> | void;
  onRefreshUsers?: () => Promise<void> | void;
}

interface AdminPermissionsPayload {
  permissionConfig: PermissionConfig;
  users: PermissionAdminUser[];
  companies: Company[];
}

export const PermissionsTab: React.FC<PermissionsTabProps> = ({
  isOpen,
  currentUser,
  initialSubtab,
  initialTargetUserId,
  onConsumeTargetUser,
  onRefreshState,
  onRefreshUsers,
}) => {
  const reportTabDirty = useSettingsTabDirty();
  const baseId = useId();
  const isAdmin = currentUser?.role === 'admin';

  const [subtab, setSubtab] = useState<PermissionsSubtab>(initialSubtab || 'roles');
  const [payload, setPayload] = useState<AdminPermissionsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Podzakładka 1: Role (macierz + potwierdzenie hasłem)
  const [draftRolePerms, setDraftRolePerms] = useState<RolePermissionsMap | null>(null);
  const [rolePassword, setRolePassword] = useState('');
  const rolesSubmit = useFormSubmit();

  // Podzakładka 2: Grupy
  const [groupModalMode, setGroupModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingGroup, setEditingGroup] = useState<PermissionGroup | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupPerms, setGroupPerms] = useState<Permission[]>([]);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<PermissionGroup | null>(null);
  const groupModalRef = useRef<HTMLDivElement>(null);
  const groupCancelRef = useRef<HTMLButtonElement>(null);
  const deleteGroupModalRef = useRef<HTMLDivElement>(null);
  const deleteGroupCancelRef = useRef<HTMLButtonElement>(null);
  const groupSubmit = useFormSubmit();
  const groupDeleteSubmit = useFormSubmit();

  // Podzakładka 3: Użytkownicy
  const [userSearch, setUserSearch] = useState('');
  const [editingAccessUser, setEditingAccessUser] = useState<PermissionAdminUser | null>(null);

  // Podzakładka 4: Członkowie firm
  const [draftCompanyMemberPerms, setDraftCompanyMemberPerms] = useState<Permission[]>([]);
  const [selectedUserToAddByCompany, setSelectedUserToAddByCompany] = useState<Record<string, string>>({});
  const [busyCompanyMemberKey, setBusyCompanyMemberKey] = useState<string | null>(null);
  const companyMemberSubmit = useFormSubmit();
  const companyAssignSubmit = useFormSubmit();

  const fetchPermissionsData = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/permissions', { credentials: 'same-origin' });
      if (!res.ok) {
        const parsed = await parseApiErrorResponse(
          res,
          'Nie udało się pobrać konfiguracji uprawnień.'
        );
        setLoadError(parsed.error);
        return;
      }
      const json = await res.json();
      const cfg: PermissionConfig = json.permissionConfig;
      const usersList: PermissionAdminUser[] = Array.isArray(json.users) ? json.users : [];
      const companiesList: Company[] = Array.isArray(json.companies) ? json.companies : [];
      setPayload({ permissionConfig: cfg, users: usersList, companies: companiesList });
      setDraftRolePerms({
        admin: [...ALL_PERMISSIONS],
        project_manager: [...(cfg.rolePermissions.project_manager || [])],
        developer: [...(cfg.rolePermissions.developer || [])],
        tester: [...(cfg.rolePermissions.tester || [])],
        viewer: [...(cfg.rolePermissions.viewer || [])],
      });
      setDraftCompanyMemberPerms([...(cfg.companyMemberPermissions || [])]);
    } catch (err: unknown) {
      setLoadError(normalizeSubmitError(err, 'Błąd połączenia z serwerem.').error);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isOpen && isAdmin) {
      setStatusBanner(null);
      rolesSubmit.clearError();
      companyMemberSubmit.clearError();
      companyAssignSubmit.clearError();
      void fetchPermissionsData();
    }
  }, [isOpen, isAdmin, fetchPermissionsData]);

  useEffect(() => {
    if (initialSubtab) {
      setSubtab(initialSubtab);
    }
  }, [initialSubtab]);

  useEffect(() => {
    if (!isOpen || !initialTargetUserId || !payload) return;
    const found = payload.users.find((u) => u.id === initialTargetUserId);
    setSubtab('users');
    if (found) {
      setEditingAccessUser(found);
    }
    onConsumeTargetUser?.();
  }, [isOpen, initialTargetUserId, payload, onConsumeTargetUser]);

  const rolesDirty = useMemo(() => {
    if (!payload || !draftRolePerms) return false;
    for (const r of EDITABLE_USER_ROLES) {
      const a = [...(payload.permissionConfig.rolePermissions[r] || [])].sort().join(',');
      const b = [...(draftRolePerms[r] || [])].sort().join(',');
      if (a !== b) return true;
    }
    return rolePassword.length > 0;
  }, [payload, draftRolePerms, rolePassword]);

  const companyMemberPermsDirty = useMemo(() => {
    if (!payload) return false;
    const a = [...(payload.permissionConfig.companyMemberPermissions || [])].sort().join(',');
    const b = [...draftCompanyMemberPerms].sort().join(',');
    return a !== b;
  }, [payload, draftCompanyMemberPerms]);

  const isDirty = Boolean(isOpen && isAdmin && (rolesDirty || companyMemberPermsDirty));

  useEffect(() => {
    reportTabDirty('permissions', isDirty);
    return () => reportTabDirty('permissions', false);
  }, [isDirty, reportTabDirty]);

  const { backdropProps: groupBackdropProps, flashClassName: groupFlashClass } =
    useDismissOnOutsideClick({
      isOpen: Boolean(groupModalMode),
      mode: 'form',
      panelRef: groupModalRef,
      onDismiss: () => setGroupModalMode(null),
      disabled: groupSubmit.isSubmitting,
      cancelButtonRef: groupCancelRef,
    });

  useFocusTrap({
    isOpen: Boolean(groupModalMode),
    onClose: () => setGroupModalMode(null),
    containerRef: groupModalRef,
    disableEscape: groupSubmit.isSubmitting,
  });

  const { backdropProps: delGroupBackdropProps, flashClassName: delGroupFlashClass } =
    useDismissOnOutsideClick({
      isOpen: Boolean(deleteGroupTarget),
      mode: 'form',
      panelRef: deleteGroupModalRef,
      onDismiss: () => setDeleteGroupTarget(null),
      disabled: groupDeleteSubmit.isSubmitting,
      cancelButtonRef: deleteGroupCancelRef,
    });

  useFocusTrap({
    isOpen: Boolean(deleteGroupTarget),
    onClose: () => setDeleteGroupTarget(null),
    containerRef: deleteGroupModalRef,
    disableEscape: groupDeleteSubmit.isSubmitting,
  });

  const groupedCatalog = useMemo(
    () =>
      CATALOG_CATEGORIES.map((category) => ({
        category,
        items: PERMISSION_CATALOG.filter((entry) => entry.category === category),
      })),
    []
  );

  const companyScopedCatalog = useMemo(
    () => PERMISSION_CATALOG.filter((entry) => entry.companyScoped),
    []
  );

  const nonCompanyScopedCatalog = useMemo(
    () => PERMISSION_CATALOG.filter((entry) => !entry.companyScoped),
    []
  );

  const groupMemberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!payload) return counts;
    for (const u of payload.users) {
      for (const gid of u.groupIds || []) {
        counts.set(gid, (counts.get(gid) || 0) + 1);
      }
    }
    return counts;
  }, [payload]);

  const approvedAdminCount = useMemo(() => {
    if (!payload) return 1;
    return payload.users.filter((u) => u.role === 'admin' && u.isApproved !== false).length;
  }, [payload]);

  const companiesById = useMemo(() => {
    const map = new Map<string, Company>();
    for (const c of payload?.companies || []) {
      map.set(c.id, c);
    }
    return map;
  }, [payload]);

  const groupsById = useMemo(() => {
    const map = new Map<string, PermissionGroup>();
    for (const g of payload?.permissionConfig.permissionGroups || []) {
      map.set(g.id, g);
    }
    return map;
  }, [payload]);

  const filteredUsers = useMemo(() => {
    if (!payload) return [];
    const q = userSearch.trim().toLowerCase();
    if (!q) return payload.users;
    return payload.users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        ROLE_LABELS_PL[u.role].toLowerCase().includes(q)
    );
  }, [payload, userSearch]);

  if (!isAdmin) {
    return (
      <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
        <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>Zarządzanie uprawnieniami jest dostępne wyłącznie dla Administratora.</span>
      </div>
    );
  }

  const refreshAfterMutation = async (message?: string) => {
    await fetchPermissionsData();
    await onRefreshUsers?.();
    await onRefreshState?.();
    if (message) setStatusBanner(message);
  };

  // --- Podzakładka 1: Role ---
  const handleToggleRolePerm = (role: UserRole, perm: Permission) => {
    if (role === 'admin' || !draftRolePerms) return;
    setDraftRolePerms((prev) => {
      if (!prev) return prev;
      const cur = prev[role] || [];
      const next = cur.includes(perm) ? cur.filter((p) => p !== perm) : [...cur, perm];
      return { ...prev, [role]: next };
    });
    rolesSubmit.clearError();
    setStatusBanner(null);
  };

  const handleSaveRolePermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftRolePerms) return;
    rolesSubmit.clearError();
    setStatusBanner(null);

    if (!rolePassword) {
      rolesSubmit.setValidationError(
        'Podaj aktualne hasło administratora, aby zapisać matrycę uprawnień ról.',
        'currentPassword'
      );
      return;
    }

    const result = await rolesSubmit.submit(
      async () => {
        const rolePayload: Record<string, Permission[]> = {};
        for (const r of EDITABLE_USER_ROLES) {
          rolePayload[r] = draftRolePerms[r] || [];
        }
        const res = await fetch('/api/admin/permissions', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rolePermissions: rolePayload,
            currentPassword: rolePassword,
          }),
        });
        if (!res.ok) {
          const parsed = await parseApiErrorResponse(
            res,
            'Nie udało się zapisać uprawnień ról.'
          );
          return { ok: false, status: res.status, ...parsed };
        }
        return { ok: true, status: res.status };
      },
      { fallbackError: 'Nie udało się zapisać uprawnień ról.' }
    );

    if (result.ok) {
      setRolePassword('');
      await refreshAfterMutation('Zapisano uprawnienia ról w systemie.');
    }
  };

  // --- Podzakładka 2: Grupy ---
  const openCreateGroupModal = () => {
    setGroupModalMode('create');
    setEditingGroup(null);
    setGroupName('');
    setGroupDesc('');
    setGroupPerms([]);
    groupSubmit.clearError();
  };

  const openEditGroupModal = (group: PermissionGroup) => {
    setGroupModalMode('edit');
    setEditingGroup(group);
    setGroupName(group.name);
    setGroupDesc(group.description || '');
    setGroupPerms([...group.permissions]);
    groupSubmit.clearError();
  };

  const toggleGroupPerm = (perm: Permission) => {
    setGroupPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleSubmitGroupModal = async (e: React.FormEvent) => {
    e.preventDefault();
    groupSubmit.clearError();
    const trimmedName = groupName.trim();
    if (!trimmedName) {
      groupSubmit.setValidationError('Podaj nazwę grupy uprawnień.', 'name');
      return;
    }

    const result = await groupSubmit.submit(
      async () => {
        const isEdit = groupModalMode === 'edit' && editingGroup;
        const url = isEdit
          ? `/api/admin/permission-groups/${encodeURIComponent(editingGroup.id)}`
          : '/api/admin/permission-groups';
        const method = isEdit ? 'PUT' : 'POST';
        const res = await fetch(url, {
          method,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            description: groupDesc.trim(),
            permissions: groupPerms,
          }),
        });
        if (!res.ok) {
          const parsed = await parseApiErrorResponse(
            res,
            isEdit ? 'Nie udało się zaktualizować grupy.' : 'Nie udało się utworzyć grupy.'
          );
          return { ok: false, status: res.status, ...parsed };
        }
        return { ok: true, status: res.status };
      },
      { fallbackError: 'Błąd zapisu grupy uprawnień.' }
    );

    if (result.ok) {
      const wasEdit = groupModalMode === 'edit';
      setGroupModalMode(null);
      await refreshAfterMutation(
        wasEdit ? `Zaktualizowano grupę "${trimmedName}".` : `Utworzono grupę "${trimmedName}".`
      );
    }
  };

  const handleConfirmDeleteGroup = async () => {
    if (!deleteGroupTarget) return;
    groupDeleteSubmit.clearError();
    const target = deleteGroupTarget;
    const result = await groupDeleteSubmit.submit(
      async () => {
        const res = await fetch(
          `/api/admin/permission-groups/${encodeURIComponent(target.id)}`,
          { method: 'DELETE', credentials: 'same-origin' }
        );
        if (!res.ok) {
          const parsed = await parseApiErrorResponse(
            res,
            'Nie udało się usunąć grupy uprawnień.'
          );
          return { ok: false, status: res.status, ...parsed };
        }
        return { ok: true, status: res.status };
      },
      { fallbackError: 'Błąd usuwania grupy uprawnień.' }
    );
    if (result.ok) {
      setDeleteGroupTarget(null);
      await refreshAfterMutation(`Usunięto grupę "${target.name}".`);
    }
  };

  // --- Podzakładka 4: Członkowie firm ---
  const handleToggleCompanyMemberPerm = (perm: Permission) => {
    setDraftCompanyMemberPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
    companyMemberSubmit.clearError();
    setStatusBanner(null);
  };

  const handleSaveCompanyMemberPerms = async () => {
    companyMemberSubmit.clearError();
    setStatusBanner(null);
    const result = await companyMemberSubmit.submit(
      async () => {
        const res = await fetch('/api/admin/permissions', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyMemberPermissions: draftCompanyMemberPerms }),
        });
        if (!res.ok) {
          const parsed = await parseApiErrorResponse(
            res,
            'Nie udało się zapisać zestawu uprawnień członków firm.'
          );
          return { ok: false, status: res.status, ...parsed };
        }
        return { ok: true, status: res.status };
      },
      { fallbackError: 'Błąd zapisu uprawnień członków firm.' }
    );
    if (result.ok) {
      await refreshAfterMutation('Zapisano uprawnienia przysługujące członkom firm.');
    }
  };

  const handleAssignUserToCompany = async (companyId: string, userId: string, assign: boolean) => {
    if (!payload || !userId) return;
    const target = payload.users.find((u) => u.id === userId);
    if (!target) return;
    const currentCompanyIds = Array.isArray(target.companyIds) ? target.companyIds : [];
    const nextCompanyIds = assign
      ? Array.from(new Set([...currentCompanyIds, companyId]))
      : currentCompanyIds.filter((cid) => cid !== companyId);

    const opKey = `${companyId}:${userId}`;
    setBusyCompanyMemberKey(opKey);
    companyAssignSubmit.clearError();
    setStatusBanner(null);

    const result = await companyAssignSubmit.submit(
      async () => {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/access`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyIds: nextCompanyIds }),
        });
        if (!res.ok) {
          const parsed = await parseApiErrorResponse(
            res,
            'Nie udało się zaktualizować członkostwa w firmie.'
          );
          return { ok: false, status: res.status, ...parsed };
        }
        return { ok: true, status: res.status };
      },
      { fallbackError: 'Błąd zmiany przypisania użytkownika do firmy.' }
    );

    setBusyCompanyMemberKey(null);
    if (result.ok) {
      if (assign) {
        setSelectedUserToAddByCompany((prev) => ({ ...prev, [companyId]: '' }));
      }
      await refreshAfterMutation(
        assign
          ? `Przypisano użytkownika ${target.name} do firmy.`
          : `Usunięto użytkownika ${target.name} z firmy.`
      );
    }
  };

  const renderPermissionMatrixRows = (
    items: PermissionCatalogEntry[],
    checkedSet: Set<Permission>,
    onToggle: (perm: Permission) => void,
    disabled: boolean
  ) =>
    items.map((entry) => (
      <label
        key={entry.key}
        className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
      >
        <input
          type="checkbox"
          checked={checkedSet.has(entry.key)}
          disabled={disabled}
          onChange={() => onToggle(entry.key)}
          className="mt-0.5 rounded border-slate-300 dark:border-slate-700"
        />
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 dark:text-white text-xs">
            {entry.label}{' '}
            <span className="font-mono text-[10px] font-normal text-slate-600 dark:text-slate-400">
              ({entry.key})
            </span>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">{entry.description}</p>
        </div>
      </label>
    ));

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Nagłówek sekcji */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
            <Shield className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <span>Uprawnienia, Grupy i Członkowie firm</span>
          </h4>
          <p className="text-slate-600 dark:text-slate-400 text-xs mt-0.5">
            Konfiguruj uprawnienia ról systemowych, własne grupy, indywidualne nadania/odmowy oraz przypisania użytkowników do firm.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchPermissionsData()}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Odśwież</span>
        </button>
      </div>

      {/* Podzakładki */}
      <div
        role="tablist"
        aria-label="Podzakładki uprawnień"
        className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2.5"
      >
        {(
          [
            { id: 'roles', label: 'Role' },
            {
              id: 'groups',
              label: `Grupy (${payload?.permissionConfig.permissionGroups.length ?? 0})`,
            },
            { id: 'users', label: `Użytkownicy (${payload?.users.length ?? 0})` },
            { id: 'companies', label: `Członkowie firm (${payload?.companies.length ?? 0})` },
          ] as Array<{ id: PermissionsSubtab; label: string }>
        ).map((tab) => {
          const active = subtab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setSubtab(tab.id);
                setStatusBanner(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                active
                  ? 'bg-sky-700 text-white shadow-2xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {statusBanner && (
        <div
          role="status"
          className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
          <span>{statusBanner}</span>
        </div>
      )}

      {loadError && (
        <FormError
          error={loadError}
          onDismiss={() => setLoadError(null)}
        />
      )}

      {!payload && isLoading && (
        <div role="status" className="py-8 text-center text-xs text-slate-600 dark:text-slate-400">
          Ładowanie konfiguracji uprawnień...
        </div>
      )}

      {/* 1. ROLE */}
      {payload && draftRolePerms && subtab === 'roles' && (
        <form onSubmit={handleSaveRolePermissions} className="space-y-4">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
            Zaznacz uprawnienia domyślnie przysługujące poszczególnym rolom. Rola <strong>Administrator</strong> zawsze posiada komplet uprawnień i jest zablokowana przed edycją.
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th scope="col" className="py-2.5 px-3 font-bold min-w-[230px]">
                      Uprawnienie
                    </th>
                    {USER_ROLES.map((r) => (
                      <th
                        key={r}
                        scope="col"
                        className="py-2.5 px-2.5 font-bold text-center whitespace-nowrap"
                        title={ROLE_LABELS_PL[r]}
                      >
                        <div className="flex flex-col items-center">
                          <span>{ROLE_SHORT_LABELS_PL[r]}</span>
                          {r === 'admin' && (
                            <span className="text-[10px] font-normal text-slate-600 dark:text-slate-400">
                              (zablokowana)
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {groupedCatalog.map((group) => (
                    <React.Fragment key={group.category}>
                      <tr className="bg-slate-50 dark:bg-slate-800/60">
                        <td
                          colSpan={1 + USER_ROLES.length}
                          className="py-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                        >
                          {group.category}
                        </td>
                      </tr>
                      {group.items.map((entry) => (
                        <tr
                          key={entry.key}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30"
                        >
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {entry.label}
                            </div>
                            <div className="text-[10px] font-mono text-slate-600 dark:text-slate-400">
                              {entry.key}
                            </div>
                          </td>
                          {USER_ROLES.map((r) => {
                            const isAdminRole = r === 'admin';
                            const isChecked = isAdminRole
                              ? true
                              : (draftRolePerms[r] || []).includes(entry.key);
                            return (
                              <td key={r} className="py-2 px-2.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={isAdminRole || rolesSubmit.isSubmitting}
                                  onChange={() => handleToggleRolePerm(r, entry.key)}
                                  aria-label={`${entry.label} dla roli ${ROLE_LABELS_PL[r]}`}
                                  className="rounded border-slate-300 dark:border-slate-700 disabled:opacity-60"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <FormError
            id={`${baseId}-roles-error`}
            error={rolesSubmit.submitError}
            alertRef={rolesSubmit.alertRef}
            onDismiss={rolesSubmit.clearError}
          />

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex flex-wrap items-end justify-between gap-3">
            <div className="flex-1 min-w-[220px] max-w-sm">
              <label
                htmlFor={`${baseId}-roles-password`}
                className="block font-semibold text-slate-800 dark:text-slate-200 text-xs mb-1"
              >
                Potwierdź aktualnym hasłem administratora *
              </label>
              <input
                id={`${baseId}-roles-password`}
                type="password"
                value={rolePassword}
                onChange={(e) => {
                  setRolePassword(e.target.value);
                  rolesSubmit.clearError();
                }}
                {...rolesSubmit.getFieldA11yProps('currentPassword', `${baseId}-roles-error`)}
                placeholder="Hasło administratora"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-white"
              />
            </div>

            <button
              type="submit"
              disabled={rolesSubmit.isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{rolesSubmit.isSubmitting ? 'Zapisywanie...' : 'Zapisz uprawnienia ról'}</span>
            </button>
          </div>
        </form>
      )}

      {/* 2. GRUPY */}
      {payload && subtab === 'groups' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Grupy pozwalają nadawać wybrane zestawy uprawnień niezależnie od roli ({payload.permissionConfig.permissionGroups.length}/{MAX_PERMISSION_GROUPS}).
            </p>
            <button
              type="button"
              onClick={openCreateGroupModal}
              disabled={payload.permissionConfig.permissionGroups.length >= MAX_PERMISSION_GROUPS}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Nowa grupa</span>
            </button>
          </div>

          {payload.permissionConfig.permissionGroups.length === 0 ? (
            <div className="p-8 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-600 dark:text-slate-400">
              Brak grup uprawnień. Utwórz pierwszą grupę, aby móc przypisywać dodatkowe uprawnienia zespołowe.
            </div>
          ) : (
            <div className="space-y-2.5">
              {payload.permissionConfig.permissionGroups.map((group) => {
                const membersCount = groupMemberCounts.get(group.id) || 0;
                return (
                  <div
                    key={group.id}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-start justify-between gap-3"
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-white text-sm">
                          {group.name}
                        </span>
                        <span className="px-2 py-0.5 rounded border text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 tabular-nums">
                          Użytkownicy: {membersCount}
                        </span>
                        <span className="px-2 py-0.5 rounded border text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200 border-indigo-200 dark:border-indigo-800 tabular-nums">
                          Uprawnienia: {group.permissions.length}
                        </span>
                      </div>
                      {group.description && (
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {group.description}
                        </p>
                      )}
                      {group.permissions.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {group.permissions.map((perm) => (
                            <span
                              key={perm}
                              className="px-1.5 py-0.5 rounded border text-[10px] font-mono bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                            >
                              {perm}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditGroupModal(group)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Edytuj</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          groupDeleteSubmit.clearError();
                          setDeleteGroupTarget(group);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-xs font-semibold transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Usuń</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. UŻYTKOWNICY */}
      {payload && subtab === 'users' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={`${baseId}-user-search`} className="sr-only">
              Szukaj użytkownika
            </label>
            <input
              id={`${baseId}-user-search`}
              type="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Szukaj po nazwisku, e-mailu lub roli..."
              className="w-full sm:w-72 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white"
            />
            <span className="text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
              Wyświetlono: {filteredUsers.length} z {payload.users.length}
            </span>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th scope="col" className="py-2.5 px-3 font-bold">Użytkownik</th>
                    <th scope="col" className="py-2.5 px-3 font-bold">Rola</th>
                    <th scope="col" className="py-2.5 px-3 font-bold">Grupy</th>
                    <th scope="col" className="py-2.5 px-3 font-bold">Firmy</th>
                    <th scope="col" className="py-2.5 px-3 font-bold">Nadania / Odmowy</th>
                    <th scope="col" className="py-2.5 px-3 font-bold text-right">Akcja</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {filteredUsers.map((u) => {
                    const userGroups = (u.groupIds || [])
                      .map((gid) => groupsById.get(gid)?.name)
                      .filter(Boolean) as string[];
                    const userCompanies = (u.companyIds || [])
                      .map((cid) => companiesById.get(cid))
                      .filter(Boolean) as Company[];
                    const grantsCount = u.permissionGrants?.length || 0;
                    const denialsCount = u.permissionDenials?.length || 0;

                    return (
                      <tr key={u.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900 dark:text-white">{u.name}</div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400">{u.email}</div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded border text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700">
                            {ROLE_LABELS_PL[u.role]}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {userGroups.length === 0 ? (
                            <span className="text-slate-500 dark:text-slate-400">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {userGroups.map((gName) => (
                                <span
                                  key={gName}
                                  className="px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200 border-indigo-200 dark:border-indigo-800"
                                >
                                  {gName}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {userCompanies.length === 0 ? (
                            <span className="text-slate-500 dark:text-slate-400">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {userCompanies.map((c) => (
                                <span
                                  key={c.id}
                                  title={c.name}
                                  className="px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800"
                                >
                                  {c.letter} · {c.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
                            <span className="px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800">
                              +{grantsCount}
                            </span>
                            <span className="px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800">
                              −{denialsCount}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setEditingAccessUser(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/50 text-xs font-semibold transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Edytuj dostęp</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 4. CZŁONKOWIE FIRM */}
      {payload && subtab === 'companies' && (
        <div className="space-y-6">
          {/* Lista firm i przypisanych użytkowników */}
          <div className="space-y-3">
            <div>
              <h5 className="font-bold text-slate-900 dark:text-white text-sm">
                Przypisanie użytkowników do firm
              </h5>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Użytkownicy przypisani do firmy otrzymują poniższy zestaw uprawnień dla projektów, zadań i przetargów powiązanych z tą firmą.
              </p>
            </div>

            <FormError
              error={companyAssignSubmit.submitError}
              alertRef={companyAssignSubmit.alertRef}
              onDismiss={companyAssignSubmit.clearError}
            />

            {payload.companies.length === 0 ? (
              <div className="p-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-600 dark:text-slate-400">
                Brak zarejestrowanych firm w systemie. Dodaj firmę w zakładce „Firmy”.
              </div>
            ) : (
              <div className="space-y-3">
                {payload.companies.map((company) => {
                  const members = payload.users.filter((u) =>
                    (u.companyIds || []).includes(company.id)
                  );
                  const candidates = payload.users.filter(
                    (u) => !(u.companyIds || []).includes(company.id) && u.isApproved !== false
                  );
                  const selectedUserId = selectedUserToAddByCompany[company.id] || '';

                  return (
                    <div
                      key={company.id}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono font-bold text-xs px-2 py-1 rounded border bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border-slate-300 dark:border-slate-700">
                            {company.letter}
                          </span>
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white text-sm">
                              {company.name}
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                              Przypisani członkowie: {members.length}
                              {!company.isActive ? ' · Nieaktywna' : ''}
                            </div>
                          </div>
                        </div>

                        {candidates.length > 0 && (
                          <div className="flex items-center gap-2">
                            <label
                              htmlFor={`${baseId}-add-member-${company.id}`}
                              className="sr-only"
                            >
                              Dodaj użytkownika do firmy {company.name}
                            </label>
                            <select
                              id={`${baseId}-add-member-${company.id}`}
                              value={selectedUserId}
                              onChange={(e) =>
                                setSelectedUserToAddByCompany((prev) => ({
                                  ...prev,
                                  [company.id]: e.target.value,
                                }))
                              }
                              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                            >
                              <option value="">Wybierz użytkownika...</option>
                              {candidates.map((cand) => (
                                <option key={cand.id} value={cand.id}>
                                  {cand.name} ({ROLE_SHORT_LABELS_PL[cand.role]})
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={
                                !selectedUserId ||
                                busyCompanyMemberKey === `${company.id}:${selectedUserId}`
                              }
                              onClick={() =>
                                void handleAssignUserToCompany(company.id, selectedUserId, true)
                              }
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                            >
                              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Dodaj</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {members.length === 0 ? (
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          Brak przypisanych użytkowników do tej firmy.
                        </p>
                      ) : (
                        <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                          {members.map((member) => {
                            const isBusy = busyCompanyMemberKey === `${company.id}:${member.id}`;
                            return (
                              <div
                                key={member.id}
                                className="px-3 py-2 flex items-center justify-between gap-2 bg-slate-50/50 dark:bg-slate-950/40"
                              >
                                <div className="min-w-0">
                                  <span className="font-semibold text-slate-900 dark:text-white">
                                    {member.name}
                                  </span>
                                  <span className="text-[11px] text-slate-600 dark:text-slate-400 ml-2">
                                    {member.email} · {ROLE_LABELS_PL[member.role]}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleAssignUserToCompany(company.id, member.id, false)
                                  }
                                  aria-label={`Usuń użytkownika ${member.name} z firmy ${company.name}`}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-[11px] font-semibold disabled:opacity-50"
                                >
                                  <X className="w-3 h-3" aria-hidden="true" />
                                  <span>Usuń z firmy</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Edycja zestawu uprawnień członków firm */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h5 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                  <span>Uprawnienia członków firm (companyMemberPermissions)</span>
                </h5>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Zestaw uprawnień nadawany przypisanemu użytkownikowi wyłącznie w obrębie zasobów jego firmy.
                </p>
              </div>
              <button
                type="button"
                disabled={companyMemberSubmit.isSubmitting}
                onClick={() => void handleSaveCompanyMemberPerms()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {companyMemberSubmit.isSubmitting
                    ? 'Zapisywanie...'
                    : 'Zapisz uprawnienia firmowe'}
                </span>
              </button>
            </div>

            <FormError
              error={companyMemberSubmit.submitError}
              alertRef={companyMemberSubmit.alertRef}
              onDismiss={companyMemberSubmit.clearError}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {renderPermissionMatrixRows(
                companyScopedCatalog,
                new Set(draftCompanyMemberPerms),
                handleToggleCompanyMemberPerm,
                companyMemberSubmit.isSubmitting
              )}
            </div>

            {nonCompanyScopedCatalog.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-300 py-1">
                  Uprawnienia globalne (poza zakresem pojedynczej firmy)
                </summary>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                  {renderPermissionMatrixRows(
                    nonCompanyScopedCatalog,
                    new Set(draftCompanyMemberPerms),
                    handleToggleCompanyMemberPerm,
                    companyMemberSubmit.isSubmitting
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Okno tworzenia / edycji grupy uprawnień */}
      {groupModalMode && (
        <div
          {...groupBackdropProps}
          className="fixed inset-0 z-[70] bg-slate-950/75 backdrop-blur-2xs flex items-center justify-center p-3 sm:p-5"
        >
          <div
            ref={groupModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${baseId}-grp-title`}
            className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden text-xs text-slate-900 dark:text-slate-100 ${groupFlashClass}`}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-between">
              <h3 id={`${baseId}-grp-title`} className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-700 dark:text-indigo-400" aria-hidden="true" />
                <span>
                  {groupModalMode === 'edit'
                    ? `Edytuj grupę: ${editingGroup?.name || ''}`
                    : 'Nowa grupa uprawnień'}
                </span>
              </h3>
              <button
                type="button"
                disabled={groupSubmit.isSubmitting}
                onClick={() => setGroupModalMode(null)}
                aria-label="Zamknij okno grupy uprawnień"
                className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmitGroupModal} className="flex-1 overflow-y-auto p-5 space-y-4">
              <FormError
                id={`${baseId}-grp-error`}
                error={groupSubmit.submitError}
                alertRef={groupSubmit.alertRef}
                onDismiss={groupSubmit.clearError}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor={`${baseId}-grp-name`}
                    className="block font-semibold text-slate-800 dark:text-slate-200 mb-1"
                  >
                    Nazwa grupy *
                  </label>
                  <input
                    id={`${baseId}-grp-name`}
                    type="text"
                    required
                    maxLength={PERMISSION_GROUP_NAME_MAX}
                    value={groupName}
                    onChange={(e) => {
                      setGroupName(e.target.value);
                      groupSubmit.clearError();
                    }}
                    {...groupSubmit.getFieldA11yProps('name', `${baseId}-grp-error`)}
                    placeholder="np. Zespół przetargowy"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-grp-desc`}
                    className="block font-semibold text-slate-800 dark:text-slate-200 mb-1"
                  >
                    Opis grupy
                  </label>
                  <input
                    id={`${baseId}-grp-desc`}
                    type="text"
                    maxLength={PERMISSION_GROUP_DESC_MAX}
                    value={groupDesc}
                    onChange={(e) => setGroupDesc(e.target.value)}
                    placeholder="Krótki opis przeznaczenia grupy"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <span className="block font-bold text-slate-900 dark:text-white">
                  Uprawnienia przypisane do grupy ({groupPerms.length})
                </span>
                {groupedCatalog.map((cat) => (
                  <div key={cat.category} className="space-y-1.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      {cat.category}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {renderPermissionMatrixRows(
                        cat.items,
                        new Set(groupPerms),
                        toggleGroupPerm,
                        groupSubmit.isSubmitting
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  ref={groupCancelRef}
                  type="button"
                  disabled={groupSubmit.isSubmitting}
                  onClick={() => setGroupModalMode(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={groupSubmit.isSubmitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-semibold"
                >
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {groupSubmit.isSubmitting
                      ? 'Zapisywanie...'
                      : groupModalMode === 'edit'
                        ? 'Zapisz zmiany'
                        : 'Utwórz grupę'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Okno potwierdzenia usunięcia grupy */}
      {deleteGroupTarget && (
        <div
          {...delGroupBackdropProps}
          className="fixed inset-0 z-[70] bg-slate-950/75 backdrop-blur-2xs flex items-center justify-center p-4"
        >
          <div
            ref={deleteGroupModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${baseId}-del-grp-title`}
            className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4 text-xs text-slate-900 dark:text-slate-100 ${delGroupFlashClass}`}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 shrink-0">
                <Trash2 className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h3 id={`${baseId}-del-grp-title`} className="text-sm font-bold text-slate-900 dark:text-white">
                  Usuń grupę „{deleteGroupTarget.name}”
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Do tej grupy należy obecnie{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {groupMemberCounts.get(deleteGroupTarget.id) || 0} użytkowników
                  </strong>
                  . Po usunięciu grupy zostaną oni z niej wypisani i natychmiast utracą uprawnienia wynikające wyłącznie z tej grupy.
                </p>
              </div>
            </div>

            <FormError
              error={groupDeleteSubmit.submitError}
              alertRef={groupDeleteSubmit.alertRef}
              onDismiss={groupDeleteSubmit.clearError}
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                ref={deleteGroupCancelRef}
                type="button"
                disabled={groupDeleteSubmit.isSubmitting}
                onClick={() => setDeleteGroupTarget(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold"
              >
                Anuluj
              </button>
              <button
                type="button"
                disabled={groupDeleteSubmit.isSubmitting}
                onClick={() => void handleConfirmDeleteGroup()}
                className="px-3.5 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-semibold"
              >
                {groupDeleteSubmit.isSubmitting ? 'Usuwanie...' : 'Tak, usuń grupę'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Okno edycji dostępu pojedynczego użytkownika */}
      <PermissionUserAccessModal
        isOpen={Boolean(editingAccessUser)}
        user={editingAccessUser}
        currentUser={currentUser}
        permissionConfig={payload?.permissionConfig || {
          rolePermissions: {
            admin: [...ALL_PERMISSIONS],
            project_manager: [],
            developer: [],
            tester: [],
            viewer: [],
          },
          permissionGroups: [],
          companyMemberPermissions: [],
        }}
        companies={payload?.companies || []}
        approvedAdminCount={approvedAdminCount}
        onClose={() => setEditingAccessUser(null)}
        onSaved={() =>
          refreshAfterMutation(
            editingAccessUser
              ? `Zapisano uprawnienia użytkownika ${editingAccessUser.name}.`
              : 'Zapisano uprawnienia użytkownika.'
          )
        }
      />
    </div>
  );
};

export default PermissionsTab;
