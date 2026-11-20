import express from 'express';
import crypto from 'crypto';
import type { Company, ProjectNumberingScope } from '../../types/index.js';
import { filterCompaniesForUser, hasForbiddenKeys } from '../../utils/access.js';
import { getClientIp } from '../security.js';
import { DISK_FULL_ERROR_MESSAGE, isDiskFullError, StateStore } from '../state.js';
import { SessionStore } from '../sessions.js';
import { logger } from '../logger.js';

export const MAX_COMPANIES_COUNT = 26;
export const COMPANY_NAME_MAX_LENGTH = 200;
export const COMPANY_LETTER_REGEX = /^[A-Z]$/;

export function companyHasProjects(appState: any, companyId: string): boolean {
  const projects = Array.isArray(appState?.projects) ? appState.projects : [];
  if (projects.some((p: any) => p && p.companyId === companyId)) {
    return true;
  }

  const trash = Array.isArray(appState?.trash) ? appState.trash : [];
  if (
    trash.some(
      (entry: any) =>
        entry &&
        entry.type === 'project' &&
        entry.payload?.project?.companyId === companyId
    )
  ) {
    return true;
  }

  return false;
}

export function sanitizeImportedCompanies(rawCompanies: unknown): Company[] {
  if (!Array.isArray(rawCompanies)) return [];
  const result: Company[] = [];
  const usedLetters = new Set<string>();
  const usedIds = new Set<string>();

  for (const item of rawCompanies) {
    if (result.length >= MAX_COMPANIES_COUNT) break;
    if (!item || typeof item !== 'object') continue;

    const rawName = typeof (item as any).name === 'string' ? (item as any).name.trim() : '';
    const rawLetter = typeof (item as any).letter === 'string' ? (item as any).letter.trim().toUpperCase() : '';
    if (!rawName || rawName.length > COMPANY_NAME_MAX_LENGTH) continue;
    if (!COMPANY_LETTER_REGEX.test(rawLetter) || usedLetters.has(rawLetter)) continue;

    const rawId = typeof (item as any).id === 'string' && (item as any).id.trim()
      ? (item as any).id.trim()
      : crypto.randomUUID();
    if (usedIds.has(rawId)) continue;

    const rawNip = typeof (item as any).nip === 'string' ? (item as any).nip.trim().slice(0, 50) : '';
    const rawAddress = typeof (item as any).address === 'string' ? (item as any).address.trim().slice(0, 200) : '';
    const isActive = typeof (item as any).isActive === 'boolean' ? (item as any).isActive : true;

    usedLetters.add(rawLetter);
    usedIds.add(rawId);

    result.push({
      id: rawId,
      name: rawName,
      letter: rawLetter,
      ...(rawNip ? { nip: rawNip } : {}),
      ...(rawAddress ? { address: rawAddress } : {}),
      isActive,
    });
  }

  return result;
}

export function registerCompanyRoutes(
  app: express.Express,
  deps: { stateStore: StateStore; sessionStore: SessionStore }
): void {
  const { stateStore, sessionStore } = deps;
  const { requireAuth, requireAdmin } = sessionStore;
  const { securityLogger } = stateStore;

  // GET /api/companies — widoczne dla wszystkich zalogowanych (nip i address tylko dla admin i project_manager)
  app.get('/api/companies', requireAuth, (req, res) => {
    const appState = stateStore.ensureStateStructure();
    const caller = (req as any).user;
    const companies = filterCompaniesForUser(appState.companies || [], caller);
    const projectNumbering = appState.projectNumbering || { scope: 'year' as ProjectNumberingScope };

    return res.json({
      companies,
      projectNumbering,
    });
  });

  // PUT /api/companies/settings — tryb numeracji ('year' | 'company') oraz domyślna firma (tylko admin)
  app.put('/api/companies/settings', requireAdmin, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;

      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const body = req.body || {};
      const currentSettings = appState.projectNumbering || { scope: 'year' as ProjectNumberingScope };
      const nextSettings: { scope: ProjectNumberingScope; defaultCompanyId?: string } = {
        scope: currentSettings.scope === 'company' ? 'company' : 'year',
        ...(currentSettings.defaultCompanyId ? { defaultCompanyId: currentSettings.defaultCompanyId } : {}),
      };

      if (body.scope !== undefined) {
        if (body.scope !== 'year' && body.scope !== 'company') {
          return res.status(400).json({ error: 'Nieprawidłowy tryb numeracji projektów (dozwolone: year lub company).' });
        }
        nextSettings.scope = body.scope;
      }

      if (Object.prototype.hasOwnProperty.call(body, 'defaultCompanyId')) {
        if (body.defaultCompanyId === null || body.defaultCompanyId === '') {
          delete nextSettings.defaultCompanyId;
        } else if (typeof body.defaultCompanyId === 'string') {
          const cid = body.defaultCompanyId.trim();
          const comp = (appState.companies || []).find((c: Company) => c.id === cid);
          if (!comp || !comp.isActive) {
            return res.status(400).json({ error: 'Domyślna firma musi istnieć i być aktywna.' });
          }
          nextSettings.defaultCompanyId = cid;
        } else {
          return res.status(400).json({ error: 'Nieprawidłowy identyfikator domyślnej firmy.' });
        }
      }

      appState.projectNumbering = nextSettings;
      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('settings_changed', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { section: 'projectNumbering', scope: nextSettings.scope },
        })
        .catch(() => {});

      return res.json({
        success: true,
        projectNumbering: appState.projectNumbering,
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Server API] Błąd aktualizacji ustawień numeracji firm:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/companies — tworzenie firmy (tylko admin)
  app.post('/api/companies', requireAdmin, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;

      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const companies: Company[] = Array.isArray(appState.companies) ? appState.companies : [];
      if (companies.length >= MAX_COMPANIES_COUNT) {
        return res.status(400).json({ error: 'Osiągnięto maksymalny limit 26 firm (A–Z).' });
      }

      const body = req.body || {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return res.status(400).json({ error: 'Wymagana nazwa firmy.' });
      }
      if (name.length > COMPANY_NAME_MAX_LENGTH) {
        return res.status(400).json({ error: `Nazwa firmy może mieć maksymalnie ${COMPANY_NAME_MAX_LENGTH} znaków.` });
      }

      const letter = typeof body.letter === 'string' ? body.letter.trim().toUpperCase() : '';
      if (!COMPANY_LETTER_REGEX.test(letter)) {
        return res.status(400).json({ error: 'Litera firmy musi być pojedynczą wielką literą A–Z.' });
      }

      if (companies.some((c) => c.letter.toUpperCase() === letter)) {
        return res.status(409).json({ error: `Litera "${letter}" jest już przypisana do innej firmy.` });
      }

      if (body.nip !== undefined && body.nip !== null && typeof body.nip !== 'string') {
        return res.status(400).json({ error: 'NIP musi być ciągiem znaków.' });
      }
      if (body.address !== undefined && body.address !== null && typeof body.address !== 'string') {
        return res.status(400).json({ error: 'Adres musi być ciągiem znaków.' });
      }
      if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
        return res.status(400).json({ error: 'Pole isActive musi być wartością logiczną.' });
      }

      const nip = typeof body.nip === 'string' ? body.nip.trim() : '';
      if (nip.length > 50) {
        return res.status(400).json({ error: 'NIP może mieć maksymalnie 50 znaków.' });
      }

      const address = typeof body.address === 'string' ? body.address.trim() : '';
      if (address.length > COMPANY_NAME_MAX_LENGTH) {
        return res.status(400).json({ error: `Adres może mieć maksymalnie ${COMPANY_NAME_MAX_LENGTH} znaków.` });
      }

      const newCompany: Company = {
        id: crypto.randomUUID(),
        name,
        letter,
        ...(nip ? { nip } : {}),
        ...(address ? { address } : {}),
        isActive: body.isActive !== undefined ? body.isActive : true,
      };

      companies.push(newCompany);
      appState.companies = companies;

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('company_created', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { companyId: newCompany.id, name: newCompany.name, letter: newCompany.letter },
        })
        .catch(() => {});

      return res.status(201).json({
        success: true,
        company: newCompany,
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Server API] Błąd tworzenia firmy:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/companies/:id — aktualizacja firmy (tylko admin)
  app.patch('/api/companies/:id', requireAdmin, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;

      if (hasForbiddenKeys(req.body)) {
        return res.status(400).json({ error: 'Niedozwolony klucz w żądaniu (__proto__, constructor, prototype).' });
      }

      const { id } = req.params;
      const companies: Company[] = Array.isArray(appState.companies) ? appState.companies : [];
      const company = companies.find((c) => c.id === id);
      if (!company) {
        return res.status(404).json({ error: `Firma o ID "${id}" nie istnieje.` });
      }

      const body = req.body || {};

      if (body.name !== undefined) {
        if (typeof body.name !== 'string') {
          return res.status(400).json({ error: 'Nazwa firmy musi być ciągiem znaków.' });
        }
        const trimmedName = body.name.trim();
        if (!trimmedName) {
          return res.status(400).json({ error: 'Wymagana nazwa firmy.' });
        }
        if (trimmedName.length > COMPANY_NAME_MAX_LENGTH) {
          return res.status(400).json({ error: `Nazwa firmy może mieć maksymalnie ${COMPANY_NAME_MAX_LENGTH} znaków.` });
        }
        company.name = trimmedName;
      }

      if (body.letter !== undefined) {
        if (typeof body.letter !== 'string') {
          return res.status(400).json({ error: 'Litera firmy musi być pojedynczą wielką literą A–Z.' });
        }
        const nextLetter = body.letter.trim().toUpperCase();
        if (!COMPANY_LETTER_REGEX.test(nextLetter)) {
          return res.status(400).json({ error: 'Litera firmy musi być pojedynczą wielką literą A–Z.' });
        }
        if (nextLetter !== company.letter.toUpperCase()) {
          if (companyHasProjects(appState, company.id)) {
            return res.status(409).json({
              error: 'Nie można zmienić litery firmy, ponieważ posiada przypisane projekty.',
            });
          }
          if (companies.some((c) => c.id !== company.id && c.letter.toUpperCase() === nextLetter)) {
            return res.status(409).json({ error: `Litera "${nextLetter}" jest już przypisana do innej firmy.` });
          }
          company.letter = nextLetter;
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'nip')) {
        if (body.nip === null || body.nip === '') {
          delete company.nip;
        } else if (typeof body.nip === 'string') {
          const trimmedNip = body.nip.trim();
          if (trimmedNip.length > 50) {
            return res.status(400).json({ error: 'NIP może mieć maksymalnie 50 znaków.' });
          }
          if (trimmedNip) {
            company.nip = trimmedNip;
          } else {
            delete company.nip;
          }
        } else {
          return res.status(400).json({ error: 'NIP musi być ciągiem znaków.' });
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'address')) {
        if (body.address === null || body.address === '') {
          delete company.address;
        } else if (typeof body.address === 'string') {
          const trimmedAddress = body.address.trim();
          if (trimmedAddress.length > COMPANY_NAME_MAX_LENGTH) {
            return res.status(400).json({ error: `Adres może mieć maksymalnie ${COMPANY_NAME_MAX_LENGTH} znaków.` });
          }
          if (trimmedAddress) {
            company.address = trimmedAddress;
          } else {
            delete company.address;
          }
        } else {
          return res.status(400).json({ error: 'Adres musi być ciągiem znaków.' });
        }
      }

      if (body.isActive !== undefined) {
        if (typeof body.isActive !== 'boolean') {
          return res.status(400).json({ error: 'Pole isActive musi być wartością logiczną.' });
        }
        company.isActive = body.isActive;
        if (!body.isActive && appState.projectNumbering?.defaultCompanyId === company.id) {
          delete appState.projectNumbering.defaultCompanyId;
        }
      }

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('company_updated', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { companyId: company.id, name: company.name, letter: company.letter, isActive: company.isActive },
        })
        .catch(() => {});

      return res.json({
        success: true,
        company,
        revision: newRev,
      });
    } catch (err: any) {
      if (isDiskFullError(err)) {
        return res.status(507).json({ error: DISK_FULL_ERROR_MESSAGE });
      }
      logger.error('[Server API] Błąd aktualizacji firmy:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/companies/:id — usunięcie firmy (409 gdy są projekty, tylko admin)
  app.delete('/api/companies/:id', requireAdmin, async (req, res) => {
    try {
      const appState = stateStore.ensureStateStructure();
      const caller = (req as any).user;
      const { id } = req.params;

      const companies: Company[] = Array.isArray(appState.companies) ? appState.companies : [];
      const idx = companies.findIndex((c) => c.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: `Firma o ID "${id}" nie istnieje.` });
      }

      if (companyHasProjects(appState, id)) {
        return res.status(409).json({
          error: 'Nie można usunąć firmy, ponieważ posiada przypisane projekty. Zmień status firmy na nieaktywną.',
        });
      }

      const [removed] = companies.splice(idx, 1);
      appState.companies = companies;

      if (appState.projectNumbering?.defaultCompanyId === id) {
        delete appState.projectNumbering.defaultCompanyId;
      }

      const newRev = stateStore.bumpStateRevision();
      await stateStore.saveStateAtomicAsync();

      await securityLogger
        .record('company_deleted', {
          userId: caller.id,
          ip: getClientIp(req),
          userAgent: (req.headers['user-agent'] || '').slice(0, 100),
          details: { companyId: removed.id, name: removed.name, letter: removed.letter },
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
      logger.error('[Server API] Błąd usuwania firmy:', err);
      return res.status(500).json({ error: err.message });
    }
  });
}
