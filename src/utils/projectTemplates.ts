import { Project, Task, User, ProjectTemplate, TemplateTaskBlueprint } from '../types';
import { DEFAULT_PROJECT_TEMPLATES } from '../data/defaultTemplates';

const TEMPLATES_STORAGE_KEY = 'oph_project_templates';

/**
 * Loads all project templates: built-in defaults + administrator's custom templates
 */
export const loadAllProjectTemplates = (): ProjectTemplate[] => {
  try {
    const customSaved = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    const customTemplates: ProjectTemplate[] = customSaved ? JSON.parse(customSaved) : [];
    
    // Ensure all default templates are present
    const existingIds = new Set(customTemplates.map((t) => t.id));
    const merged = [...customTemplates];

    DEFAULT_PROJECT_TEMPLATES.forEach((def) => {
      if (!existingIds.has(def.id)) {
        merged.push(def);
      }
    });

    return merged;
  } catch {
    return DEFAULT_PROJECT_TEMPLATES;
  }
};

/**
 * Saves a new custom template created by administrator
 */
export const saveCustomProjectTemplate = (template: ProjectTemplate): void => {
  try {
    const current = loadAllProjectTemplates();
    const withoutExisting = current.filter((t) => t.id !== template.id);
    const updated = [template, ...withoutExisting];
    
    // Only persist custom templates or overrides to localStorage
    const toSave = updated.filter((t) => t.isCustom || t.id.startsWith('custom-'));
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error('Error saving template:', e);
  }
};

/**
 * Deletes a custom template
 */
export const deleteCustomProjectTemplate = (templateId: string): void => {
  try {
    const current = loadAllProjectTemplates();
    const updated = current.filter((t) => t.id !== templateId);
    const toSave = updated.filter((t) => t.isCustom || t.id.startsWith('custom-'));
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error('Error deleting template:', e);
  }
};

/**
 * Helper to calculate date string + days offset
 */
const addDays = (dateStr: string, days: number): string => {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return dateStr;
  }
};

/**
 * Helper to calculate difference in days between two dates
 */
const diffDays = (date1: string, date2: string): number => {
  try {
    const d1 = new Date(date1 + 'T00:00:00').getTime();
    const d2 = new Date(date2 + 'T00:00:00').getTime();
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
};

/**
 * Converts an existing Project and its Tasks into a reusable ProjectTemplate
 */
export const createTemplateFromExistingProject = (
  project: Project,
  projectTasks: Task[],
  templateName: string,
  category: ProjectTemplate['category'] = 'kubaturowe'
): ProjectTemplate => {
  // Sort tasks chronologically by start date
  const sortedTasks = [...projectTasks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const projStart = project.startDate || sortedTasks[0]?.startDate || '2026-10-01';

  // Map task IDs to index in sorted array for blocker resolution
  const idToIndexMap = new Map<string, number>();
  sortedTasks.forEach((t, idx) => idToIndexMap.set(t.id, idx));

  const blueprints: TemplateTaskBlueprint[] = sortedTasks.map((t) => {
    const offset = Math.max(0, diffDays(projStart, t.startDate));
    const duration = t.durationDays || Math.max(1, diffDays(t.startDate, t.dueDate) + 1);

    const blockerIds = t.blockingTaskIds || t.dependencies || [];
    const blockerIndices = blockerIds
      .map((id) => idToIndexMap.get(id))
      .filter((idx): idx is number => idx !== undefined);

    return {
      title: t.title,
      description: t.description || '',
      type: t.type,
      priority: t.priority,
      durationDays: duration,
      offsetDays: offset,
      isOfficialDeadline: !!t.isOfficialDeadline,
      estimatedHours: t.estimatedHours,
      tags: t.tags || [],
      blockerIndices,
    };
  });

  const newTemplate: ProjectTemplate = {
    id: `custom-${Date.now()}`,
    name: templateName.trim() || `Szablon z projektu [${project.key}]`,
    category,
    description: `Szablon utworzony przez Administratora na bazie projektu [${project.key}] "${project.name}". Zawiera ${blueprints.length} etapów i powiązań.`,
    defaultDurationDays: project.durationDays || 90,
    defaultPriority: project.priority,
    defaultBudget: project.budget,
    tasks: blueprints,
    isCustom: true,
    createdAt: new Date().toISOString(),
  };

  saveCustomProjectTemplate(newTemplate);
  return newTemplate;
};

/**
 * Instantiates an array of tasks for a new project from a selected template
 */
export const instantiateTasksFromTemplate = (
  template: ProjectTemplate,
  newProjectId: string,
  projectStartDate: string,
  reporterUser: User
): Task[] => {
  const generatedTasks: Task[] = [];
  const indexToTaskIdMap = new Map<number, string>();

  // First pass: create unique task IDs and map index
  template.tasks.forEach((_, idx) => {
    const taskId = `tsk-${Date.now()}-${idx + 1}`;
    indexToTaskIdMap.set(idx, taskId);
  });

  // Second pass: instantiate full Task objects with relative dates and mapped blocker IDs
  template.tasks.forEach((bp, idx) => {
    const taskId = indexToTaskIdMap.get(idx)!;
    const taskStart = addDays(projectStartDate, bp.offsetDays);
    const taskDue = addDays(taskStart, Math.max(1, bp.durationDays) - 1);

    // Map blocker indices to generated task IDs
    const mappedBlockers = (bp.blockerIndices || [])
      .map((bIdx) => indexToTaskIdMap.get(bIdx))
      .filter((id): id is string => !!id);

    const isInitialTask = mappedBlockers.length === 0;

    const task: Task = {
      id: taskId,
      projectId: newProjectId,
      code: `ETP-${String(idx + 1).padStart(2, '0')}`,
      title: bp.title,
      description: bp.description,
      type: bp.type,
      priority: bp.priority,
      status: isInitialTask ? 'to_do' : 'blocked',
      reporterId: reporterUser.id,
      assigneeId: reporterUser.id,
      startDate: taskStart,
      dueDate: taskDue,
      durationDays: bp.durationDays,
      isOfficialDeadline: bp.isOfficialDeadline,
      estimatedHours: bp.estimatedHours,
      spentHours: 0,
      progress: 0,
      blockingTaskIds: mappedBlockers,
      dependencies: mappedBlockers,
      tags: bp.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    generatedTasks.push(task);
  });

  return generatedTasks;
};
