import express from 'express';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import {
  generateBase32Secret,
  generate10BackupCodes,
  verifyTotpStrict,
  verifyAndConsumeBackupCode,
  getOtpAuthUrl,
} from '../../utils/totp.js';
import {
  Session,
  PublicSession,
  isSessionExpired,
  toPublicSession,
  computeSessionPublicId,
} from '../../utils/sessions.js';
import { DUMMY_SCRYPT_HASH, ServerConfig } from '../config.js';
import { StateStore, sanitizeUser } from '../state.js';
import {
  SecurityContext,
  getClientIp,
  hashPasswordScrypt,
  verifyPasswordScrypt,
  verifyAndMigratePassword,
} from '../security.js';
import { SessionStore } from '../sessions.js';
import { validatePassword } from '../../utils/passwordPolicy.js';

export interface AuthRoutesDeps {
  config: ServerConfig;
  stateStore: StateStore;
  sessionStore: SessionStore;
  security: SecurityContext;
}

export function registerAuthRoutes(app: express.Express, deps: AuthRoutesDeps): void {
  const { config, stateStore, sessionStore, security } = deps;
  const {
    effectiveAppSecret,
    sessionIdleMs,
    sessionMaxHours,
    sessionMaxMs,
    isSelfRegistrationAllowed,
    getSetupToken,
    isSetupTokenRequired,
    isSmtpConfigured,
  } = config;
  const { securityLogger } = stateStore;
  const {
    sessions,
    hashSessionToken,
    saveSessionsAsync,
    scheduleThrottledSessionsSave,
    setSessionCookie,
    clearSessionCookie,
    getSessionFromReq,
    requireAuth,
  } = sessionStore;
  const {
    passwordResetRequestEmailLimiter,
    passwordResetRequestIpLimiter,
    passwordResetVerifyIpLimiter,
    registerIpLimiter,
    setupAdminIpLimiter,
    passwordResetTokens,
    passwordResetEmailAttempts,
    isRateLimited,
    registerFailedLogin,
    resetFailedLogin,
  } = security;

  // GET /api/auth/password-reset/status
  app.get('/api/auth/password-reset/status', (_req, res) => {
    const enabled = isSmtpConfigured();
    res.json({
      enabled,
      message: enabled
        ? 'Resetowanie hasła przez e-mail jest aktywne'
        : 'Funkcja resetowania hasła przez e-mail jest wyłączona (brak konfiguracji serwera SMTP). Skontaktuj się z administratorem pracowni.',
    });
  });

  // POST /api/auth/password-reset/request
  app.post('/api/auth/password-reset/request', async (req, res) => {
    try {
      const clientIp = getClientIp(req);
      const ipCheck = passwordResetRequestIpLimiter.hit(clientIp);
      if (!ipCheck.allowed) {
        res.setHeader('Retry-After', ipCheck.retryAfterSeconds.toString());
        return res.status(429).json({
          error: 'Zbyt wiele żądań resetu hasła z tego adresu IP. Spróbuj ponownie później.',
          retryAfter: ipCheck.retryAfterSeconds,
        });
      }

      if (!isSmtpConfigured()) {
        return res.status(400).json({
          error: 'Funkcja resetowania hasła przez e-mail jest wyłączona. Skontaktuj się z administratorem pracowni.',
        });
      }

      const { email } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      const standardMessage =
        'Jeśli podany adres e-mail istnieje w bazie pracowni, wysłano na niego 6-cyfrowy kod weryfikacyjny. Kod jest ważny przez 10 minut.';

      if (!cleanEmail) {
        return res.json({ success: true, message: standardMessage });
      }

      const emailCheck = passwordResetRequestEmailLimiter.hit(cleanEmail);
      if (!emailCheck.allowed) {
        res.setHeader('Retry-After', emailCheck.retryAfterSeconds.toString());
        return res.status(429).json({
          error: 'Zbyt wiele żądań resetu hasła dla tego adresu e-mail. Spróbuj ponownie później.',
          retryAfter: emailCheck.retryAfterSeconds,
        });
      }

      const targetUser = (stateStore.getUsers() || []).find(
        (u) => (u.email || '').trim().toLowerCase() === cleanEmail
      );

      if (targetUser) {
        const code = crypto.randomInt(100000, 1000000).toString();
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');

        passwordResetTokens.set(cleanEmail, {
          email: cleanEmail,
          userId: targetUser.id,
          codeHash,
          expiresAt: Date.now() + 10 * 60 * 1000,
          attempts: 0,
        });

        try {
          const port = parseInt(process.env.SMTP_PORT || '587', 10);
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: port === 465,
            auth: process.env.SMTP_USER
              ? {
                  user: process.env.SMTP_USER,
                  pass: process.env.SMTP_PASS || '',
                }
              : undefined,
          });

          await transporter.sendMail({
            from: process.env.SMTP_FROM || '"Zarządzanie Projektami" <noreply@pracownia.pl>',
            to: cleanEmail,
            subject: 'Kod weryfikacyjny resetu hasła - Zarządzanie Projektami',
            text: `Twój jednorazowy 6-cyfrowy kod do zresetowania hasła to: ${code}\n\nKod jest ważny przez 10 minut (maksymalnie 5 prób weryfikacji).\nJeśli to nie Ty prosiłeś o reset hasła, zignoruj tę wiadomość.`,
            html: `<div style="font-family: sans-serif; padding: 24px; color: #1e293b; max-width: 480px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="color: #0284c7; margin-top: 0;">Zarządzanie Projektami</h2>
            <p style="font-size: 14px; line-height: 1.5;">Otrzymaliśmy prośbę o zresetowanie hasła dla Twojego profilu w pracowni.</p>
            <p style="font-size: 13px; font-weight: bold; margin-bottom: 8px;">Twój 6-cyfrowy kod weryfikacyjny:</p>
            <div style="font-size: 32px; font-family: monospace; font-weight: bold; letter-spacing: 6px; color: #0f172a; padding: 14px 20px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; width: fit-content;">${code}</div>
            <p style="font-size: 12px; color: #64748b; margin-top: 18px; line-height: 1.4;">Kod jest ważny przez <strong>10 minut</strong> (maksymalnie 5 prób weryfikacji). Jeśli to nie Ty prosiłeś o zmianę hasła, zignoruj tę wiadomość.</p>
          </div>`,
          });
          console.log(`[Server Auth] Wysłano kod resetu hasła na adres e-mail: ${cleanEmail}`);
          securityLogger.record('password_reset_requested', {
            userId: targetUser.id,
            ip: clientIp,
            userAgent: (req.headers['user-agent'] || '').slice(0, 100),
            details: { emailDomain: cleanEmail.split('@')[1] || '' },
          }).catch(() => {});
        } catch (mailErr: any) {
          console.error(`[Server Auth] Błąd wysyłania e-maila SMTP na adres ${cleanEmail}:`, mailErr.message);
        }
      }

      res.json({ success: true, message: standardMessage });
    } catch (err: any) {
      console.error('[Server Auth] Błąd resetu hasła request:', err);
      res.json({
        success: true,
        message: 'Jeśli podany adres e-mail istnieje w bazie pracowni, wysłano na niego 6-cyfrowy kod weryfikacyjny. Kod jest ważny przez 10 minut.',
      });
    }
  });

  // POST /api/auth/password-reset/verify
  app.post('/api/auth/password-reset/verify', (req, res) => {
    const clientIp = getClientIp(req);
    const ipCheck = passwordResetVerifyIpLimiter.hit(clientIp);
    if (!ipCheck.allowed) {
      res.setHeader('Retry-After', ipCheck.retryAfterSeconds.toString());
      return res.status(429).json({
        error: 'Zbyt wiele prób weryfikacji kodu z tego adresu IP. Spróbuj ponownie później.',
        retryAfter: ipCheck.retryAfterSeconds,
      });
    }

    const { email, code } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').replace(/[\s-]/g, '').trim();

    const now = Date.now();
    let attemptRec = passwordResetEmailAttempts.get(cleanEmail);
    if (attemptRec && now >= attemptRec.windowExpiresAt) {
      attemptRec = undefined;
      passwordResetEmailAttempts.delete(cleanEmail);
    }

    if (attemptRec && attemptRec.attempts >= 5) {
      const retryAfter = Math.max(1, Math.ceil((attemptRec.windowExpiresAt - now) / 1000));
      res.setHeader('Retry-After', retryAfter.toString());
      return res.status(429).json({
        error: 'Przekroczono maksymalną liczbę prób (5) weryfikacji w oknie 1 godziny. Poproś o nowy kod później.',
        retryAfter,
      });
    }

    const token = passwordResetTokens.get(cleanEmail);
    if (!token || token.expiresAt < now) {
      return res.status(400).json({ error: 'Kod weryfikacyjny wygasł lub nie został wygenerowany. Poproś o nowy kod.' });
    }

    if (!attemptRec) {
      attemptRec = { attempts: 1, windowExpiresAt: now + 60 * 60 * 1000 };
    } else {
      attemptRec.attempts += 1;
    }
    passwordResetEmailAttempts.set(cleanEmail, attemptRec);

    const enteredHash = crypto.createHash('sha256').update(cleanCode).digest('hex');
    const isMatch = crypto.timingSafeEqual(Buffer.from(enteredHash), Buffer.from(token.codeHash));

    if (!isMatch) {
      const remaining = 5 - attemptRec.attempts;
      if (remaining <= 0) {
        passwordResetTokens.delete(cleanEmail);
        const retryAfter = Math.max(1, Math.ceil((attemptRec.windowExpiresAt - now) / 1000));
        res.setHeader('Retry-After', retryAfter.toString());
        return res.status(429).json({
          error: 'Przekroczono limit 5 prób weryfikacji. Poproś o nowy kod resetu za godzinę.',
          retryAfter,
        });
      }
      return res.status(400).json({ error: `Nieprawidłowy kod weryfikacyjny. Pozostało prób: ${remaining}` });
    }

    const verifiedTicket = crypto.randomBytes(32).toString('hex');
    token.verifiedTicket = verifiedTicket;
    res.json({ success: true, verifiedTicket });
  });

  // POST /api/auth/password-reset/confirm
  app.post('/api/auth/password-reset/confirm', async (req, res) => {
    try {
      const { email, verifiedTicket, newPassword } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();

      const token = passwordResetTokens.get(cleanEmail);
      if (!token || !token.verifiedTicket || token.verifiedTicket !== verifiedTicket || token.expiresAt < Date.now()) {
        return res.status(400).json({ error: 'Sesja resetowania hasła wygasła lub jest nieprawidłowa. Rozpocznij procedurę od nowa.' });
      }

      const users = stateStore.getUsers() || [];
      const targetUser = users.find((u) => u.id === token.userId);
      if (!targetUser) {
        return res.status(404).json({ error: 'Użytkownik nie istnieje w systemie.' });
      }

      const pwCheck = validatePassword(String(newPassword || ''), {
        email: targetUser.email,
        name: targetUser.name,
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

      for (const [sToken, s] of sessions.entries()) {
        if (s.userId === targetUser.id) {
          sessions.delete(sToken);
        }
      }
      saveSessionsAsync();

      passwordResetTokens.delete(cleanEmail);
      passwordResetEmailAttempts.delete(cleanEmail);
      stateStore.setAppState({
        ...(stateStore.getAppState() || {}),
        users,
        updatedAt: new Date().toISOString(),
      });
      await stateStore.saveStateAtomicAsync();

      securityLogger.record('password_reset_completed', {
        userId: targetUser.id,
        ip: getClientIp(req),
        userAgent: (req.headers['user-agent'] || '').slice(0, 100),
        details: { role: targetUser.role },
      }).catch(() => {});

      res.json({ success: true, message: 'Hasło zostało pomyślnie zmienione. Możesz się teraz zalogować nowym hasłem.' });
    } catch (err: any) {
      console.error('[Server Auth] Błąd confirm password reset:', err);
      res.status(500).json({ error: 'Błąd zapisu nowego hasła' });
    }
  });

  // GET /api/auth/setup-status
  app.get('/api/auth/setup-status', (req, res) => {
    const session = getSessionFromReq(req);
    const users = stateStore.getUsers() || [];
    const setupRequired = users.length === 0;
    const allowSelfRegistration = isSelfRegistrationAllowed();
    const requireSetupToken = isSetupTokenRequired();

    if (!session) {
      return res.json({
        setupRequired,
        allowSelfRegistration,
        requireSetupToken,
      });
    }

    res.json({
      setupRequired,
      userCount: users.length,
      users: users.filter((u) => u.isApproved !== false).map(sanitizeUser),
    });
  });

  // POST /api/auth/login
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { userId, email, password, totpCode } = req.body || {};
      const identifier = String(email || userId || '').trim();
      const clientIp = getClientIp(req);

      if (!identifier || !password) {
        return res.status(400).json({ error: 'Wymagany adres e-mail i hasło dostępu' });
      }

      if (isRateLimited(identifier, clientIp)) {
        securityLogger.record('login_failure', {
          email: identifier.includes('@') ? identifier : undefined,
          userId: !identifier.includes('@') ? identifier : undefined,
          ip: clientIp,
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { reason: 'locked_out' },
        }).catch(() => {});
        return res.status(429).json({
          error: 'Zbyt wiele nieudanych prób logowania. Konto lub adres IP zablokowany na 15 minut.',
        });
      }

      const AUTH_ERROR_MSG = 'Nieprawidłowy adres e-mail lub hasło';

      const user = (stateStore.getUsers() || []).find(
        (u) => (u.email && u.email.toLowerCase() === identifier.toLowerCase()) || u.id === identifier
      );

      if (!user) {
        await verifyPasswordScrypt(String(password), DUMMY_SCRYPT_HASH);
        registerFailedLogin(identifier, clientIp);
        const isLocked = isRateLimited(identifier, clientIp);
        securityLogger.record('login_failure', {
          email: identifier.includes('@') ? identifier : undefined,
          userId: !identifier.includes('@') ? identifier : undefined,
          ip: clientIp,
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { reason: isLocked ? 'locked_out' : 'unknown_user' },
        }).catch(() => {});
        if (isLocked) {
          return res.status(429).json({
            error: 'Zbyt wiele nieudanych prób logowania. Konto lub adres IP zablokowany na 15 minut.',
          });
        }
        return res.status(401).json({ error: AUTH_ERROR_MSG });
      }

      if (user.isApproved === false) {
        securityLogger.record('login_failure', {
          email: user.email,
          userId: user.id,
          ip: clientIp,
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { reason: 'pending_approval' },
        }).catch(() => {});
        return res.status(403).json({ error: 'Konto oczekuje na zatwierdzenie przez Administratora' });
      }

      const isPasswordValid = await verifyAndMigratePassword(user, String(password), stateStore);
      if (!isPasswordValid) {
        registerFailedLogin(identifier, clientIp);
        const isLocked = isRateLimited(identifier, clientIp);
        securityLogger.record('login_failure', {
          email: user.email,
          userId: user.id,
          ip: clientIp,
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { reason: isLocked ? 'locked_out' : 'bad_password' },
        }).catch(() => {});
        if (isLocked) {
          return res.status(429).json({
            error: 'Zbyt wiele nieudanych prób logowania. Konto lub adres IP zablokowany na 15 minut.',
          });
        }
        return res.status(401).json({ error: AUTH_ERROR_MSG });
      }

      if (user.twoFactorEnabled || (user.pending2FA && user.pending2FA.secret)) {
        if (!totpCode) {
          return res.json({
            require2FA: true,
            message: 'Wymagany 6-cyfrowy kod Google Authenticator lub jednorazowy kod zapasowy',
          });
        }

        let authSuccess = false;

        if (user.twoFactorEnabled && user.twoFactorSecret) {
          const matchedStep = verifyTotpStrict(user.twoFactorSecret, String(totpCode), user.lastTotpCounter);
          if (matchedStep !== null) {
            user.lastTotpCounter = matchedStep;
            authSuccess = true;
            await stateStore.saveStateAtomicAsync();
          } else if (verifyAndConsumeBackupCode(user, String(totpCode), effectiveAppSecret)) {
            authSuccess = true;
            await stateStore.saveStateAtomicAsync();
            console.log(`[Server Auth] Użytkownik ${user.name} (${user.id}) zalogował się za pomocą jednorazowego kodu zapasowego.`);
            securityLogger.record('twofa_backup_code_used', {
              userId: user.id,
              ip: clientIp,
              userAgent: (req.headers['user-agent'] || '').slice(0, 100),
              details: { remainingCodes: user.twoFactorBackupCodes?.length ?? 0 },
            }).catch(() => {});
          }
        } else if (user.pending2FA && user.pending2FA.secret) {
          const matchedStep = verifyTotpStrict(user.pending2FA.secret, String(totpCode));
          if (matchedStep !== null) {
            user.twoFactorEnabled = true;
            user.twoFactorSecret = user.pending2FA.secret;
            user.twoFactorBackupCodes = user.pending2FA.backupCodeHashes;
            user.lastTotpCounter = matchedStep;
            delete user.pending2FA;
            authSuccess = true;
            await stateStore.saveStateAtomicAsync();
            console.log(`[Server Auth] Użytkownik ${user.name} (${user.id}) potwierdził 2FA przy pierwszym logowaniu.`);
            securityLogger.record('twofa_enabled', {
              userId: user.id,
              ip: clientIp,
              userAgent: (req.headers['user-agent'] || '').slice(0, 100),
              details: { context: 'registration_first_login' },
            }).catch(() => {});
          }
        }

        if (!authSuccess) {
          registerFailedLogin(identifier, clientIp);
          const isLocked = isRateLimited(identifier, clientIp);
          securityLogger.record('login_failure', {
            email: user.email,
            userId: user.id,
            ip: clientIp,
            userAgent: (req.headers['user-agent'] || '').slice(0, 100),
            details: { reason: isLocked ? 'locked_out' : 'bad_2fa' },
          }).catch(() => {});
          if (isLocked) {
            return res.status(429).json({
              error: 'Zbyt wiele nieudanych prób logowania. Konto lub adres IP zablokowany na 15 minut.',
            });
          }
          return res.status(401).json({ error: 'Nieprawidłowy kod 2FA lub kod zapasowy' });
        }
      }

      resetFailedLogin(identifier, clientIp);

      const userAgent = (req.headers['user-agent'] || '').slice(0, 200);
      const now = Date.now();
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(rawToken);
      const session: Session = {
        tokenHash,
        userId: user.id,
        role: user.role,
        createdAt: now,
        expiresAt: now + sessionMaxMs,
        lastSeenAt: now,
        userAgent: userAgent || undefined,
        ip: clientIp || undefined,
      };
      sessions.set(tokenHash, session);
      saveSessionsAsync();

      securityLogger.record('login_success', {
        email: user.email,
        userId: user.id,
        ip: clientIp,
        userAgent: (req.headers['user-agent'] || '').slice(0, 100),
        details: { role: user.role },
      }).catch(() => {});

      setSessionCookie(req, res, rawToken, sessionMaxHours * 3600);
      res.json({ success: true, user: sanitizeUser(user) });
    } catch (err: any) {
      console.error('[Server Auth] Błąd logowania:', err);
      res.status(500).json({ error: 'Wystąpił błąd serwera podczas logowania' });
    }
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', (req, res) => {
    const session = getSessionFromReq(req);
    if (session) {
      securityLogger.record('logout', {
        userId: session.userId,
        ip: getClientIp(req),
        userAgent: (req.headers['user-agent'] || '').slice(0, 100),
      }).catch(() => {});
      sessions.delete(session.tokenHash);
      saveSessionsAsync();
    }
    clearSessionCookie(req, res);
    res.json({ success: true });
  });

  // GET /api/auth/me
  app.get('/api/auth/me', requireAuth, (req, res) => {
    const user = (req as any).user;
    res.json({ authenticated: true, user: sanitizeUser(user) });
  });

  // GET /api/auth/sessions
  app.get('/api/auth/sessions', requireAuth, (req, res) => {
    const caller = (req as any).user;
    const currentSession = (req as any).session as Session;
    const now = Date.now();
    const userSessions: PublicSession[] = [];

    for (const [tokenHash, s] of sessions.entries()) {
      if (s.userId === caller.id) {
        if (isSessionExpired(s, now, sessionIdleMs, sessionMaxMs)) {
          sessions.delete(tokenHash);
          scheduleThrottledSessionsSave();
          continue;
        }
        userSessions.push(toPublicSession(s, currentSession.tokenHash, effectiveAppSecret));
      }
    }

    userSessions.sort((a, b) => {
      if (a.current && !b.current) return -1;
      if (!a.current && b.current) return 1;
      return b.lastSeenAt - a.lastSeenAt;
    });

    res.json({ success: true, sessions: userSessions });
  });

  // DELETE /api/auth/sessions/:id
  app.delete('/api/auth/sessions/:id', requireAuth, async (req, res) => {
    const caller = (req as any).user;
    const currentSession = (req as any).session as Session;
    const { id } = req.params;
    let foundTokenHash: string | null = null;
    let isCurrent = false;

    for (const [tokenHash, s] of sessions.entries()) {
      if (s.userId === caller.id) {
        const pubId = computeSessionPublicId(tokenHash, effectiveAppSecret);
        if (pubId === id) {
          foundTokenHash = tokenHash;
          isCurrent = tokenHash === currentSession.tokenHash;
          break;
        }
      }
    }

    if (!foundTokenHash) {
      return res.status(404).json({ error: 'Sesja nie istnieje lub należy do kogoś innego' });
    }

    sessions.delete(foundTokenHash);
    await saveSessionsAsync();

    securityLogger.record('session_revoked', {
      userId: caller.id,
      ip: getClientIp(req),
      userAgent: (req.headers['user-agent'] || '').slice(0, 100),
      details: { sessionId: id, isCurrent },
    }).catch(() => {});

    if (isCurrent) {
      clearSessionCookie(req, res);
      return res.json({ success: true, message: 'Wylogowano z bieżącej sesji', loggedOutCurrent: true });
    }

    res.json({ success: true, message: 'Sesja została unieważniona' });
  });

  // POST /api/auth/sessions/revoke-others
  app.post('/api/auth/sessions/revoke-others', requireAuth, async (req, res) => {
    const caller = (req as any).user;
    const currentSession = (req as any).session as Session;
    let revokedCount = 0;

    for (const [tokenHash, s] of sessions.entries()) {
      if (s.userId === caller.id && tokenHash !== currentSession.tokenHash) {
        sessions.delete(tokenHash);
        revokedCount++;
      }
    }

    await saveSessionsAsync();

    securityLogger.record('session_revoked', {
      userId: caller.id,
      ip: getClientIp(req),
      userAgent: (req.headers['user-agent'] || '').slice(0, 100),
      details: { type: 'revoke_others', revokedCount },
    }).catch(() => {});

    res.json({ success: true, message: `Unieważniono pozostałe sesje (${revokedCount})`, revokedCount });
  });

  // POST /api/auth/setup-admin
  app.post('/api/auth/setup-admin', async (req, res) => {
    try {
      const clientIp = getClientIp(req);
      const ipCheck = setupAdminIpLimiter.hit(clientIp);
      if (!ipCheck.allowed) {
        res.setHeader('Retry-After', ipCheck.retryAfterSeconds.toString());
        return res.status(429).json({
          error: 'Zbyt wiele prób konfiguracji administratora z tego adresu IP. Spróbuj ponownie później.',
          retryAfter: ipCheck.retryAfterSeconds,
        });
      }

      if ((stateStore.getUsers() || []).length > 0) {
        return res.status(400).json({ error: 'Konto administratora zostało już utworzone w systemie.' });
      }

      if (isSetupTokenRequired()) {
        const { setupToken } = req.body || {};
        const expectedToken = getSetupToken();
        if (!setupToken || String(setupToken).trim() !== expectedToken) {
          return res.status(403).json({
            error: 'Nieprawidłowy token autoryzacyjny pierwszego administratora (SETUP_TOKEN).',
          });
        }
      }

      const { name, email, password, department } = req.body || {};
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Wszystkie pola są wymagane.' });
      }
      const pwCheck = validatePassword(String(password), {
        name: String(name),
        email: String(email),
      });
      if (!pwCheck.ok) {
        return res.status(400).json({
          error: pwCheck.errors.join(' '),
          errors: pwCheck.errors,
        });
      }

      const passwordHash = await hashPasswordScrypt(String(password));
      const adminUser = {
        id: crypto.randomUUID(),
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
        role: 'admin',
        department: department ? String(department).trim() : 'Główny Projektant',
        initials: String(name).trim().split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'AD',
        passwordHash,
        isDemo: false,
        isApproved: true,
        createdAt: new Date().toISOString(),
      };

      stateStore.setUsers([adminUser]);
      stateStore.setAppState({
        ...(stateStore.getAppState() || {}),
        initialized: true,
        users: stateStore.getUsers(),
        updatedAt: new Date().toISOString(),
      });
      await stateStore.saveStateAtomicAsync();

      const userAgent = (req.headers['user-agent'] || '').slice(0, 200);
      const now = Date.now();
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(rawToken);
      const session: Session = {
        tokenHash,
        userId: adminUser.id,
        role: adminUser.role,
        createdAt: now,
        expiresAt: now + sessionMaxMs,
        lastSeenAt: now,
        userAgent: userAgent || undefined,
        ip: clientIp || undefined,
      };
      sessions.set(tokenHash, session);
      saveSessionsAsync();

      setSessionCookie(req, res, rawToken, sessionMaxHours * 3600);

      securityLogger.record('setup_admin', {
        userId: adminUser.id,
        email: adminUser.email,
        ip: clientIp,
        userAgent: (req.headers['user-agent'] || '').slice(0, 100),
        details: { name: adminUser.name },
      }).catch(() => {});

      res.json({ success: true, user: sanitizeUser(adminUser) });
    } catch (err: any) {
      console.error('[Server Auth] Błąd setup-admin:', err);
      res.status(500).json({ error: 'Błąd tworzenia konta administratora' });
    }
  });

  // POST /api/auth/register
  app.post('/api/auth/register', async (req, res) => {
    try {
      if (!isSelfRegistrationAllowed()) {
        return res.status(403).json({
          error: 'Samodzielna rejestracja użytkowników została wyłączona przez administratora systemu (ALLOW_SELF_REGISTRATION=false).',
        });
      }

      const clientIp = getClientIp(req);
      const ipCheck = registerIpLimiter.hit(clientIp);
      if (!ipCheck.allowed) {
        res.setHeader('Retry-After', ipCheck.retryAfterSeconds.toString());
        return res.status(429).json({
          error: 'Zbyt wiele prób rejestracji z tego adresu IP. Spróbuj ponownie później.',
          retryAfter: ipCheck.retryAfterSeconds,
        });
      }

      const { name, email, password, department, twoFactorEnabled } = req.body || {};
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Wymagane imię, e-mail i hasło.' });
      }
      const pwCheck = validatePassword(String(password), {
        name: String(name),
        email: String(email),
      });
      if (!pwCheck.ok) {
        return res.status(400).json({
          error: pwCheck.errors.join(' '),
          errors: pwCheck.errors,
        });
      }

      const cleanEmail = String(email).trim().toLowerCase();
      const users = stateStore.getUsers() || [];
      const existing = users.find((u) => u.email?.toLowerCase() === cleanEmail);
      if (existing) {
        return res.json({
          success: true,
          message: 'Wniosek rejestracyjny został zapisany. Administrator musi zatwierdzić konto.',
        });
      }

      const passwordHash = await hashPasswordScrypt(String(password));

      let twoFactorData: { secret: string; otpAuthUrl: string; backupCodes: string[] } | null = null;
      let pending2FAData: { secret: string; backupCodeHashes: string[]; createdAt: number } | undefined = undefined;

      if (Boolean(twoFactorEnabled)) {
        const server2FASecret = generateBase32Secret(32);
        const { codes, hashes } = generate10BackupCodes(effectiveAppSecret);
        const otpAuthUrl = getOtpAuthUrl(cleanEmail, server2FASecret);
        twoFactorData = {
          secret: server2FASecret,
          otpAuthUrl,
          backupCodes: codes,
        };
        pending2FAData = {
          secret: server2FASecret,
          backupCodeHashes: hashes,
          createdAt: Date.now(),
        };
      }

      const newUser = {
        id: crypto.randomUUID(),
        name: String(name).trim(),
        email: cleanEmail,
        role: 'developer',
        department: department ? String(department).trim() : 'Projektant',
        initials: String(name).trim().split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'UZ',
        passwordHash,
        twoFactorEnabled: false,
        pending2FA: pending2FAData,
        lastTotpCounter: 0,
        isDemo: false,
        isApproved: false,
        registeredAt: new Date().toISOString(),
      };

      users.push(newUser);
      stateStore.setUsers(users);
      stateStore.setAppState({
        ...(stateStore.getAppState() || {}),
        users,
        updatedAt: new Date().toISOString(),
      });
      await stateStore.saveStateAtomicAsync();

      securityLogger.record('registration', {
        userId: newUser.id,
        email: newUser.email,
        ip: clientIp,
        userAgent: (req.headers['user-agent'] || '').slice(0, 100),
        details: { department: newUser.department, withTwoFactor: Boolean(twoFactorEnabled) },
      }).catch(() => {});

      res.json({
        success: true,
        message: 'Wniosek rejestracyjny został zapisany. Administrator musi zatwierdzić konto.',
        twoFactor: twoFactorData,
      });
    } catch (err: any) {
      console.error('[Server Auth] Błąd rejestracji:', err);
      res.status(500).json({ error: 'Błąd rejestracji użytkownika' });
    }
  });
}
