import type { ProjectTemplate, ProjectTemplateSummary } from '../types';
import { DEFAULT_PROJECT_TEMPLATES } from '../data/defaultTemplates.js';
import {
  migrateLegacyTemplate,
  type LegacyTemplateLike,
} from './templateValidation.js';
import { parseApiErrorResponse } from '../hooks/useFormSubmit';

export class TemplateApiError extends Error {
  status: number;
  field?: string;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.name = 'TemplateApiError';
    this.status = status;
    this.field = field;
  }
}

export class TemplateConflictError extends TemplateApiError {
  currentTemplate?: ProjectTemplate;
  constructor(message: string, currentTemplate?: ProjectTemplate) {
    super(message, 409);
    this.name = 'TemplateConflictError';
    this.currentTemplate = currentTemplate;
  }
}

export const LEGACY_TEMPLATES_STORAGE_KEY = 'oph_project_templates';

/**
 * Zwraca listę własnych szablonów zapisanych wcześniej w localStorage przeglądarki
 * (po migracji z blockerIndices na key / blockerKeys).
 */
export const getLegacyLocalCustomTemplates = (): ProjectTemplate[] => {
  try {
    if (typeof localStorage === 'undefined') return [];
    const rawSaved = localStorage.getItem(LEGACY_TEMPLATES_STORAGE_KEY);
    if (!rawSaved) return [];
    const parsed = JSON.parse(rawSaved);
    if (!Array.isArray(parsed)) return [];
    const builtInIds = new Set(DEFAULT_PROJECT_TEMPLATES.map((t) => t.id));
    const result: ProjectTemplate[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const legacy = item as LegacyTemplateLike;
      const id = typeof legacy.id === 'string' ? legacy.id : '';
      const isCustomEntry =
        Boolean(legacy.isCustom) || id.startsWith('custom-') || !builtInIds.has(id);
      if (!isCustomEntry || builtInIds.has(id)) continue;
      result.push(migrateLegacyTemplate(legacy, { builtIn: false }));
    }
    return result;
  } catch {
    return [];
  }
};

export const clearLegacyLocalCustomTemplates = (): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LEGACY_TEMPLATES_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
};

async function createApiError(res: Response, fallback: string): Promise<TemplateApiError> {
  const parsed = await parseApiErrorResponse(res, fallback);
  return new TemplateApiError(parsed.error, res.status, parsed.field);
}

export async function fetchTemplatesList(): Promise<ProjectTemplateSummary[]> {
  const res = await fetch('/api/templates', { credentials: 'same-origin' });
  if (!res.ok) {
    throw await createApiError(res, 'Nie udało się pobrać listy szablonów projektów.');
  }
  const data = await res.json();
  return Array.isArray(data?.templates) ? data.templates : [];
}

export async function fetchTemplateById(templateId: string): Promise<ProjectTemplate> {
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
    credentials: 'same-origin',
  });
  if (!res.ok) {
    throw await createApiError(res, 'Nie udało się pobrać szczegółów szablonu projektu.');
  }
  const data = await res.json();
  if (!data?.template) {
    throw new Error('Brak danych szablonu w odpowiedzi serwera.');
  }
  return data.template as ProjectTemplate;
}

export async function createTemplateOnServer(
  payload: Omit<ProjectTemplate, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'builtIn' | 'isCustom'>
): Promise<{ template: ProjectTemplate; revision?: number }> {
  const res = await fetch('/api/templates', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await createApiError(res, 'Nie udało się zapisać szablonu na serwerze.');
  }
  const data = await res.json();
  return {
    template: data.template as ProjectTemplate,
    revision: typeof data.revision === 'number' ? data.revision : undefined,
  };
}

export async function updateTemplateOnServer(
  templateId: string,
  payload: Omit<ProjectTemplate, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'builtIn' | 'isCustom'>,
  options?: { expectedRevision?: number }
): Promise<{ template: ProjectTemplate; revision?: number }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof options?.expectedRevision === 'number') {
    headers['If-Match'] = String(options.expectedRevision);
  }
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({
      ...payload,
      ...(typeof options?.expectedRevision === 'number'
        ? { expectedRevision: options.expectedRevision }
        : {}),
    }),
  });
  if (res.status === 409) {
    const clone = res.clone();
    const data = await clone.json().catch(() => null);
    if (data && (data.currentTemplate || typeof data.error === 'string')) {
      throw new TemplateConflictError(
        data.error || 'Szablon został zmieniony przez innego użytkownika.',
        data.currentTemplate as ProjectTemplate | undefined
      );
    }
    const parsed = await parseApiErrorResponse(
      res,
      'Szablon został zmieniony przez innego użytkownika.'
    );
    throw new TemplateConflictError(parsed.error);
  }
  if (!res.ok) {
    throw await createApiError(res, 'Nie udało się zaktualizować szablonu na serwerze.');
  }
  const data = await res.json();
  return {
    template: data.template as ProjectTemplate,
    revision: typeof data.revision === 'number' ? data.revision : undefined,
  };
}

export async function duplicateTemplateOnServer(
  templateId: string,
  name?: string
): Promise<{ template: ProjectTemplate; revision?: number }> {
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}/duplicate`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name ? { name } : {}),
  });
  if (!res.ok) {
    throw await createApiError(res, 'Nie udało się zduplikować szablonu.');
  }
  const data = await res.json();
  return {
    template: data.template as ProjectTemplate,
    revision: typeof data.revision === 'number' ? data.revision : undefined,
  };
}

export async function deleteTemplateOnServer(
  templateId: string
): Promise<{ revision?: number }> {
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    throw await createApiError(res, 'Nie udało się usunąć szablonu.');
  }
  const data = await res.json();
  return {
    revision: typeof data.revision === 'number' ? data.revision : undefined,
  };
}

export interface CreateTemplateFromProjectPayload {
  name: string;
  category: ProjectTemplate['category'];
  description?: string;
  selectedTaskIds?: string[];
  skipCompleted?: boolean;
  preserveAssigneeRoles?: boolean;
}

export async function createTemplateFromProjectOnServer(
  projectId: string,
  payload: CreateTemplateFromProjectPayload
): Promise<{ template: ProjectTemplate; revision?: number }> {
  const res = await fetch(`/api/templates/from-project/${encodeURIComponent(projectId)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await createApiError(res, 'Nie udało się utworzyć szablonu z projektu.');
  }
  const data = await res.json();
  return {
    template: data.template as ProjectTemplate,
    revision: typeof data.revision === 'number' ? data.revision : undefined,
  };
}
