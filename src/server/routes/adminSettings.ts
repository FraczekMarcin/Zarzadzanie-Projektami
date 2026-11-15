import express from 'express';
import { isValidEmail } from '../../utils/settingsSchema.js';
import { formatSmtpErrorPolish, MailerService } from '../mailer.js';
import {
  SecurityContext,
  getClientIp,
  verifyAndMigratePassword,
} from '../security.js';
import { SessionStore } from '../sessions.js';
import { SettingsService } from '../settings.js';
import { StateStore } from '../state.js';
import { logger } from '../logger.js';

export interface AdminSettingsRoutesDeps {
  stateStore: StateStore;
  sessionStore: SessionStore;
  security: SecurityContext;
  settingsService: SettingsService;
  mailer: MailerService;
}

export function registerAdminSettingsRoutes(
  app: express.Express,
  deps: AdminSettingsRoutesDeps
): void {
  const { stateStore, sessionStore, security, settingsService, mailer } = deps;
  const { requireAdmin } = sessionStore;
  const { adminSettingsLimiter, smtpTestLimiter } = security;
  const { securityLogger } = stateStore;

  // GET /api/admin/settings — efektywne ustawienia, źródła, blokady env i sekcja tylko do odczytu
  app.get('/api/admin/settings', requireAdmin, (req, res) => {
    try {
      const payload = settingsService.getAdminSettingsPayload(req);
      res.json(payload);
    } catch (err: any) {
      logger.error('[AdminSettings] Błąd odczytu ustawień administratora:', err?.message || err);
      res.status(500).json({ error: 'Nie udało się odczytać ustawień administratora.' });
    }
  });

  // PUT /api/admin/settings — częściowa aktualizacja ustawień (limit 20 żądań/godz., wymaga aktualnego hasła admina)
  app.put('/api/admin/settings', requireAdmin, async (req, res) => {
    try {
      const caller = (req as any).user;
      const clientIp = getClientIp(req);
      const rateCheck = adminSettingsLimiter.hit(`admin:${caller.id}:${clientIp}`);
      if (!rateCheck.allowed) {
        res.setHeader('Retry-After', rateCheck.retryAfterSeconds.toString());
        return res.status(429).json({
          error: 'Zbyt wiele prób zmiany ustawień administratora. Spróbuj ponownie później.',
          retryAfter: rateCheck.retryAfterSeconds,
        });
      }

      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Nieprawidłowy format danych ustawień.' });
      }

      const currentPassword =
        typeof body.currentPassword === 'string' ? body.currentPassword : '';
      if (!currentPassword) {
        return res.status(400).json({
          error: 'Wymagane podanie aktualnego hasła administratora w celu potwierdzenia zmian.',
        });
      }

      const passwordOk = await verifyAndMigratePassword(caller, currentPassword, stateStore);
      if (!passwordOk) {
        return res.status(401).json({
          error: 'Nieprawidłowe aktualne hasło administratora.',
        });
      }

      const lockConflict = settingsService.findLockedFieldConflict(body);
      if (lockConflict) {
        return res.status(409).json({
          error: `Pole "${lockConflict.field}" jest zablokowane zmienną środowiskową ${lockConflict.envVar} i nie może być modyfikowane w interfejsie.`,
          field: lockConflict.field,
          envVar: lockConflict.envVar,
        });
      }

      const validation = settingsService.validateAndNormalizeUpdate(body);
      if (!validation.ok) {
        return res.status(400).json({
          error: validation.errors.join(' '),
          errors: validation.errors,
        });
      }

      const { changedFields } = await settingsService.applySettingsPatch(validation.patch);

      if (changedFields.length > 0) {
        await securityLogger
          .record('settings_changed', {
            userId: caller.id,
            ip: clientIp,
            userAgent: (req.headers['user-agent'] || '').slice(0, 100),
            details: { changedFields },
          })
          .catch(() => {});
        logger.info(`[AdminSettings] Administrator (${caller.id}) zmienił pola: ${changedFields.join(', ')}.`);
      }

      const updatedPayload = settingsService.getAdminSettingsPayload(req);
      return res.json({
        success: true,
        changedFields,
        settings: updatedPayload,
      });
    } catch (err: any) {
      logger.error('[AdminSettings] Błąd zapisu ustawień administratora:', err?.message || err);
      return res.status(500).json({ error: 'Nie udało się zapisać ustawień administratora.' });
    }
  });

  // POST /api/admin/settings/smtp-test — wysyłka testowej wiadomości (limit 3/min)
  app.post('/api/admin/settings/smtp-test', requireAdmin, async (req, res) => {
    const caller = (req as any).user;
    const clientIp = getClientIp(req);
    const rateCheck = smtpTestLimiter.hit(`smtp_test:${caller.id}:${clientIp}`);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', rateCheck.retryAfterSeconds.toString());
      return res.status(429).json({
        error: 'Zbyt wiele prób wysyłki testowej wiadomości SMTP. Odczekaj minutę i spróbuj ponownie.',
        retryAfter: rateCheck.retryAfterSeconds,
      });
    }

    const rawTo = req.body?.to !== undefined ? String(req.body.to).trim() : String(caller.email || '').trim();
    if (!rawTo || !isValidEmail(rawTo)) {
      return res.status(400).json({
        error: 'Podaj prawidłowy adres e-mail odbiorcy wiadomości testowej.',
      });
    }

    if (!mailer.isMailConfigured()) {
      return res.status(400).json({
        error: 'Serwer SMTP nie jest skonfigurowany. Uzupełnij co najmniej adres serwera SMTP (host) i zapisz ustawienia.',
      });
    }

    const runtimeSmtp = settingsService.getRuntimeSmtpConfig();
    const userAgent = (req.headers['user-agent'] || '').slice(0, 100);
    const recipientDomain = rawTo.includes('@') ? rawTo.split('@')[1] : '';

    try {
      await mailer.sendMail({
        to: rawTo,
        subject: 'Wiadomość testowa SMTP — Zarządzanie Projektami',
        text: `To jest automatyczna wiadomość testowa z systemu Zarządzanie Projektami.\n\nKonfiguracja serwera SMTP (${runtimeSmtp.host}:${runtimeSmtp.port}) działa prawidłowo.`,
        html: `<div style="font-family: sans-serif; padding: 24px; color: #1e293b; max-width: 520px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #0284c7; margin-top: 0;">Zarządzanie Projektami — Test SMTP</h2>
          <p style="font-size: 14px; line-height: 1.5;">To jest automatyczna wiadomość testowa potwierdzająca prawidłową konfigurację serwera pocztowego SMTP.</p>
          <p style="font-size: 13px; color: #475569;">Połączenie przez serwer: <strong>${runtimeSmtp.host}:${runtimeSmtp.port}</strong></p>
        </div>`,
      });

      await securityLogger
        .record('smtp_test_sent', {
          userId: caller.id,
          ip: clientIp,
          userAgent,
          details: recipientDomain ? { recipientDomain } : undefined,
        })
        .catch(() => {});

      logger.info(`[AdminSettings] Administrator (${caller.id}) wysłał testową wiadomość SMTP.`);
      return res.json({
        success: true,
        message: `Wiadomość testowa została pomyślnie wysłana na adres ${rawTo}.`,
        to: rawTo,
      });
    } catch (err: any) {
      const friendlyError = formatSmtpErrorPolish(err, runtimeSmtp.password);
      await securityLogger
        .record('smtp_test_failed', {
          userId: caller.id,
          ip: clientIp,
          userAgent,
          details: { reason: friendlyError },
        })
        .catch(() => {});

      logger.warn(`[AdminSettings] Błąd wysyłki testowej SMTP (${caller.id}): ${friendlyError}`);
      return res.status(502).json({
        error: friendlyError,
      });
    }
  });
}
