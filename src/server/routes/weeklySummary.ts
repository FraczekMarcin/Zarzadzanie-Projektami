import express from 'express';
import { formatSmtpErrorPolish, MailerService } from '../mailer.js';
import { SecurityContext, getClientIp } from '../security.js';
import { SessionStore } from '../sessions.js';
import { SettingsService } from '../settings.js';
import { DISK_FULL_ERROR_MESSAGE, isDiskFullError } from '../state.js';
import { WeeklySummaryService } from '../weeklySummary.js';
import { logger } from '../logger.js';

export interface WeeklySummaryRoutesDeps {
  sessionStore: SessionStore;
  security: SecurityContext;
  settingsService: SettingsService;
  mailer: MailerService;
  weeklySummaryService: WeeklySummaryService;
}

export function registerWeeklySummaryRoutes(
  app: express.Express,
  deps: WeeklySummaryRoutesDeps
): void {
  const { sessionStore, security, settingsService, mailer, weeklySummaryService } = deps;
  const { requireAdmin } = sessionStore;
  const { weeklySummaryPreviewLimiter } = security;

  // GET /api/admin/weekly-summary/status — status harmonogramu i ostatniej wysyłki
  app.get('/api/admin/weekly-summary/status', requireAdmin, (_req, res) => {
    try {
      const status = weeklySummaryService.getStatus();
      res.json(status);
    } catch (err: any) {
      logger.error('[WeeklySummary] Błąd pobierania statusu podsumowania tygodniowego:', err?.message || err);
      res.status(500).json({ error: 'Nie udało się pobrać statusu podsumowania tygodniowego.' });
    }
  });

  // POST /api/admin/weekly-summary/preview — wysyłka podglądu wyłącznie do zalogowanego admina (maks. 3/godz.)
  app.post('/api/admin/weekly-summary/preview', requireAdmin, async (req, res) => {
    const caller = (req as any).user;
    const clientIp = getClientIp(req);
    const rateCheck = weeklySummaryPreviewLimiter.hit(
      `weekly_summary_preview:${caller.id}:${clientIp}`
    );
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', rateCheck.retryAfterSeconds.toString());
      return res.status(429).json({
        error: 'Przekroczono limit wysyłki podglądu podsumowania tygodniowego (maksymalnie 3 na godzinę).',
        retryAfter: rateCheck.retryAfterSeconds,
      });
    }

    if (!mailer.isMailConfigured()) {
      return res.status(400).json({
        error: 'Serwer SMTP nie jest skonfigurowany. Skonfiguruj i zapisz ustawienia SMTP przed wysłaniem podglądu.',
      });
    }

    try {
      const result = await weeklySummaryService.sendPreview(caller);
      return res.json({
        success: true,
        message: `Wysłano podgląd podsumowania tygodniowego na Twój adres e-mail (${result.to}).`,
        ...result,
      });
    } catch (err: any) {
      const smtpPass = settingsService.getRuntimeSmtpConfig().password;
      const friendlyError = formatSmtpErrorPolish(err, smtpPass);
      logger.warn(`[WeeklySummary] Błąd wysyłki podglądu (${caller.id}): ${friendlyError}`);
      return res.status(502).json({ error: friendlyError });
    }
  });

  // POST /api/admin/weekly-summary/run-now — ręczne wyzwolenie wysyłki podsumowania tygodniowego
  app.post('/api/admin/weekly-summary/run-now', requireAdmin, async (req, res) => {
    if (!mailer.isMailConfigured()) {
      return res.status(400).json({
        error: 'Serwer SMTP nie jest skonfigurowany. Skonfiguruj i zapisz ustawienia SMTP przed uruchomieniem wysyłki.',
      });
    }

    const force = Boolean(req.body?.force);
    try {
      const result = await weeklySummaryService.runNow({ force });
      return res.json({
        success: true,
        ...result,
        status: weeklySummaryService.getStatus(),
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[WeeklySummary] Błąd ręcznego uruchomienia wysyłki:', err?.message || err);
      return res.status(500).json({ error: 'Nie udało się uruchomić wysyłki podsumowania tygodniowego.' });
    }
  });
}
