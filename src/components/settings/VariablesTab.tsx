import React, { useState, useEffect, useMemo } from 'react';
import {
  BellRing,
  Percent,
  RotateCcw,
  Trash2,
  Tag,
  Building2,
  CheckCircle2,
  Lock,
  UploadCloud,
  Layers,
  Flag,
  ArrowUp,
  ArrowDown,
  Edit3,
  Check,
  X,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import type {
  Project,
  ProjectMetaColorKey,
  ProjectPriorityOption,
  ProjectStatusOption,
  ProjectSubtypeOption,
  ProjectTemplateSummary,
  ProjectTypeOption,
  User,
} from '../../types';
import {
  VatRateOption,
  ClientRecord,
  DEFAULT_VAT_RATES,
  TaskTypeDefinition,
  DEFAULT_TASK_TYPES,
  VARIABLES_LIMITS,
  saveVariablesToServer,
  hasLegacyLocalVariables,
  readLegacyLocalVariables,
  clearLegacyLocalVariables,
} from '../../utils/variableSettings';
import {
  PROJECT_META_LABEL_MAX,
  PROJECT_META_PALETTE,
  PROJECT_TYPE_LABEL_MAX,
  findProjectSubtypeUsage,
  findProjectTypeUsage,
  getOrderedProjectPriorities,
  getOrderedProjectStatuses,
  getOrderedProjectSubtypes,
  getOrderedProjectTypes,
  getPaletteDef,
  slugifyProjectMetaId,
} from '../../utils/projectMeta';
import { DEFAULT_PROJECT_TEMPLATES } from '../../data/defaultTemplates';
import { fetchTemplatesList } from '../../utils/projectTemplates';
import { useVariables } from '../../hooks/useVariables';
import { useFormSubmit } from '../../hooks/useFormSubmit';
import { FormError } from '../FormError';
import { useSettingsTabDirty } from './SettingsDirtyContext';
import { can } from '../../utils/permissions';

export interface VariablesTabProps {
  isOpen: boolean;
  currentUser: User | null;
  projects?: Project[];
}

export const VariablesTab: React.FC<VariablesTabProps> = ({
  isOpen,
  currentUser,
  projects = [],
}) => {
  const reportTabDirty = useSettingsTabDirty();
  const serverVars = useVariables();
  const isAdmin = currentUser?.role === 'admin';
  const canViewClients =
    can(currentUser, 'finance.view') || can(currentUser, 'clients.edit');

  const vatRates = serverVars.vatRates;
  const clients = serverVars.clients;
  const taskTypes = serverVars.taskTypes;
  const projectStatuses = useMemo(
    () => getOrderedProjectStatuses(serverVars.projectStatuses),
    [serverVars.projectStatuses]
  );
  const projectPriorities = useMemo(
    () => getOrderedProjectPriorities(serverVars.projectPriorities),
    [serverVars.projectPriorities]
  );
  const projectTypes = useMemo(
    () => getOrderedProjectTypes(serverVars.projectTypes),
    [serverVars.projectTypes]
  );

  const [templateSummaries, setTemplateSummaries] = useState<ProjectTemplateSummary[]>(() =>
    DEFAULT_PROJECT_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      typeId: t.typeId,
      description: t.description,
      defaultDurationDays: t.defaultDurationDays,
      defaultPriority: t.defaultPriority,
      taskCount: t.tasks.length,
      officialDeadlineCount: t.tasks.filter((tk) => Boolean(tk.isOfficialDeadline)).length,
      deliverableCount: t.deliverables?.length || 0,
      builtIn: true,
    }))
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchTemplatesList()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) {
          setTemplateSummaries(list);
        }
      })
      .catch(() => {
        // zachowaj co najmniej wbudowane szablony do weryfikacji użycia
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const statusUsageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) {
      if (p?.status) {
        counts.set(p.status, (counts.get(p.status) || 0) + 1);
      }
    }
    return counts;
  }, [projects]);

  const priorityUsageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) {
      if (p?.priority) {
        counts.set(p.priority, (counts.get(p.priority) || 0) + 1);
      }
    }
    return counts;
  }, [projects]);

  const [warningDaysInput, setWarningDaysInput] = useState<string>(
    String(serverVars.deadlineWarningDays)
  );
  const [projWarnDaysInput, setProjWarnDaysInput] = useState<string>(
    String(serverVars.projectDeadline?.warnDays ?? 30)
  );
  const [projCriticalDaysInput, setProjCriticalDaysInput] = useState<string>(
    String(serverVars.projectDeadline?.criticalDays ?? 7)
  );
  const [projBlinkEnabledInput, setProjBlinkEnabledInput] = useState<boolean>(
    serverVars.projectDeadline?.blinkEnabled ?? true
  );
  const [newVatRate, setNewVatRate] = useState<number>(23);
  const [newVatLabel, setNewVatLabel] = useState<string>('23% Podstawowa');
  const [newVatExempt, setNewVatExempt] = useState<boolean>(false);

  const [newClientName, setNewClientName] = useState('');
  const [newClientContact, setNewClientContact] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientNip, setNewClientNip] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');

  const [newTaskTypeId, setNewTaskTypeId] = useState('');
  const [newTaskTypeLabel, setNewTaskTypeLabel] = useState('');
  const [newTaskTypeDesc, setNewTaskTypeDesc] = useState('');

  // Project statuses form state
  const [newStatusLabel, setNewStatusLabel] = useState('');
  const [newStatusColor, setNewStatusColor] = useState<ProjectMetaColorKey>('sky');
  const [newStatusClosed, setNewStatusClosed] = useState(false);
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [editStatusLabel, setEditStatusLabel] = useState('');
  const [editStatusColor, setEditStatusColor] = useState<ProjectMetaColorKey>('sky');
  const [editStatusClosed, setEditStatusClosed] = useState(false);

  // Project priorities form state
  const [newPriorityLabel, setNewPriorityLabel] = useState('');
  const [newPriorityColor, setNewPriorityColor] = useState<ProjectMetaColorKey>('sky');
  const [editingPriorityId, setEditingPriorityId] = useState<string | null>(null);
  const [editPriorityLabel, setEditPriorityLabel] = useState('');
  const [editPriorityColor, setEditPriorityColor] = useState<ProjectMetaColorKey>('sky');

  // Project types & subtypes form state
  const [newTypeLabel, setNewTypeLabel] = useState('');
  const [newTypeColor, setNewTypeColor] = useState<ProjectMetaColorKey>('sky');
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [editTypeLabel, setEditTypeLabel] = useState('');
  const [editTypeColor, setEditTypeColor] = useState<ProjectMetaColorKey>('sky');
  const [editTypeActive, setEditTypeActive] = useState(true);
  const [expandedTypeIds, setExpandedTypeIds] = useState<Set<string>>(() => new Set());
  const [newSubtypeLabels, setNewSubtypeLabels] = useState<Record<string, string>>({});
  const [editingSubtypeKey, setEditingSubtypeKey] = useState<string | null>(null);
  const [editSubtypeLabel, setEditSubtypeLabel] = useState('');
  const [editSubtypeActive, setEditSubtypeActive] = useState(true);

  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [showMigrationBanner, setShowMigrationBanner] = useState<boolean>(false);

  const {
    isSubmitting: isSaving,
    submitError: saveError,
    alertRef: errorAlertRef,
    submit,
    clearError,
    setValidationError,
  } = useFormSubmit();

  useEffect(() => {
    setWarningDaysInput(String(serverVars.deadlineWarningDays));
  }, [serverVars.deadlineWarningDays, isOpen]);

  useEffect(() => {
    setProjWarnDaysInput(String(serverVars.projectDeadline?.warnDays ?? 30));
    setProjCriticalDaysInput(String(serverVars.projectDeadline?.criticalDays ?? 7));
    setProjBlinkEnabledInput(serverVars.projectDeadline?.blinkEnabled ?? true);
  }, [serverVars.projectDeadline, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      clearError();
      setSaveSuccess(null);
      setEditingStatusId(null);
      setEditingPriorityId(null);
      setEditingTypeId(null);
      setEditingSubtypeKey(null);
    }
    setShowMigrationBanner(Boolean(isAdmin && !serverVars.initialized && hasLegacyLocalVariables()));
  }, [isOpen, isAdmin, serverVars.initialized, clearError]);

  const hasUnsavedSubtypeInput = Object.values(newSubtypeLabels).some((v) => v.trim().length > 0);

  const isDirty = Boolean(
    isOpen &&
      isAdmin &&
      (warningDaysInput !== String(serverVars.deadlineWarningDays) ||
        projWarnDaysInput !== String(serverVars.projectDeadline?.warnDays ?? 30) ||
        projCriticalDaysInput !== String(serverVars.projectDeadline?.criticalDays ?? 7) ||
        projBlinkEnabledInput !== (serverVars.projectDeadline?.blinkEnabled ?? true) ||
        newVatRate !== 23 ||
        (newVatLabel.trim() !== '' && newVatLabel !== '23% Podstawowa') ||
        newVatExempt !== false ||
        newClientName.trim() ||
        newClientContact.trim() ||
        newClientPhone.trim() ||
        newClientEmail.trim() ||
        newClientNip.trim() ||
        newClientAddress.trim() ||
        newTaskTypeId.trim() ||
        newTaskTypeLabel.trim() ||
        newTaskTypeDesc.trim() ||
        newStatusLabel.trim() ||
        newPriorityLabel.trim() ||
        newTypeLabel.trim() ||
        hasUnsavedSubtypeInput ||
        editingStatusId !== null ||
        editingPriorityId !== null ||
        editingTypeId !== null ||
        editingSubtypeKey !== null)
  );

  useEffect(() => {
    reportTabDirty('variables', isDirty);
    return () => reportTabDirty('variables', false);
  }, [isDirty, reportTabDirty]);

  const persistPatch = async (
    patch: Parameters<typeof saveVariablesToServer>[0],
    successMsg: string
  ): Promise<boolean> => {
    if (!isAdmin) return false;
    setSaveSuccess(null);
    const res = await submit(
      async () => {
        const result = await saveVariablesToServer(patch);
        if (!result.ok) {
          return {
            ok: false,
            status: result.status,
            error: result.error || 'Nie udało się zapisać zmian na serwerze.',
          };
        }
        return { ok: true };
      },
      { fallbackError: 'Nie udało się zapisać zmian na serwerze.' }
    );
    if (!res.ok) {
      return false;
    }
    setSaveSuccess(successMsg);
    return true;
  };

  const handleMigrateFromBrowser = async () => {
    if (!isAdmin) return;
    const legacyPatch = readLegacyLocalVariables();
    const patchToSave =
      Object.keys(legacyPatch).length > 0
        ? legacyPatch
        : { deadlineWarningDays: serverVars.deadlineWarningDays };

    const ok = await persistPatch(
      patchToSave,
      'Ustawienia z przeglądarki zostały zapisane na serwerze.'
    );
    if (ok) {
      clearLegacyLocalVariables();
      setShowMigrationBanner(false);
    }
  };

  const handleSkipMigration = () => {
    clearLegacyLocalVariables();
    setShowMigrationBanner(false);
  };

  const handleSaveWarningDays = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSaveSuccess(null);
    const parsed = Number(warningDaysInput.trim());
    if (
      warningDaysInput.trim() === '' ||
      !Number.isInteger(parsed) ||
      parsed < VARIABLES_LIMITS.deadlineWarningDaysMin ||
      parsed > VARIABLES_LIMITS.deadlineWarningDaysMax
    ) {
      setValidationError('Czas wyprzedzenia ostrzeżenia musi być liczbą całkowitą od 0 do 30 dni.');
      return;
    }
    await persistPatch({ deadlineWarningDays: parsed }, 'Zapisano liczbę dni ostrzeżenia o terminie.');
  };

  const handleSaveProjectDeadline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSaveSuccess(null);
    const warnDays = Number(projWarnDaysInput.trim());
    const criticalDays = Number(projCriticalDaysInput.trim());

    if (
      projWarnDaysInput.trim() === '' ||
      !Number.isInteger(warnDays) ||
      warnDays < VARIABLES_LIMITS.projectDeadlineDaysMin ||
      warnDays > VARIABLES_LIMITS.projectDeadlineDaysMax
    ) {
      setValidationError(
        `Próg ostrzeżenia terminu projektu musi być liczbą całkowitą z zakresu ${VARIABLES_LIMITS.projectDeadlineDaysMin}–${VARIABLES_LIMITS.projectDeadlineDaysMax} dni.`
      );
      return;
    }
    if (
      projCriticalDaysInput.trim() === '' ||
      !Number.isInteger(criticalDays) ||
      criticalDays < VARIABLES_LIMITS.projectDeadlineDaysMin ||
      criticalDays > VARIABLES_LIMITS.projectDeadlineDaysMax
    ) {
      setValidationError(
        `Próg krytyczny terminu projektu musi być liczbą całkowitą z zakresu ${VARIABLES_LIMITS.projectDeadlineDaysMin}–${VARIABLES_LIMITS.projectDeadlineDaysMax} dni.`
      );
      return;
    }
    if (criticalDays >= warnDays) {
      setValidationError('Próg krytyczny musi być mniejszy niż próg ostrzeżenia.');
      return;
    }

    await persistPatch(
      {
        projectDeadline: {
          warnDays,
          criticalDays,
          blinkEnabled: projBlinkEnabledInput,
        },
      },
      'Zapisano ustawienia ostrzeżeń i mrugania terminów projektów.'
    );
  };

  const handleAddVatRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newVatLabel.trim()) return;

    const rateVal = newVatExempt ? 0 : Number(newVatRate);
    const newItem: VatRateOption = {
      id: `vat-${Date.now()}`,
      value: rateVal,
      rate: rateVal,
      label: newVatLabel.trim(),
      ...(newVatExempt ? { isExempt: true } : {}),
      isDefault: vatRates.length === 0,
    };

    const updated = [...vatRates, newItem];
    const ok = await persistPatch({ vatRates: updated }, 'Dodano stawkę VAT.');
    if (ok) {
      setNewVatLabel('');
      setNewVatRate(23);
      setNewVatExempt(false);
    }
  };

  const handleDeleteVatRate = async (id: string) => {
    if (!isAdmin) return;
    const updated = vatRates.filter((v) => v.id !== id);
    await persistPatch({ vatRates: updated }, 'Usunięto stawkę VAT.');
  };

  const handleResetVatRates = async () => {
    if (!isAdmin) return;
    await persistPatch(
      { vatRates: DEFAULT_VAT_RATES.map((v) => ({ ...v })) },
      'Przywrócono domyślne stawki VAT.'
    );
  };

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newClientName.trim()) return;

    const newRec: ClientRecord = {
      id: `cli-${Date.now()}`,
      name: newClientName.trim(),
      ...(newClientContact.trim() ? { contactPerson: newClientContact.trim() } : {}),
      ...(newClientPhone.trim() ? { phone: newClientPhone.trim() } : {}),
      ...(newClientEmail.trim() ? { email: newClientEmail.trim() } : {}),
      ...(newClientNip.trim() ? { nip: newClientNip.trim() } : {}),
      ...(newClientAddress.trim() ? { address: newClientAddress.trim() } : {}),
      createdAt: new Date().toISOString(),
    };

    const updated = [newRec, ...clients];
    const ok = await persistPatch({ clients: updated }, 'Zapisano inwestora w bazie serwera.');
    if (ok) {
      setNewClientName('');
      setNewClientContact('');
      setNewClientPhone('');
      setNewClientEmail('');
      setNewClientNip('');
      setNewClientAddress('');
    }
  };

  const handleDeleteClient = async (id: string) => {
    if (!isAdmin) return;
    const updated = clients.filter((c) => c.id !== id);
    await persistPatch({ clients: updated }, 'Usunięto inwestora z bazy serwera.');
  };

  const handleAddTaskType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newTaskTypeLabel.trim()) return;

    const id =
      newTaskTypeId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || `typ-${Date.now()}`;
    const trimmedName = newTaskTypeLabel.trim();
    const newType: TaskTypeDefinition = {
      id,
      name: trimmedName,
      label: trimmedName,
      ...(newTaskTypeDesc.trim() ? { description: newTaskTypeDesc.trim() } : {}),
      color: 'sky',
      isDefault: false,
    };

    const updated = [...taskTypes, newType];
    const ok = await persistPatch({ taskTypes: updated }, 'Dodano nowy typ zadania.');
    if (ok) {
      setNewTaskTypeId('');
      setNewTaskTypeLabel('');
      setNewTaskTypeDesc('');
    }
  };

  const handleDeleteTaskType = async (id: string) => {
    if (!isAdmin) return;
    const updated = taskTypes.filter((t) => t.id !== id);
    await persistPatch({ taskTypes: updated }, 'Usunięto typ zadania.');
  };

  const handleResetTaskTypes = async () => {
    if (!isAdmin) return;
    await persistPatch(
      { taskTypes: DEFAULT_TASK_TYPES.map((t) => ({ ...t })) },
      'Przywrócono domyślne typy zadań.'
    );
  };

  // --- Handlers: Project Statuses ---
  const reindexStatusOrders = (list: ProjectStatusOption[]): ProjectStatusOption[] =>
    list.map((item, idx) => ({ ...item, order: idx + 1 }));

  const handleAddProjectStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    const label = newStatusLabel.trim();
    if (!label) {
      setValidationError('Nazwa stanu projektu nie może być pusta.');
      return;
    }
    if (label.length > PROJECT_META_LABEL_MAX) {
      setValidationError(`Nazwa stanu może mieć maksymalnie ${PROJECT_META_LABEL_MAX} znaków.`);
      return;
    }
    if (projectStatuses.length >= VARIABLES_LIMITS.projectStatusesMax) {
      setValidationError(
        `Osiągnięto maksymalną liczbę stanów projektu (${VARIABLES_LIMITS.projectStatusesMax}).`
      );
      return;
    }
    const baseId = slugifyProjectMetaId(label, 'stan');
    let candidateId = baseId;
    let suffix = 2;
    const existingIds = new Set(projectStatuses.map((s) => s.id));
    while (existingIds.has(candidateId)) {
      candidateId = `${baseId.slice(0, 42)}_${suffix}`;
      suffix += 1;
    }

    const updated = reindexStatusOrders([
      ...projectStatuses,
      {
        id: candidateId,
        label,
        color: newStatusColor,
        order: projectStatuses.length + 1,
        isDefault: false,
        isClosed: newStatusClosed,
      },
    ]);

    const ok = await persistPatch({ projectStatuses: updated }, 'Dodano nowy stan projektu.');
    if (ok) {
      setNewStatusLabel('');
      setNewStatusColor('sky');
      setNewStatusClosed(false);
    }
  };

  const handleStartEditStatus = (item: ProjectStatusOption) => {
    clearError();
    setEditingStatusId(item.id);
    setEditStatusLabel(item.label);
    setEditStatusColor(item.color);
    setEditStatusClosed(Boolean(item.isClosed));
  };

  const handleSaveEditStatus = async (id: string) => {
    if (!isAdmin) return;
    const label = editStatusLabel.trim();
    if (!label) {
      setValidationError('Nazwa stanu projektu nie może być pusta.');
      return;
    }
    const updated = projectStatuses.map((item) =>
      item.id === id
        ? {
            ...item,
            label,
            color: editStatusColor,
            isClosed: editStatusClosed,
          }
        : item
    );
    const ok = await persistPatch({ projectStatuses: updated }, 'Zapisano zmiany stanu projektu.');
    if (ok) {
      setEditingStatusId(null);
    }
  };

  const handleSetDefaultStatus = async (id: string) => {
    if (!isAdmin) return;
    const updated = projectStatuses.map((item) => ({
      ...item,
      isDefault: item.id === id,
    }));
    await persistPatch({ projectStatuses: updated }, 'Zmieniono domyślny stan nowego projektu.');
  };

  const handleMoveProjectStatus = async (index: number, delta: -1 | 1) => {
    if (!isAdmin) return;
    const target = index + delta;
    if (target < 0 || target >= projectStatuses.length) return;
    const copy = [...projectStatuses];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    const updated = reindexStatusOrders(copy);
    await persistPatch({ projectStatuses: updated }, 'Zmieniono kolejność stanów projektu.');
  };

  const handleDeleteProjectStatus = async (item: ProjectStatusOption) => {
    if (!isAdmin) return;
    const usageCount = statusUsageCounts.get(item.id) || 0;
    if (item.isSystem) {
      setValidationError(`Stan systemowy „${item.label}” nie może zostać usunięty.`);
      return;
    }
    if (usageCount > 0) {
      setValidationError(
        `Nie można usunąć stanu „${item.label}”, ponieważ jest używany przez ${usageCount} projekt(ów).`
      );
      return;
    }
    const remaining = projectStatuses.filter((s) => s.id !== item.id);
    if (remaining.length > 0 && !remaining.some((s) => s.isDefault)) {
      remaining[0] = { ...remaining[0], isDefault: true };
    }
    const updated = reindexStatusOrders(remaining);
    await persistPatch({ projectStatuses: updated }, `Usunięto stan „${item.label}”.`);
  };

  // --- Handlers: Project Priorities ---
  const reindexPriorityOrders = (list: ProjectPriorityOption[]): ProjectPriorityOption[] =>
    list.map((item, idx) => ({ ...item, order: idx + 1 }));

  const handleAddProjectPriority = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    const label = newPriorityLabel.trim();
    if (!label) {
      setValidationError('Nazwa priorytetu projektu nie może być pusta.');
      return;
    }
    if (label.length > PROJECT_META_LABEL_MAX) {
      setValidationError(
        `Nazwa priorytetu może mieć maksymalnie ${PROJECT_META_LABEL_MAX} znaków.`
      );
      return;
    }
    if (projectPriorities.length >= VARIABLES_LIMITS.projectPrioritiesMax) {
      setValidationError(
        `Osiągnięto maksymalną liczbę priorytetów projektu (${VARIABLES_LIMITS.projectPrioritiesMax}).`
      );
      return;
    }
    const baseId = slugifyProjectMetaId(label, 'priorytet');
    let candidateId = baseId;
    let suffix = 2;
    const existingIds = new Set(projectPriorities.map((p) => p.id));
    while (existingIds.has(candidateId)) {
      candidateId = `${baseId.slice(0, 42)}_${suffix}`;
      suffix += 1;
    }

    const updated = reindexPriorityOrders([
      ...projectPriorities,
      {
        id: candidateId,
        label,
        color: newPriorityColor,
        order: projectPriorities.length + 1,
        isDefault: false,
      },
    ]);

    const ok = await persistPatch(
      { projectPriorities: updated },
      'Dodano nowy priorytet projektu.'
    );
    if (ok) {
      setNewPriorityLabel('');
      setNewPriorityColor('sky');
    }
  };

  const handleStartEditPriority = (item: ProjectPriorityOption) => {
    clearError();
    setEditingPriorityId(item.id);
    setEditPriorityLabel(item.label);
    setEditPriorityColor(item.color);
  };

  const handleSaveEditPriority = async (id: string) => {
    if (!isAdmin) return;
    const label = editPriorityLabel.trim();
    if (!label) {
      setValidationError('Nazwa priorytetu projektu nie może być pusta.');
      return;
    }
    const updated = projectPriorities.map((item) =>
      item.id === id
        ? {
            ...item,
            label,
            color: editPriorityColor,
          }
        : item
    );
    const ok = await persistPatch(
      { projectPriorities: updated },
      'Zapisano zmiany priorytetu projektu.'
    );
    if (ok) {
      setEditingPriorityId(null);
    }
  };

  const handleSetDefaultPriority = async (id: string) => {
    if (!isAdmin) return;
    const updated = projectPriorities.map((item) => ({
      ...item,
      isDefault: item.id === id,
    }));
    await persistPatch(
      { projectPriorities: updated },
      'Zmieniono domyślny priorytet nowego projektu.'
    );
  };

  const handleMoveProjectPriority = async (index: number, delta: -1 | 1) => {
    if (!isAdmin) return;
    const target = index + delta;
    if (target < 0 || target >= projectPriorities.length) return;
    const copy = [...projectPriorities];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    const updated = reindexPriorityOrders(copy);
    await persistPatch(
      { projectPriorities: updated },
      'Zmieniono kolejność priorytetów projektu.'
    );
  };

  const handleDeleteProjectPriority = async (item: ProjectPriorityOption) => {
    if (!isAdmin) return;
    const usageCount = priorityUsageCounts.get(item.id) || 0;
    if (item.isSystem) {
      setValidationError(`Priorytet systemowy „${item.label}” nie może zostać usunięty.`);
      return;
    }
    if (usageCount > 0) {
      setValidationError(
        `Nie można usunąć priorytetu „${item.label}”, ponieważ jest używany przez ${usageCount} projekt(ów).`
      );
      return;
    }
    const remaining = projectPriorities.filter((p) => p.id !== item.id);
    if (remaining.length > 0 && !remaining.some((p) => p.isDefault)) {
      remaining[0] = { ...remaining[0], isDefault: true };
    }
    const updated = reindexPriorityOrders(remaining);
    await persistPatch({ projectPriorities: updated }, `Usunięto priorytet „${item.label}”.`);
  };

  // --- Handlers: Project Types & Subtypes ---
  const reindexTypeOrders = (list: ProjectTypeOption[]): ProjectTypeOption[] =>
    list.map((item, idx) => ({ ...item, order: idx + 1 }));

  const reindexSubtypeOrders = (list: ProjectSubtypeOption[]): ProjectSubtypeOption[] =>
    list.map((item, idx) => ({ ...item, order: idx + 1 }));

  const toggleExpandType = (typeId: string) => {
    setExpandedTypeIds((prev) => {
      const next = new Set(prev);
      if (next.has(typeId)) next.delete(typeId);
      else next.add(typeId);
      return next;
    });
  };

  const handleAddProjectType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    const label = newTypeLabel.trim();
    if (!label) {
      setValidationError('Nazwa rodzaju projektu nie może być pusta.');
      return;
    }
    if (label.length > PROJECT_TYPE_LABEL_MAX) {
      setValidationError(`Nazwa rodzaju projektu może mieć maksymalnie ${PROJECT_TYPE_LABEL_MAX} znaków.`);
      return;
    }
    if (projectTypes.some((t) => t.label.toLowerCase() === label.toLowerCase())) {
      setValidationError(`Rodzaj projektu „${label}” już istnieje.`);
      return;
    }
    if (projectTypes.length >= VARIABLES_LIMITS.projectTypesMax) {
      setValidationError(
        `Osiągnięto maksymalną liczbę rodzajów projektów (${VARIABLES_LIMITS.projectTypesMax}).`
      );
      return;
    }
    const baseId = slugifyProjectMetaId(label, 'rodzaj');
    let candidateId = baseId;
    let suffix = 2;
    const existingIds = new Set(projectTypes.map((t) => t.id));
    while (existingIds.has(candidateId)) {
      candidateId = `${baseId.slice(0, 42)}_${suffix}`;
      suffix += 1;
    }

    const updated = reindexTypeOrders([
      ...projectTypes,
      {
        id: candidateId,
        label,
        color: newTypeColor,
        order: projectTypes.length + 1,
        isActive: true,
        subtypes: [],
      },
    ]);

    const ok = await persistPatch({ projectTypes: updated }, `Dodano rodzaj projektu „${label}”.`);
    if (ok) {
      setNewTypeLabel('');
      setNewTypeColor('sky');
    }
  };

  const handleStartEditType = (item: ProjectTypeOption) => {
    clearError();
    setEditingTypeId(item.id);
    setEditTypeLabel(item.label);
    setEditTypeColor(item.color);
    setEditTypeActive(item.isActive !== false);
  };

  const handleSaveEditType = async (id: string) => {
    if (!isAdmin) return;
    const label = editTypeLabel.trim();
    if (!label) {
      setValidationError('Nazwa rodzaju projektu nie może być pusta.');
      return;
    }
    if (label.length > PROJECT_TYPE_LABEL_MAX) {
      setValidationError(`Nazwa rodzaju projektu może mieć maksymalnie ${PROJECT_TYPE_LABEL_MAX} znaków.`);
      return;
    }
    const updated = projectTypes.map((item) =>
      item.id === id
        ? {
            ...item,
            label,
            color: editTypeColor,
            isActive: editTypeActive,
          }
        : item
    );
    const ok = await persistPatch({ projectTypes: updated }, `Zapisano zmiany rodzaju „${label}”.`);
    if (ok) {
      setEditingTypeId(null);
    }
  };

  const handleToggleTypeActive = async (item: ProjectTypeOption) => {
    if (!isAdmin) return;
    const nextActive = item.isActive === false;
    const updated = projectTypes.map((pt) =>
      pt.id === item.id ? { ...pt, isActive: nextActive } : pt
    );
    await persistPatch(
      { projectTypes: updated },
      nextActive ? `Aktywowano rodzaj „${item.label}”.` : `Dezaktywowano rodzaj „${item.label}”.`
    );
  };

  const handleMoveProjectType = async (index: number, delta: -1 | 1) => {
    if (!isAdmin) return;
    const target = index + delta;
    if (target < 0 || target >= projectTypes.length) return;
    const copy = [...projectTypes];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    const updated = reindexTypeOrders(copy);
    await persistPatch({ projectTypes: updated }, 'Zmieniono kolejność rodzajów projektów.');
  };

  const handleDeleteProjectType = async (item: ProjectTypeOption) => {
    if (!isAdmin) return;
    const usage = findProjectTypeUsage(item.id, {
      projects,
      templates: templateSummaries,
    });
    const totalUsage = usage.projects.length + usage.templates.length + usage.positionsCount;
    if (totalUsage > 0) {
      const details: string[] = [];
      if (usage.projects.length > 0) details.push(`projekty: ${usage.projects.length}`);
      if (usage.templates.length > 0) details.push(`szablony: ${usage.templates.length}`);
      if (usage.positionsCount > 0) details.push(`pozycje: ${usage.positionsCount}`);
      setValidationError(
        `Nie można usunąć rodzaju „${item.label}”, ponieważ jest używany (${details.join(', ')}).`
      );
      return;
    }
    const remaining = reindexTypeOrders(projectTypes.filter((pt) => pt.id !== item.id));
    await persistPatch({ projectTypes: remaining }, `Usunięto rodzaj projektu „${item.label}”.`);
  };

  const handleAddSubtype = async (typeItem: ProjectTypeOption) => {
    if (!isAdmin) return;
    const label = (newSubtypeLabels[typeItem.id] || '').trim();
    if (!label) {
      setValidationError('Nazwa podrodzaju nie może być pusta.');
      return;
    }
    if (label.length > PROJECT_TYPE_LABEL_MAX) {
      setValidationError(`Nazwa podrodzaju może mieć maksymalnie ${PROJECT_TYPE_LABEL_MAX} znaków.`);
      return;
    }
    const currentSubs = getOrderedProjectSubtypes(typeItem);
    if (currentSubs.some((s) => s.label.toLowerCase() === label.toLowerCase())) {
      setValidationError(`Podrodzaj „${label}” już istnieje w rodzaju „${typeItem.label}”.`);
      return;
    }
    if (currentSubs.length >= VARIABLES_LIMITS.projectSubtypesMax) {
      setValidationError(
        `Osiągnięto maksymalną liczbę podrodzajów (${VARIABLES_LIMITS.projectSubtypesMax}) dla rodzaju „${typeItem.label}”.`
      );
      return;
    }
    const baseId = slugifyProjectMetaId(label, 'podrodzaj');
    let candidateId = baseId;
    let suffix = 2;
    const existingIds = new Set(currentSubs.map((s) => s.id));
    while (existingIds.has(candidateId)) {
      candidateId = `${baseId.slice(0, 42)}_${suffix}`;
      suffix += 1;
    }
    const nextSubs = reindexSubtypeOrders([
      ...currentSubs,
      {
        id: candidateId,
        label,
        order: currentSubs.length + 1,
        isActive: true,
      },
    ]);
    const updated = projectTypes.map((pt) =>
      pt.id === typeItem.id ? { ...pt, subtypes: nextSubs } : pt
    );
    const ok = await persistPatch(
      { projectTypes: updated },
      `Dodano podrodzaj „${label}” do rodzaju „${typeItem.label}”.`
    );
    if (ok) {
      setNewSubtypeLabels((prev) => ({ ...prev, [typeItem.id]: '' }));
    }
  };

  const handleStartEditSubtype = (typeId: string, sub: ProjectSubtypeOption) => {
    clearError();
    setEditingSubtypeKey(`${typeId}:${sub.id}`);
    setEditSubtypeLabel(sub.label);
    setEditSubtypeActive(sub.isActive !== false);
  };

  const handleSaveEditSubtype = async (typeId: string, subId: string) => {
    if (!isAdmin) return;
    const label = editSubtypeLabel.trim();
    if (!label) {
      setValidationError('Nazwa podrodzaju nie może być pusta.');
      return;
    }
    if (label.length > PROJECT_TYPE_LABEL_MAX) {
      setValidationError(`Nazwa podrodzaju może mieć maksymalnie ${PROJECT_TYPE_LABEL_MAX} znaków.`);
      return;
    }
    const updated = projectTypes.map((pt) => {
      if (pt.id !== typeId) return pt;
      return {
        ...pt,
        subtypes: getOrderedProjectSubtypes(pt).map((sub) =>
          sub.id === subId ? { ...sub, label, isActive: editSubtypeActive } : sub
        ),
      };
    });
    const ok = await persistPatch({ projectTypes: updated }, `Zapisano podrodzaj „${label}”.`);
    if (ok) {
      setEditingSubtypeKey(null);
    }
  };

  const handleMoveSubtype = async (typeItem: ProjectTypeOption, index: number, delta: -1 | 1) => {
    if (!isAdmin) return;
    const subs = getOrderedProjectSubtypes(typeItem);
    const target = index + delta;
    if (target < 0 || target >= subs.length) return;
    const copy = [...subs];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    const nextSubs = reindexSubtypeOrders(copy);
    const updated = projectTypes.map((pt) =>
      pt.id === typeItem.id ? { ...pt, subtypes: nextSubs } : pt
    );
    await persistPatch({ projectTypes: updated }, 'Zmieniono kolejność podrodzajów.');
  };

  const handleDeleteSubtype = async (typeItem: ProjectTypeOption, sub: ProjectSubtypeOption) => {
    if (!isAdmin) return;
    const usage = findProjectSubtypeUsage(typeItem.id, sub.id, {
      projects,
      templates: templateSummaries,
    });
    const totalUsage = usage.projects.length + usage.templates.length + usage.positionsCount;
    if (totalUsage > 0) {
      setValidationError(
        `Nie można usunąć podrodzaju „${sub.label}”, ponieważ jest używany (${totalUsage} powiązań).`
      );
      return;
    }
    const nextSubs = reindexSubtypeOrders(
      getOrderedProjectSubtypes(typeItem).filter((s) => s.id !== sub.id)
    );
    const updated = projectTypes.map((pt) =>
      pt.id === typeItem.id ? { ...pt, subtypes: nextSubs } : pt
    );
    await persistPatch(
      { projectTypes: updated },
      `Usunięto podrodzaj „${sub.label}” z rodzaju „${typeItem.label}”.`
    );
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* One-time migration banner from browser localStorage */}
      {showMigrationBanner && (
        <div
          role="region"
          aria-label="Migracja ustawień z przeglądarki"
          className="p-4 bg-sky-50 dark:bg-sky-950/40 border border-sky-300 dark:border-sky-800 rounded-xl flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs text-sky-950 dark:text-sky-100">
            <UploadCloud className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span>Znaleziono ustawienia z tej przeglądarki. Zapisać je na serwerze?</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isSaving}
              onClick={handleMigrateFromBrowser}
              className="px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              Zapisz na serwerze
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSkipMigration}
              className="px-3 py-1.5 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold transition-colors"
            >
              Pomiń
            </button>
          </div>
        </div>
      )}

      {!isAdmin && (
        <div
          role="note"
          className="p-3 bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 text-xs flex items-center gap-2"
        >
          <Lock className="w-4 h-4 text-slate-600 dark:text-slate-400 shrink-0" aria-hidden="true" />
          <span>Podgląd tylko do odczytu. Zmiana zmiennych systemowych jest dostępna wyłącznie dla Administratora.</span>
        </div>
      )}

      <FormError
        id="variables-tab-error"
        error={saveError}
        alertRef={errorAlertRef}
        onDismiss={clearError}
      />

      {saveSuccess && (
        <div
          role="status"
          className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{saveSuccess}</span>
        </div>
      )}

      {/* Section: Deadline Warning Threshold */}
      <form
        onSubmit={handleSaveWarningDays}
        className="p-4 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl space-y-3"
      >
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
              <BellRing className="w-4 h-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <span>Ostrzeżenia o zbliżającym się terminie zadania (Drzewo Zadań)</span>
            </h4>
            <p className="text-slate-600 dark:text-slate-300 text-[11px]">
              W drzewie zadań zadania, których termin upływa za podaną liczbę dni, będą miały mrugającą obwiednię.
              Zadania przeterminowane mrugają na czerwono.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <label htmlFor="settings-warning-days" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Czas wyprzedzenia ostrzeżenia:
          </label>
          <div className="flex items-center gap-2">
            <input
              id="settings-warning-days"
              type="number"
              min="0"
              max="30"
              disabled={!isAdmin || isSaving}
              value={warningDaysInput}
              onChange={(e) => setWarningDaysInput(e.target.value)}
              className="w-20 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-white font-mono font-bold text-center disabled:opacity-60"
            />
            <span className="text-xs text-slate-600 dark:text-slate-400 font-semibold">dni kalendarzowych</span>
            {isAdmin && (
              <button
                type="submit"
                disabled={isSaving}
                className="px-3 py-1 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded font-semibold text-xs transition-colors"
              >
                Zapisz
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Section: Project Deadline Warning & Blink Thresholds */}
      <form
        onSubmit={handleSaveProjectDeadline}
        className="p-4 bg-rose-50/70 dark:bg-rose-950/25 border border-rose-200 dark:border-rose-900/60 rounded-xl space-y-3"
      >
        <div>
          <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-700 dark:text-rose-400" aria-hidden="true" />
            <span>Ostrzeżenia i mruganie terminów projektów</span>
          </h4>
          <p className="text-slate-600 dark:text-slate-300 text-[11px] mt-0.5">
            Dla projektów niezakończonych termin wyświetlany jest na czerwono od progu ostrzeżenia, a od progu krytycznego oraz po terminie mruga z całym wierszem lub kafelkiem (z poszanowaniem preferencji użytkownika i prefers-reduced-motion).
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4 pt-1">
          <div>
            <label
              htmlFor="settings-project-deadline-warn"
              className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1"
            >
              Próg ostrzeżenia (czerwony termin, dni):
            </label>
            <input
              id="settings-project-deadline-warn"
              type="number"
              min={VARIABLES_LIMITS.projectDeadlineDaysMin}
              max={VARIABLES_LIMITS.projectDeadlineDaysMax}
              disabled={!isAdmin || isSaving}
              value={projWarnDaysInput}
              onChange={(e) => setProjWarnDaysInput(e.target.value)}
              className="w-24 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-white font-mono font-bold text-center disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="settings-project-deadline-critical"
              className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1"
            >
              Próg krytyczny (mruganie, dni &lt; progu ostrz.):
            </label>
            <input
              id="settings-project-deadline-critical"
              type="number"
              min={VARIABLES_LIMITS.projectDeadlineDaysMin}
              max={VARIABLES_LIMITS.projectDeadlineDaysMax}
              disabled={!isAdmin || isSaving}
              value={projCriticalDaysInput}
              onChange={(e) => setProjCriticalDaysInput(e.target.value)}
              className="w-24 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-white font-mono font-bold text-center disabled:opacity-60"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer pb-1">
            <input
              id="settings-project-deadline-blink"
              type="checkbox"
              disabled={!isAdmin || isSaving}
              checked={projBlinkEnabledInput}
              onChange={(e) => setProjBlinkEnabledInput(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-700 text-rose-700"
            />
            <span>Globalnie włączone mruganie</span>
          </label>

          {isAdmin && (
            <button
              type="submit"
              disabled={isSaving}
              className="px-3 py-1 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded font-semibold text-xs transition-colors"
            >
              Zapisz progi terminów
            </button>
          )}
        </div>
      </form>

      {/* Section: Project Statuses */}
      <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
        <div>
          <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <span>
              Stany projektów ({projectStatuses.length}/{VARIABLES_LIMITS.projectStatusesMax})
            </span>
          </h4>
          <p className="text-slate-600 dark:text-slate-400 text-xs">
            Słownik stanów dostępny w formularzu projektu i filtrach. Stany oznaczone jako{' '}
            <strong>Stan końcowy</strong> są wykluczane z ostrzeżeń o terminach, podsumowań tygodniowych i przypomnień.
          </p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th scope="col" className="py-2 px-3 font-semibold">Podgląd / Nazwa</th>
                <th scope="col" className="py-2 px-3 font-semibold text-center">Domyślny</th>
                <th scope="col" className="py-2 px-3 font-semibold text-center">Stan końcowy</th>
                <th scope="col" className="py-2 px-3 font-semibold text-center">Użycie</th>
                {isAdmin && <th scope="col" className="py-2 px-3 font-semibold text-right">Akcje</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {projectStatuses.map((st, idx) => {
                const palette = getPaletteDef(st.color);
                const usageCount = statusUsageCounts.get(st.id) || 0;
                const isEditing = editingStatusId === st.id;
                const deleteDisabled = isSaving || Boolean(st.isSystem) || usageCount > 0;
                const deleteHint = st.isSystem
                  ? 'Pozycja systemowa nie może zostać usunięta'
                  : usageCount > 0
                  ? `Używany przez ${usageCount} projekt(ów) — nie można usunąć`
                  : 'Usuń stan projektu';

                return (
                  <tr key={st.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2 px-3">
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            aria-label={`Nazwa stanu ${st.label}`}
                            maxLength={PROJECT_META_LABEL_MAX}
                            value={editStatusLabel}
                            onChange={(e) => setEditStatusLabel(e.target.value)}
                            className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white"
                          />
                          <div className="flex flex-wrap gap-1" role="group" aria-label="Paleta kolorów stanu">
                            {PROJECT_META_PALETTE.map((c) => (
                              <button
                                key={c.key}
                                type="button"
                                aria-label={`Kolor ${c.label}`}
                                aria-pressed={editStatusColor === c.key}
                                onClick={() => setEditStatusColor(c.key)}
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                  editStatusColor === c.key
                                    ? 'border-slate-900 dark:border-white scale-110'
                                    : 'border-transparent'
                                }`}
                                style={{ backgroundColor: c.swatchHex }}
                                title={c.label}
                              >
                                {editStatusColor === c.key && (
                                  <Check className="w-3 h-3 text-white drop-shadow" aria-hidden="true" />
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${palette.badgeClass}`}
                          >
                            {st.label}
                          </span>
                          <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400">
                            {st.id}
                          </span>
                          {st.isSystem && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              Systemowy
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <input
                        type="radio"
                        name="default-project-status"
                        aria-label={`Ustaw stan ${st.label} jako domyślny`}
                        checked={Boolean(st.isDefault)}
                        disabled={!isAdmin || isSaving}
                        onChange={() => handleSetDefaultStatus(st.id)}
                      />
                    </td>
                    <td className="py-2 px-3 text-center">
                      {isEditing ? (
                        <label className="inline-flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            aria-label={`Stan końcowy dla ${st.label}`}
                            checked={editStatusClosed}
                            onChange={(e) => setEditStatusClosed(e.target.checked)}
                          />
                          <span className="text-[11px] text-slate-700 dark:text-slate-300">Końcowy</span>
                        </label>
                      ) : (
                        <span
                          className={`text-[11px] font-semibold ${
                            st.isClosed
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {st.isClosed ? 'Tak' : 'Nie'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center font-mono text-slate-700 dark:text-slate-300">
                      {usageCount}
                    </td>
                    {isAdmin && (
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleSaveEditStatus(st.id)}
                              className="px-2 py-1 rounded bg-sky-700 hover:bg-sky-800 text-white text-[11px] font-semibold"
                            >
                              Zapisz
                            </button>
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => setEditingStatusId(null)}
                              aria-label="Anuluj edycję stanu"
                              className="p-1 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                            >
                              <X className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isSaving || idx === 0}
                              onClick={() => handleMoveProjectStatus(idx, -1)}
                              aria-label={`Przesuń stan ${st.label} w górę`}
                              className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                            >
                              <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              disabled={isSaving || idx === projectStatuses.length - 1}
                              onClick={() => handleMoveProjectStatus(idx, 1)}
                              aria-label={`Przesuń stan ${st.label} w dół`}
                              className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                            >
                              <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleStartEditStatus(st)}
                              aria-label={`Edytuj stan ${st.label}`}
                              className="p-1 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300"
                            >
                              <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              disabled={deleteDisabled}
                              onClick={() => handleDeleteProjectStatus(st)}
                              aria-label={`Usuń stan ${st.label}`}
                              title={deleteHint}
                              className="p-1 text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {isAdmin && (
          <form
            onSubmit={handleAddProjectStatus}
            className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-wrap gap-3 items-end"
          >
            <div className="flex-1 min-w-[180px]">
              <label
                htmlFor="settings-new-project-status-label"
                className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1"
              >
                Nowy stan projektu *
              </label>
              <input
                id="settings-new-project-status-label"
                type="text"
                maxLength={PROJECT_META_LABEL_MAX}
                disabled={isSaving}
                value={newStatusLabel}
                onChange={(e) => setNewStatusLabel(e.target.value)}
                placeholder="np. Gwarancja lub Anulowany"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <span className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                Kolor
              </span>
              <div className="flex items-center gap-1" role="group" aria-label="Kolor nowego stanu">
                {PROJECT_META_PALETTE.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    aria-label={`Kolor ${c.label}`}
                    aria-pressed={newStatusColor === c.key}
                    onClick={() => setNewStatusColor(c.key)}
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      newStatusColor === c.key
                        ? 'border-slate-900 dark:border-white scale-110'
                        : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c.swatchHex }}
                    title={c.label}
                  >
                    {newStatusColor === c.key && (
                      <Check className="w-3 h-3 text-white drop-shadow" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-300 pb-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={newStatusClosed}
                disabled={isSaving}
                onChange={(e) => setNewStatusClosed(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700"
              />
              <span>Stan końcowy</span>
            </label>

            <button
              type="submit"
              disabled={isSaving || projectStatuses.length >= VARIABLES_LIMITS.projectStatusesMax}
              className="px-3.5 py-1.5 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white rounded font-semibold text-xs shadow-xs transition-colors"
            >
              + Dodaj stan
            </button>
          </form>
        )}
      </div>

      {/* Section: Project Priorities */}
      <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
        <div>
          <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
            <Flag className="w-4 h-4 text-rose-700 dark:text-rose-400" aria-hidden="true" />
            <span>
              Priorytety projektów ({projectPriorities.length}/{VARIABLES_LIMITS.projectPrioritiesMax})
            </span>
          </h4>
          <p className="text-slate-600 dark:text-slate-400 text-xs">
            Słownik priorytetów wyświetlanych na kartach i listach projektów.
          </p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th scope="col" className="py-2 px-3 font-semibold">Podgląd / Nazwa</th>
                <th scope="col" className="py-2 px-3 font-semibold text-center">Domyślny</th>
                <th scope="col" className="py-2 px-3 font-semibold text-center">Użycie</th>
                {isAdmin && <th scope="col" className="py-2 px-3 font-semibold text-right">Akcje</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {projectPriorities.map((pr, idx) => {
                const palette = getPaletteDef(pr.color);
                const usageCount = priorityUsageCounts.get(pr.id) || 0;
                const isEditing = editingPriorityId === pr.id;
                const deleteDisabled = isSaving || Boolean(pr.isSystem) || usageCount > 0;
                const deleteHint = pr.isSystem
                  ? 'Pozycja systemowa nie może zostać usunięta'
                  : usageCount > 0
                  ? `Używany przez ${usageCount} projekt(ów) — nie można usunąć`
                  : 'Usuń priorytet projektu';

                return (
                  <tr key={pr.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2 px-3">
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            aria-label={`Nazwa priorytetu ${pr.label}`}
                            maxLength={PROJECT_META_LABEL_MAX}
                            value={editPriorityLabel}
                            onChange={(e) => setEditPriorityLabel(e.target.value)}
                            className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white"
                          />
                          <div className="flex flex-wrap gap-1" role="group" aria-label="Paleta kolorów priorytetu">
                            {PROJECT_META_PALETTE.map((c) => (
                              <button
                                key={c.key}
                                type="button"
                                aria-label={`Kolor ${c.label}`}
                                aria-pressed={editPriorityColor === c.key}
                                onClick={() => setEditPriorityColor(c.key)}
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                  editPriorityColor === c.key
                                    ? 'border-slate-900 dark:border-white scale-110'
                                    : 'border-transparent'
                                }`}
                                style={{ backgroundColor: c.swatchHex }}
                                title={c.label}
                              >
                                {editPriorityColor === c.key && (
                                  <Check className="w-3 h-3 text-white drop-shadow" aria-hidden="true" />
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${palette.badgeClass}`}
                          >
                            {pr.label}
                          </span>
                          <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400">
                            {pr.id}
                          </span>
                          {pr.isSystem && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              Systemowy
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <input
                        type="radio"
                        name="default-project-priority"
                        aria-label={`Ustaw priorytet ${pr.label} jako domyślny`}
                        checked={Boolean(pr.isDefault)}
                        disabled={!isAdmin || isSaving}
                        onChange={() => handleSetDefaultPriority(pr.id)}
                      />
                    </td>
                    <td className="py-2 px-3 text-center font-mono text-slate-700 dark:text-slate-300">
                      {usageCount}
                    </td>
                    {isAdmin && (
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleSaveEditPriority(pr.id)}
                              className="px-2 py-1 rounded bg-sky-700 hover:bg-sky-800 text-white text-[11px] font-semibold"
                            >
                              Zapisz
                            </button>
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => setEditingPriorityId(null)}
                              aria-label="Anuluj edycję priorytetu"
                              className="p-1 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                            >
                              <X className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isSaving || idx === 0}
                              onClick={() => handleMoveProjectPriority(idx, -1)}
                              aria-label={`Przesuń priorytet ${pr.label} w górę`}
                              className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                            >
                              <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              disabled={isSaving || idx === projectPriorities.length - 1}
                              onClick={() => handleMoveProjectPriority(idx, 1)}
                              aria-label={`Przesuń priorytet ${pr.label} w dół`}
                              className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                            >
                              <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleStartEditPriority(pr)}
                              aria-label={`Edytuj priorytet ${pr.label}`}
                              className="p-1 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300"
                            >
                              <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              disabled={deleteDisabled}
                              onClick={() => handleDeleteProjectPriority(pr)}
                              aria-label={`Usuń priorytet ${pr.label}`}
                              title={deleteHint}
                              className="p-1 text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {isAdmin && (
          <form
            onSubmit={handleAddProjectPriority}
            className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-wrap gap-3 items-end"
          >
            <div className="flex-1 min-w-[180px]">
              <label
                htmlFor="settings-new-project-priority-label"
                className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1"
              >
                Nowy priorytet projektu *
              </label>
              <input
                id="settings-new-project-priority-label"
                type="text"
                maxLength={PROJECT_META_LABEL_MAX}
                disabled={isSaving}
                value={newPriorityLabel}
                onChange={(e) => setNewPriorityLabel(e.target.value)}
                placeholder="np. Strategiczny"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <span className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                Kolor
              </span>
              <div className="flex items-center gap-1" role="group" aria-label="Kolor nowego priorytetu">
                {PROJECT_META_PALETTE.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    aria-label={`Kolor ${c.label}`}
                    aria-pressed={newPriorityColor === c.key}
                    onClick={() => setNewPriorityColor(c.key)}
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      newPriorityColor === c.key
                        ? 'border-slate-900 dark:border-white scale-110'
                        : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c.swatchHex }}
                    title={c.label}
                  >
                    {newPriorityColor === c.key && (
                      <Check className="w-3 h-3 text-white drop-shadow" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={isSaving || projectPriorities.length >= VARIABLES_LIMITS.projectPrioritiesMax}
              className="px-3.5 py-1.5 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white rounded font-semibold text-xs shadow-xs transition-colors"
            >
              + Dodaj priorytet
            </button>
          </form>
        )}
      </div>

      {/* Section: Project Types & Subtypes */}
      <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
        <div>
          <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-indigo-700 dark:text-indigo-400" aria-hidden="true" />
            <span>
              Rodzaje projektów i podrodzaje ({projectTypes.length}/{VARIABLES_LIMITS.projectTypesMax})
            </span>
          </h4>
          <p className="text-slate-600 dark:text-slate-400 text-xs">
            Słownik rodzajów projektów i podrodzajów dostępny w projektach, szablonach i ekonomii. Identyfikatory pozostają stabilne przy zmianie nazwy lub kolejności.
          </p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th scope="col" className="py-2 px-3 font-semibold">Rodzaj / ID</th>
                <th scope="col" className="py-2 px-3 font-semibold text-center">Podrodzaje</th>
                <th scope="col" className="py-2 px-3 font-semibold text-center">Status</th>
                <th scope="col" className="py-2 px-3 font-semibold text-center">Użycie</th>
                {isAdmin && <th scope="col" className="py-2 px-3 font-semibold text-right">Akcje</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {projectTypes.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} className="py-4 text-center text-slate-600 dark:text-slate-400">
                    Brak zdefiniowanych rodzajów projektów.
                  </td>
                </tr>
              ) : (
                projectTypes.map((pt, idx) => {
                  const palette = getPaletteDef(pt.color);
                  const subtypes = getOrderedProjectSubtypes(pt);
                  const usage = findProjectTypeUsage(pt.id, {
                    projects,
                    templates: templateSummaries,
                  });
                  const totalUsage = usage.projects.length + usage.templates.length + usage.positionsCount;
                  const isEditing = editingTypeId === pt.id;
                  const isExpanded = expandedTypeIds.has(pt.id);
                  const deleteDisabled = isSaving || totalUsage > 0;
                  const deleteHint =
                    totalUsage > 0
                      ? `Używany (projekty: ${usage.projects.length}, szablony: ${usage.templates.length}, pozycje: ${usage.positionsCount}) — nie można usunąć`
                      : 'Usuń rodzaj projektu';

                  return (
                    <React.Fragment key={pt.id}>
                      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2 px-3">
                          {isEditing ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                aria-label={`Nazwa rodzaju ${pt.label}`}
                                maxLength={PROJECT_TYPE_LABEL_MAX}
                                value={editTypeLabel}
                                onChange={(e) => setEditTypeLabel(e.target.value)}
                                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white"
                              />
                              <div className="flex flex-wrap items-center gap-3">
                                <div className="flex flex-wrap gap-1" role="group" aria-label="Paleta kolorów rodzaju">
                                  {PROJECT_META_PALETTE.map((c) => (
                                    <button
                                      key={c.key}
                                      type="button"
                                      aria-label={`Kolor ${c.label}`}
                                      aria-pressed={editTypeColor === c.key}
                                      onClick={() => setEditTypeColor(c.key)}
                                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                        editTypeColor === c.key
                                          ? 'border-slate-900 dark:border-white scale-110'
                                          : 'border-transparent'
                                      }`}
                                      style={{ backgroundColor: c.swatchHex }}
                                      title={c.label}
                                    >
                                      {editTypeColor === c.key && (
                                        <Check className="w-3 h-3 text-white drop-shadow" aria-hidden="true" />
                                      )}
                                    </button>
                                  ))}
                                </div>
                                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={editTypeActive}
                                    onChange={(e) => setEditTypeActive(e.target.checked)}
                                  />
                                  <span>Aktywny</span>
                                </label>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${palette.badgeClass}`}
                              >
                                {pt.label}
                              </span>
                              <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400">
                                {pt.id}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggleExpandType(pt.id)}
                            aria-expanded={isExpanded}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-semibold"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3 h-3" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="w-3 h-3" aria-hidden="true" />
                            )}
                            <span>{subtypes.length} podrodz.</span>
                          </button>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            disabled={!isAdmin || isSaving}
                            onClick={() => handleToggleTypeActive(pt)}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors disabled:opacity-60 ${
                              pt.isActive !== false
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700'
                            }`}
                          >
                            {pt.isActive !== false ? 'Aktywny' : 'Nieaktywny'}
                          </button>
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-slate-700 dark:text-slate-300" title={`Projekty: ${usage.projects.length}, Szablony: ${usage.templates.length}, Pozycje: ${usage.positionsCount}`}>
                          {totalUsage}
                        </td>
                        {isAdmin && (
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            {isEditing ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isSaving}
                                  onClick={() => handleSaveEditType(pt.id)}
                                  className="px-2 py-1 rounded bg-sky-700 hover:bg-sky-800 text-white text-[11px] font-semibold"
                                >
                                  Zapisz
                                </button>
                                <button
                                  type="button"
                                  disabled={isSaving}
                                  onClick={() => setEditingTypeId(null)}
                                  aria-label="Anuluj edycję rodzaju"
                                  className="p-1 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                                >
                                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isSaving || idx === 0}
                                  onClick={() => handleMoveProjectType(idx, -1)}
                                  aria-label={`Przesuń rodzaj ${pt.label} w górę`}
                                  className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isSaving || idx === projectTypes.length - 1}
                                  onClick={() => handleMoveProjectType(idx, 1)}
                                  aria-label={`Przesuń rodzaj ${pt.label} w dół`}
                                  className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isSaving}
                                  onClick={() => handleStartEditType(pt)}
                                  aria-label={`Edytuj rodzaj ${pt.label}`}
                                  className="p-1 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300"
                                >
                                  <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  disabled={deleteDisabled}
                                  onClick={() => handleDeleteProjectType(pt)}
                                  aria-label={`Usuń rodzaj ${pt.label}`}
                                  title={deleteHint}
                                  className="p-1 text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50/80 dark:bg-slate-800/30">
                          <td colSpan={isAdmin ? 5 : 4} className="px-4 py-3 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                                Podrodzaje dla „{pt.label}” ({subtypes.length}/{VARIABLES_LIMITS.projectSubtypesMax})
                              </span>
                            </div>

                            {subtypes.length === 0 ? (
                              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                                Brak zdefiniowanych podrodzajów dla tego rodzaju projektu.
                              </p>
                            ) : (
                              <div className="divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900">
                                {subtypes.map((sub, subIdx) => {
                                  const subKey = `${pt.id}:${sub.id}`;
                                  const isEditingSub = editingSubtypeKey === subKey;
                                  const subUsage = findProjectSubtypeUsage(pt.id, sub.id, {
                                    projects,
                                    templates: templateSummaries,
                                  });
                                  const subUsageCount =
                                    subUsage.projects.length +
                                    subUsage.templates.length +
                                    subUsage.positionsCount;

                                  return (
                                    <div
                                      key={sub.id}
                                      className="px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                                    >
                                      {isEditingSub ? (
                                        <div className="flex flex-wrap items-center gap-2 flex-1">
                                          <input
                                            type="text"
                                            aria-label={`Nazwa podrodzaju ${sub.label}`}
                                            maxLength={PROJECT_TYPE_LABEL_MAX}
                                            value={editSubtypeLabel}
                                            onChange={(e) => setEditSubtypeLabel(e.target.value)}
                                            className="flex-1 min-w-[140px] bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-white"
                                          />
                                          <label className="inline-flex items-center gap-1 cursor-pointer text-slate-700 dark:text-slate-300">
                                            <input
                                              type="checkbox"
                                              checked={editSubtypeActive}
                                              onChange={(e) => setEditSubtypeActive(e.target.checked)}
                                            />
                                            <span>Aktywny</span>
                                          </label>
                                          <button
                                            type="button"
                                            disabled={isSaving}
                                            onClick={() => handleSaveEditSubtype(pt.id, sub.id)}
                                            className="px-2 py-0.5 rounded bg-sky-700 hover:bg-sky-800 text-white font-semibold"
                                          >
                                            Zapisz
                                          </button>
                                          <button
                                            type="button"
                                            disabled={isSaving}
                                            onClick={() => setEditingSubtypeKey(null)}
                                            aria-label="Anuluj edycję podrodzaju"
                                            className="p-1 text-slate-600 dark:text-slate-300"
                                          >
                                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                                          </button>
                                        </div>
                                      ) : (
                                        <>
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-semibold text-slate-900 dark:text-white">
                                              {sub.label}
                                            </span>
                                            <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400">
                                              {sub.id}
                                            </span>
                                            <span
                                              className={`px-1.5 py-0.2 rounded text-[10px] border ${
                                                sub.isActive !== false
                                                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700'
                                              }`}
                                            >
                                              {sub.isActive !== false ? 'Aktywny' : 'Nieaktywny'}
                                            </span>
                                            {subUsageCount > 0 && (
                                              <span className="text-[10px] font-mono text-slate-600 dark:text-slate-400">
                                                użycie: {subUsageCount}
                                              </span>
                                            )}
                                          </div>
                                          {isAdmin && (
                                            <div className="flex items-center gap-1">
                                              <button
                                                type="button"
                                                disabled={isSaving || subIdx === 0}
                                                onClick={() => handleMoveSubtype(pt, subIdx, -1)}
                                                aria-label={`Przesuń podrodzaj ${sub.label} w górę`}
                                                className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                                              >
                                                <ArrowUp className="w-3 h-3" aria-hidden="true" />
                                              </button>
                                              <button
                                                type="button"
                                                disabled={isSaving || subIdx === subtypes.length - 1}
                                                onClick={() => handleMoveSubtype(pt, subIdx, 1)}
                                                aria-label={`Przesuń podrodzaj ${sub.label} w dół`}
                                                className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                                              >
                                                <ArrowDown className="w-3 h-3" aria-hidden="true" />
                                              </button>
                                              <button
                                                type="button"
                                                disabled={isSaving}
                                                onClick={() => handleStartEditSubtype(pt.id, sub)}
                                                aria-label={`Edytuj podrodzaj ${sub.label}`}
                                                className="p-1 text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300"
                                              >
                                                <Edit3 className="w-3 h-3" aria-hidden="true" />
                                              </button>
                                              <button
                                                type="button"
                                                disabled={isSaving || subUsageCount > 0}
                                                onClick={() => handleDeleteSubtype(pt, sub)}
                                                aria-label={`Usuń podrodzaj ${sub.label}`}
                                                title={
                                                  subUsageCount > 0
                                                    ? `Używany (${subUsageCount}) — nie można usunąć`
                                                    : 'Usuń podrodzaj'
                                                }
                                                className="p-1 text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 disabled:opacity-30 disabled:cursor-not-allowed"
                                              >
                                                <Trash2 className="w-3 h-3" aria-hidden="true" />
                                              </button>
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {isAdmin && (
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="text"
                                  aria-label={`Nowy podrodzaj dla ${pt.label}`}
                                  maxLength={PROJECT_TYPE_LABEL_MAX}
                                  disabled={isSaving || subtypes.length >= VARIABLES_LIMITS.projectSubtypesMax}
                                  value={newSubtypeLabels[pt.id] || ''}
                                  onChange={(e) =>
                                    setNewSubtypeLabels((prev) => ({
                                      ...prev,
                                      [pt.id]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      void handleAddSubtype(pt);
                                    }
                                  }}
                                  placeholder="Nowy podrodzaj (np. Architektura, Konstrukcja)"
                                  className="flex-1 min-w-[200px] bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-white"
                                />
                                <button
                                  type="button"
                                  disabled={isSaving || subtypes.length >= VARIABLES_LIMITS.projectSubtypesMax}
                                  onClick={() => void handleAddSubtype(pt)}
                                  className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white rounded font-semibold text-xs transition-colors"
                                >
                                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Dodaj podrodzaj</span>
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {isAdmin && (
          <form
            onSubmit={handleAddProjectType}
            className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-wrap gap-3 items-end"
          >
            <div className="flex-1 min-w-[180px]">
              <label
                htmlFor="settings-new-project-type-label"
                className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1"
              >
                Nowy rodzaj projektu *
              </label>
              <input
                id="settings-new-project-type-label"
                type="text"
                maxLength={PROJECT_TYPE_LABEL_MAX}
                disabled={isSaving}
                value={newTypeLabel}
                onChange={(e) => setNewTypeLabel(e.target.value)}
                placeholder="np. Koncepcja drogowa"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <span className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                Kolor
              </span>
              <div className="flex items-center gap-1" role="group" aria-label="Kolor nowego rodzaju">
                {PROJECT_META_PALETTE.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    aria-label={`Kolor ${c.label}`}
                    aria-pressed={newTypeColor === c.key}
                    onClick={() => setNewTypeColor(c.key)}
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      newTypeColor === c.key
                        ? 'border-slate-900 dark:border-white scale-110'
                        : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c.swatchHex }}
                    title={c.label}
                  >
                    {newTypeColor === c.key && (
                      <Check className="w-3 h-3 text-white drop-shadow" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={isSaving || projectTypes.length >= VARIABLES_LIMITS.projectTypesMax}
              className="px-3.5 py-1.5 bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white rounded font-semibold text-xs shadow-xs transition-colors"
            >
              + Dodaj rodzaj
            </button>
          </form>
        )}
      </div>

      {/* Section: VAT Rates */}
      <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <Percent className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>Definicja stawek podatku VAT</span>
            </h4>
            <p className="text-slate-600 dark:text-slate-400 text-xs">
              Stawki VAT wykorzystywane w wycenach ofertowych oraz kalkulacji kosztów branżowych.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              disabled={isSaving}
              onClick={handleResetVatRates}
              className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
              title="Przywróć domyślne stawki (23%, 8%, 5%, 0%, ZW)"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Domyślne</span>
            </button>
          )}
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th scope="col" className="py-2 px-3 font-semibold w-24">Stawka %</th>
                <th scope="col" className="py-2 px-3 font-semibold">Nazwa / Opis stawki</th>
                <th scope="col" className="py-2 px-3 font-semibold w-28 text-center">Status</th>
                {isAdmin && <th scope="col" className="py-2 px-3 font-semibold w-16 text-center">Usuń</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {vatRates.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-white">
                    {v.isExempt ? 'ZW' : `${v.value ?? v.rate}%`}
                  </td>
                  <td className="py-2 px-3 text-slate-700 dark:text-slate-300 font-medium">
                    {v.label}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {v.isDefault ? (
                      <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-semibold">
                        Domyślna
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-600 dark:text-slate-400">Opcjonalna</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleDeleteVatRate(v.id)}
                        className="text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 p-1 disabled:opacity-50"
                        aria-label={`Usuń stawkę VAT ${v.label}`}
                        title="Usuń stawkę VAT"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add new VAT rate */}
        {isAdmin && (
          <form onSubmit={handleAddVatRate} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-wrap gap-2 items-end">
            <div className="w-24">
              <label htmlFor="settings-new-vat-rate" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Stawka %</label>
              <input
                id="settings-new-vat-rate"
                type="number"
                required
                step="0.01"
                min="0"
                max="100"
                disabled={isSaving || newVatExempt}
                value={newVatExempt ? 0 : newVatRate}
                onChange={(e) => setNewVatRate(Number(e.target.value))}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono disabled:opacity-60"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="settings-new-vat-label" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Etykieta stawki</label>
              <input
                id="settings-new-vat-label"
                type="text"
                required
                maxLength={VARIABLES_LIMITS.vatLabelMax}
                disabled={isSaving}
                value={newVatLabel}
                onChange={(e) => setNewVatLabel(e.target.value)}
                placeholder="np. 23% Podstawowa lub ZW (Zwolniony)"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-300 pb-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={newVatExempt}
                disabled={isSaving}
                onChange={(e) => setNewVatExempt(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700"
              />
              <span>ZW</span>
            </label>
            <button
              type="submit"
              disabled={isSaving}
              className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded font-semibold text-xs shadow-xs transition-colors"
            >
              + Dodaj stawkę
            </button>
          </form>
        )}
      </div>

      {/* Section: Task Types (Typy zadań: Rysunek, Opis, Uzgodnienia, Czekanie na urząd) */}
      <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <Tag className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              <span>Definicja Typów Zadań ({taskTypes.length})</span>
            </h4>
            <p className="text-slate-600 dark:text-slate-400 text-xs">
              Kategoryzacja zadań w pracowni: Rysunek, Opis, Uzgodnienia, Czekanie na urząd oraz typy zdefiniowane przez biuro.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              disabled={isSaving}
              onClick={handleResetTaskTypes}
              className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
              title="Przywróć domyślne typy zadań (Rysunek, Opis, Uzgodnienia, Czekanie na urząd)"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Domyślne typy</span>
            </button>
          )}
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th scope="col" className="py-2 px-3 font-semibold w-32">Identyfikator</th>
                <th scope="col" className="py-2 px-3 font-semibold">Nazwa typu zadania</th>
                <th scope="col" className="py-2 px-3 font-semibold">Opis / Zastosowanie</th>
                <th scope="col" className="py-2 px-3 font-semibold w-24 text-center">Status</th>
                {isAdmin && <th scope="col" className="py-2 px-3 font-semibold w-16 text-center">Usuń</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {taskTypes.map((tt) => (
                <tr key={tt.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
                    {tt.id}
                  </td>
                  <td className="py-2 px-3 font-bold text-slate-900 dark:text-white">
                    {tt.name || tt.label}
                  </td>
                  <td className="py-2 px-3 text-slate-600 dark:text-slate-400 text-[11px]">
                    {tt.description || '—'}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-800">
                      {tt.isDefault ? 'Standard' : 'Własny'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleDeleteTaskType(tt.id)}
                        className="text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 p-1 disabled:opacity-50"
                        aria-label={`Usuń typ zadania ${tt.name || tt.label}`}
                        title="Usuń ten typ zadania"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add new task type form */}
        {isAdmin && (
          <form onSubmit={handleAddTaskType} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-wrap gap-2 items-end">
            <div className="w-28">
              <label htmlFor="settings-task-type-id" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Kod / ID</label>
              <input
                id="settings-task-type-id"
                type="text"
                maxLength={VARIABLES_LIMITS.taskTypeIdMax}
                disabled={isSaving}
                value={newTaskTypeId}
                onChange={(e) => setNewTaskTypeId(e.target.value)}
                placeholder="np. nadzor"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label htmlFor="settings-task-type-label" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Nazwa typu *</label>
              <input
                id="settings-task-type-label"
                type="text"
                required
                maxLength={VARIABLES_LIMITS.taskTypeNameMax}
                disabled={isSaving}
                value={newTaskTypeLabel}
                onChange={(e) => setNewTaskTypeLabel(e.target.value)}
                placeholder="np. Nadzór autorski"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="settings-task-type-desc" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Opis / zastosowanie</label>
              <input
                id="settings-task-type-desc"
                type="text"
                maxLength={VARIABLES_LIMITS.taskTypeDescMax}
                disabled={isSaving}
                value={newTaskTypeDesc}
                onChange={(e) => setNewTaskTypeDesc(e.target.value)}
                placeholder="Zastosowanie w dokumentacji"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={isSaving}
              className="px-3.5 py-1.5 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white rounded font-semibold text-xs shadow-xs transition-colors"
            >
              + Dodaj typ
            </button>
          </form>
        )}
      </div>

      {/* Section: Clients list (visible only for admin and project_manager) */}
      {canViewClients && (
        <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <Building2 className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              <span>Baza stałych Zamawiających / Inwestorów ({clients.length})</span>
            </h4>
            <p className="text-slate-600 dark:text-slate-400 text-xs">
              Lista stałych Zamawiających dostępna w formularzach projektów i wycenach.
            </p>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th scope="col" className="py-2 px-3 font-semibold">Nazwa Inwestora</th>
                  <th scope="col" className="py-2 px-3 font-semibold">Osoba kontaktowa</th>
                  <th scope="col" className="py-2 px-3 font-semibold">NIP</th>
                  <th scope="col" className="py-2 px-3 font-semibold">Kontakt</th>
                  {isAdmin && <th scope="col" className="py-2 px-3 font-semibold w-16 text-center">Usuń</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 5 : 4} className="py-4 text-center text-slate-600 dark:text-slate-400">
                      Brak stałych inwestorów w bazie.
                    </td>
                  </tr>
                ) : (
                  clients.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">
                        {c.name}
                        {c.address && <span className="block text-[10px] text-slate-600 dark:text-slate-400 font-normal">{c.address}</span>}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                        {c.contactPerson || '—'}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                        {c.nip || '—'}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-400 text-[11px]">
                        {c.phone && <div>{c.phone}</div>}
                        {c.email && <div className="text-sky-700 dark:text-sky-400">{c.email}</div>}
                        {!c.phone && !c.email && '—'}
                      </td>
                      {isAdmin && (
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleDeleteClient(c.id)}
                            className="text-slate-600 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 p-1 disabled:opacity-50"
                            aria-label={`Usuń inwestora ${c.name}`}
                            title="Usuń inwestora z bazy"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Add new client form */}
          {isAdmin && (
            <form onSubmit={handleAddClient} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
              <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                + Dodaj nowego Inwestora do listy stałych klientów
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  required
                  maxLength={VARIABLES_LIMITS.clientFieldMax}
                  disabled={isSaving}
                  aria-label="Nazwa firmy lub inwestora"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Nazwa firmy / Inwestora *"
                  className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                />
                <input
                  type="text"
                  maxLength={VARIABLES_LIMITS.clientFieldMax}
                  disabled={isSaving}
                  aria-label="Osoba kontaktowa"
                  value={newClientContact}
                  onChange={(e) => setNewClientContact(e.target.value)}
                  placeholder="Osoba kontaktowa"
                  className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                />
                <input
                  type="text"
                  maxLength={VARIABLES_LIMITS.clientNipMax}
                  disabled={isSaving}
                  aria-label="NIP inwestora"
                  value={newClientNip}
                  onChange={(e) => setNewClientNip(e.target.value)}
                  placeholder="NIP"
                  className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  maxLength={VARIABLES_LIMITS.clientFieldMax}
                  disabled={isSaving}
                  aria-label="Telefon inwestora"
                  value={newClientPhone}
                  onChange={(e) => setNewClientPhone(e.target.value)}
                  placeholder="Telefon (+48 ...)"
                  className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                />
                <input
                  type="email"
                  maxLength={VARIABLES_LIMITS.clientFieldMax}
                  disabled={isSaving}
                  aria-label="Adres e-mail inwestora"
                  value={newClientEmail}
                  onChange={(e) => setNewClientEmail(e.target.value)}
                  placeholder="Adres E-mail"
                  className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={isSaving}
                  className="py-1.5 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white rounded font-semibold text-xs transition-colors shadow-xs"
                >
                  Zapisz Inwestora w bazie
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

export default VariablesTab;
