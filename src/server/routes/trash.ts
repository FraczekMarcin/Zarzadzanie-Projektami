import express from 'express';
import { recomputeProjectProgress } from '../../utils/progress.js';
import { getClientIp } from '../security.js';
import { SessionStore } from '../sessions.js';
import { SettingsService } from '../settings.js';
import { DISK_FULL_ERROR_MESSAGE, isDiskFullError, StateStore } from '../state.js';
import { listTrashForUser, purgeExpiredTrash, restoreTrashEntry } from '../trash.js';
import { logger } from '../logger.js';

export function registerTrashRoutes(
  app: express.Express,
  deps: {
    stateStore: StateStore;
    sessionStore: SessionStore;
    settingsService: SettingsService;
  }
): void {
  const { stateStore, sessionStore, settingsService } = deps;
  const { requireAuth } = sessionStore;
  const { securityLogger } = stateStore;

  // GET /api/trash — lista wpisów kosza dostępnych dla zalogowanego użytkownika (bez pełnego payloadu)
  app.get('/api/trash', requireAuth, (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;
      const items = listTrashForUser(appState, caller, Date.now());
      const retentionDays = settingsService.getEffectiveTrashRetentionDays();
      res.json({
        items,
        retentionDays,
      });
    } catch (err: any) {
      logger.error('[Trash] Błąd pobierania listy kosza:', err?.message || err);
      res.status(500).json({ error: 'Nie udało się pobrać zawartości kosza.' });
    }
  });

  // POST /api/trash/:id/restore — przywrócenie zadania lub projektu z kosza
  app.post('/api/trash/:id/restore', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;
      const { id } = req.params;

      purgeExpiredTrash(appState, Date.now());

      const result = restoreTrashEntry(appState, id, caller, Date.now());
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }

      const restoredProjectId =
        result.type === 'task' ? result.task?.projectId : result.project?.id;
      if (restoredProjectId) {
        recomputeProjectProgress(appState, restoredProjectId, {
          weighting: settingsService.getEffectiveProgressWeighting(),
        });
      }

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('trash_restored', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { count: 1 },
        })
        .catch(() => {});

      return res.json({
        success: true,
        restored: result,
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Trash] Błąd przywracania elementu z kosza:', err?.message || err);
      return res.status(500).json({ error: 'Nie udało się przywrócić elementu z kosza.' });
    }
  });

  // DELETE /api/trash/:id — trwałe usunięcie pojedynczego wpisu z kosza (admin lub project_manager)
  app.delete('/api/trash/:id', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;
      if (caller.role !== 'admin' && caller.role !== 'project_manager') {
        return res.status(403).json({
          error: 'Trwałe usuwanie elementów z kosza wymaga roli administratora lub kierownika projektu.',
        });
      }

      const { id } = req.params;
      if (!Array.isArray(appState.trash)) appState.trash = [];
      const index = appState.trash.findIndex((e: any) => e && e.id === id);
      if (index === -1) {
        return res.status(404).json({ error: 'Wpis w koszu nie istnieje.' });
      }

      appState.trash.splice(index, 1);
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('trash_purged', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { count: 1 },
        })
        .catch(() => {});

      return res.json({ success: true, count: 1, revision: newRev });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Trash] Błąd trwałego usuwania wpisu z kosza:', err?.message || err);
      return res.status(500).json({ error: 'Nie udało się trwale usunąć elementu z kosza.' });
    }
  });

  // DELETE /api/trash — opróżnienie całego kosza (tylko admin, wymaga body { confirm: true })
  app.delete('/api/trash', requireAuth, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;
      if (caller.role !== 'admin') {
        return res.status(403).json({
          error: 'Opróżnienie całego kosza jest dozwolone wyłącznie dla Administratora.',
        });
      }

      if (req.body?.confirm !== true) {
        return res.status(400).json({
          error: 'Wymagane wyraźne potwierdzenie opróżnienia kosza (confirm: true).',
        });
      }

      const count = Array.isArray(appState.trash) ? appState.trash.length : 0;
      appState.trash = [];
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('trash_emptied', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { count },
        })
        .catch(() => {});

      return res.json({ success: true, count, revision: newRev });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Trash] Błąd opróżniania kosza:', err?.message || err);
      return res.status(500).json({ error: 'Nie udało się opróżnić kosza.' });
    }
  });
}
