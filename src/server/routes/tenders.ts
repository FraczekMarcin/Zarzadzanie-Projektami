import express from 'express';
import { filterProjectForUser, hasForbiddenKeys } from '../../utils/access.js';
import {
  buildProjectFromTender,
  computeTenderSummary,
  filterTenders,
  isValidIsoDate,
  MAX_TENDERS,
  sortTenders,
  TENDER_SORT_KEYS,
  TenderSortKey,
  TenderSortOrder,
  toTenderDetail,
  validateTenderWritePayload,
} from '../../utils/tenders.js';
import crypto from 'crypto';
import type { ProjectTemplate, Task, Tender } from '../../types/index.js';
import { normalizeProgressWeighting, recomputeProjectProgress } from '../../utils/progress.js';
import {
  instantiateTemplateForProject,
  resolveTemplateById,
} from '../../utils/templateInstantiation.js';
import { getClientIp, SecurityContext } from '../security.js';
import { DISK_FULL_ERROR_MESSAGE, isDiskFullError, StateStore } from '../state.js';
import { SessionStore } from '../sessions.js';
import { logger } from '../logger.js';

function isTenderRoleAuthorized(user: { role?: string } | null | undefined): boolean {
  return Boolean(user && (user.role === 'admin' || user.role === 'project_manager'));
}

function parseOptionalPriceFilter(raw: unknown, fieldName: string): { ok: true; value?: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true };
  const str = String(raw).trim();
  if (!str) return { ok: true };
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0) {
    return { ok: false, error: `Nieprawidłowa wartość parametru ${fieldName}.` };
  }
  return { ok: true, value: num };
}

export function registerTenderRoutes(
  app: express.Express,
  deps: {
    stateStore: StateStore;
    sessionStore: SessionStore;
    security: SecurityContext;
  }
): void {
  const { stateStore, sessionStore, security } = deps;
  const { requireAuth } = sessionStore;
  const { tenderWriteLimiter } = security;
  const { securityLogger } = stateStore;

  // Kolejka serializująca tworzenie projektów z przetargu (ochrona przed wyścigiem numeracji RRRR-X_L i duplikacją)
  let createProjectQueue: Promise<void> = Promise.resolve();
  function withCreateProjectLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = createProjectQueue.then(fn, fn);
    createProjectQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function checkWriteRateLimit(caller: { id: string }, res: express.Response): boolean {
    const rateCheck = tenderWriteLimiter.hit(caller.id);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
      res.status(429).json({
        error: 'Przekroczono limit zapisów przetargów (maks. 60 żądań na godzinę). Spróbuj ponownie później.',
        retryAfter: rateCheck.retryAfterSeconds,
      });
      return false;
    }
    return true;
  }

  // GET /api/tenders
  app.get('/api/tenders', requireAuth, (req, res) => {
    try {
      const caller = (req as any).user;
      if (!isTenderRoleAuthorized(caller)) {
        return res.status(403).json({
          error: 'Dostęp do przetargów wymaga roli administratora lub kierownika projektu.',
        });
      }

      const appState = stateStore.ensureStateStructure();
      const tenders: Tender[] = Array.isArray(appState.tenders) ? appState.tenders : [];

      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const authority = typeof req.query.authority === 'string' ? req.query.authority : undefined;
      const status = typeof req.query.status === 'string' && req.query.status.trim()
        ? req.query.status.trim()
        : undefined;

      const rawFrom = typeof req.query.from === 'string' ? req.query.from.trim() : '';
      const rawTo = typeof req.query.to === 'string' ? req.query.to.trim() : '';
      if (rawFrom && !isValidIsoDate(rawFrom)) {
        return res.status(400).json({ error: 'Nieprawidłowy format daty "from" (oczekiwano RRRR-MM-DD).' });
      }
      if (rawTo && !isValidIsoDate(rawTo)) {
        return res.status(400).json({ error: 'Nieprawidłowy format daty "to" (oczekiwano RRRR-MM-DD).' });
      }

      const ourOnly = req.query.ourOnly === 'true' || req.query.ourOnly === '1';
      const won = req.query.won === 'true' || req.query.won === '1';

      const minPriceRes = parseOptionalPriceFilter(req.query.minPrice, 'minPrice');
      if (!minPriceRes.ok) {
        return res.status(400).json({ error: minPriceRes.error });
      }
      const maxPriceRes = parseOptionalPriceFilter(req.query.maxPrice, 'maxPrice');
      if (!maxPriceRes.ok) {
        return res.status(400).json({ error: maxPriceRes.error });
      }

      const rawSort = typeof req.query.sort === 'string' ? req.query.sort.trim() : '';
      let sort: TenderSortKey = 'resolutionDate';
      if (rawSort) {
        if (!TENDER_SORT_KEYS.includes(rawSort as TenderSortKey)) {
          return res.status(400).json({ error: `Nieprawidłowy klucz sortowania "${rawSort}".` });
        }
        sort = rawSort as TenderSortKey;
      }

      const rawOrder = typeof req.query.order === 'string' ? req.query.order.trim().toLowerCase() : '';
      let order: TenderSortOrder = 'desc';
      if (rawOrder) {
        if (rawOrder !== 'asc' && rawOrder !== 'desc') {
          return res.status(400).json({ error: 'Nieprawidłowy kierunek sortowania (dozwolone: asc, desc).' });
        }
        order = rawOrder as TenderSortOrder;
      }

      const parsedPage = parseInt(String(req.query.page ?? '1'), 10);
      const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;

      const parsedPageSize = parseInt(String(req.query.pageSize ?? '25'), 10);
      const pageSize = Number.isNaN(parsedPageSize)
        ? 25
        : Math.min(Math.max(parsedPageSize, 1), 100);

      const filtered = filterTenders(tenders, {
        q,
        authority,
        status,
        from: rawFrom || undefined,
        to: rawTo || undefined,
        ourOnly,
        won,
        minPrice: minPriceRes.value,
        maxPrice: maxPriceRes.value,
      });

      const sorted = sortTenders(filtered, sort, order);
      const summary = computeTenderSummary(sorted);
      const total = sorted.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const offset = (page - 1) * pageSize;
      const items = sorted.slice(offset, offset + pageSize);

      return res.json({
        items,
        total,
        page,
        pageSize,
        totalPages,
        summary,
      });
    } catch (err: any) {
      logger.error('[Tenders] Błąd pobierania listy przetargów:', err?.message || err);
      return res.status(500).json({ error: 'Nie udało się pobrać listy przetargów.' });
    }
  });

  // GET /api/tenders/:id
  app.get('/api/tenders/:id', requireAuth, (req, res) => {
    try {
      const caller = (req as any).user;
      if (!isTenderRoleAuthorized(caller)) {
        return res.status(403).json({
          error: 'Dostęp do przetargów wymaga roli administratora lub kierownika projektu.',
        });
      }

      const appState = stateStore.ensureStateStructure();
      const tenders: Tender[] = Array.isArray(appState.tenders) ? appState.tenders : [];
      const tender = tenders.find((t) => t && t.id === req.params.id);
      if (!tender) {
        return res.status(404).json({ error: `Przetarg o ID "${req.params.id}" nie został znaleziony.` });
      }

      return res.json({ tender: toTenderDetail(tender) });
    } catch (err: any) {
      logger.error('[Tenders] Błąd pobierania szczegółów przetargu:', err?.message || err);
      return res.status(500).json({ error: 'Nie udało się pobrać szczegółów przetargu.' });
    }
  });

  // POST /api/tenders
  app.post('/api/tenders', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      if (!isTenderRoleAuthorized(caller)) {
        return res.status(403).json({
          error: 'Tworzenie przetargów wymaga roli administratora lub kierownika projektu.',
        });
      }
      if (!checkWriteRateLimit(caller, res)) {
        return;
      }
      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const appState = stateStore.ensureStateStructure();
      const tenders: Tender[] = Array.isArray(appState.tenders) ? appState.tenders : [];
      if (tenders.length >= MAX_TENDERS) {
        return res.status(400).json({
          error: `Osiągnięto maksymalny limit ${MAX_TENDERS} przetargów.`,
        });
      }

      const validation = validateTenderWritePayload(req.body || {}, {
        mode: 'create',
        companies: appState.companies || [],
        callerId: caller.id,
      });

      if (!validation.ok || !validation.tender) {
        return res.status(400).json({
          error: validation.error || 'Nieprawidłowe dane przetargu.',
          ...(validation.field ? { field: validation.field } : {}),
        });
      }

      tenders.push(validation.tender);
      appState.tenders = tenders;

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('tender_created', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { tenderId: validation.tender.id, name: validation.tender.name },
        })
        .catch(() => {});

      return res.status(201).json({
        success: true,
        tender: toTenderDetail(validation.tender),
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Tenders] Błąd tworzenia przetargu:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się utworzyć przetargu.' });
    }
  });

  // PATCH /api/tenders/:id
  app.patch('/api/tenders/:id', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      if (!isTenderRoleAuthorized(caller)) {
        return res.status(403).json({
          error: 'Edycja przetargów wymaga roli administratora lub kierownika projektu.',
        });
      }
      if (!checkWriteRateLimit(caller, res)) {
        return;
      }
      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const appState = stateStore.ensureStateStructure();
      const tenders: Tender[] = Array.isArray(appState.tenders) ? appState.tenders : [];
      const index = tenders.findIndex((t) => t && t.id === req.params.id);
      if (index === -1) {
        return res.status(404).json({ error: `Przetarg o ID "${req.params.id}" nie został znaleziony.` });
      }

      const existing = tenders[index];
      const patch = req.body || {};

      const rawIfMatch =
        req.headers['if-match'] ||
        (patch.expectedRevision !== undefined ? String(patch.expectedRevision) : null);
      if (rawIfMatch) {
        const cleanMatch = String(rawIfMatch).replace(/["W\/]/g, '').trim();
        const currentRev = String(existing.revision !== undefined ? existing.revision : 1);
        if (cleanMatch !== '*' && cleanMatch !== currentRev) {
          return res.status(409).json({
            error: 'Konflikt wersji przetargu (został zmodyfikowany przez innego użytkownika).',
            currentTender: toTenderDetail(existing),
            revision: appState.revision,
          });
        }
      }

      const validation = validateTenderWritePayload(patch, {
        mode: 'update',
        existingTender: existing,
        companies: appState.companies || [],
        callerId: caller.id,
      });

      if (!validation.ok || !validation.tender) {
        return res.status(400).json({
          error: validation.error || 'Nieprawidłowe dane aktualizacji przetargu.',
          ...(validation.field ? { field: validation.field } : {}),
        });
      }

      tenders[index] = validation.tender;
      appState.tenders = tenders;

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('tender_updated', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: {
            tenderId: validation.tender.id,
            changedFields: validation.changedFields || [],
          },
        })
        .catch(() => {});

      return res.json({
        success: true,
        tender: toTenderDetail(validation.tender),
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Tenders] Błąd aktualizacji przetargu:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się zaktualizować przetargu.' });
    }
  });

  // DELETE /api/tenders/:id
  app.delete('/api/tenders/:id', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      if (!isTenderRoleAuthorized(caller)) {
        return res.status(403).json({
          error: 'Usuwanie przetargów wymaga roli administratora lub kierownika projektu.',
        });
      }
      if (!checkWriteRateLimit(caller, res)) {
        return;
      }
      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const appState = stateStore.ensureStateStructure();
      const tenders: Tender[] = Array.isArray(appState.tenders) ? appState.tenders : [];
      const index = tenders.findIndex((t) => t && t.id === req.params.id);
      if (index === -1) {
        return res.status(404).json({ error: `Przetarg o ID "${req.params.id}" nie został znaleziony.` });
      }

      const tender = tenders[index];
      if (caller.role !== 'admin' && tender.createdBy !== caller.id) {
        return res.status(403).json({
          error: 'Usunięcie przetargu jest dozwolone wyłącznie dla administratora lub autora przetargu.',
        });
      }

      if (req.body?.confirm !== true) {
        return res.status(400).json({
          error: 'Wymagane wyraźne potwierdzenie usunięcia przetargu (confirm: true).',
        });
      }

      tenders.splice(index, 1);
      appState.tenders = tenders;

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('tender_deleted', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { tenderId: tender.id, name: tender.name },
        })
        .catch(() => {});

      return res.json({
        success: true,
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Tenders] Błąd usuwania przetargu:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się usunąć przetargu.' });
    }
  });

  // POST /api/tenders/:id/create-project
  app.post('/api/tenders/:id/create-project', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      if (!isTenderRoleAuthorized(caller)) {
        return res.status(403).json({
          error: 'Utworzenie projektu z przetargu wymaga roli administratora lub kierownika projektu.',
        });
      }
      if (!checkWriteRateLimit(caller, res)) {
        return;
      }
      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const outcome = await withCreateProjectLock(async () => {
        const appState = stateStore.ensureStateStructure();
        const tenders: Tender[] = Array.isArray(appState.tenders) ? appState.tenders : [];
        const tender = tenders.find((t) => t && t.id === req.params.id);
        if (!tender) {
          return { status: 404, payload: { error: `Przetarg o ID "${req.params.id}" nie został znaleziony.` } };
        }

        const rawBody = req.body || {};
        const hasTemplateParam =
          rawBody.templateId !== undefined &&
          rawBody.templateId !== null &&
          rawBody.templateId !== '';
        let resolvedTemplate: ProjectTemplate | undefined;
        if (hasTemplateParam) {
          if (typeof rawBody.templateId !== 'string' || !rawBody.templateId.trim()) {
            return {
              status: 400,
              payload: { error: 'Nieprawidłowy identyfikator szablonu (templateId).' },
            };
          }
          resolvedTemplate = resolveTemplateById(appState, rawBody.templateId.trim());
          if (!resolvedTemplate) {
            return {
              status: 404,
              payload: { error: `Szablon o ID "${rawBody.templateId.trim()}" nie został znaleziony.` },
            };
          }
        }

        const buildResult = buildProjectFromTender({
          tender,
          callerId: caller.id,
          projects: appState.projects || [],
          trashedProjects: appState.trash || [],
          companies: appState.companies || [],
          projectNumberingScope:
            appState.projectNumbering?.scope === 'company' ? 'company' : 'year',
          defaultCompanyId: appState.projectNumbering?.defaultCompanyId,
          vatRates: appState.variables?.vatRates,
          projectStatuses: appState.variables?.projectStatuses,
          projectPriorities: appState.variables?.projectPriorities,
          projectTypes: appState.variables?.projectTypes,
          body: rawBody,
          templateDurationDays: resolvedTemplate?.defaultDurationDays,
          templateTypeId: resolvedTemplate?.typeId,
          templateDeliverables: resolvedTemplate?.deliverables,
        });

        if (!buildResult.ok) {
          return {
            status: buildResult.status,
            payload: {
              error: buildResult.error,
              ...(buildResult.extra || {}),
            },
          };
        }

        const nowIso = new Date().toISOString();
        let instantiatedTasks: Task[] = [];
        if (resolvedTemplate) {
          const instRes = instantiateTemplateForProject({
            template: resolvedTemplate,
            project: {
              id: buildResult.project.id,
              key: buildResult.project.key,
              startDate: buildResult.project.startDate,
              ownerId: buildResult.project.ownerId,
            },
            caller,
            templateTaskKeys: rawBody.templateTaskKeys,
            existingProjectTasksCount: 0,
            nowIso,
          });
          if (!instRes.ok) {
            return { status: instRes.status, payload: { error: instRes.error } };
          }
          instantiatedTasks = instRes.tasks;
        }

        const prevProjects = Array.isArray(appState.projects) ? [...appState.projects] : [];
        const prevTasks = Array.isArray(appState.tasks) ? [...appState.tasks] : [];
        const prevLogs = Array.isArray(appState.activityLogs) ? [...appState.activityLogs] : [];
        const prevTenderSnapshot = {
          linkedProjectId: tender.linkedProjectId,
          revision: tender.revision,
          updatedAt: tender.updatedAt,
        };
        const prevRev = appState.revision || 0;

        let newRev: number;
        try {
          if (!Array.isArray(appState.projects)) {
            appState.projects = [];
          }
          appState.projects.push(buildResult.project);
          if (instantiatedTasks.length > 0) {
            if (!Array.isArray(appState.tasks)) {
              appState.tasks = [];
            }
            appState.tasks = [...instantiatedTasks, ...appState.tasks];
          }

          recomputeProjectProgress(appState, buildResult.project.id, {
            weighting: normalizeProgressWeighting(appState.progressWeighting),
          });

          if (resolvedTemplate) {
            if (!Array.isArray(appState.activityLogs)) {
              appState.activityLogs = [];
            }
            const actorName = caller?.name || caller?.email || caller?.id || 'Użytkownik';
            const deadlineCount = instantiatedTasks.filter((t) => t.isOfficialDeadline).length;
            appState.activityLogs.unshift({
              id: `act-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
              projectId: buildResult.project.id,
              userId: caller.id,
              action: `${actorName} utworzył projekt [${buildResult.project.key}] z przetargu z szablonu "${resolvedTemplate.name}" (${instantiatedTasks.length} zadań)`,
              timestamp: nowIso,
              details: `Wygenerowano ${instantiatedTasks.length} zadań (terminy urzędowe: ${deadlineCount}).`,
            });
            if (appState.activityLogs.length > 500) {
              appState.activityLogs = appState.activityLogs.slice(0, 500);
            }
          }

          tender.linkedProjectId = buildResult.project.id;
          tender.revision = (tender.revision || 1) + 1;
          tender.updatedAt = nowIso;

          newRev = stateStore.bumpStateRevision();
          await stateStore.saveStateAtomicAsync();
        } catch (saveErr) {
          appState.projects = prevProjects;
          appState.tasks = prevTasks;
          appState.activityLogs = prevLogs;
          tender.linkedProjectId = prevTenderSnapshot.linkedProjectId;
          tender.revision = prevTenderSnapshot.revision;
          tender.updatedAt = prevTenderSnapshot.updatedAt;
          appState.revision = prevRev;
          throw saveErr;
        }

        await securityLogger
          .record('tender_project_created', {
            userId: caller.id,
            ip: getClientIp(req),
            userAgent: (req.headers['user-agent'] || '').slice(0, 100),
            details: {
              tenderId: tender.id,
              projectId: buildResult.project.id,
              projectKey: buildResult.project.key,
              ...(resolvedTemplate ? { templateId: resolvedTemplate.id, tasksCount: instantiatedTasks.length } : {}),
            },
          })
          .catch(() => {});

        const successMessage = resolvedTemplate
          ? `Utworzono projekt ${buildResult.project.key} z szablonu "${resolvedTemplate.name}" (${instantiatedTasks.length} zadań).`
          : `Utworzono projekt ${buildResult.project.key}.`;

        return {
          status: 201,
          payload: {
            success: true,
            project: filterProjectForUser(buildResult.project, caller),
            tender: toTenderDetail(tender),
            ...(resolvedTemplate ? { tasks: instantiatedTasks } : {}),
            message: successMessage,
            revision: newRev,
          },
        };
      });

      return res.status(outcome.status).json(outcome.payload);
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Tenders] Błąd tworzenia projektu z przetargu:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się utworzyć projektu z przetargu.' });
    }
  });
}
