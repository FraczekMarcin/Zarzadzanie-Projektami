import express from 'express';
import crypto from 'crypto';
import type { Permission, PermissionConfig, PermissionGroup, UserRole } from '../../types/index.js';
import { hasForbiddenKeys } from '../../utils/access.js';
import {
  ALL_PERMISSIONS,
  EDITABLE_USER_ROLES,
  MAX_PERMISSION_GROUPS,
  PERMISSION_CATALOG,
  PERMISSION_GROUP_DESC_MAX,
  PERMISSION_GROUP_NAME_MAX,
  USER_ROLES,
  getEffectivePermissions,
  isValidUserRole,
  normalizePermissionConfig,
  sanitizeStringIdArray,
  validateStrictPermissionList,
} from '../../utils/permissions.js';
import { getClientIp } from '../security.js';
import { DISK_FULL_ERROR_MESSAGE, isDiskFullError, StateStore, sanitizeUser } from '../state.js';
import { SessionStore } from '../sessions.js';
import { logger } from '../logger.js';

export interface PermissionRoutesDeps {
  stateStore: StateStore;
  sessionStore: SessionStore;
  notifyPermissionsChanged?: (options?: { userIds?: string[] | null }) => void;
}

function buildAdminUserAccessSummary(user: any, permissionConfig: PermissionConfig) {
  const safe = sanitizeUser(user);
  return {
    ...safe,
    groupIds: Array.isArray(user?.groupIds) ? [...user.groupIds] : [],
    companyIds: Array.isArray(user?.companyIds) ? [...user.companyIds] : [],
    permissionGrants: Array.isArray(user?.permissionGrants) ? [...user.permissionGrants] : [],
    permissionDenials: Array.isArray(user?.permissionDenials) ? [...user.permissionDenials] : [],
    effectivePermissions: getEffectivePermissions(user, permissionConfig),
  };
}

export function registerPermissionRoutes(
  app: express.Express,
  deps: PermissionRoutesDeps
): void {
  const { stateStore, sessionStore, notifyPermissionsChanged } = deps;
  const { requireAdmin } = sessionStore;
  const { securityLogger } = stateStore;

  const notifySse = (userIds?: string[] | null) => {
    try {
      notifyPermissionsChanged?.({ userIds: userIds ?? null });
    } catch (err: any) {
      logger.warn('[Permissions] Błąd wysyłania powiadomienia SSE o uprawnieniach:', err?.message || err);
    }
  };

  // GET /api/admin/permissions — konfiguracja ról, grup, uprawnień firmowych oraz dostępu użytkowników (tylko admin)
  app.get('/api/admin/permissions', requireAdmin, (_req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const permissionConfig = normalizePermissionConfig(appState.permissionConfig);
      appState.permissionConfig = permissionConfig;
      const users = (Array.isArray(appState.users) ? appState.users : []).map((u: any) =>
        buildAdminUserAccessSummary(u, permissionConfig)
      );

      return res.json({
        catalog: PERMISSION_CATALOG,
        roles: USER_ROLES,
        editableRoles: EDITABLE_USER_ROLES,
        permissionConfig,
        users,
        companies: Array.isArray(appState.companies) ? appState.companies : [],
      });
    } catch (err: any) {
      logger.error('[Permissions] Błąd pobierania konfiguracji uprawnień:', err?.message || err);
      return res.status(500).json({ error: 'Nie udało się pobrać konfiguracji uprawnień.' });
    }
  });

  // PUT /api/admin/permissions — zapis uprawnień ról (poza admin) oraz companyMemberPermissions (tylko admin)
  app.put('/api/admin/permissions', requireAdmin, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;

      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Nieprawidłowy format danych konfiguracji uprawnień.' });
      }

      const allowedTopKeys = new Set(['rolePermissions', 'companyMemberPermissions']);
      for (const key of Object.keys(body)) {
        if (!allowedTopKeys.has(key)) {
          return res.status(400).json({ error: `Nieznane pole w żądaniu: "${key}".` });
        }
      }

      const hasRoles = Object.prototype.hasOwnProperty.call(body, 'rolePermissions');
      const hasCompanyPerms = Object.prototype.hasOwnProperty.call(body, 'companyMemberPermissions');
      if (!hasRoles && !hasCompanyPerms) {
        return res.status(400).json({
          error: 'Wymagane podanie pola rolePermissions lub companyMemberPermissions.',
        });
      }

      const currentConfig = normalizePermissionConfig(appState.permissionConfig);
      const nextRolePermissions = {
        ...currentConfig.rolePermissions,
        admin: [...ALL_PERMISSIONS],
      };
      const changedRoles: string[] = [];

      if (hasRoles) {
        const rawRoles = body.rolePermissions;
        if (!rawRoles || typeof rawRoles !== 'object' || Array.isArray(rawRoles)) {
          return res.status(400).json({ error: 'Pole rolePermissions musi być obiektem mapującym role na uprawnienia.' });
        }

        if (Object.prototype.hasOwnProperty.call(rawRoles, 'admin')) {
          return res.status(400).json({
            error: 'Rola "admin" zawsze posiada pełen zestaw uprawnień i nie podlega edycji.',
          });
        }

        for (const [roleKey, permsRaw] of Object.entries(rawRoles)) {
          if (!isValidUserRole(roleKey)) {
            return res.status(400).json({
              error: `Nieznana rola użytkownika: "${roleKey}".`,
            });
          }
          if (roleKey === 'admin') {
            return res.status(400).json({
              error: 'Rola "admin" zawsze posiada pełen zestaw uprawnień i nie podlega edycji.',
            });
          }
          const validation = validateStrictPermissionList(permsRaw, `rolePermissions.${roleKey}`);
          if (!validation.ok) {
            return res.status(400).json({ error: validation.error });
          }
          nextRolePermissions[roleKey] = validation.permissions;
          changedRoles.push(roleKey);
        }
      }

      let nextCompanyMemberPermissions = currentConfig.companyMemberPermissions;
      if (hasCompanyPerms) {
        const validation = validateStrictPermissionList(
          body.companyMemberPermissions,
          'companyMemberPermissions'
        );
        if (!validation.ok) {
          return res.status(400).json({ error: validation.error });
        }
        nextCompanyMemberPermissions = validation.permissions;
      }

      const nextConfig: PermissionConfig = {
        rolePermissions: nextRolePermissions,
        permissionGroups: currentConfig.permissionGroups,
        companyMemberPermissions: nextCompanyMemberPermissions,
      };

      const prevSnapshot = structuredClone(appState.permissionConfig);
      const prevRev = appState.revision || 0;
      const prevUpdatedAt = appState.updatedAt;
      let newRev: number;
      try {
        appState.permissionConfig = nextConfig;
        appState.updatedAt = new Date().toISOString();
        newRev = stateStore.bumpStateRevision();
        await stateStore.saveStateAtomicAsync();
      } catch (saveErr) {
        appState.permissionConfig = prevSnapshot;
        appState.revision = prevRev;
        appState.updatedAt = prevUpdatedAt;
        throw saveErr;
      }

      notifySse(null);

      await securityLogger
        .record('permission_changed', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: {
            scope: 'global_config',
            changedRoles,
            companyMemberPermissionsUpdated: hasCompanyPerms,
          },
        })
        .catch(() => {});

      return res.json({
        success: true,
        permissionConfig: nextConfig,
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Permissions] Błąd aktualizacji konfiguracji uprawnień:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się zapisać konfiguracji uprawnień.' });
    }
  });

  // POST /api/admin/permission-groups — utworzenie nowej grupy uprawnień (maks. 50, tylko admin)
  app.post('/api/admin/permission-groups', requireAdmin, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;

      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Nieprawidłowy format danych grupy uprawnień.' });
      }

      const allowedKeys = new Set(['name', 'description', 'permissions']);
      for (const key of Object.keys(body)) {
        if (!allowedKeys.has(key)) {
          return res.status(400).json({ error: `Nieznane pole w żądaniu: "${key}".` });
        }
      }

      const config = normalizePermissionConfig(appState.permissionConfig);
      if (config.permissionGroups.length >= MAX_PERMISSION_GROUPS) {
        return res.status(400).json({
          error: `Osiągnięto maksymalny limit ${MAX_PERMISSION_GROUPS} grup uprawnień.`,
        });
      }

      if (typeof body.name !== 'string') {
        return res.status(400).json({ error: 'Wymagana nazwa grupy uprawnień.', field: 'name' });
      }
      const name = body.name.trim();
      if (!name) {
        return res.status(400).json({ error: 'Nazwa grupy uprawnień nie może być pusta.', field: 'name' });
      }
      if (name.length > PERMISSION_GROUP_NAME_MAX) {
        return res.status(400).json({
          error: `Nazwa grupy uprawnień może mieć maksymalnie ${PERMISSION_GROUP_NAME_MAX} znaków.`,
          field: 'name',
        });
      }
      if (config.permissionGroups.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
        return res.status(409).json({
          error: `Grupa uprawnień o nazwie "${name}" już istnieje.`,
          field: 'name',
        });
      }

      let description = '';
      if (body.description !== undefined && body.description !== null) {
        if (typeof body.description !== 'string') {
          return res.status(400).json({ error: 'Opis grupy uprawnień musi być tekstem.', field: 'description' });
        }
        description = body.description.trim();
        if (description.length > PERMISSION_GROUP_DESC_MAX) {
          return res.status(400).json({
            error: `Opis grupy uprawnień może mieć maksymalnie ${PERMISSION_GROUP_DESC_MAX} znaków.`,
            field: 'description',
          });
        }
      }

      let permissions: Permission[] = [];
      if (body.permissions !== undefined) {
        const permCheck = validateStrictPermissionList(body.permissions, 'permissions');
        if (!permCheck.ok) {
          return res.status(400).json({ error: permCheck.error, field: 'permissions' });
        }
        permissions = permCheck.permissions;
      }

      const group: PermissionGroup = {
        id: `grp-${crypto.randomUUID()}`,
        name,
        description,
        permissions,
      };

      const prevGroups = structuredClone(config.permissionGroups);
      const prevRev = appState.revision || 0;
      const prevUpdatedAt = appState.updatedAt;
      let newRev: number;
      try {
        config.permissionGroups.push(group);
        appState.permissionConfig = config;
        appState.updatedAt = new Date().toISOString();
        newRev = stateStore.bumpStateRevision();
        await stateStore.saveStateAtomicAsync();
      } catch (saveErr) {
        config.permissionGroups = prevGroups;
        appState.permissionConfig = config;
        appState.revision = prevRev;
        appState.updatedAt = prevUpdatedAt;
        throw saveErr;
      }

      notifySse(null);

      await securityLogger
        .record('permission_changed', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: {
            action: 'group_created',
            groupId: group.id,
            groupName: group.name,
            permissions: group.permissions,
          },
        })
        .catch(() => {});

      return res.status(201).json({
        success: true,
        group,
        permissionConfig: config,
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Permissions] Błąd tworzenia grupy uprawnień:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się utworzyć grupy uprawnień.' });
    }
  });

  // PUT /api/admin/permission-groups/:id — aktualizacja grupy uprawnień (tylko admin)
  app.put('/api/admin/permission-groups/:id', requireAdmin, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;

      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Nieprawidłowy format danych aktualizacji grupy.' });
      }

      const allowedKeys = new Set(['name', 'description', 'permissions']);
      for (const key of Object.keys(body)) {
        if (!allowedKeys.has(key)) {
          return res.status(400).json({ error: `Nieznane pole w żądaniu: "${key}".` });
        }
      }

      const config = normalizePermissionConfig(appState.permissionConfig);
      const groupIdx = config.permissionGroups.findIndex((g) => g.id === req.params.id);
      if (groupIdx === -1) {
        return res.status(404).json({ error: `Grupa uprawnień o ID "${req.params.id}" nie istnieje.` });
      }

      const existing = config.permissionGroups[groupIdx];
      let nextName = existing.name;
      let nextDescription = existing.description;
      let nextPermissions = existing.permissions;

      if (Object.prototype.hasOwnProperty.call(body, 'name')) {
        if (typeof body.name !== 'string') {
          return res.status(400).json({ error: 'Nazwa grupy uprawnień musi być tekstem.', field: 'name' });
        }
        const trimmedName = body.name.trim();
        if (!trimmedName) {
          return res.status(400).json({ error: 'Nazwa grupy uprawnień nie może być pusta.', field: 'name' });
        }
        if (trimmedName.length > PERMISSION_GROUP_NAME_MAX) {
          return res.status(400).json({
            error: `Nazwa grupy uprawnień może mieć maksymalnie ${PERMISSION_GROUP_NAME_MAX} znaków.`,
            field: 'name',
          });
        }
        if (
          config.permissionGroups.some(
            (g) => g.id !== existing.id && g.name.toLowerCase() === trimmedName.toLowerCase()
          )
        ) {
          return res.status(409).json({
            error: `Grupa uprawnień o nazwie "${trimmedName}" już istnieje.`,
            field: 'name',
          });
        }
        nextName = trimmedName;
      }

      if (Object.prototype.hasOwnProperty.call(body, 'description')) {
        if (body.description === null || body.description === '') {
          nextDescription = '';
        } else if (typeof body.description === 'string') {
          const trimmedDesc = body.description.trim();
          if (trimmedDesc.length > PERMISSION_GROUP_DESC_MAX) {
            return res.status(400).json({
              error: `Opis grupy uprawnień może mieć maksymalnie ${PERMISSION_GROUP_DESC_MAX} znaków.`,
              field: 'description',
            });
          }
          nextDescription = trimmedDesc;
        } else {
          return res.status(400).json({ error: 'Opis grupy uprawnień musi być tekstem.', field: 'description' });
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'permissions')) {
        const permCheck = validateStrictPermissionList(body.permissions, 'permissions');
        if (!permCheck.ok) {
          return res.status(400).json({ error: permCheck.error, field: 'permissions' });
        }
        nextPermissions = permCheck.permissions;
      }

      const updatedGroup: PermissionGroup = {
        id: existing.id,
        name: nextName,
        description: nextDescription,
        permissions: nextPermissions,
      };

      const prevGroup = structuredClone(existing);
      const prevRev = appState.revision || 0;
      const prevUpdatedAt = appState.updatedAt;
      let newRev: number;
      try {
        config.permissionGroups[groupIdx] = updatedGroup;
        appState.permissionConfig = config;
        appState.updatedAt = new Date().toISOString();
        newRev = stateStore.bumpStateRevision();
        await stateStore.saveStateAtomicAsync();
      } catch (saveErr) {
        config.permissionGroups[groupIdx] = prevGroup;
        appState.permissionConfig = config;
        appState.revision = prevRev;
        appState.updatedAt = prevUpdatedAt;
        throw saveErr;
      }

      const affectedUserIds = (appState.users || [])
        .filter((u: any) => Array.isArray(u?.groupIds) && u.groupIds.includes(updatedGroup.id))
        .map((u: any) => u.id);
      notifySse(affectedUserIds);

      await securityLogger
        .record('permission_changed', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: {
            action: 'group_updated',
            groupId: updatedGroup.id,
            groupName: updatedGroup.name,
            permissions: updatedGroup.permissions,
          },
        })
        .catch(() => {});

      return res.json({
        success: true,
        group: updatedGroup,
        permissionConfig: config,
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Permissions] Błąd aktualizacji grupy uprawnień:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się zaktualizować grupy uprawnień.' });
    }
  });

  // DELETE /api/admin/permission-groups/:id — usunięcie grupy uprawnień i odpięcie od użytkowników (tylko admin)
  app.delete('/api/admin/permission-groups/:id', requireAdmin, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;

      const config = normalizePermissionConfig(appState.permissionConfig);
      const groupIdx = config.permissionGroups.findIndex((g) => g.id === req.params.id);
      if (groupIdx === -1) {
        return res.status(404).json({ error: `Grupa uprawnień o ID "${req.params.id}" nie istnieje.` });
      }

      const [removedGroup] = config.permissionGroups.splice(groupIdx, 1);
      appState.permissionConfig = config;

      const affectedUserIds: string[] = [];
      for (const user of appState.users || []) {
        if (user && Array.isArray(user.groupIds) && user.groupIds.includes(removedGroup.id)) {
          affectedUserIds.push(user.id);
          const filtered = user.groupIds.filter((gid: string) => gid !== removedGroup.id);
          if (filtered.length > 0) {
            user.groupIds = filtered;
          } else {
            delete user.groupIds;
          }
        }
      }
      stateStore.setUsers(appState.users);
      appState.updatedAt = new Date().toISOString();

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      notifySse(affectedUserIds);

      await securityLogger
        .record('permission_changed', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: {
            action: 'group_deleted',
            groupId: removedGroup.id,
            groupName: removedGroup.name,
            affectedUserIds,
          },
        })
        .catch(() => {});

      return res.json({
        success: true,
        permissionConfig: config,
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Permissions] Błąd usuwania grupy uprawnień:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się usunąć grupy uprawnień.' });
    }
  });

  // PUT /api/admin/users/:id/access — przypisanie roli, grup, firm oraz nadań/wyłączeń dla użytkownika (tylko admin)
  app.put('/api/admin/users/:id/access', requireAdmin, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;

      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Nieprawidłowy format danych dostępu użytkownika.' });
      }

      const allowedKeys = new Set([
        'role',
        'groupIds',
        'companyIds',
        'permissionGrants',
        'permissionDenials',
      ]);
      for (const key of Object.keys(body)) {
        if (!allowedKeys.has(key)) {
          return res.status(400).json({ error: `Nieznane pole w żądaniu: "${key}".` });
        }
      }

      const hasAnyField = Array.from(allowedKeys).some((k) =>
        Object.prototype.hasOwnProperty.call(body, k)
      );
      if (!hasAnyField) {
        return res.status(400).json({
          error: 'Wymagane podanie co najmniej jednego pola dostępu (role, groupIds, companyIds, permissionGrants, permissionDenials).',
        });
      }

      const users = Array.isArray(appState.users) ? appState.users : [];
      const targetUser = users.find((u: any) => u && u.id === req.params.id);
      if (!targetUser) {
        return res.status(404).json({ error: `Użytkownik o ID "${req.params.id}" nie istnieje.` });
      }

      const permConfig = normalizePermissionConfig(appState.permissionConfig);
      const validGroupIds = new Set(permConfig.permissionGroups.map((g) => g.id));
      const validCompanyIds = new Set(
        (Array.isArray(appState.companies) ? appState.companies : [])
          .filter((c: any) => c && typeof c.id === 'string')
          .map((c: any) => c.id)
      );

      let nextRole: UserRole | undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'role')) {
        if (!isValidUserRole(body.role)) {
          return res.status(400).json({
            error: `Nieprawidłowa rola użytkownika: "${String(body.role)}".`,
            field: 'role',
          });
        }
        nextRole = body.role;
        if (targetUser.role === 'admin' && targetUser.isApproved !== false && nextRole !== 'admin') {
          const remainingApprovedAdmins = users.filter(
            (u: any) => u && u.id !== targetUser.id && u.role === 'admin' && u.isApproved !== false
          ).length;
          if (remainingApprovedAdmins < 1) {
            return res.status(409).json({
              error: 'Nie można zmienić roli ostatniego zatwierdzonego administratora w systemie.',
            });
          }
        }
      }

      let nextGroupIds: string[] | undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'groupIds')) {
        if (!Array.isArray(body.groupIds) || body.groupIds.some((id: unknown) => typeof id !== 'string')) {
          return res.status(400).json({ error: 'Pole groupIds musi być tablicą identyfikatorów tekstowych.', field: 'groupIds' });
        }
        const cleaned = sanitizeStringIdArray(body.groupIds);
        for (const gid of cleaned) {
          if (!validGroupIds.has(gid)) {
            return res.status(400).json({
              error: `Grupa uprawnień o ID "${gid}" nie istnieje.`,
              field: 'groupIds',
            });
          }
        }
        nextGroupIds = cleaned;
      }

      let nextCompanyIds: string[] | undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'companyIds')) {
        if (!Array.isArray(body.companyIds) || body.companyIds.some((id: unknown) => typeof id !== 'string')) {
          return res.status(400).json({ error: 'Pole companyIds musi być tablicą identyfikatorów tekstowych.', field: 'companyIds' });
        }
        const cleaned = sanitizeStringIdArray(body.companyIds);
        for (const cid of cleaned) {
          if (!validCompanyIds.has(cid)) {
            return res.status(400).json({
              error: `Firma o ID "${cid}" nie istnieje.`,
              field: 'companyIds',
            });
          }
        }
        nextCompanyIds = cleaned;
      }

      let nextGrants: Permission[] | undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'permissionGrants')) {
        const resGrants = validateStrictPermissionList(body.permissionGrants, 'permissionGrants');
        if (!resGrants.ok) {
          return res.status(400).json({ error: resGrants.error, field: 'permissionGrants' });
        }
        nextGrants = resGrants.permissions;
      }

      let nextDenials: Permission[] | undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'permissionDenials')) {
        const resDenials = validateStrictPermissionList(body.permissionDenials, 'permissionDenials');
        if (!resDenials.ok) {
          return res.status(400).json({ error: resDenials.error, field: 'permissionDenials' });
        }
        nextDenials = resDenials.permissions;
      }

      const prevRole = targetUser.role;
      if (nextRole !== undefined) {
        targetUser.role = nextRole;
      }
      if (nextGroupIds !== undefined) {
        if (nextGroupIds.length > 0) targetUser.groupIds = nextGroupIds;
        else delete targetUser.groupIds;
      }
      if (nextCompanyIds !== undefined) {
        if (nextCompanyIds.length > 0) targetUser.companyIds = nextCompanyIds;
        else delete targetUser.companyIds;
      }
      if (nextGrants !== undefined) {
        if (nextGrants.length > 0) targetUser.permissionGrants = nextGrants;
        else delete targetUser.permissionGrants;
      }
      if (nextDenials !== undefined) {
        if (nextDenials.length > 0) targetUser.permissionDenials = nextDenials;
        else delete targetUser.permissionDenials;
      }

      stateStore.setUsers(users);
      appState.updatedAt = new Date().toISOString();

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      notifySse([targetUser.id]);

      await securityLogger
        .record('permission_changed', {
          userId: targetUser.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: {
            action: 'user_access_updated',
            changedByCallerId: caller.id,
            targetUserId: targetUser.id,
            ...(nextRole !== undefined ? { previousRole: prevRole, role: nextRole } : {}),
            ...(nextGroupIds !== undefined ? { groupIds: nextGroupIds } : {}),
            ...(nextCompanyIds !== undefined ? { companyIds: nextCompanyIds } : {}),
            ...(nextGrants !== undefined ? { permissionGrants: nextGrants } : {}),
            ...(nextDenials !== undefined ? { permissionDenials: nextDenials } : {}),
          },
        })
        .catch(() => {});

      return res.json({
        success: true,
        user: buildAdminUserAccessSummary(targetUser, permConfig),
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Permissions] Błąd aktualizacji dostępu użytkownika:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się zaktualizować dostępu użytkownika.' });
    }
  });
}
