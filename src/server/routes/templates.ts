import express from 'express';
import crypto from 'crypto';
import type { Project, ProjectTemplate, Task } from '../../types/index.js';
import { DEFAULT_PROJECT_TEMPLATES } from '../../data/defaultTemplates.js';
import { canWrite, hasForbiddenKeys } from '../../utils/access.js';
import {
  MAX_CUSTOM_TEMPLATES,
  TEMPLATE_LIMITS,
  buildTemplateFromProject,
  toTemplateSummary,
  validateTemplateWritePayload,
} from '../../utils/templateValidation.js';
import { getClientIp } from '../security.js';
import { DISK_FULL_ERROR_MESSAGE, isDiskFullError, StateStore } from '../state.js';
import { SessionStore } from '../sessions.js';
import { logger } from '../logger.js';

function cloneTemplate(tpl: ProjectTemplate): ProjectTemplate {
  return {
    ...tpl,
    tasks: (tpl.tasks || []).map((t) => ({
      ...t,
      ...(t.tags ? { tags: [...t.tags] } : {}),
      ...(t.blockerKeys ? { blockerKeys: [...t.blockerKeys] } : {}),
    })),
  };
}

function buildDuplicateName(sourceName: string, requestedName: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (requestedName !== undefined && requestedName !== null && requestedName !== '') {
    if (typeof requestedName !== 'string') {
      return { ok: false, error: 'Nazwa szablonu musi być tekstem.' };
    }
    const trimmed = requestedName.trim();
    if (!trimmed) {
      return { ok: false, error: 'Nazwa szablonu nie może być pusta.' };
    }
    if (trimmed.length > TEMPLATE_LIMITS.name) {
      return { ok: false, error: `Nazwa szablonu nie może przekraczać ${TEMPLATE_LIMITS.name} znaków.` };
    }
    return { ok: true, name: trimmed };
  }
  const suffix = ' (kopia)';
  const baseMax = TEMPLATE_LIMITS.name - suffix.length;
  const base = sourceName.trim().slice(0, baseMax);
  return { ok: true, name: `${base}${suffix}` };
}

export function registerTemplateRoutes(
  app: express.Express,
  deps: { stateStore: StateStore; sessionStore: SessionStore }
): void {
  const { stateStore, sessionStore } = deps;
  const { requireAuth } = sessionStore;
  const { securityLogger } = stateStore;

  const builtInById = new Map<string, ProjectTemplate>(
    DEFAULT_PROJECT_TEMPLATES.map((tpl) => [tpl.id, tpl])
  );

  // GET /api/templates — metadane szablonów dla zalogowanych użytkowników mogących tworzyć projekty
  app.get('/api/templates', requireAuth, (req, res) => {
    const caller = (req as any).user;
    if (!canWrite(caller)) {
      return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
    }

    const appState = stateStore.ensureStateStructure();
    const customTemplates: ProjectTemplate[] = Array.isArray(appState.projectTemplates)
      ? appState.projectTemplates
      : [];

    const customSummaries = customTemplates.map((t) =>
      toTemplateSummary({ ...t, isCustom: true, builtIn: false })
    );
    const builtInSummaries = DEFAULT_PROJECT_TEMPLATES.map((t) =>
      toTemplateSummary({ ...t, isCustom: false, builtIn: true })
    );

    return res.json({
      templates: [...customSummaries, ...builtInSummaries],
    });
  });

  // GET /api/templates/:id — pełny szablon wraz z listą zadań
  app.get('/api/templates/:id', requireAuth, (req, res) => {
    const caller = (req as any).user;
    if (!canWrite(caller)) {
      return res.status(403).json({ error: 'Rola viewer posiada dostęp wyłącznie do odczytu.' });
    }

    const builtIn = builtInById.get(req.params.id);
    if (builtIn) {
      return res.json({ template: cloneTemplate({ ...builtIn, builtIn: true, isCustom: false }) });
    }

    const appState = stateStore.ensureStateStructure();
    const customTemplates: ProjectTemplate[] = Array.isArray(appState.projectTemplates)
      ? appState.projectTemplates
      : [];
    const custom = customTemplates.find((t) => t && t.id === req.params.id);
    if (!custom) {
      return res.status(404).json({ error: `Szablon o ID "${req.params.id}" nie został znaleziony.` });
    }

    return res.json({
      template: cloneTemplate({ ...custom, builtIn: false, isCustom: true }),
    });
  });

  // POST /api/templates — utworzenie nowego własnego szablonu (tylko admin)
  app.post('/api/templates', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      if (caller.role !== 'admin') {
        return res.status(403).json({
          error: 'Tworzenie szablonów projektów jest dozwolone wyłącznie dla Administratora.',
        });
      }
      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const appState = stateStore.ensureStateStructure();
      const customTemplates: ProjectTemplate[] = Array.isArray(appState.projectTemplates)
        ? appState.projectTemplates
        : [];
      if (customTemplates.length >= MAX_CUSTOM_TEMPLATES) {
        return res.status(400).json({
          error: `Osiągnięto maksymalny limit ${MAX_CUSTOM_TEMPLATES} własnych szablonów projektów.`,
        });
      }

      const validation = validateTemplateWritePayload(req.body);
      if (!validation.ok) {
        return res.status(400).json({
          error: validation.error,
          ...(validation.field ? { field: validation.field } : {}),
        });
      }

      const nowIso = new Date().toISOString();
      const newTemplate: ProjectTemplate = {
        id: `tpl-${crypto.randomUUID()}`,
        ...validation.data,
        isCustom: true,
        builtIn: false,
        revision: 1,
        createdBy: caller.id,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      customTemplates.unshift(newTemplate);
      appState.projectTemplates = customTemplates;

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('template_created', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: {
            templateId: newTemplate.id,
            name: newTemplate.name,
            taskCount: newTemplate.tasks.length,
          },
        })
        .catch(() => {});

      return res.status(201).json({
        success: true,
        template: cloneTemplate(newTemplate),
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Templates] Błąd tworzenia szablonu:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się utworzyć szablonu projektu.' });
    }
  });

  // POST /api/templates/from-project/:projectId — utworzenie szablonu z istniejącego projektu (tylko admin)
  app.post('/api/templates/from-project/:projectId', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      if (caller.role !== 'admin') {
        return res.status(403).json({
          error: 'Tworzenie szablonów z projektów jest dozwolone wyłącznie dla Administratora.',
        });
      }
      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const appState = stateStore.ensureStateStructure();
      const customTemplates: ProjectTemplate[] = Array.isArray(appState.projectTemplates)
        ? appState.projectTemplates
        : [];
      if (customTemplates.length >= MAX_CUSTOM_TEMPLATES) {
        return res.status(400).json({
          error: `Osiągnięto maksymalny limit ${MAX_CUSTOM_TEMPLATES} własnych szablonów projektów.`,
        });
      }

      const projects: Project[] = Array.isArray(appState.projects) ? appState.projects : [];
      const project = projects.find((p) => p && p.id === req.params.projectId);
      if (!project) {
        return res.status(404).json({
          error: `Projekt o ID "${req.params.projectId}" nie został znaleziony.`,
        });
      }

      const allTasks: Task[] = Array.isArray(appState.tasks) ? appState.tasks : [];
      const projectTasks = allTasks.filter((t) => t && t.projectId === project.id);

      const buildResult = buildTemplateFromProject({
        project,
        projectTasks,
        body: req.body || {},
        callerId: caller.id,
        templateId: `tpl-${crypto.randomUUID()}`,
      });

      if (!buildResult.ok) {
        return res.status(buildResult.status).json({
          error: buildResult.error,
          ...(buildResult.field ? { field: buildResult.field } : {}),
        });
      }

      const createdTemplate: ProjectTemplate = {
        ...buildResult.template,
        revision: 1,
      };
      customTemplates.unshift(createdTemplate);
      appState.projectTemplates = customTemplates;

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('template_created', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: {
            templateId: buildResult.template.id,
            name: buildResult.template.name,
            sourceProjectId: project.id,
            taskCount: buildResult.template.tasks.length,
          },
        })
        .catch(() => {});

      return res.status(201).json({
        success: true,
        template: cloneTemplate(buildResult.template),
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Templates] Błąd tworzenia szablonu z projektu:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się utworzyć szablonu z projektu.' });
    }
  });

  // POST /api/templates/:id/duplicate — duplikacja dowolnego szablonu (także wbudowanego) (tylko admin)
  app.post('/api/templates/:id/duplicate', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      if (caller.role !== 'admin') {
        return res.status(403).json({
          error: 'Duplikowanie szablonów projektów jest dozwolone wyłącznie dla Administratora.',
        });
      }
      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const appState = stateStore.ensureStateStructure();
      const customTemplates: ProjectTemplate[] = Array.isArray(appState.projectTemplates)
        ? appState.projectTemplates
        : [];
      if (customTemplates.length >= MAX_CUSTOM_TEMPLATES) {
        return res.status(400).json({
          error: `Osiągnięto maksymalny limit ${MAX_CUSTOM_TEMPLATES} własnych szablonów projektów.`,
        });
      }

      const source =
        builtInById.get(req.params.id) ||
        customTemplates.find((t) => t && t.id === req.params.id);
      if (!source) {
        return res.status(404).json({ error: `Szablon o ID "${req.params.id}" nie został znaleziony.` });
      }

      const nameRes = buildDuplicateName(source.name, req.body?.name);
      if (!nameRes.ok) {
        return res.status(400).json({ error: nameRes.error, field: 'name' });
      }

      const nowIso = new Date().toISOString();
      const cloned = cloneTemplate(source);
      const duplicated: ProjectTemplate = {
        ...cloned,
        id: `tpl-${crypto.randomUUID()}`,
        name: nameRes.name,
        isCustom: true,
        builtIn: false,
        revision: 1,
        createdBy: caller.id,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      customTemplates.unshift(duplicated);
      appState.projectTemplates = customTemplates;

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('template_created', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: {
            templateId: duplicated.id,
            name: duplicated.name,
            duplicatedFrom: source.id,
            taskCount: duplicated.tasks.length,
          },
        })
        .catch(() => {});

      return res.status(201).json({
        success: true,
        template: cloneTemplate(duplicated),
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Templates] Błąd duplikowania szablonu:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się zduplikować szablonu.' });
    }
  });

  // PUT /api/templates/:id — aktualizacja własnego szablonu (tylko admin, wbudowane są tylko do odczytu)
  app.put('/api/templates/:id', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      if (caller.role !== 'admin') {
        return res.status(403).json({
          error: 'Edycja szablonów projektów jest dozwolona wyłącznie dla Administratora.',
        });
      }
      if (builtInById.has(req.params.id)) {
        return res.status(403).json({
          error: 'Wbudowane szablony projektów są tylko do odczytu. Aby je zmodyfikować, zduplikuj szablon.',
        });
      }
      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const appState = stateStore.ensureStateStructure();
      const customTemplates: ProjectTemplate[] = Array.isArray(appState.projectTemplates)
        ? appState.projectTemplates
        : [];
      const idx = customTemplates.findIndex((t) => t && t.id === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ error: `Szablon o ID "${req.params.id}" nie został znaleziony.` });
      }

      const existing = customTemplates[idx];
      const rawIfMatch =
        req.headers['if-match'] ||
        (req.body?.expectedRevision !== undefined ? String(req.body.expectedRevision) : null);
      if (rawIfMatch !== null && rawIfMatch !== '') {
        const cleanMatch = String(rawIfMatch).replace(/["W\/]/g, '').trim();
        const currentRev = String(existing.revision !== undefined ? existing.revision : 1);
        if (cleanMatch !== '*' && cleanMatch !== currentRev) {
          return res.status(409).json({
            error: 'Konflikt wersji szablonu (szablon został zmodyfikowany przez innego użytkownika).',
            currentTemplate: cloneTemplate({ ...existing, builtIn: false, isCustom: true }),
            revision: appState.revision,
          });
        }
      }

      const validation = validateTemplateWritePayload(req.body);
      if (!validation.ok) {
        return res.status(400).json({
          error: validation.error,
          ...(validation.field ? { field: validation.field } : {}),
        });
      }

      const nowIso = new Date().toISOString();
      const updated: ProjectTemplate = {
        id: existing.id,
        ...validation.data,
        isCustom: true,
        builtIn: false,
        revision: (typeof existing.revision === 'number' ? existing.revision : 1) + 1,
        createdBy: existing.createdBy || caller.id,
        createdAt: existing.createdAt || nowIso,
        updatedAt: nowIso,
        ...(validation.data.sourceProjectId === undefined && existing.sourceProjectId
          ? { sourceProjectId: existing.sourceProjectId }
          : {}),
      };

      customTemplates[idx] = updated;
      appState.projectTemplates = customTemplates;

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('template_updated', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: {
            templateId: updated.id,
            name: updated.name,
            taskCount: updated.tasks.length,
          },
        })
        .catch(() => {});

      return res.json({
        success: true,
        template: cloneTemplate(updated),
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Templates] Błąd aktualizacji szablonu:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się zaktualizować szablonu.' });
    }
  });

  // DELETE /api/templates/:id — usunięcie własnego szablonu (tylko admin, wbudowane są chronione)
  app.delete('/api/templates/:id', requireAuth, async (req, res) => {
    try {
      const caller = (req as any).user;
      if (caller.role !== 'admin') {
        return res.status(403).json({
          error: 'Usuwanie szablonów projektów jest dozwolone wyłącznie dla Administratora.',
        });
      }
      if (builtInById.has(req.params.id)) {
        return res.status(403).json({
          error: 'Wbudowanych szablonów projektów nie można usunąć.',
        });
      }

      const appState = stateStore.ensureStateStructure();
      const customTemplates: ProjectTemplate[] = Array.isArray(appState.projectTemplates)
        ? appState.projectTemplates
        : [];
      const idx = customTemplates.findIndex((t) => t && t.id === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ error: `Szablon o ID "${req.params.id}" nie został znaleziony.` });
      }

      const removed = customTemplates[idx];
      customTemplates.splice(idx, 1);
      appState.projectTemplates = customTemplates;

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('template_deleted', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: {
            templateId: removed.id,
            name: removed.name,
          },
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
      logger.error('[Templates] Błąd usuwania szablonu:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Nie udało się usunąć szablonu.' });
    }
  });
}
