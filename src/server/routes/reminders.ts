import express from 'express';
import { formatSmtpErrorPolish, MailerService } from '../mailer.js';
import { ReminderService } from '../reminders.js';
import { SecurityContext, getClientIp } from '../security.js';
import { SessionStore } from '../sessions.js';
import { SettingsService } from '../settings.js';
import { logger } from '../logger.js';

export interface ReminderRoutesDeps {
  sessionStore: SessionStore;
  security: SecurityContext;
  settingsService: SettingsService;
  mailer: MailerService;
  reminderService: ReminderService;
}

export function registerReminderRoutes(
  app: express.Express,
  deps: ReminderRoutesDeps
): void {
  const { sessionStore, security, settingsService, mailer, reminderService } = deps;
  const { requireAdmin } = sessionStore;
  const { remindersPreviewLimiter } = security;

  // GET /api/admin/reminders/status — status harmonogramu i ostatniej wysyłki
  app.get('/api/admin/reminders/status', requireAdmin, (_req, res) => {
    try {
      const status = reminderService.getStatus();
      res.json(status);
    } catch (err: any) {
      logger.error('[Reminders] Błąd pobierania statusu przypomnień:', err?.message || err);
      res.status(500).json({ error: 'Nie udało się pobrać statusu przypomnień.' });
    }
  });

  // POST /api/admin/reminders/preview — wysyłka podglądu wyłącznie do zalogowanego admina (maks. 3/godz.)
  app.post('/api/admin/reminders/preview', requireAdmin, async (req, res) => {
    const caller = (req as any).user;
    const clientIp = getClientIp(req);
    const rateCheck = remindersPreviewLimiter.hit(`reminders_preview:${caller.id}:${clientIp}`);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', rateCheck.retryAfterSeconds.toString());
      return res.status(429).json({
        error: 'Przekroczono limit wysyłki podglądu przypomnień (maksymalnie 3 na godzinę).',
        retryAfter: rateCheck.retryAfterSeconds,
      });
    }

    if (!mailer.isMailConfigured()) {
      return res.status(400).json({
        error: 'Serwer SMTP nie jest skonfigurowany. Skonfiguruj i zapisz ustawienia SMTP przed wysłaniem podglądu.',
      });
    }

    try {
      const result = await reminderService.sendPreview(caller);
      return res.json({
        success: true,
        message: `Wysłano wiadomość podglądu na Twój adres e-mail (${result.to}).`,
        ...result,
      });
    } catch (err: any) {
      const smtpPass = settingsService.getRuntimeSmtpConfig().password;
      const friendlyError = formatSmtpErrorPolish(err, smtpPass);
      logger.warn(`[Reminders] Błąd wysyłki podglądu przypomnień (${caller.id}): ${friendlyError}`);
      return res.status(502).json({ error: friendlyError });
    }
  });

  // POST /api/admin/reminders/run-now — ręczne wyzwolenie wysyłki przypomnień
  app.post('/api/admin/reminders/run-now', requireAdmin, async (req, res) => {
    if (!mailer.isMailConfigured()) {
      return res.status(400).json({
        error: 'Serwer SMTP nie jest skonfigurowany. Skonfiguruj i zapisz ustawienia SMTP przed uruchomieniem wysyłki.',
      });
    }

    const force = Boolean(req.body?.force);
    try {
      const result = await reminderService.runNow({ force });
      return res.json({
        success: true,
        ...result,
        status: reminderService.getStatus(),
      });
    } catch (err: any) {
      logger.error('[Reminders] Błąd ręcznego uruchomienia wysyłki przypomnień:', err?.message || err);
      return res.status(500).json({ error: 'Nie udało się uruchomić wysyłki przypomnień.' });
    }
  });
}
