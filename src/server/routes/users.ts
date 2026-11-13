import express from 'express';
import crypto from 'crypto';
import {
  generateBase32Secret,
  generate10BackupCodes,
  verifyTotpStrict,
  verifyAndConsumeBackupCode,
  getOtpAuthUrl,
} from '../../utils/totp.js';
import { ServerConfig } from '../config.js';
import { StateStore, sanitizeUser } from '../state.js';
import {
  SecurityContext,
  getClientIp,
  hashPasswordScrypt,
  verifyAndMigratePassword,
} from '../security.js';
import { SessionStore } from '../sessions.js';
import { validatePassword } from '../../utils/passwordPolicy.js';

export interface UserRoutesDeps {
  config: ServerConfig;
  stateStore: StateStore;
  sessionStore: SessionStore;
  security: SecurityContext;
}

export function registerUserRoutes(app: express.Express, deps: UserRoutesDeps): void {
  const { config, stateStore, sessionStore, security } = deps;
  const { effectiveAppSecret } = config;
  const { securityLogger } = stateStore;
  const { sessions, saveSessionsAsync, getSessionFromReq, requireAuth, requireAdmin } = sessionStore;
  const { isRateLimited, registerFailedLogin, resetFailedLogin } = security;

  // DELETE /api/users/:userId/sessions (Admin)
  app.delete('/api/users/:userId/sessions', requireAdmin, async (req, res) => {
    const caller = (req as any).user;
    const { userId } = req.params;
    const targetUser = (stateStore.getUsers() || []).find((u: any) => u.id === userId);
    if (!targetUser) {
      return res.status(404).json({ error: `Użytkownik o ID "${userId}" nie istnieje` });
    }

    let revokedCount = 0;
    for (const [tokenHash, s] of sessions.entries()) {
      if (s.userId === userId) {
        sessions.delete(tokenHash);
        revokedCount++;
      }
    }

    await saveSessionsAsync();

    securityLogger.record('session_revoked', {
      userId,
      ip: getClientIp(req),
      userAgent: (req.headers['user-agent'] || '').slice(0, 100),
      details: { revokedByAdminId: caller?.id, targetUserName: targetUser.name, revokedCount },
    }).catch(() => {});

    res.json({
      success: true,
      message: `Unieważniono wszystkie sesje użytkownika ${targetUser.name} (${revokedCount})`,
      revokedCount,
    });
  });

  // POST /api/users/:userId/password
  app.post('/api/users/:userId/password', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      const { userId } = req.params;
      const { currentPassword, newPassword } = req.body || {};
      const clientIp = getClientIp(req);

      if (!newPassword || typeof newPassword !== 'string') {
        return res.status(400).json({
          error: 'Hasło musi zawierać co najmniej 12 znaków.',
          errors: ['Hasło musi zawierać co najmniej 12 znaków.'],
        });
      }

      const users = stateStore.getUsers() || [];
      const targetUser = users.find((u) => u.id === userId);
      if (!targetUser) {
        return res.status(404).json({ error: 'Użytkownik nie istnieje w systemie.' });
      }

      const isSelf = caller.id === userId;
      const isAdmin = caller.role === 'admin';

      if (!isSelf && !isAdmin) {
        return res.status(403).json({ error: 'Brak uprawnień do zmiany hasła innego użytkownika.' });
      }

      if (isSelf) {
        const rateLimitKey = `pwd_chg:${clientIp}:${userId}`;
        if (isRateLimited(rateLimitKey, clientIp)) {
          return res.status(429).json({
            error: 'Zbyt wiele nieudanych prób wprowadzenia dotychczasowego hasła. Blokada na 15 minut.',
          });
        }

        if (!currentPassword) {
          return res.status(400).json({ error: 'Wymagane podanie dotychczasowego hasła.' });
        }

        const isCurrentValid = await verifyAndMigratePassword(targetUser, String(currentPassword), stateStore);
        if (!isCurrentValid) {
          registerFailedLogin(rateLimitKey, clientIp);
          return res.status(401).json({ error: 'Nieprawidłowe dotychczasowe hasło.' });
        }
        resetFailedLogin(rateLimitKey, clientIp);
      }

      const pwCheck = validatePassword(String(newPassword), {
        name: targetUser.name,
        email: targetUser.email,
      });
      if (!pwCheck.ok) {
        return res.status(400).json({
          error: pwCheck.errors.join(' '),
          errors: pwCheck.errors,
        });
      }

      const newHash = await hashPasswordScrypt(String(newPassword));
      targetUser.passwordHash = newHash;
      delete targetUser.password;

      stateStore.setAppState({
        ...(stateStore.getAppState() || {}),
        users,
        updatedAt: new Date().toISOString(),
      });
      await stateStore.saveStateAtomicAsync();

      const currentSession = getSessionFromReq(req);
      for (const [tokenHash, session] of sessions.entries()) {
        if (session.userId === targetUser.id) {
          if (isSelf && tokenHash === currentSession?.tokenHash) {
            continue;
          }
          sessions.delete(tokenHash);
        }
      }
      saveSessionsAsync();

      securityLogger.record('password_changed', {
        userId: targetUser.id,
        ip: clientIp,
        userAgent: (req.headers['user-agent'] || '').slice(0, 100),
        details: { changedByCallerId: caller.id, isSelf },
      }).catch(() => {});

      res.json({ success: true, message: 'Hasło zostało pomyślnie zaktualizowane.' });
    } catch (err: any) {
      console.error('[Server Auth] Błąd zmiany hasła:', err);
      res.status(500).json({ error: 'Błąd podczas zmiany hasła' });
    }
  });

  // POST /api/users/:userId/2fa/setup
  app.post('/api/users/:userId/2fa/setup', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      const { userId } = req.params;
      const { currentPassword, code } = req.body || {};
      const clientIp = getClientIp(req);

      if (caller.id !== userId) {
        return res.status(403).json({
          error: 'Użytkownik musi samodzielnie skonfigurować 2FA na swoim urządzeniu. Administrator może jedynie zresetować 2FA.',
        });
      }

      const targetUser = (stateStore.getUsers() || []).find((u) => u.id === userId);
      if (!targetUser) return res.status(404).json({ error: 'Użytkownik nie istnieje' });

      const rateLimitKey = `2fa_setup:${clientIp}:${userId}`;
      if (isRateLimited(rateLimitKey, clientIp)) {
        return res.status(429).json({ error: 'Zbyt wiele prób. Blokada na 15 minut.' });
      }

      if (!currentPassword) {
        return res.status(400).json({ error: 'Wymagane podanie bieżącego hasła' });
      }

      const isPassValid = await verifyAndMigratePassword(targetUser, String(currentPassword), stateStore);
      if (!isPassValid) {
        registerFailedLogin(rateLimitKey, clientIp);
        return res.status(401).json({ error: 'Nieprawidłowe hasło dostępu' });
      }

      if (targetUser.twoFactorEnabled) {
        if (!code) {
          return res.status(400).json({ error: 'Dla aktywnego 2FA wymagany jest aktualny kod weryfikacyjny z aplikacji' });
        }
        let codeValid = false;
        if (targetUser.twoFactorSecret) {
          const step = verifyTotpStrict(targetUser.twoFactorSecret, String(code), targetUser.lastTotpCounter);
          if (step !== null) codeValid = true;
        }
        if (!codeValid && verifyAndConsumeBackupCode(targetUser, String(code), effectiveAppSecret)) {
          codeValid = true;
        }
        if (!codeValid) {
          registerFailedLogin(rateLimitKey, clientIp);
          return res.status(401).json({ error: 'Nieprawidłowy aktualny kod 2FA lub kod zapasowy' });
        }
      }

      resetFailedLogin(rateLimitKey, clientIp);

      const secret = generateBase32Secret(32);
      const { codes, hashes } = generate10BackupCodes(effectiveAppSecret);
      const cleanEmail = String(targetUser.email || '').trim().toLowerCase();
      const otpAuthUrl = getOtpAuthUrl(cleanEmail, secret);

      targetUser.pending2FA = {
        secret,
        backupCodeHashes: hashes,
        createdAt: Date.now(),
      };
      await stateStore.saveStateAtomicAsync();

      res.json({
        success: true,
        secret,
        otpAuthUrl,
        backupCodes: codes,
      });
    } catch (err: any) {
      console.error('[Server Auth] Błąd 2fa/setup:', err);
      res.status(500).json({ error: 'Błąd generowania konfiguracji 2FA' });
    }
  });

  // POST /api/users/:userId/2fa/confirm
  app.post('/api/users/:userId/2fa/confirm', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      const { userId } = req.params;
      const { code } = req.body || {};

      if (caller.id !== userId) {
        return res.status(403).json({ error: 'Brak uprawnień do potwierdzenia konfiguracji 2FA dla tego konta' });
      }

      const users = stateStore.getUsers() || [];
      const targetUser = users.find((u) => u.id === userId);
      if (!targetUser) return res.status(404).json({ error: 'Użytkownik nie istnieje' });

      if (!targetUser.pending2FA || !targetUser.pending2FA.secret) {
        return res.status(400).json({ error: 'Brak oczekującej konfiguracji 2FA. Zainicjuj procedurę ponownie.' });
      }

      const matchedStep = verifyTotpStrict(targetUser.pending2FA.secret, String(code));
      if (matchedStep === null) {
        return res.status(400).json({ error: 'Nieprawidłowy 6-cyfrowy kod weryfikacyjny z aplikacji Google Authenticator' });
      }

      targetUser.twoFactorEnabled = true;
      targetUser.twoFactorSecret = targetUser.pending2FA.secret;
      targetUser.twoFactorBackupCodes = targetUser.pending2FA.backupCodeHashes;
      targetUser.lastTotpCounter = matchedStep;
      delete targetUser.pending2FA;

      stateStore.setAppState({
        ...(stateStore.getAppState() || {}),
        users,
        updatedAt: new Date().toISOString(),
      });
      await stateStore.saveStateAtomicAsync();

      const currentSession = getSessionFromReq(req);
      for (const [tokenHash, session] of sessions.entries()) {
        if (session.userId === targetUser.id && tokenHash !== currentSession?.tokenHash) {
          sessions.delete(tokenHash);
        }
      }
      saveSessionsAsync();

      securityLogger.record('twofa_enabled', {
        userId: targetUser.id,
        ip: getClientIp(req),
        userAgent: (req.headers['user-agent'] || '').slice(0, 100),
        details: { backupCodesCount: targetUser.twoFactorBackupCodes?.length ?? 0 },
      }).catch(() => {});

      res.json({
        success: true,
        twoFactorEnabled: true,
        backupCodesCount: targetUser.twoFactorBackupCodes.length,
      });
    } catch (err: any) {
      console.error('[Server Auth] Błąd 2fa/confirm:', err);
      res.status(500).json({ error: 'Błąd potwierdzenia 2FA' });
    }
  });

  // POST /api/users/:userId/2fa/disable
  app.post('/api/users/:userId/2fa/disable', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      const { userId } = req.params;
      const { currentPassword, code } = req.body || {};
      const clientIp = getClientIp(req);

      const users = stateStore.getUsers() || [];
      const targetUser = users.find((u) => u.id === userId);
      if (!targetUser) return res.status(404).json({ error: 'Użytkownik nie istnieje' });

      const isSelf = caller.id === userId;
      const isAdmin = caller.role === 'admin';

      if (!isSelf && !isAdmin) {
        return res.status(403).json({ error: 'Brak uprawnień do zarządzania 2FA dla tego konta' });
      }

      if (isSelf) {
        const rateLimitKey = `2fa_disable:${clientIp}:${userId}`;
        if (isRateLimited(rateLimitKey, clientIp)) {
          return res.status(429).json({ error: 'Zbyt wiele prób. Blokada na 15 minut.' });
        }

        if (!currentPassword) {
          return res.status(400).json({ error: 'Wymagane dotychczasowe hasło dostępu' });
        }
        const isPassValid = await verifyAndMigratePassword(targetUser, String(currentPassword), stateStore);
        if (!isPassValid) {
          registerFailedLogin(rateLimitKey, clientIp);
          return res.status(401).json({ error: 'Nieprawidłowe hasło dostępu' });
        }

        if (targetUser.twoFactorEnabled) {
          if (!code) {
            return res.status(400).json({ error: 'Wymagany 6-cyfrowy kod z Google Authenticator lub kod zapasowy' });
          }
          let codeValid = false;
          if (targetUser.twoFactorSecret) {
            const step = verifyTotpStrict(targetUser.twoFactorSecret, String(code), targetUser.lastTotpCounter);
            if (step !== null) codeValid = true;
          }
          if (!codeValid && verifyAndConsumeBackupCode(targetUser, String(code), effectiveAppSecret)) {
            codeValid = true;
          }

          if (!codeValid) {
            registerFailedLogin(rateLimitKey, clientIp);
            return res.status(401).json({ error: 'Nieprawidłowy kod 2FA lub kod zapasowy' });
          }
        }

        resetFailedLogin(rateLimitKey, clientIp);
      } else {
        console.log(`[Server Auth] Administrator ${caller.name} (${caller.id}) zresetował 2FA dla ${targetUser.name} (${targetUser.id}).`);
      }

      targetUser.twoFactorEnabled = false;
      delete targetUser.twoFactorSecret;
      delete targetUser.twoFactorBackupCodes;
      delete targetUser.lastTotpCounter;
      delete targetUser.pending2FA;

      stateStore.setAppState({
        ...(stateStore.getAppState() || {}),
        users,
        updatedAt: new Date().toISOString(),
      });
      await stateStore.saveStateAtomicAsync();

      if (!isSelf) {
        for (const [token, session] of sessions.entries()) {
          if (session.userId === targetUser.id) {
            sessions.delete(token);
          }
        }
        saveSessionsAsync();
      }

      securityLogger.record('twofa_disabled', {
        userId: targetUser.id,
        ip: clientIp,
        userAgent: (req.headers['user-agent'] || '').slice(0, 100),
        details: { disabledByCallerId: caller.id, isSelf },
      }).catch(() => {});

      res.json({ success: true, twoFactorEnabled: false });
    } catch (err: any) {
      console.error('[Server Auth] Błąd 2fa/disable:', err);
      res.status(500).json({ error: 'Błąd wyłączania 2FA' });
    }
  });

  // POST /api/users/:userId/approve
  app.post('/api/users/:userId/approve', requireAdmin, async (req, res) => {
    const caller = (req as any).user;
    const { userId } = req.params;
    const users = stateStore.getUsers() || [];
    const targetUser = users.find((u) => u.id === userId);
    if (!targetUser) return res.status(404).json({ error: 'Użytkownik nie istnieje' });

    targetUser.isApproved = true;
    stateStore.setAppState({
      ...(stateStore.getAppState() || {}),
      users,
      updatedAt: new Date().toISOString(),
    });
    await stateStore.saveStateAtomicAsync();

    securityLogger.record('user_approved', {
      userId: targetUser.id,
      ip: getClientIp(req),
      userAgent: (req.headers['user-agent'] || '').slice(0, 100),
      details: { approvedByCallerId: caller?.id, targetUserName: targetUser.name, role: targetUser.role },
    }).catch(() => {});

    res.json({ success: true, user: sanitizeUser(targetUser) });
  });

  // DELETE /api/users/:userId
  app.delete('/api/users/:userId', requireAdmin, async (req, res) => {
    const caller = (req as any).user;
    const { userId } = req.params;

    if (caller.id === userId) {
      return res.status(400).json({ error: 'Nie możesz usunąć aktualnie zalogowanego konta Administratora' });
    }

    const users = stateStore.getUsers() || [];
    const deletedUser = users.find((u) => u.id === userId);
    const nextUsers = users.filter((u) => u.id !== userId);
    stateStore.setUsers(nextUsers);
    stateStore.setAppState({
      ...(stateStore.getAppState() || {}),
      users: nextUsers,
      updatedAt: new Date().toISOString(),
    });
    await stateStore.saveStateAtomicAsync();

    securityLogger.record('user_deleted', {
      userId,
      ip: getClientIp(req),
      userAgent: (req.headers['user-agent'] || '').slice(0, 100),
      details: { deletedByCallerId: caller?.id, deletedUserName: deletedUser?.name, deletedUserRole: deletedUser?.role },
    }).catch(() => {});

    res.json({ success: true });
  });

  // POST /api/users
  app.post('/api/users', requireAdmin, async (req, res) => {
    try {
      const caller = (req as any).user;
      const { name, email, role, department, password } = req.body || {};
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Wymagane pola: imię, e-mail i hasło.' });
      }

      const cleanEmail = String(email).trim().toLowerCase();
      const users = stateStore.getUsers() || [];
      const existing = users.find((u) => u.email?.toLowerCase() === cleanEmail);
      if (existing) {
        return res.status(400).json({ error: 'Użytkownik o podanym adresie e-mail już istnieje w systemie.' });
      }

      const ALLOWED_ROLES = ['admin', 'project_manager', 'developer', 'tester', 'viewer'];
      const assignedRole = role || 'developer';
      if (!ALLOWED_ROLES.includes(assignedRole)) {
        return res.status(400).json({
          error: `Nieprawidłowa rola użytkownika. Dozwolone: ${ALLOWED_ROLES.join(', ')}.`,
        });
      }

      const pwCheck = validatePassword(String(password), {
        name: String(name),
        email: cleanEmail,
      });
      if (!pwCheck.ok) {
        return res.status(400).json({
          error: pwCheck.errors.join(' '),
          errors: pwCheck.errors,
        });
      }

      const passwordHash = await hashPasswordScrypt(String(password));
      const newUser = {
        id: crypto.randomUUID(),
        name: String(name).trim(),
        email: cleanEmail,
        role: assignedRole,
        department: department ? String(department).trim() : 'Projektant',
        initials: String(name).trim().split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'UZ',
        passwordHash,
        isDemo: false,
        isApproved: true,
        createdAt: new Date().toISOString(),
      };

      users.push(newUser);
      stateStore.setUsers(users);
      stateStore.setAppState({
        ...(stateStore.getAppState() || {}),
        users,
        updatedAt: new Date().toISOString(),
      });
      await stateStore.saveStateAtomicAsync();

      securityLogger.record('user_created', {
        userId: newUser.id,
        ip: getClientIp(req),
        userAgent: (req.headers['user-agent'] || '').slice(0, 100),
        details: { createdByCallerId: caller?.id, newUserName: newUser.name, role: newUser.role, department: newUser.department },
      }).catch(() => {});

      res.json({ success: true, user: sanitizeUser(newUser) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
