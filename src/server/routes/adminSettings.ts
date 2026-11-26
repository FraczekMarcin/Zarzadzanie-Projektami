import express from 'express';
import { DEFAULT_PROJECT_TEMPLATES } from '../../data/defaultTemplates.js';
import { isSameOrigin } from '../../utils/access.js';
import { recomputeAllProjectsProgress } from '../../utils/progress.js';
import {
  findProjectSubtypeUsage,
  findProjectTypeUsage,
  normalizeProjectTypes,
} from '../../utils/projectMeta.js';
import { isValidEmail } from '../../utils/settingsSchema.js';
import { validateVariablesUpdate } from '../../utils/variablesSchema.js';
import { formatSmtpErrorPolish, MailerService } from '../mailer.js';
import {
  SecurityContext,
  getClientIp,
  verifyAndMigratePassword,
} from '../security.js';
import { SessionStore } from '../sessions.js';
import { SettingsService } from '../settings.js';
import { TrustedDevicesService } from '../trustedDevices.js';
import { DISK_FULL_ERROR_MESSAGE, isDiskFullError, StateStore } from '../state.js';
import { logger } from '../logger.js';

export interface AdminSettingsRoutesDeps {
  stateStore: StateStore;
  sessionStore: SessionStore;
  security: SecurityContext;
  settingsService: SettingsService;
  mailer: MailerService;
  trustedDevicesService: TrustedDevicesService;
}

export function registerAdminSettingsRoutes(
  app: express.Express,
  deps: AdminSettingsRoutesDeps
): void {
  const { stateStore, sessionStore, security, settingsService, mailer, trustedDevicesService } = deps;
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

        if (
          changedFields.includes('trustedDevices.enabled') &&
          !settingsService.getEffectiveTrustedDevicesSettings().enabled
        ) {
          const revokedCount = await trustedDevicesService.revokeAllDevicesGlobally();
          if (revokedCount > 0) {
            await securityLogger
              .record('device_revoked', {
                userId: caller.id,
                ip: clientIp,
                userAgent: (req.headers['user-agent'] || '').slice(0, 100),
                details: { reason: 'feature_disabled_by_admin', count: revokedCount },
              })
              .catch(() => {});
          }
        }
        if (changedFields.includes('progress.weighting')) {
          const appState = stateStore.ensureStateStructure();
          recomputeAllProjectsProgress(appState, {
            weighting: settingsService.getEffectiveProgressWeighting(),
          });
          stateStore.bumpStateRevision();
          await stateStore.saveStateAtomicAsync();
        }
      }

      const updatedPayload = settingsService.getAdminSettingsPayload(req);
      return res.json({
        success: true,
        changedFields,
        settings: updatedPayload,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
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

  // PUT /api/admin/variables — aktualizacja zmiennych systemowych (tylko admin, kontrola Origin)
  app.put('/api/admin/variables', requireAdmin, async (req, res) => {
    try {
      const originHeader = req.headers.origin;
      const rawOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
      if (rawOrigin && typeof rawOrigin === 'string' && rawOrigin.trim()) {
        let effectiveHost = '';
        if (req.app.get('trust proxy')) {
          const xfh = req.headers['x-forwarded-host'];
          if (xfh) {
            const rawXfh = Array.isArray(xfh) ? xfh[0] : xfh;
            if (typeof rawXfh === 'string' && rawXfh.trim()) {
              effectiveHost = rawXfh.split(',')[0].trim();
            }
          }
        }
        if (!effectiveHost) {
          const h = req.headers.host;
          const rawH = Array.isArray(h) ? h[0] : h;
          if (typeof rawH === 'string') {
            effectiveHost = rawH.trim();
          }
        }
        if (!isSameOrigin(rawOrigin, effectiveHost)) {
          await securityLogger
            .record('origin_blocked', {
              ip: getClientIp(req),
              userAgent: (req.headers['user-agent'] || '').slice(0, 100),
              details: { origin: String(rawOrigin).slice(0, 150), host: effectiveHost, path: req.path },
            })
            .catch(() => {});
          return res.status(403).json({ error: 'Niedozwolone źródło żądania' });
        }
      }

      const validation = validateVariablesUpdate(req.body);
      if (!validation.ok) {
        return res.status(400).json({
          error: validation.errors.join(' '),
          errors: validation.errors,
        });
      }

      const appState = stateStore.ensureStateStructure();
      const prevVariables = appState.variables;
      const projects = Array.isArray(appState.projects) ? appState.projects : [];

      if (validation.patch.projectStatuses) {
        const nextStatusIds = new Set(validation.patch.projectStatuses.map((s) => s.id));
        const prevStatuses = Array.isArray(prevVariables.projectStatuses)
          ? prevVariables.projectStatuses
          : [];
        for (const prevStatus of prevStatuses) {
          if (!nextStatusIds.has(prevStatus.id)) {
            const usingProjects = projects.filter((p: any) => p && p.status === prevStatus.id);
            if (usingProjects.length > 0) {
              const sample = usingProjects
                .slice(0, 5)
                .map((p: any) => `${p.key || p.id}${p.name ? ` (${p.name})` : ''}`)
                .join(', ');
              const suffix = usingProjects.length > 5 ? ` i ${usingProjects.length - 5} innych` : '';
              return res.status(409).json({
                error: `Nie można usunąć stanu projektu "${prevStatus.label}", ponieważ jest używany przez projekty: ${sample}${suffix}.`,
                field: 'projectStatuses',
                inUseProjects: usingProjects.map((p: any) => ({
                  id: p.id,
                  key: p.key || '',
                  name: p.name || '',
                })),
              });
            }
          }
        }
      }

      if (validation.patch.projectPriorities) {
        const nextPriorityIds = new Set(validation.patch.projectPriorities.map((p) => p.id));
        const prevPriorities = Array.isArray(prevVariables.projectPriorities)
          ? prevVariables.projectPriorities
          : [];
        for (const prevPriority of prevPriorities) {
          if (!nextPriorityIds.has(prevPriority.id)) {
            const usingProjects = projects.filter((p: any) => p && p.priority === prevPriority.id);
            if (usingProjects.length > 0) {
              const sample = usingProjects
                .slice(0, 5)
                .map((p: any) => `${p.key || p.id}${p.name ? ` (${p.name})` : ''}`)
                .join(', ');
              const suffix = usingProjects.length > 5 ? ` i ${usingProjects.length - 5} innych` : '';
              return res.status(409).json({
                error: `Nie można usunąć priorytetu projektu "${prevPriority.label}", ponieważ jest używany przez projekty: ${sample}${suffix}.`,
                field: 'projectPriorities',
                inUseProjects: usingProjects.map((p: any) => ({
                  id: p.id,
                  key: p.key || '',
                  name: p.name || '',
                })),
              });
            }
          }
        }
      }

      if (validation.patch.projectTypes) {
        const nextTypes = validation.patch.projectTypes;
        const nextTypeMap = new Map(nextTypes.map((t) => [t.id, t]));
        const prevTypes = normalizeProjectTypes(prevVariables.projectTypes);
        const customTemplates = Array.isArray(appState.projectTemplates) ? appState.projectTemplates : [];
        const allTemplates = [...customTemplates, ...DEFAULT_PROJECT_TEMPLATES];
        const tenders = Array.isArray(appState.tenders) ? appState.tenders : [];

        for (const prevType of prevTypes) {
          const nextType = nextTypeMap.get(prevType.id);
          if (!nextType) {
            const usage = findProjectTypeUsage(prevType.id, {
              projects,
              templates: allTemplates,
              tenders,
            });
            if (
              usage.projects.length > 0 ||
              usage.templates.length > 0 ||
              usage.positionsCount > 0
            ) {
              const parts: string[] = [];
              if (usage.projects.length > 0) {
                const sample = usage.projects
                  .slice(0, 5)
                  .map((p) => `${p.key || p.id}${p.name ? ` (${p.name})` : ''}`)
                  .join(', ');
                parts.push(
                  `projekty: ${sample}${usage.projects.length > 5 ? ` i ${usage.projects.length - 5} innych` : ''}`
                );
              }
              if (usage.templates.length > 0) {
                const sampleT = usage.templates
                  .slice(0, 5)
                  .map((t) => t.name)
                  .join(', ');
                parts.push(
                  `szablony: ${sampleT}${usage.templates.length > 5 ? ` i ${usage.templates.length - 5} innych` : ''}`
                );
              }
              if (usage.positionsCount > 0) {
                parts.push(`pozycje (${usage.positionsCount})`);
              }
              return res.status(409).json({
                error: `Nie można usunąć rodzaju projektu "${prevType.label}", ponieważ jest używany (${parts.join('; ')}).`,
                field: 'projectTypes',
                inUseProjects: usage.projects,
                inUseTemplates: usage.templates,
                positionsCount: usage.positionsCount,
              });
            }
          } else {
            const nextSubtypeIds = new Set((nextType.subtypes || []).map((s) => s.id));
            for (const prevSub of prevType.subtypes || []) {
              if (!nextSubtypeIds.has(prevSub.id)) {
                const usage = findProjectSubtypeUsage(prevType.id, prevSub.id, {
                  projects,
                  templates: allTemplates,
                  tenders,
                });
                if (
                  usage.projects.length > 0 ||
                  usage.templates.length > 0 ||
                  usage.positionsCount > 0
                ) {
                  const parts: string[] = [];
                  if (usage.projects.length > 0) {
                    const sample = usage.projects
                      .slice(0, 5)
                      .map((p) => `${p.key || p.id}${p.name ? ` (${p.name})` : ''}`)
                      .join(', ');
                    parts.push(
                      `projekty: ${sample}${usage.projects.length > 5 ? ` i ${usage.projects.length - 5} innych` : ''}`
                    );
                  }
                  if (usage.templates.length > 0) {
                    const sampleT = usage.templates
                      .slice(0, 5)
                      .map((t) => t.name)
                      .join(', ');
                    parts.push(
                      `szablony: ${sampleT}${usage.templates.length > 5 ? ` i ${usage.templates.length - 5} innych` : ''}`
                    );
                  }
                  if (usage.positionsCount > 0) {
                    parts.push(`pozycje (${usage.positionsCount})`);
                  }
                  return res.status(409).json({
                    error: `Nie można usunąć podrodzaju "${prevSub.label}" w rodzaju "${prevType.label}", ponieważ jest używany (${parts.join('; ')}).`,
                    field: 'projectTypes',
                    inUseProjects: usage.projects,
                    inUseTemplates: usage.templates,
                    positionsCount: usage.positionsCount,
                  });
                }
              }
            }
          }
        }
      }

      const nextVariables = {
        ...prevVariables,
        ...validation.patch,
        initialized: true,
      };

      const changedSections: string[] = [];
      for (const key of [
        'vatRates',
        'clients',
        'taskTypes',
        'projectStatuses',
        'projectPriorities',
        'projectTypes',
        'deadlineWarningDays',
      ] as const) {
        if (
          validation.patch[key] !== undefined &&
          JSON.stringify(prevVariables[key]) !== JSON.stringify(nextVariables[key])
        ) {
          changedSections.push(key);
        }
      }

      appState.variables = nextVariables;
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      const caller = (req as any).user;
      const clientIp = getClientIp(req);
      if (changedSections.length > 0) {
        await securityLogger
          .record('variables_changed', {
            userId: caller.id,
            ip: clientIp,
            userAgent: (req.headers['user-agent'] || '').slice(0, 100),
            details: { sections: changedSections },
          })
          .catch(() => {});
        logger.info(
          `[AdminVariables] Administrator (${caller.id}) zmienił sekcje zmiennych systemowych: ${changedSections.join(', ')}.`
        );
      }

      return res.json({
        success: true,
        revision: newRev,
        variables: nextVariables,
        changedSections,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[AdminVariables] Błąd zapisu zmiennych systemowych:', err?.message || err);
      return res.status(500).json({ error: 'Nie udało się zapisać zmiennych systemowych.' });
    }
  });
}
