import type {
  Permission,
  PermissionConfig,
  PermissionGroup,
  RolePermissionsMap,
  Tender,
  UserRole,
} from '../types/index.js';

export const USER_ROLES: readonly UserRole[] = [
  'admin',
  'project_manager',
  'developer',
  'tester',
  'viewer',
] as const;

export const EDITABLE_USER_ROLES: readonly UserRole[] = [
  'project_manager',
  'developer',
  'tester',
  'viewer',
] as const;

export const MAX_PERMISSION_GROUPS = 50;
export const PERMISSION_GROUP_NAME_MAX = 80;
export const PERMISSION_GROUP_DESC_MAX = 300;

export const ALL_PERMISSIONS: readonly Permission[] = [
  'projects.view',
  'projects.create',
  'projects.edit',
  'projects.delete',
  'projects.archive',
  'tasks.edit',
  'finance.view',
  'finance.edit',
  'economy.view',
  'tenders.view',
  'tenders.edit',
  'contractors.view',
  'contractors.edit',
  'clients.edit',
  'templates.manage',
  'trash.manage',
  'reports.view',
] as const;

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);
const USER_ROLE_SET = new Set<string>(USER_ROLES);

export interface PermissionCatalogEntry {
  key: Permission;
  label: string;
  description: string;
  category: 'Projekty i zadania' | 'Finanse i kontrahenci' | 'Przetargi i zasoby' | 'System i raporty';
  companyScoped: boolean;
}

export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  {
    key: 'projects.view',
    label: 'Podgląd projektów',
    description: 'Przeglądanie listy, szczegółów i harmonogramów projektów.',
    category: 'Projekty i zadania',
    companyScoped: true,
  },
  {
    key: 'projects.create',
    label: 'Tworzenie projektów',
    description: 'Dodawanie nowych projektów oraz tworzenie projektów z szablonów.',
    category: 'Projekty i zadania',
    companyScoped: true,
  },
  {
    key: 'projects.edit',
    label: 'Edycja projektów',
    description: 'Zmiana danych projektu; uprawnienie globalne obejmuje także klucz i członków.',
    category: 'Projekty i zadania',
    companyScoped: true,
  },
  {
    key: 'projects.delete',
    label: 'Usuwanie projektów',
    description: 'Przenoszenie projektów do kosza.',
    category: 'Projekty i zadania',
    companyScoped: true,
  },
  {
    key: 'projects.archive',
    label: 'Archiwizacja projektów',
    description: 'Przenoszenie projektów do archiwum oraz przywracanie z archiwum.',
    category: 'Projekty i zadania',
    companyScoped: true,
  },
  {
    key: 'tasks.edit',
    label: 'Edycja zadań',
    description: 'Tworzenie, aktualizacja, komentowanie i usuwanie zadań w projektach.',
    category: 'Projekty i zadania',
    companyScoped: true,
  },
  {
    key: 'finance.view',
    label: 'Podgląd finansów',
    description: 'Dostęp do budżetu, wycen, kosztów, transz płatności i danych zamawiającego.',
    category: 'Finanse i kontrahenci',
    companyScoped: true,
  },
  {
    key: 'finance.edit',
    label: 'Edycja finansów',
    description: 'Modyfikacja budżetu, wycen, kosztów, transz, firmy projektu i danych klienta.',
    category: 'Finanse i kontrahenci',
    companyScoped: true,
  },
  {
    key: 'economy.view',
    label: 'Widok Ekonomia',
    description: 'Dostęp do zestawień finansowych i rentowności projektów w module Ekonomia.',
    category: 'Finanse i kontrahenci',
    companyScoped: true,
  },
  {
    key: 'tenders.view',
    label: 'Podgląd przetargów',
    description: 'Przeglądanie listy i szczegółów postępowań przetargowych.',
    category: 'Przetargi i zasoby',
    companyScoped: true,
  },
  {
    key: 'tenders.edit',
    label: 'Edycja przetargów',
    description: 'Tworzenie, edycja i usuwanie przetargów oraz zakładanie projektu z przetargu.',
    category: 'Przetargi i zasoby',
    companyScoped: true,
  },
  {
    key: 'contractors.view',
    label: 'Podgląd wykonawców',
    description: 'Przeglądanie katalogu wykonawców i podwykonawców powiązanych z firmą.',
    category: 'Finanse i kontrahenci',
    companyScoped: true,
  },
  {
    key: 'contractors.edit',
    label: 'Edycja wykonawców',
    description: 'Dodawanie, edycja i usuwanie wpisów wykonawców powiązanych z firmą.',
    category: 'Finanse i kontrahenci',
    companyScoped: true,
  },
  {
    key: 'clients.edit',
    label: 'Edycja bazy klientów',
    description: 'Zarządzanie centralnym katalogiem inwestorów i klientów.',
    category: 'Finanse i kontrahenci',
    companyScoped: false,
  },
  {
    key: 'templates.manage',
    label: 'Zarządzanie szablonami',
    description: 'Tworzenie, duplikowanie, aktualizacja i usuwanie własnych szablonów projektów.',
    category: 'Przetargi i zasoby',
    companyScoped: false,
  },
  {
    key: 'trash.manage',
    label: 'Zarządzanie koszem',
    description: 'Podgląd, przywracanie oraz trwałe usuwanie pojedynczych pozycji z kosza.',
    category: 'System i raporty',
    companyScoped: true,
  },
  {
    key: 'reports.view',
    label: 'Podgląd raportów',
    description: 'Otrzymywanie tygodniowych raportów projektowych oraz dostęp do zestawień.',
    category: 'System i raporty',
    companyScoped: false,
  },
] as const;

export const DEFAULT_ROLE_PERMISSIONS: RolePermissionsMap = {
  admin: [...ALL_PERMISSIONS],
  project_manager: [
    'projects.view',
    'projects.create',
    'projects.edit',
    'projects.delete',
    'projects.archive',
    'tasks.edit',
    'finance.view',
    'finance.edit',
    'economy.view',
    'tenders.view',
    'tenders.edit',
    'contractors.view',
    'contractors.edit',
    'trash.manage',
    'reports.view',
  ],
  developer: ['projects.create'],
  tester: ['projects.create'],
  viewer: [],
};

export const DEFAULT_COMPANY_MEMBER_PERMISSIONS: Permission[] = [
  'projects.view',
  'projects.edit',
  'tasks.edit',
  'finance.view',
  'finance.edit',
  'economy.view',
  'tenders.view',
  'tenders.edit',
  'contractors.view',
  'contractors.edit',
];

export function isValidPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSION_SET.has(value);
}

export function isValidUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && USER_ROLE_SET.has(value);
}

export function sanitizePermissionArray(raw: unknown): Permission[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<Permission>();
  const out: Permission[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && PERMISSION_SET.has(item)) {
      const perm = item as Permission;
      if (!seen.has(perm)) {
        seen.add(perm);
        out.push(perm);
      }
    }
  }
  return out;
}

export function sanitizeStringIdArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
      }
    }
  }
  return out;
}

export function createDefaultPermissionConfig(): PermissionConfig {
  return {
    rolePermissions: {
      admin: [...ALL_PERMISSIONS],
      project_manager: [...DEFAULT_ROLE_PERMISSIONS.project_manager],
      developer: [...DEFAULT_ROLE_PERMISSIONS.developer],
      tester: [...DEFAULT_ROLE_PERMISSIONS.tester],
      viewer: [...DEFAULT_ROLE_PERMISSIONS.viewer],
    },
    permissionGroups: [],
    companyMemberPermissions: [...DEFAULT_COMPANY_MEMBER_PERMISSIONS],
  };
}

export function normalizePermissionConfig(raw: unknown): PermissionConfig {
  const defaults = createDefaultPermissionConfig();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults;
  }

  const obj = raw as Record<string, unknown>;
  const rawRoles =
    obj.rolePermissions && typeof obj.rolePermissions === 'object' && !Array.isArray(obj.rolePermissions)
      ? (obj.rolePermissions as Record<string, unknown>)
      : {};

  const rolePermissions: RolePermissionsMap = {
    admin: [...ALL_PERMISSIONS],
    project_manager: Array.isArray(rawRoles.project_manager)
      ? sanitizePermissionArray(rawRoles.project_manager)
      : [...DEFAULT_ROLE_PERMISSIONS.project_manager],
    developer: Array.isArray(rawRoles.developer)
      ? sanitizePermissionArray(rawRoles.developer)
      : [...DEFAULT_ROLE_PERMISSIONS.developer],
    tester: Array.isArray(rawRoles.tester)
      ? sanitizePermissionArray(rawRoles.tester)
      : [...DEFAULT_ROLE_PERMISSIONS.tester],
    viewer: Array.isArray(rawRoles.viewer)
      ? sanitizePermissionArray(rawRoles.viewer)
      : [...DEFAULT_ROLE_PERMISSIONS.viewer],
  };

  const permissionGroups: PermissionGroup[] = [];
  const seenGroupIds = new Set<string>();
  if (Array.isArray(obj.permissionGroups)) {
    for (const item of obj.permissionGroups) {
      if (permissionGroups.length >= MAX_PERMISSION_GROUPS) break;
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const g = item as Record<string, unknown>;
      const id = typeof g.id === 'string' ? g.id.trim() : '';
      const name = typeof g.name === 'string' ? g.name.trim().slice(0, PERMISSION_GROUP_NAME_MAX) : '';
      if (!id || !name || seenGroupIds.has(id)) continue;
      seenGroupIds.add(id);
      const description =
        typeof g.description === 'string' ? g.description.trim().slice(0, PERMISSION_GROUP_DESC_MAX) : '';
      const permissions = sanitizePermissionArray(g.permissions);
      permissionGroups.push({
        id,
        name,
        description,
        permissions,
      });
    }
  }

  const companyMemberPermissions = Array.isArray(obj.companyMemberPermissions)
    ? sanitizePermissionArray(obj.companyMemberPermissions)
    : [...DEFAULT_COMPANY_MEMBER_PERMISSIONS];

  return {
    rolePermissions,
    permissionGroups,
    companyMemberPermissions,
  };
}

export function validateStrictPermissionList(
  raw: unknown,
  fieldName = 'permissions'
): { ok: true; permissions: Permission[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: `Pole "${fieldName}" musi być tablicą uprawnień.` };
  }
  const seen = new Set<Permission>();
  const valid: Permission[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !PERMISSION_SET.has(item)) {
      return {
        ok: false,
        error: `Nieznane uprawnienie "${String(item)}" w polu "${fieldName}".`,
      };
    }
    const perm = item as Permission;
    if (!seen.has(perm)) {
      seen.add(perm);
      valid.push(perm);
    }
  }
  return { ok: true, permissions: valid };
}

export interface PermissionUserLike {
  id?: string;
  role?: UserRole | string;
  groupIds?: string[];
  companyIds?: string[];
  permissionGrants?: Permission[];
  permissionDenials?: Permission[];
  effectivePermissions?: Permission[];
}

export type PermissionResource =
  | {
      type?: 'project';
      id?: string;
      companyId?: string | null;
      companyIds?: string[];
      ownerId?: string | null;
      memberIds?: string[];
      project?: {
        id?: string;
        companyId?: string | null;
        ownerId?: string | null;
        memberIds?: string[];
      } | null;
    }
  | {
      type: 'task';
      id?: string;
      projectId?: string;
      assigneeId?: string | null;
      reporterId?: string | null;
      companyId?: string | null;
      project?: {
        id?: string;
        companyId?: string | null;
        ownerId?: string | null;
        memberIds?: string[];
      } | null;
      task?: {
        id?: string;
        projectId?: string;
        assigneeId?: string | null;
        reporterId?: string | null;
      } | null;
    }
  | {
      type: 'tender';
      tender?: Pick<Tender, 'bidders'> | { bidders?: Array<{ isOurs?: boolean; companyId?: string }> } | null;
      bidders?: Array<{ isOurs?: boolean; companyId?: string }>;
      companyId?: string | null;
      companyIds?: string[];
    }
  | {
      type: 'contractor';
      contractor?: {
        companyId?: string | null;
        companyIds?: string[];
        projectCompanyIds?: string[];
      } | null;
      companyId?: string | null;
      companyIds?: string[];
      projectCompanyIds?: string[];
    }
  | Record<string, any>;

export type PermissionCheckContext =
  | PermissionConfig
  | { permissionConfig?: PermissionConfig | null }
  | null
  | undefined;

export function resolvePermissionConfig(context?: PermissionCheckContext): PermissionConfig {
  if (!context) return createDefaultPermissionConfig();
  if ('permissionConfig' in context) {
    return normalizePermissionConfig(context.permissionConfig);
  }
  if ('rolePermissions' in context) {
    return normalizePermissionConfig(context);
  }
  return createDefaultPermissionConfig();
}

function addCompanyId(target: Set<string>, raw: unknown): void {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed) target.add(trimmed);
  }
}

function addCompanyIds(target: Set<string>, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    addCompanyId(target, item);
  }
}

export function extractResourceCompanyIds(resource: PermissionResource | null | undefined): string[] {
  if (!resource || typeof resource !== 'object') return [];
  const res = resource as Record<string, any>;
  const ids = new Set<string>();

  addCompanyId(ids, res.companyId);
  addCompanyIds(ids, res.companyIds);
  addCompanyIds(ids, res.projectCompanyIds);

  if (res.project && typeof res.project === 'object') {
    addCompanyId(ids, res.project.companyId);
    addCompanyIds(ids, res.project.companyIds);
  }

  const tenderObj = res.tender && typeof res.tender === 'object' ? res.tender : res;
  if (Array.isArray(tenderObj.bidders)) {
    for (const bidder of tenderObj.bidders) {
      if (bidder && bidder.isOurs === true) {
        addCompanyId(ids, bidder.companyId);
      }
    }
  }

  if (res.contractor && typeof res.contractor === 'object') {
    addCompanyId(ids, res.contractor.companyId);
    addCompanyIds(ids, res.contractor.companyIds);
    addCompanyIds(ids, res.contractor.projectCompanyIds);
  }

  return Array.from(ids);
}

function extractProjectResource(resource: PermissionResource | null | undefined): {
  id?: string;
  ownerId?: string | null;
  memberIds?: string[];
  companyId?: string | null;
} | null {
  if (!resource || typeof resource !== 'object') return null;
  const res = resource as Record<string, any>;
  if (res.project && typeof res.project === 'object') {
    return res.project;
  }
  if (res.type === 'tender' || res.type === 'contractor') {
    return null;
  }
  if (
    'memberIds' in res ||
    'ownerId' in res ||
    (res.type === 'project') ||
    ('id' in res && 'companyId' in res && !('assigneeId' in res) && !('reporterId' in res))
  ) {
    return res;
  }
  return null;
}

function extractTaskResource(resource: PermissionResource | null | undefined): {
  assigneeId?: string | null;
  reporterId?: string | null;
} | null {
  if (!resource || typeof resource !== 'object') return null;
  const res = resource as Record<string, any>;
  if (res.task && typeof res.task === 'object') {
    return res.task;
  }
  if (res.type === 'task') {
    return res;
  }
  if ('assigneeId' in res || 'reporterId' in res) {
    return res;
  }
  return null;
}

function getPermissionFlags(
  user: PermissionUserLike,
  permission: Permission,
  config: PermissionConfig,
  hasExplicitContext: boolean
): {
  fromRole: boolean;
  fromGroup: boolean;
  fromGrant: boolean;
  denied: boolean;
} {
  const denials = new Set(sanitizePermissionArray(user.permissionDenials));
  const denied = denials.has(permission);

  if (!hasExplicitContext && Array.isArray(user.effectivePermissions)) {
    const hasGlobal = !denied && user.effectivePermissions.includes(permission);
    const grants = sanitizePermissionArray(user.permissionGrants);
    const fromGrant = !denied && grants.includes(permission);
    // Jeśli rola to project_manager i uprawnienie jest w effectivePermissions, mogło pochodzić z roli lub grupy
    const isPmRoleDefault =
      user.role === 'project_manager' &&
      DEFAULT_ROLE_PERMISSIONS.project_manager.includes(permission);
    return {
      fromRole: hasGlobal && isPmRoleDefault,
      fromGroup: hasGlobal && !isPmRoleDefault,
      fromGrant,
      denied,
    };
  }

  const role = isValidUserRole(user.role) ? user.role : undefined;
  const fromRole = role ? (config.rolePermissions[role] || []).includes(permission) : false;

  const userGroupIds = new Set(sanitizeStringIdArray(user.groupIds));
  let fromGroup = false;
  if (userGroupIds.size > 0) {
    for (const group of config.permissionGroups) {
      if (userGroupIds.has(group.id) && group.permissions.includes(permission)) {
        fromGroup = true;
        break;
      }
    }
  }

  const grants = sanitizePermissionArray(user.permissionGrants);
  const fromGrant = grants.includes(permission);

  return { fromRole, fromGroup, fromGrant, denied };
}

export function getEffectiveGlobalPermissions(
  user: PermissionUserLike | null | undefined,
  context?: PermissionCheckContext
): Permission[] {
  if (!user || !user.role) return [];
  if (user.role === 'admin') return [...ALL_PERMISSIONS];

  if (!context && Array.isArray(user.effectivePermissions)) {
    const denials = new Set(sanitizePermissionArray(user.permissionDenials));
    const allowed = new Set(sanitizePermissionArray(user.effectivePermissions));
    return ALL_PERMISSIONS.filter((p) => allowed.has(p) && !denials.has(p));
  }

  const config = resolvePermissionConfig(context);
  const result = new Set<Permission>();

  const role = isValidUserRole(user.role) ? user.role : undefined;
  if (role) {
    for (const p of config.rolePermissions[role] || []) {
      result.add(p);
    }
  }

  const userGroupIds = new Set(sanitizeStringIdArray(user.groupIds));
  if (userGroupIds.size > 0) {
    for (const group of config.permissionGroups) {
      if (userGroupIds.has(group.id)) {
        for (const p of group.permissions) {
          result.add(p);
        }
      }
    }
  }

  for (const p of sanitizePermissionArray(user.permissionGrants)) {
    result.add(p);
  }

  for (const p of sanitizePermissionArray(user.permissionDenials)) {
    result.delete(p);
  }

  return ALL_PERMISSIONS.filter((p) => result.has(p));
}

export function getEffectivePermissions(
  user: PermissionUserLike | null | undefined,
  context?: PermissionCheckContext,
  resource?: PermissionResource | null
): Permission[] {
  if (!user || !user.role) return [];
  if (user.role === 'admin') return [...ALL_PERMISSIONS];

  const config = resolvePermissionConfig(context);
  const result = new Set<Permission>(getEffectiveGlobalPermissions(user, config));

  if (resource) {
    for (const perm of ALL_PERMISSIONS) {
      if (!result.has(perm) && can(user, perm, resource, config)) {
        result.add(perm);
      } else if (result.has(perm) && !can(user, perm, resource, config)) {
        result.delete(perm);
      }
    }
  }

  return ALL_PERMISSIONS.filter((p) => result.has(p));
}

export function hasMatchingCompanyMembership(
  user: PermissionUserLike | null | undefined,
  resource: PermissionResource | null | undefined
): boolean {
  if (!user || !resource) return false;
  const userCompanies = new Set(sanitizeStringIdArray(user.companyIds));
  if (userCompanies.size === 0) return false;
  const resourceCompanies = extractResourceCompanyIds(resource);
  return resourceCompanies.some((cid) => userCompanies.has(cid));
}

export function canUserUseCompanyPermission(
  user: PermissionUserLike | null | undefined,
  permission: Permission,
  context?: PermissionCheckContext
): boolean {
  if (!user || !user.role) return false;
  if (user.role === 'admin') return true;
  const denials = new Set(sanitizePermissionArray(user.permissionDenials));
  if (denials.has(permission)) return false;
  const userCompanies = sanitizeStringIdArray(user.companyIds);
  if (userCompanies.length === 0) return false;
  const config = resolvePermissionConfig(context);
  return config.companyMemberPermissions.includes(permission);
}

/**
 * Centralna funkcja sprawdzająca uprawnienie użytkownika (opcjonalnie względem zasobu).
 * Kolejność:
 * 1. Rola 'admin' zawsze ma wszystkie uprawnienia.
 * 2. Wyłączenia indywidualne (`permissionDenials`) zawsze wygrywają z rolą, grupą, grantem, firmą i własnością.
 * 3. Połączenie źródeł: rola + grupy + granty indywidualne + członkostwo firmy (tylko dla zasobu tej firmy)
 *    + własność/członkostwo w konkretnym projekcie lub zadaniu (poza rolą viewer).
 */
export function can(
  user: PermissionUserLike | null | undefined,
  permission: Permission,
  resource?: PermissionResource | null,
  context?: PermissionCheckContext
): boolean {
  if (!user || !user.role) return false;
  if (!PERMISSION_SET.has(permission)) return false;
  if (user.role === 'admin') return true;

  const config = resolvePermissionConfig(context);
  const { fromRole, fromGroup, fromGrant, denied } = getPermissionFlags(
    user,
    permission,
    config,
    Boolean(context)
  );
  if (denied) return false;

  const fromCompany =
    Boolean(resource) &&
    config.companyMemberPermissions.includes(permission) &&
    hasMatchingCompanyMembership(user, resource);

  const userId = typeof user.id === 'string' ? user.id : '';
  const project = extractProjectResource(resource);
  const task = extractTaskResource(resource);

  const isProjectOwner = Boolean(
    project && userId && project.ownerId && project.ownerId === userId && user.role !== 'viewer'
  );
  const isProjectMember = Boolean(
    project && userId && Array.isArray(project.memberIds) && project.memberIds.includes(userId)
  );
  const isTaskOwner = Boolean(
    task &&
      userId &&
      user.role !== 'viewer' &&
      ((task.assigneeId && task.assigneeId === userId) ||
        (task.reporterId && task.reporterId === userId))
  );

  let fromOwnershipOrMembership = false;
  if (isProjectOwner) {
    if (
      permission === 'projects.view' ||
      permission === 'projects.edit' ||
      permission === 'tasks.edit' ||
      permission === 'finance.view' ||
      permission === 'finance.edit' ||
      permission === 'economy.view'
    ) {
      fromOwnershipOrMembership = true;
    }
  }
  if (!fromOwnershipOrMembership && isProjectMember) {
    if (permission === 'projects.view') {
      fromOwnershipOrMembership = true;
    } else if (
      user.role !== 'viewer' &&
      (permission === 'projects.edit' || permission === 'tasks.edit')
    ) {
      fromOwnershipOrMembership = true;
    }
  }
  if (!fromOwnershipOrMembership && isTaskOwner && permission === 'tasks.edit') {
    fromOwnershipOrMembership = true;
  }

  // Zachowanie dotychczasowej reguły dla finance.edit:
  // domyślne uprawnienie z roli project_manager nie pozwala edytować finansów projektu z obcym ownerId,
  // chyba że użytkownik ma uprawnienie z członkostwa firmy, grupy, indywidualnego grantu lub jest właścicielem.
  if (permission === 'finance.edit') {
    if (fromOwnershipOrMembership || fromCompany || fromGroup || fromGrant) {
      return true;
    }
    if (fromRole) {
      if (project && project.ownerId && project.ownerId !== userId) {
        return false;
      }
      return true;
    }
    return false;
  }

  return Boolean(
    fromRole || fromGroup || fromGrant || fromCompany || fromOwnershipOrMembership
  );
}
