import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { Project, Task, User, Priority, ProjectTemplate, Company, ProjectNumberingSettings } from '../types';
import { downloadIcsFile } from '../utils/calendar';
import { getNextProjectCode, isProjectCodeAvailable, isValidProjectCodeFormat } from '../utils/projectCode';
import { loadAllProjectTemplates } from '../utils/projectTemplates';
import { ProjectDetailModal } from './ProjectDetailModal';
import { FIELD_LIMITS, canEditFinance, canViewFinance } from '../utils/access';
import { calcGrossFromNet, formatMoney } from '../utils/money';
import { getTodayIso } from '../utils/today';
import type { FinancePatchSaveResult } from '../hooks/useServerSync';
import { useFocusTrap } from '../utils/useFocusTrap';
import { ProjectTile } from './projects/ProjectTile';
import { ProjectRow } from './projects/ProjectRow';
import {
  loadProjectsViewPref,
  saveProjectsViewPref,
  sortProjectsList,
  ProjectsViewMode,
  ProjectListSortKey,
  ProjectListSortDirection,
} from './projects/projectsViewUtils';

const AdminTemplateManagerModal = lazy(() =>
  import('./AdminTemplateManagerModal').then((m) => ({ default: m.AdminTemplateManagerModal }))
);
const ProjectFinancialsModal = lazy(() =>
  import('./ProjectFinancialsModal').then((m) => ({ default: m.ProjectFinancialsModal }))
);
import {
  FolderPlus,
  AlertTriangle,
  Layers,
  X,
  Check,
  Building2,
  Trash2,
  DollarSign,
  Folder,
  Archive,
  Filter,
  LayoutGrid,
  List,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { registerClientIfNew } from '../utils/variableSettings';
import { useVariables } from '../hooks/useVariables';

const getTodayIsoDate = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const calculateDueDate = (start: string, days: number): string => {
  try {
    const d = new Date(start + 'T00:00:00');
    d.setDate(d.getDate() + Math.max(1, days) - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return start;
  }
};

const calculateDays = (start: string, end: string): number => {
  try {
    const d1 = new Date(start + 'T00:00:00').getTime();
    const d2 = new Date(end + 'T00:00:00').getTime();
    const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(1, diff);
  } catch {
    return 1;
  }
};

interface ProjectsOverviewProps {
  projects: Project[];
  companies?: Company[];
  projectNumbering?: ProjectNumberingSettings;
  tasks: Task[];
  users: User[];
  currentUser: User;
  onSelectProject: (projectId: string) => void;
  onAddProject: (newProject: Omit<Project, 'id' | 'key'> & { key?: string }, selectedTemplate?: ProjectTemplate) => void;
  onUpdateProject?: (updatedProject: Project) => void;
  onUpdateProjectFinance?: (projectId: string, patch: Partial<Project>, expectedRevision?: number) => Promise<FinancePatchSaveResult>;
  onApplyFreshProject?: (freshProject: Project) => void;
  onDeleteProject?: (projectId: string) => void;
  onDeleteAllDemoData?: () => void;
  trashRetentionDays?: number;
  pendingDetailProjectId?: string | null;
  onConsumePendingDetailProject?: () => void;
}

export const ProjectsOverview: React.FC<ProjectsOverviewProps> = ({
  projects,
  companies = [],
  projectNumbering = { scope: 'year' },
  tasks,
  users,
  currentUser,
  onSelectProject,
  onAddProject,
  onUpdateProject,
  onUpdateProjectFinance,
  onApplyFreshProject,
  onDeleteProject,
  onDeleteAllDemoData,
  trashRetentionDays = 30,
  pendingDetailProjectId = null,
  onConsumePendingDetailProject,
}) => {
  const { clients: availableClients, vatRates: availableVatRates } = useVariables();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('none');

  // Financials modal state
  const [financialsProject, setFinancialsProject] = useState<Project | null>(null);

  // Delete project confirmation state
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  // Tab filter: Active vs Archived projects
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [projectStatusFilter, setProjectStatusFilter] = useState<'all' | 'critical' | 'blocked' | 'in_progress' | 'completed'>('all');

  // View mode (Kafelki vs Lista) & sorting
  const [viewMode, setViewMode] = useState<ProjectsViewMode>(() => loadProjectsViewPref());
  const [sortKey, setSortKey] = useState<ProjectListSortKey | null>(null);
  const [sortDir, setSortDir] = useState<ProjectListSortDirection>('asc');

  // Read-only project details viewer
  const [viewingProject, setViewingProject] = useState<Project | null>(null);

  useEffect(() => {
    if (!pendingDetailProjectId) return;
    const matched = projects.find((p) => p.id === pendingDetailProjectId);
    if (matched) {
      setActiveTab(matched.isArchived ? 'archived' : 'active');
      setViewingProject(matched);
    }
    onConsumePendingDetailProject?.();
  }, [pendingDetailProjectId, projects, onConsumePendingDetailProject]);

  // Admin archive confirmation modal
  const [projectToArchive, setProjectToArchive] = useState<{
    project: Project;
    incompleteCount: number;
  } | null>(null);

  // Form fields
  const [projectCode, setProjectCode] = useState('');
  const [companyId, setCompanyId] = useState<string>('');
  const [useAutoCode, setUseAutoCode] = useState<boolean>(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [status, setStatus] = useState<'active' | 'planning' | 'on_hold' | 'completed'>('active');
  const [startDate, setStartDate] = useState(getTodayIsoDate);
  const [durationDays, setDurationDays] = useState<number>(60);
  const [dueDate, setDueDate] = useState(() => calculateDueDate(getTodayIsoDate(), 60));
  const [budget, setBudget] = useState('100 000 PLN');
  const [projectValue, setProjectValue] = useState<number>(100000);
  const [projectVatRate, setProjectVatRate] = useState<number>(23);
  const [ownerId, setOwnerId] = useState<string>('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(['usr-1', 'usr-2']);

  // Client info fields
  const [clientName, setClientName] = useState('');
  const [clientContactPerson, setClientContactPerson] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientNip, setClientNip] = useState('');
  const [diskPath, setDiskPath] = useState('');
  const [copiedProjectId, setCopiedProjectId] = useState<string | null>(null);

  const archiveModalRef = useRef<HTMLDivElement>(null);
  const deleteModalRef = useRef<HTMLDivElement>(null);
  const formModalRef = useRef<HTMLDivElement>(null);

  useFocusTrap({
    isOpen: Boolean(projectToArchive),
    containerRef: archiveModalRef,
    onClose: () => setProjectToArchive(null),
  });

  useFocusTrap({
    isOpen: Boolean(projectToDelete),
    containerRef: deleteModalRef,
    onClose: () => setProjectToDelete(null),
  });

  useFocusTrap({
    isOpen: isModalOpen,
    containerRef: formModalRef,
    onClose: () => setIsModalOpen(false),
  });

  useEffect(() => {
    setAvailableTemplates(loadAllProjectTemplates());
  }, [isModalOpen, isTemplateManagerOpen]);

  const activeCompanies = useMemo(
    () => companies.filter((c) => c.isActive).sort((a, b) => a.letter.localeCompare(b.letter)),
    [companies]
  );

  const isAdminOrPm = currentUser.role === 'admin' || currentUser.role === 'project_manager';
  const canEditSelectedProjectCompany = editingProject
    ? currentUser.role === 'admin' ||
      canEditFinance(currentUser, editingProject) ||
      (Boolean(editingProject.ownerId) && editingProject.ownerId === currentUser.id)
    : true;

  const autoPreviewInfo = useMemo(() => {
    if (editingProject || activeCompanies.length === 0) {
      return { code: '', error: null as string | null };
    }
    if (!companyId) {
      return { code: '', error: null as string | null };
    }
    try {
      const preview = getNextProjectCode(
        projects,
        [],
        companies,
        companyId,
        new Date().getFullYear(),
        projectNumbering.scope
      );
      return { code: preview, error: null as string | null };
    } catch (err: any) {
      return { code: '', error: err?.message || 'Błąd generowania numeru' };
    }
  }, [editingProject, activeCompanies.length, companyId, projects, companies, projectNumbering.scope]);

  // Check code availability
  const isAutoModeActive = !editingProject && activeCompanies.length > 0 && useAutoCode;
  const requiresCompanySelection = !editingProject && activeCompanies.length > 0;
  const isCodeAvailable = isAutoModeActive
    ? !autoPreviewInfo.error
    : isProjectCodeAvailable(projectCode, projects, editingProject?.id);
  const isCodeFormatValid = isAutoModeActive
    ? !autoPreviewInfo.error
    : isValidProjectCodeFormat(projectCode);
  const isFormValid =
    name.trim().length > 0 &&
    (!requiresCompanySelection || Boolean(companyId)) &&
    isCodeAvailable &&
    isCodeFormatValid;

  const handleStartDateChange = (newStart: string) => {
    setStartDate(newStart);
    setDueDate(calculateDueDate(newStart, durationDays));
  };

  const handleDurationDaysChange = (days: number) => {
    const val = Math.max(1, days);
    setDurationDays(val);
    setDueDate(calculateDueDate(startDate, val));
  };

  const handleDueDateChange = (newEnd: string) => {
    setDueDate(newEnd);
    setDurationDays(calculateDays(startDate, newEnd));
  };

  const openCreateModal = (preselectedTemplate?: ProjectTemplate) => {
    setEditingProject(null);
    const defaultCompany =
      projectNumbering.defaultCompanyId &&
      activeCompanies.some((c) => c.id === projectNumbering.defaultCompanyId)
        ? projectNumbering.defaultCompanyId
        : '';
    setCompanyId(defaultCompany);
    if (activeCompanies.length > 0) {
      setUseAutoCode(true);
      if (defaultCompany) {
        try {
          setProjectCode(
            getNextProjectCode(
              projects,
              [],
              companies,
              defaultCompany,
              new Date().getFullYear(),
              projectNumbering.scope
            )
          );
        } catch {
          setProjectCode('');
        }
      } else {
        setProjectCode('');
      }
    } else {
      setUseAutoCode(false);
      setProjectCode(getNextProjectCode(projects));
    }
    const templates = loadAllProjectTemplates();
    setAvailableTemplates(templates);

    const today = getTodayIsoDate();
    if (preselectedTemplate) {
      setSelectedTemplateId(preselectedTemplate.id);
      setName(preselectedTemplate.name);
      setDescription(preselectedTemplate.description);
      setPriority(preselectedTemplate.defaultPriority);
      setStatus('active');
      setStartDate(today);
      setDurationDays(preselectedTemplate.defaultDurationDays);
      setDueDate(calculateDueDate(today, preselectedTemplate.defaultDurationDays));
      setBudget(preselectedTemplate.defaultBudget || '180 000 PLN');
      setProjectValue(180000);
      setProjectVatRate(23);
    } else {
      setSelectedTemplateId('none');
      setName('');
      setDescription('');
      setPriority('normal');
      setStatus('active');
      setStartDate(today);
      setDurationDays(60);
      setDueDate(calculateDueDate(today, 60));
      setBudget('150 000 PLN');
      setProjectValue(150000);
      setProjectVatRate(23);
    }
    setClientName('');
    setClientContactPerson('');
    setClientPhone('');
    setClientEmail('');
    setClientNip('');
    setDiskPath('');
    setOwnerId('');
    setSelectedMemberIds(['usr-1', 'usr-2']);
    setIsModalOpen(true);
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (templateId === 'none') return;
    const tpl = availableTemplates.find((t) => t.id === templateId);
    if (tpl) {
      setName(tpl.name);
      setDescription(tpl.description);
      setPriority(tpl.defaultPriority);
      setDurationDays(tpl.defaultDurationDays);
      setDueDate(calculateDueDate(startDate, tpl.defaultDurationDays));
      if (tpl.defaultBudget) setBudget(tpl.defaultBudget);
    }
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setCompanyId(project.companyId || '');
    setUseAutoCode(false);
    setProjectCode(project.key);
    setName(project.name);
    setDescription(project.description);
    setPriority(project.priority);
    setStatus(project.status);
    setStartDate(project.startDate);
    setDurationDays(project.durationDays || 30);
    setDueDate(project.dueDate);
    setBudget(project.budget || '');
    setProjectValue(project.projectValue || 100000);
    setProjectVatRate(project.projectVatRate !== undefined ? project.projectVatRate : 23);
    setOwnerId(project.ownerId || '');
    setSelectedMemberIds(project.memberIds || []);
    setClientName(project.clientName || '');
    setClientContactPerson(project.clientContactPerson || '');
    setClientPhone(project.clientPhone || '');
    setClientEmail(project.clientEmail || '');
    setClientNip(project.clientNip || '');
    setDiskPath(project.diskPath || '');
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;

    if (clientName.trim()) {
      registerClientIfNew(
        {
          name: clientName.trim(),
          contactPerson: clientContactPerson.trim() || undefined,
          phone: clientPhone.trim() || undefined,
          email: clientEmail.trim() || undefined,
          nip: clientNip.trim() || undefined,
        },
        { syncToServer: currentUser?.role === 'admin' }
      );
    }

    const valNet = Number(projectValue || 0);
    const valGross = calcGrossFromNet(valNet, projectVatRate || 23);
    const budgetStr = valNet > 0 ? `${formatMoney(valNet)} PLN` : budget;

    if (editingProject && onUpdateProject) {
      onUpdateProject({
        ...editingProject,
        key: editingProject.key !== projectCode ? projectCode : editingProject.key,
        ...(canEditSelectedProjectCompany
          ? { companyId: companyId || undefined }
          : {}),
        name,
        description,
        priority,
        status,
        startDate,
        dueDate,
        durationDays,
        budget: budgetStr,
        projectValue: valNet,
        projectValueGross: valGross,
        projectVatRate,
        ownerId: ownerId || undefined,
        memberIds: selectedMemberIds,
        clientName: clientName.trim() || undefined,
        clientContactPerson: clientContactPerson.trim() || undefined,
        clientPhone: clientPhone.trim() || undefined,
        clientEmail: clientEmail.trim() || undefined,
        clientNip: clientNip.trim() || undefined,
        diskPath: diskPath.trim() || undefined,
      });
    } else {
      const template = selectedTemplateId !== 'none'
        ? availableTemplates.find((t) => t.id === selectedTemplateId)
        : undefined;

      const customKeyPayload =
        activeCompanies.length === 0 || (!useAutoCode && isAdminOrPm && projectCode.trim())
          ? projectCode.trim().toUpperCase()
          : undefined;

      onAddProject(
        {
          ...(customKeyPayload ? { key: customKeyPayload } : {}),
          ...(companyId ? { companyId } : {}),
          name,
          description,
          priority,
          status,
          startDate,
          dueDate,
          durationDays,
          progress: 0,
          budget: budgetStr,
          projectValue: valNet,
          projectValueGross: valGross,
          projectVatRate,
          ownerId: ownerId || undefined,
          spentHours: 0,
          memberIds: selectedMemberIds,
          color: '#0284c7',
          clientName: clientName.trim() || undefined,
          clientContactPerson: clientContactPerson.trim() || undefined,
          clientPhone: clientPhone.trim() || undefined,
          clientEmail: clientEmail.trim() || undefined,
          clientNip: clientNip.trim() || undefined,
          diskPath: diskPath.trim() || undefined,
        },
        template
      );
    }

    setIsModalOpen(false);
  };

  const handleRequestArchive = (project: Project) => {
    const projectTasks = tasks.filter((t) => t.projectId === project.id);
    const incompleteCount = projectTasks.filter((t) => t.status !== 'done').length;
    setProjectToArchive({ project, incompleteCount });
  };

  const handleConfirmArchive = () => {
    if (!projectToArchive || !onUpdateProject) return;
    onUpdateProject({
      ...projectToArchive.project,
      isArchived: true,
      archivedAt: new Date().toISOString(),
      archivedBy: currentUser.name,
    });
    setProjectToArchive(null);
  };

  const handleRestoreProject = (project: Project) => {
    if (!onUpdateProject) return;
    onUpdateProject({
      ...project,
      isArchived: false,
      archivedAt: undefined,
      archivedBy: undefined,
    });
  };

  const toggleMember = (userId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const demoProjectsCount = projects.filter((p) => p.isDemo).length;
  const activeProjects = useMemo(() => projects.filter((p) => !p.isArchived), [projects]);
  const archivedProjects = useMemo(() => projects.filter((p) => p.isArchived), [projects]);

  const criticalProjectsCount = useMemo(() => {
    return activeProjects.filter((p) => {
      const pTasks = tasks.filter((t) => t.projectId === p.id);
      return p.priority === 'critical' || pTasks.some((t) => t.priority === 'critical' && t.status !== 'done');
    }).length;
  }, [activeProjects, tasks]);

  const blockedProjectsCount = useMemo(() => {
    return activeProjects.filter((p) => {
      const pTasks = tasks.filter((t) => t.projectId === p.id);
      return p.status === 'on_hold' || pTasks.some((t) => t.status === 'blocked');
    }).length;
  }, [activeProjects, tasks]);

  const inProgressProjectsCount = useMemo(() => {
    return activeProjects.filter((p) => {
      const pTasks = tasks.filter((t) => t.projectId === p.id);
      return p.status === 'active' || pTasks.some((t) => t.status === 'in_progress');
    }).length;
  }, [activeProjects, tasks]);

  const completedProjectsCount = useMemo(() => {
    return activeProjects.filter((p) => {
      const pTasks = tasks.filter((t) => t.projectId === p.id);
      return p.status === 'completed' || (pTasks.length > 0 && pTasks.every((t) => t.status === 'done'));
    }).length;
  }, [activeProjects, tasks]);

  const displayedProjects = useMemo(() => {
    let list = activeTab === 'active' ? activeProjects : archivedProjects;
    if (activeTab === 'active') {
      if (projectStatusFilter === 'critical') {
        list = list.filter((p) => {
          const pTasks = tasks.filter((t) => t.projectId === p.id);
          return p.priority === 'critical' || pTasks.some((t) => t.priority === 'critical' && t.status !== 'done');
        });
      } else if (projectStatusFilter === 'blocked') {
        list = list.filter((p) => {
          const pTasks = tasks.filter((t) => t.projectId === p.id);
          return p.status === 'on_hold' || pTasks.some((t) => t.status === 'blocked');
        });
      } else if (projectStatusFilter === 'in_progress') {
        list = list.filter((p) => {
          const pTasks = tasks.filter((t) => t.projectId === p.id);
          return p.status === 'active' || pTasks.some((t) => t.status === 'in_progress');
        });
      } else if (projectStatusFilter === 'completed') {
        list = list.filter((p) => {
          const pTasks = tasks.filter((t) => t.projectId === p.id);
          return p.status === 'completed' || (pTasks.length > 0 && pTasks.every((t) => t.status === 'done'));
        });
      }
    }
    return list;
  }, [activeTab, activeProjects, archivedProjects, projectStatusFilter, tasks]);

  const todayIso = getTodayIso();

  const sortedListProjects = useMemo(
    () =>
      sortProjectsList(displayedProjects, {
        sortKey,
        sortDir,
        companies,
        users,
        tasks,
        currentUser,
        todayIso,
      }),
    [displayedProjects, sortKey, sortDir, companies, users, tasks, currentUser, todayIso]
  );

  const showClientColumn = useMemo(
    () =>
      currentUser.role === 'admin' ||
      currentUser.role === 'project_manager' ||
      displayedProjects.some((p) => canViewFinance(currentUser, p)),
    [currentUser, displayedProjects]
  );

  const companyById = useMemo(
    () => new Map(companies.map((c) => [c.id, c])),
    [companies]
  );

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const handleViewModeChange = (mode: ProjectsViewMode) => {
    setViewMode(mode);
    saveProjectsViewPref(mode);
  };

  const handleSort = (key: ProjectListSortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const getAriaSort = (key: ProjectListSortKey): 'ascending' | 'descending' | 'none' => {
    if (sortKey !== key) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  };

  const renderSortIcon = (key: ProjectListSortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="w-3 h-3 opacity-60 shrink-0" aria-hidden="true" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-sky-700 dark:text-sky-400 shrink-0" aria-hidden="true" />
    ) : (
      <ArrowDown className="w-3 h-3 text-sky-700 dark:text-sky-400 shrink-0" aria-hidden="true" />
    );
  };

  const handleCopyDiskPath = (projectId: string) => {
    setCopiedProjectId(projectId);
    window.setTimeout(() => setCopiedProjectId(null), 2000);
  };

  const handleDownloadProjectIcs = (project: Project) => {
    const projectTasks = tasks.filter((t) => t.projectId === project.id);
    downloadIcsFile(projectTasks, `${project.key}-terminarz.ics`, project.name);
  };

  return (
    <div className="space-y-6">
      {/* Top Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <span>Katalog Tematów i Projektów Pracowni</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-bold">
              {projects.length}
            </span>
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Zarządzaj tematami projektowymi, zamawiającymi, wycenami ofertowymi oraz kosztorysem branżowym.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {demoProjectsCount > 0 && onDeleteAllDemoData && (
            <button
              type="button"
              onClick={onDeleteAllDemoData}
              className="flex items-center gap-1.5 border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-xs font-semibold px-3 py-2 rounded transition-colors"
              title="Usuń tematy wstawione pokazowo"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Usuń tematy demo ({demoProjectsCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => openCreateModal()}
            className="flex items-center gap-1.5 bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-600 text-white text-xs font-semibold px-4 py-2 rounded transition-colors shadow-xs"
          >
            <FolderPlus className="w-4 h-4" aria-hidden="true" />
            <span>Zarejestruj nowy projekt</span>
          </button>
        </div>
      </div>

      {/* Tabs: Aktywne projekty vs Projekty archiwalne */}
      <div className="space-y-3">
        <div role="tablist" aria-label="Widoki projektów" className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'active'}
            onClick={() => {
              setActiveTab('active');
              setProjectStatusFilter('all');
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'active'
                ? 'bg-sky-700 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Aktywne projekty ({activeProjects.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'archived'}
            onClick={() => setActiveTab('archived')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'archived'
                ? 'bg-purple-700 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Archive className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Projekty archiwalne ({archivedProjects.length})</span>
          </button>
        </div>

        {/* Filters + View switcher row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {activeTab === 'active' ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mr-1 flex items-center gap-1">
                <Filter className="w-3 h-3" aria-hidden="true" />
                <span>Filtruj stan projektów:</span>
              </span>

              <button
                type="button"
                aria-pressed={projectStatusFilter === 'all'}
                onClick={() => setProjectStatusFilter('all')}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  projectStatusFilter === 'all'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                Wszystkie ({activeProjects.length})
              </button>

              <button
                type="button"
                aria-pressed={projectStatusFilter === 'critical'}
                onClick={() => setProjectStatusFilter('critical')}
                className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 transition-all ${
                  projectStatusFilter === 'critical'
                    ? 'bg-rose-700 text-white shadow-xs'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/40 hover:bg-rose-100'
                }`}
              >
                <span><span aria-hidden="true">🔴 </span>Krytyczne ({criticalProjectsCount})</span>
              </button>

              <button
                type="button"
                aria-pressed={projectStatusFilter === 'blocked'}
                onClick={() => setProjectStatusFilter('blocked')}
                className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 transition-all ${
                  projectStatusFilter === 'blocked'
                    ? 'bg-amber-700 text-white shadow-xs'
                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40 hover:bg-amber-100'
                }`}
              >
                <span><span aria-hidden="true">🔒 </span>Zablokowane ({blockedProjectsCount})</span>
              </button>

              <button
                type="button"
                aria-pressed={projectStatusFilter === 'in_progress'}
                onClick={() => setProjectStatusFilter('in_progress')}
                className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 transition-all ${
                  projectStatusFilter === 'in_progress'
                    ? 'bg-sky-700 text-white shadow-xs'
                    : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-900/40 hover:bg-sky-100'
                }`}
              >
                <span><span aria-hidden="true">⚡ </span>W toku ({inProgressProjectsCount})</span>
              </button>

              <button
                type="button"
                aria-pressed={projectStatusFilter === 'completed'}
                onClick={() => setProjectStatusFilter('completed')}
                className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 transition-all ${
                  projectStatusFilter === 'completed'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40 hover:bg-emerald-100'
                }`}
              >
                <span><span aria-hidden="true">✅ </span>Ukończone ({completedProjectsCount})</span>
              </button>
            </div>
          ) : (
            <div className="flex-1 min-w-[260px] p-3 bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/50 rounded-lg flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-purple-900 dark:text-purple-200">
                <Archive className="w-4 h-4 text-purple-700 dark:text-purple-400 shrink-0" aria-hidden="true" />
                <span>
                  <strong>Zakładka: Projekty archiwalne.</strong> Z poziomu tej zakładki możesz przywrócić projekt do aktywnych lub <strong>całkowicie i bezpowrotnie usunąć projekt z bazy</strong>.
                </span>
              </div>
            </div>
          )}

          {/* Switcher Kafelki / Lista */}
          <div
            role="group"
            aria-label="Widok listy projektów"
            className="inline-flex items-center rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 shrink-0 ml-auto"
          >
            <button
              type="button"
              aria-pressed={viewMode === 'tiles'}
              onClick={() => handleViewModeChange('tiles')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'tiles'
                  ? 'bg-sky-700 text-white shadow-2xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Kafelki</span>
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'list'}
              onClick={() => handleViewModeChange('list')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'list'
                  ? 'bg-sky-700 text-white shadow-2xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <List className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Lista</span>
            </button>
          </div>
        </div>
      </div>

      {/* Projects Content */}
      {displayedProjects.length === 0 ? (
        <div className="p-12 bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl text-center space-y-3">
          <Archive className="w-8 h-8 text-slate-500 dark:text-slate-400 mx-auto" aria-hidden="true" />
          <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm">
            {activeTab === 'active' ? 'Brak aktywnych projektów' : 'Brak zarchiwizowanych projektów'}
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
            {activeTab === 'active'
              ? 'Zarejestruj nowy projekt za pomocą przycisku powyżej.'
              : 'Gdy ukończysz projekt, administrator może przenieść go do tego archiwum.'}
          </p>
        </div>
      ) : viewMode === 'tiles' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {displayedProjects.map((project) => {
            const projectTasks = tasks.filter((t) => t.projectId === project.id);
            const members = users.filter((u) => project.memberIds?.includes(u.id));
            return (
              <ProjectTile
                key={project.id}
                project={project}
                companies={companies}
                projectTasks={projectTasks}
                members={members}
                currentUser={currentUser}
                copiedProjectId={copiedProjectId}
                onCopyDiskPath={handleCopyDiskPath}
                onOpen={onSelectProject}
                onViewDetails={setViewingProject}
                onOpenFinancials={setFinancialsProject}
                onEdit={openEditModal}
                onDownloadIcs={handleDownloadProjectIcs}
                onArchive={handleRequestArchive}
                onRestore={handleRestoreProject}
                onDelete={onDeleteProject ? (p) => setProjectToDelete(p) : undefined}
              />
            );
          })}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
          <div
            tabIndex={0}
            role="region"
            aria-label="Tabela projektów"
            className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          >
            <table className="w-full text-left border-collapse text-xs">
              <caption className="sr-only">
                Lista projektów ({sortedListProjects.length})
              </caption>
              <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                <tr>
                  <th scope="col" aria-sort={getAriaSort('key')} className="px-2.5 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('key')}
                      className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                    >
                      <span>Numer</span>
                      {renderSortIcon('key')}
                    </button>
                  </th>
                  <th scope="col" aria-sort={getAriaSort('name')} className="px-2.5 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('name')}
                      className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                    >
                      <span>Nazwa</span>
                      {renderSortIcon('name')}
                    </button>
                  </th>
                  <th scope="col" aria-sort={getAriaSort('company')} className="px-2.5 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('company')}
                      className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                    >
                      <span>Firma</span>
                      {renderSortIcon('company')}
                    </button>
                  </th>
                  {showClientColumn && (
                    <th scope="col" aria-sort={getAriaSort('clientName')} className="px-2.5 py-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('clientName')}
                        className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                      >
                        <span>Zamawiający</span>
                        {renderSortIcon('clientName')}
                      </button>
                    </th>
                  )}
                  <th scope="col" aria-sort={getAriaSort('status')} className="px-2.5 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('status')}
                      className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                    >
                      <span>Status</span>
                      {renderSortIcon('status')}
                    </button>
                  </th>
                  <th scope="col" aria-sort={getAriaSort('priority')} className="px-2.5 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('priority')}
                      className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                    >
                      <span>Priorytet</span>
                      {renderSortIcon('priority')}
                    </button>
                  </th>
                  <th scope="col" aria-sort={getAriaSort('dueDate')} className="px-2.5 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('dueDate')}
                      className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                    >
                      <span>Termin</span>
                      {renderSortIcon('dueDate')}
                    </button>
                  </th>
                  <th scope="col" aria-sort={getAriaSort('progress')} className="px-2.5 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('progress')}
                      className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                    >
                      <span>Postęp</span>
                      {renderSortIcon('progress')}
                    </button>
                  </th>
                  <th scope="col" aria-sort={getAriaSort('tasks')} className="px-2.5 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('tasks')}
                      className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                      title="Zadania otwarte i zaległe"
                    >
                      <span>Zadania</span>
                      {renderSortIcon('tasks')}
                    </button>
                  </th>
                  <th scope="col" aria-sort={getAriaSort('owner')} className="px-2.5 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSort('owner')}
                      className="inline-flex items-center gap-1 font-bold hover:text-sky-700 dark:hover:text-sky-400"
                    >
                      <span>Właściciel</span>
                      {renderSortIcon('owner')}
                    </button>
                  </th>
                  <th scope="col" className="px-2.5 py-2.5 whitespace-nowrap text-right font-bold">
                    Akcje
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {sortedListProjects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    company={project.companyId ? companyById.get(project.companyId) : undefined}
                    owner={project.ownerId ? userById.get(project.ownerId) : undefined}
                    tasks={tasks}
                    currentUser={currentUser}
                    todayIso={todayIso}
                    showClientColumn={showClientColumn}
                    onOpen={onSelectProject}
                    onViewDetails={setViewingProject}
                    onOpenFinancials={setFinancialsProject}
                    onEdit={openEditModal}
                    onDownloadIcs={handleDownloadProjectIcs}
                    onArchive={handleRequestArchive}
                    onRestore={handleRestoreProject}
                    onDelete={onDeleteProject ? (p) => setProjectToDelete(p) : undefined}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Financials Modal */}
      {financialsProject && (
        <Suspense fallback={null}>
          <ProjectFinancialsModal
            isOpen={true}
            onClose={() => setFinancialsProject(null)}
            project={financialsProject}
            companies={companies}
            tasks={tasks}
            currentUser={currentUser}
            isAdmin={currentUser?.role === 'admin'}
            onSaveFinancePatch={onUpdateProjectFinance}
            onRefreshProject={(fresh) => {
              onApplyFreshProject?.(fresh);
              setFinancialsProject(fresh);
            }}
            onSaveProject={(updated) => {
              if (onUpdateProject) onUpdateProject(updated);
              setFinancialsProject(null);
            }}
          />
        </Suspense>
      )}

      {/* Project Detail Modal (Podgląd danych projektu bez wchodzenia w edycję) */}
      {viewingProject && (
        <ProjectDetailModal
          isOpen={true}
          onClose={() => setViewingProject(null)}
          project={viewingProject}
          companies={companies}
          tasks={tasks}
          users={users}
          currentUser={currentUser}
          onEditProject={(p) => {
            setViewingProject(null);
            openEditModal(p);
          }}
          onOpenFinancials={(p) => {
            setViewingProject(null);
            setFinancialsProject(p);
          }}
          onArchiveProject={currentUser.role === 'admin' ? (p) => {
            setViewingProject(null);
            handleRequestArchive(p);
          } : undefined}
        />
      )}

      {/* Archive Warning & Confirmation Modal for Administrator */}
      {projectToArchive && (
        <div
          className="fixed inset-0 z-60 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-project-modal-title"
        >
          <div ref={archiveModalRef} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-2.5 text-purple-700 dark:text-purple-400">
              <div className="p-2 bg-purple-100 dark:bg-purple-950/60 rounded-lg">
                <Archive className="w-5 h-5" aria-hidden="true" />
              </div>
              <h3 id="archive-project-modal-title" className="text-sm font-bold text-slate-900 dark:text-white">
                Archiwizacja Projektu: [{projectToArchive.project.key}] {projectToArchive.project.name}
              </h3>
            </div>

            {projectToArchive.incompleteCount > 0 ? (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-lg flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <span className="font-bold block">
                    Ostrzeżenie: Część zadań w projekcie nie jest jeszcze ukończona!
                  </span>
                  <p>
                    Projekt posiada <strong>{projectToArchive.incompleteCount} nieukończonych zadań</strong>.
                    Czy jako Administrator na pewno chcesz przenieść ten projekt do archiwum projektów?
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Wszystkie zadania zostały zrealizowane. Projekt zostanie przeniesiony do zakładki "Archiwum projektów" i wykluczony z bieżąących list operacyjnych.
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setProjectToArchive(null)}
                className="px-3.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded font-semibold transition-colors"
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={handleConfirmArchive}
                className="px-4 py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded font-semibold transition-colors shadow-xs"
              >
                Potwierdź archiwizację
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {projectToDelete && (() => {
        const projTasks = tasks.filter((t) => t.projectId === projectToDelete.id);
        const incompleteCount = projTasks.filter((t) => t.status !== 'done').length;

        return (
          <div
            className="fixed inset-0 z-60 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-modal-title"
          >
            <div ref={deleteModalRef} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-3 animate-in fade-in zoom-in-95">
              <div className="flex items-center gap-2.5 text-rose-700 dark:text-rose-400">
                <Trash2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                <h4 id="delete-project-modal-title" className="text-sm font-bold text-slate-900 dark:text-white">
                  {projectToDelete.isArchived ? 'Usunięcie projektu z archiwum' : 'Usuń projekt'}
                </h4>
              </div>

              {incompleteCount > 0 && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-lg flex items-start gap-2.5 text-xs text-rose-900 dark:text-rose-200">
                  <AlertTriangle className="w-5 h-5 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="space-y-1">
                    <span className="font-bold block">
                      <span aria-hidden="true">⚠️ </span>Uwaga: Projekt posiada {incompleteCount} nieukończonych zadań!
                    </span>
                    <p>
                      Część zadań nie została oznaczona jako ukończona. Wszystkie powiązane zadania oraz komentarze zostaną przeniesione do kosza razem z projektem.
                    </p>
                  </div>
                </div>
              )}

              <p className="text-xs text-slate-600 dark:text-slate-400">
                Czy na pewno chcesz usunąć temat <strong>{projectToDelete.key}: {projectToDelete.name}</strong>? Element trafi do kosza i będzie można go przywrócić przez {trashRetentionDays} dni.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setProjectToDelete(null)}
                  className="px-3 py-1.5 rounded text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onDeleteProject) onDeleteProject(projectToDelete.id);
                    setProjectToDelete(null);
                  }}
                  className="px-3.5 py-1.5 bg-rose-700 hover:bg-rose-600 text-white rounded text-xs font-semibold shadow-xs"
                >
                  Tak, przenieś do kosza
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal: Create or Edit Project */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-form-modal-title"
        >
          <div ref={formModalRef} className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
              <div>
                <h3 id="project-form-modal-title" className="text-sm font-bold text-slate-900 dark:text-white">
                  {editingProject ? 'Edycja Projektu' : 'Rejestracja Nowego Projektu'}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Kod projektu, Zamawiający, terminy i przypisani projektanci.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 p-1"
                aria-label="Zamknij okno projektu"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* TEMPLATE PICKER - only when creating new project */}
              {!editingProject && (
                <div className="p-3 bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/50 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="project-template-select" className="font-bold text-purple-950 dark:text-purple-200 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-purple-700 dark:text-purple-400" aria-hidden="true" />
                      <span>Użyj gotowego szablonu procesu</span>
                    </label>
                  </div>

                  <select
                    id="project-template-select"
                    value={selectedTemplateId}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-800 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="none">-- Czysty projekt (dodaj zadania ręcznie) --</option>
                    {availableTemplates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name} ({tpl.tasks.length} zadań · {tpl.defaultDurationDays} dni)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* COMPANY SELECTOR */}
              {(activeCompanies.length > 0 || Boolean(editingProject?.companyId)) && (
                <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 rounded-lg space-y-1.5">
                  <label htmlFor="project-company-select" className="font-bold text-indigo-950 dark:text-indigo-200 block">
                    Firma prowadząca projekt {!editingProject && activeCompanies.length > 0 ? '*' : ''}
                  </label>
                  <select
                    id="project-company-select"
                    value={companyId}
                    required={!editingProject && activeCompanies.length > 0}
                    disabled={Boolean(editingProject && !canEditSelectedProjectCompany)}
                    onChange={(e) => {
                      const nextCid = e.target.value;
                      setCompanyId(nextCid);
                      // Przy edycji zmiana firmy NIE zmienia wydanego numeru projektu
                    }}
                    className="w-full bg-white dark:bg-slate-900 border border-indigo-300 dark:border-indigo-800 rounded px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white disabled:opacity-60"
                  >
                    <option value="">
                      {editingProject
                        ? '-- Brak przypisanej firmy --'
                        : '-- Wybierz firmę prowadzącą --'}
                    </option>
                    {activeCompanies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.letter} - {c.name}
                      </option>
                    ))}
                    {editingProject?.companyId &&
                      !activeCompanies.some((c) => c.id === editingProject.companyId) &&
                      (() => {
                        const inactiveComp = companies.find((c) => c.id === editingProject.companyId);
                        return inactiveComp ? (
                          <option value={inactiveComp.id}>
                            {inactiveComp.letter} - {inactiveComp.name} (nieaktywna)
                          </option>
                        ) : null;
                      })()}
                  </select>
                  {editingProject ? (
                    <p className="text-[11px] text-indigo-800 dark:text-indigo-300">
                      {canEditSelectedProjectCompany
                        ? 'Zmiana firmy istniejącego projektu nie zmienia nadanego wcześniej numeru projektu.'
                        : 'Zmiana firmy jest dostępna wyłącznie dla administratora i właściciela projektu.'}
                    </p>
                  ) : (
                    !companyId && (
                      <p className="text-[11px] text-amber-800 dark:text-amber-300">
                        Wybierz firmę, aby przygotować numer projektu w formacie RRRR-X_L.
                      </p>
                    )
                  )}
                </div>
              )}

              {/* PROJECT CODE FIELD */}
              <div className="p-3 bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/50 rounded-lg space-y-1.5">
                {!editingProject && activeCompanies.length > 0 && useAutoCode ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sky-950 dark:text-sky-200">
                        Numer projektu:{' '}
                        <span className="font-mono text-sky-800 dark:text-sky-300">
                          {autoPreviewInfo.code || (companyId ? '—' : 'wybierz firmę')}
                        </span>
                      </span>
                      {isAdminOrPm && (
                        <button
                          type="button"
                          onClick={() => {
                            setUseAutoCode(false);
                            setProjectCode(autoPreviewInfo.code || '');
                          }}
                          className="text-[11px] text-sky-700 dark:text-sky-400 hover:underline font-semibold"
                        >
                          Wpisz własny numer
                        </button>
                      )}
                    </div>
                    {autoPreviewInfo.error ? (
                      <p className="text-[11px] text-rose-700 dark:text-rose-400 font-semibold">
                        {autoPreviewInfo.error}
                      </p>
                    ) : (
                      <p className="text-[11px] text-sky-800 dark:text-sky-300">
                        Podgląd kolejnego numeru — ostateczny numer nadaje synchronicznie serwer przy zapisie.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <label htmlFor="project-code-input" className="font-bold text-sky-950 dark:text-sky-200 block">
                        KOD Projektu (schemat np. 2026-1_A lub 2026-01) *
                      </label>
                      <div className="flex items-center gap-2">
                        {!editingProject && activeCompanies.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setUseAutoCode(true)}
                            className="text-[11px] text-sky-700 dark:text-sky-400 hover:underline font-semibold"
                          >
                            Nadaj automatycznie
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            try {
                              setProjectCode(
                                getNextProjectCode(
                                  projects,
                                  [],
                                  companies,
                                  companyId || undefined,
                                  new Date().getFullYear(),
                                  projectNumbering.scope
                                )
                              );
                            } catch {
                              // ignore if year exhausted
                            }
                          }}
                          className="text-[11px] text-sky-700 dark:text-sky-400 hover:underline font-semibold"
                        >
                          Generuj kolejny nr
                        </button>
                      </div>
                    </div>

                    <div className="relative">
                      <input
                        id="project-code-input"
                        type="text"
                        required
                        disabled={Boolean(editingProject && !isAdminOrPm)}
                        value={projectCode}
                        onChange={(e) => setProjectCode(e.target.value.toUpperCase())}
                        maxLength={FIELD_LIMITS.key}
                        placeholder="np. 2026-1_A"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider text-slate-900 dark:text-white disabled:opacity-60"
                      />
                      <div className="absolute right-2.5 top-2.5">
                        {isCodeAvailable && isCodeFormatValid ? (
                          <span className="flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded font-bold">
                            <Check className="w-3 h-3" aria-hidden="true" /> Wolny
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded font-bold">
                            <X className="w-3 h-3" aria-hidden="true" /> Zajęty
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div>
                <label htmlFor="project-name-input" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Nazwa projektu *</label>
                <input
                  id="project-name-input"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={FIELD_LIMITS.name}
                  placeholder="np. Budynek Usługowo-Biurowy Kat. XIV"
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label htmlFor="project-desc-input" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Opis projektu</label>
                <textarea
                  id="project-desc-input"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={FIELD_LIMITS.description}
                  placeholder="Cel, zakres formalnoprawny, PZT, PAB, PT..."
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>

              {/* DANE ZAMAWIAJĄCEGO */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200 block text-[11px] uppercase tracking-wide flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                  <span>Zamawiający / Inwestor</span>
                </span>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="project-client-name" className="block text-[11px] text-slate-600 dark:text-slate-400">Nazwa firmy / Inwestora</label>
                      {availableClients.length > 0 && (
                        <select
                          aria-label="Wybierz zamawiającego z bazy"
                          onChange={(e) => {
                            const c = availableClients.find((item) => item.id === e.target.value);
                            if (c) {
                              setClientName(c.name);
                              if (c.contactPerson) setClientContactPerson(c.contactPerson);
                              if (c.phone) setClientPhone(c.phone);
                              if (c.email) setClientEmail(c.email);
                              if (c.nip) setClientNip(c.nip);
                            }
                          }}
                          defaultValue=""
                          className="text-[10px] bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-slate-600 dark:text-slate-300"
                        >
                          <option value="" disabled>Wybierz z bazy</option>
                          {availableClients.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <input
                      id="project-client-name"
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      maxLength={FIELD_LIMITS.client}
                      placeholder="np. Nordic Development SA"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="project-client-contact" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Osoba kontaktowa</label>
                    <input
                      id="project-client-contact"
                      type="text"
                      value={clientContactPerson}
                      onChange={(e) => setClientContactPerson(e.target.value)}
                      maxLength={FIELD_LIMITS.client}
                      placeholder="np. Marek Zawadzki"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label htmlFor="project-client-nip" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">NIP</label>
                    <input
                      id="project-client-nip"
                      type="text"
                      value={clientNip}
                      onChange={(e) => setClientNip(e.target.value)}
                      maxLength={FIELD_LIMITS.client}
                      placeholder="525-00-00-000"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="project-client-phone" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Telefon</label>
                    <input
                      id="project-client-phone"
                      type="text"
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      maxLength={FIELD_LIMITS.client}
                      placeholder="+48 22 555 12 34"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="project-client-email" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">E-mail</label>
                    <input
                      id="project-client-email"
                      type="email"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      maxLength={FIELD_LIMITS.client}
                      placeholder="inwestycje@nordic.pl"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* LOKALIZACJA NA DYSKU / NAS */}
              <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-lg space-y-1.5">
                <label htmlFor="project-disk-path" className="font-semibold text-amber-900 dark:text-amber-200 block text-[11px] uppercase tracking-wide flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                  <span>Lokalizacja na dysku lokalnym lub serwerze NAS</span>
                </label>
                <input
                  id="project-disk-path"
                  type="text"
                  value={diskPath}
                  onChange={(e) => setDiskPath(e.target.value)}
                  placeholder="np. Z:\PROJEKTY\2026\2026-01-NordicTower lub /mnt/nas/projekty/..."
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                />
              </div>

              {/* DURATION & DATES */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200 block text-[11px] uppercase tracking-wide">
                  Harmonogram i Czas trwania w dniach
                </span>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="project-start-date" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Data startu *</label>
                    <input
                      id="project-start-date"
                      type="date"
                      required
                      value={startDate}
                      onChange={(e) => handleStartDateChange(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                    />
                  </div>

                  <div>
                    <label htmlFor="project-duration-days" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Czas trwania *
                    </label>
                    <div className="flex items-center">
                      <input
                        id="project-duration-days"
                        type="number"
                        min={1}
                        max={3650}
                        required
                        value={durationDays}
                        onChange={(e) => handleDurationDaysChange(Number(e.target.value))}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono font-bold"
                      />
                      <span className="ml-1.5 font-mono text-slate-600 dark:text-slate-400">dni</span>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="project-due-date" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Termin końcowy</label>
                    <input
                      id="project-due-date"
                      type="date"
                      required
                      value={dueDate}
                      onChange={(e) => handleDueDateChange(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* WARTOŚĆ PROJEKTU (KWOTA UMOWY GŁÓWNEJ) */}
              <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded-lg space-y-2">
                <span className="font-semibold text-emerald-950 dark:text-emerald-200 block text-[11px] uppercase tracking-wide flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                  <span>Wartość Projektu (kwota umowy głównej)</span>
                </span>
                <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                  Kwota ta uwzględniana jest jako podstawowy przychód w bilansie i rentowności projektu.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label htmlFor="project-value-net" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Kwota netto (PLN) *</label>
                    <input
                      id="project-value-net"
                      type="number"
                      min="0"
                      step="0.01"
                      value={projectValue}
                      onChange={(e) => setProjectValue(Number(e.target.value))}
                      placeholder="np. 150000"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label htmlFor="project-vat-rate" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Stawka VAT</label>
                    <select
                      id="project-vat-rate"
                      value={projectVatRate}
                      onChange={(e) => setProjectVatRate(Number(e.target.value))}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    >
                      {availableVatRates.map((v) => (
                        <option key={v.id} value={v.value ?? v.rate}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="project-value-gross" className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Wartość brutto (PLN)</label>
                    <input
                      id="project-value-gross"
                      type="text"
                      disabled
                      value={`${formatMoney(calcGrossFromNet(projectValue, projectVatRate))} zł`}
                      className="w-full bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 font-mono font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* Project Owner (uprawnienia finansowe) */}
              <div>
                <label htmlFor="project-owner-select" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Właściciel projektu (uprawnienia edycji finansów)
                </label>
                <select
                  id="project-owner-select"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                >
                  <option value="">Brak przypisanego właściciela (wszyscy kierownicy i administrator)</option>
                  {users
                    .filter((u) => u.role === 'admin' || u.role === 'project_manager')
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role === 'admin' ? 'Administrator' : 'Kierownik projektu'})
                      </option>
                    ))}
                </select>
              </div>

              {/* Members */}
              <div>
                <span id="project-members-label" className="block font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Projektanci przypisani do zespołu:
                </span>
                <div role="group" aria-labelledby="project-members-label" className="grid grid-cols-2 gap-2">
                  {users.map((u) => {
                    const isSelected = selectedMemberIds.includes(u.id);
                    return (
                      <button
                        type="button"
                        key={u.id}
                        aria-pressed={isSelected}
                        onClick={() => toggleMember(u.id)}
                        className={`p-2 rounded border cursor-pointer flex items-center gap-2 text-left transition-colors ${
                          isSelected
                            ? 'bg-sky-50 dark:bg-sky-950/50 border-sky-300 dark:border-sky-700 text-sky-900 dark:text-sky-200'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                          {u.initials}
                        </div>
                        <span className="text-xs truncate">{u.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={!isFormValid}
                  className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded shadow-xs"
                >
                  {editingProject ? 'Zapisz zmiany w projekcie' : 'Zarejestruj projekt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
