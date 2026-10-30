import React, { useState, useEffect } from 'react';
import { Project, Task, User, Priority, ProjectTemplate } from '../types';
import { downloadIcsFile } from '../utils/calendar';
import { getNextProjectCode, isProjectCodeAvailable, isValidProjectCodeFormat } from '../utils/projectCode';
import { loadAllProjectTemplates } from '../utils/projectTemplates';
import { AdminTemplateManagerModal } from './AdminTemplateManagerModal';
import { ProjectFinancialsModal } from './ProjectFinancialsModal';
import { ProjectDetailModal } from './ProjectDetailModal';
import { 
  FolderPlus, 
  Calendar, 
  Download, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Layers, 
  Plus, 
  Briefcase,
  Users,
  Edit3,
  X,
  Check,
  Building2,
  Trash2,
  DollarSign,
  TrendingUp,
  Receipt,
  Folder,
  Copy,
  Eye,
  Archive,
  ArchiveRestore
} from 'lucide-react';
import { getClients, registerClientIfNew, getVatRates } from '../utils/variableSettings';

interface ProjectsOverviewProps {
  projects: Project[];
  tasks: Task[];
  users: User[];
  currentUser: User;
  onSelectProject: (projectId: string) => void;
  onAddProject: (newProject: Omit<Project, 'id'>, selectedTemplate?: ProjectTemplate) => void;
  onUpdateProject?: (updatedProject: Project) => void;
  onDeleteProject?: (projectId: string) => void;
  onDeleteAllDemoData?: () => void;
}

export const ProjectsOverview: React.FC<ProjectsOverviewProps> = ({
  projects,
  tasks,
  users,
  currentUser,
  onSelectProject,
  onAddProject,
  onUpdateProject,
  onDeleteProject,
  onDeleteAllDemoData,
}) => {
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

  // Read-only project details viewer
  const [viewingProject, setViewingProject] = useState<Project | null>(null);

  // Admin archive confirmation modal
  const [projectToArchive, setProjectToArchive] = useState<{
    project: Project;
    incompleteCount: number;
  } | null>(null);

  // Form fields
  const [projectCode, setProjectCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [status, setStatus] = useState<'active' | 'planning' | 'on_hold' | 'completed'>('active');
  const [startDate, setStartDate] = useState('2026-10-24');
  const [durationDays, setDurationDays] = useState<number>(60);
  const [dueDate, setDueDate] = useState('2026-12-23');
  const [budget, setBudget] = useState('100 000 PLN');
  const [projectValue, setProjectValue] = useState<number>(100000);
  const [projectVatRate, setProjectVatRate] = useState<number>(23);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(['usr-1', 'usr-2']);

  // Client info fields
  const [clientName, setClientName] = useState('');
  const [clientContactPerson, setClientContactPerson] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientNip, setClientNip] = useState('');
  const [diskPath, setDiskPath] = useState('');
  const [copiedProjectId, setCopiedProjectId] = useState<string | null>(null);

  useEffect(() => {
    setAvailableTemplates(loadAllProjectTemplates());
  }, [isModalOpen, isTemplateManagerOpen]);

  // Check code availability
  const isCodeAvailable = isProjectCodeAvailable(projectCode, projects, editingProject?.id);
  const isCodeFormatValid = isValidProjectCodeFormat(projectCode);
  const isFormValid = name.trim().length > 0 && isCodeAvailable && isCodeFormatValid;

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
    const nextCode = getNextProjectCode(projects);
    setProjectCode(nextCode);
    const templates = loadAllProjectTemplates();
    setAvailableTemplates(templates);

    if (preselectedTemplate) {
      setSelectedTemplateId(preselectedTemplate.id);
      setName(preselectedTemplate.name);
      setDescription(preselectedTemplate.description);
      setPriority(preselectedTemplate.defaultPriority);
      setStatus('active');
      setStartDate('2026-10-24');
      setDurationDays(preselectedTemplate.defaultDurationDays);
      setDueDate(calculateDueDate('2026-10-24', preselectedTemplate.defaultDurationDays));
      setBudget(preselectedTemplate.defaultBudget || '180 000 PLN');
      setProjectValue(180000);
      setProjectVatRate(23);
    } else {
      setSelectedTemplateId('none');
      setName('');
      setDescription('');
      setPriority('normal');
      setStatus('active');
      setStartDate('2026-10-24');
      setDurationDays(60);
      setDueDate('2026-12-23');
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
      registerClientIfNew({
        name: clientName.trim(),
        contactPerson: clientContactPerson.trim() || undefined,
        phone: clientPhone.trim() || undefined,
        email: clientEmail.trim() || undefined,
        nip: clientNip.trim() || undefined,
      });
    }

    const valNet = Number(projectValue || 0);
    const valGross = Math.round(valNet * (1 + (projectVatRate || 23) / 100) * 100) / 100;
    const budgetStr = valNet > 0 ? `${valNet.toLocaleString('pl-PL')} PLN` : budget;

    if (editingProject && onUpdateProject) {
      onUpdateProject({
        ...editingProject,
        key: projectCode,
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

      onAddProject(
        {
          key: projectCode,
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
  const activeProjects = projects.filter((p) => !p.isArchived);
  const archivedProjects = projects.filter((p) => p.isArchived);
  const displayedProjects = activeTab === 'active' ? activeProjects : archivedProjects;

  return (
    <div className="space-y-6">
      {/* Top Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            <span>Katalog Tematów i Projektów Pracowni</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-bold">
              {projects.length}
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Zarządzaj tematami projektowymi, zamawiającymi, wycenami ofertowymi oraz kosztorysem branżowym.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {demoProjectsCount > 0 && onDeleteAllDemoData && (
            <button
              onClick={onDeleteAllDemoData}
              className="flex items-center gap-1.5 border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-xs font-semibold px-3 py-2 rounded transition-colors"
              title="Usuń tematy wstawione pokazowo"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Usuń tematy demo ({demoProjectsCount})</span>
            </button>
          )}

          <button
            onClick={() => openCreateModal()}
            className="flex items-center gap-1.5 bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 text-white text-xs font-semibold px-4 py-2 rounded transition-colors shadow-xs"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Zarejestruj nowy projekt</span>
          </button>
        </div>
      </div>

      {/* Tabs: Aktywne projekty vs Archiwum Projektów */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('active')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'active'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Building2 className="w-3.5 h-3.5" />
          <span>Aktywne projekty ({activeProjects.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('archived')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'archived'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Archive className="w-3.5 h-3.5" />
          <span>Archiwum projektów ({archivedProjects.length})</span>
        </button>
      </div>

      {/* Projects Grid */}
      {displayedProjects.length === 0 ? (
        <div className="p-12 bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl text-center space-y-3">
          <Archive className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm">
            {activeTab === 'active' ? 'Brak aktywnych projektów' : 'Brak zarchiwizowanych projektów'}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {activeTab === 'active'
              ? 'Zarejestruj nowy projekt za pomocą przycisku powyżej.'
              : 'Gdy ukończysz projekt, administrator może przenieść go do tego archiwum.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {displayedProjects.map((project) => {
            const projectTasks = tasks.filter((t) => t.projectId === project.id);
            const completedTasks = projectTasks.filter((t) => t.status === 'done').length;
            const criticalTasks = projectTasks.filter((t) => t.priority === 'critical' && t.status !== 'done').length;
            const members = users.filter((u) => project.memberIds?.includes(u.id));

            // Calculate project financial metrics
            const selectedQuotes = (project.quotations || []).filter((q) => q.isSelected !== false);
            const revenueQuotes = selectedQuotes.filter((q) => q.type !== 'koszt');
            const costQuotes = selectedQuotes.filter((q) => q.type === 'koszt');

            const baseContract = project.projectValue || 0;
            const quoteNet = revenueQuotes.reduce((acc, q) => acc + (q.totalNet || 0), 0);
            const totalProjectRev = baseContract + quoteNet;
            const directCostsNet = (project.costs || []).reduce((acc, c) => acc + (c.amountNet || 0), 0);
            const quoteCostsNet = costQuotes.reduce((acc, q) => acc + (q.totalNet || 0), 0);
            const totalCostsNet = directCostsNet + quoteCostsNet;
            const profitNet = totalProjectRev - totalCostsNet;

          return (
            <div
              key={project.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                {/* Top badges */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-sky-800 dark:text-sky-300 bg-sky-100 dark:bg-sky-950/60 px-2.5 py-0.5 rounded border border-sky-300 dark:border-sky-800">
                      {project.key}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {project.status === 'active' ? 'Aktywny' : project.status === 'planning' ? 'Planowanie' : project.status}
                    </span>
                    {project.isDemo && (
                      <span className="text-[10px] text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded">
                        Demo
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-semibold ${
                        project.priority === 'critical'
                          ? 'text-rose-600 dark:text-rose-400'
                          : project.priority === 'high'
                          ? 'text-amber-600 dark:text-amber-400'
                          : project.priority === 'normal'
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {project.priority === 'normal' ? 'Normalny' : project.priority.toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Project Title & Description */}
                <h3
                  onClick={() => onSelectProject(project.id)}
                  className="text-base font-bold text-slate-900 dark:text-white hover:text-sky-600 dark:hover:text-sky-400 cursor-pointer transition-colors"
                >
                  {project.name}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                  {project.description}
                </p>

                {/* Client / Investor Badge */}
                {project.clientName && (
                  <div className="mt-3 p-2 bg-slate-50 dark:bg-slate-800/60 rounded border border-slate-200/80 dark:border-slate-800 text-xs flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                      <Building2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                      <span className="truncate max-w-[190px] font-medium" title={project.clientName}>
                        {project.clientName}
                      </span>
                    </div>
                    {project.clientNip && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        NIP: {project.clientNip}
                      </span>
                    )}
                  </div>
                )}

                {/* Project Value & Breakdown Card */}
                <div className="mt-2.5 p-2.5 bg-slate-50/80 dark:bg-slate-800/50 rounded-lg border border-slate-200/80 dark:border-slate-700/80 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Wartość Projektu:</span>
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white text-xs">
                      {quoteNet > 0 ? `${quoteNet.toLocaleString('pl-PL')} zł netto` : (project.budget || 'Do wyceny')}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px]">
                    <div>
                      <span className="text-slate-500 block">Wycena:</span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {quoteNet > 0 ? `${quoteNet.toLocaleString('pl-PL')} zł` : '0 zł'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Koszty:</span>
                      <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                        {totalCostsNet > 0 ? `${totalCostsNet.toLocaleString('pl-PL')} zł` : '0 zł'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Zysk:</span>
                      <span className={`font-mono font-bold ${profitNet >= 0 ? 'text-sky-600 dark:text-sky-400' : 'text-rose-600'}`}>
                        {profitNet.toLocaleString('pl-PL')} zł
                      </span>
                    </div>
                  </div>

                  {revenueQuotes.length > 0 && (
                    <div className="pt-1 text-[10px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-1">
                      <span className="font-medium text-slate-600 dark:text-slate-300">Składowe:</span>
                      {revenueQuotes.slice(0, 3).map((rq) => (
                        <span key={rq.id} className="bg-slate-200/60 dark:bg-slate-700/50 px-1 py-0.2 rounded font-mono truncate max-w-[130px]">
                          {rq.title}
                        </span>
                      ))}
                      {revenueQuotes.length > 3 && (
                        <span>+{revenueQuotes.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Disk Location if specified */}
                {project.diskPath && (
                  <div className="mt-2.5 px-2.5 py-1.5 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/40 rounded flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Folder className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate" title={project.diskPath}>
                        {project.diskPath}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(project.diskPath || '');
                        setCopiedProjectId(project.id);
                        setTimeout(() => setCopiedProjectId(null), 2000);
                      }}
                      className="p-1 hover:bg-amber-100 dark:hover:bg-amber-900/60 rounded text-amber-700 dark:text-amber-300 shrink-0 ml-1"
                      title="Kopiuj ścieżkę na dysku"
                    >
                      {copiedProjectId === project.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}

                {/* Dates & Schedule with Duration in days */}
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-600" />
                    <span className="font-bold text-slate-900 dark:text-white font-mono">
                      {project.durationDays || 30} dni
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">({project.startDate} · {project.dueDate})</span>
                  </div>
                  {project.budget && <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 font-semibold">{project.budget}</span>}
                </div>

                {/* Progress bar */}
                <div className="mt-2.5">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">Postęp realizacji</span>
                    <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 font-bold">{project.progress}%</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      style={{ width: `${project.progress}%` }}
                      className={`h-full ${
                        project.progress === 100
                          ? 'bg-emerald-500'
                          : project.priority === 'critical'
                          ? 'bg-rose-500'
                          : 'bg-sky-500'
                      }`}
                    />
                  </div>
                </div>

                {/* Task counts stats */}
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded border border-slate-100 dark:border-slate-800">
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-semibold">Zadania</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                      {completedTasks} / {projectTasks.length} ukończonych
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-semibold">Krytyczne</span>
                    <span
                      className={`font-mono tabular-nums font-semibold ${
                        criticalTasks > 0 ? 'text-rose-600' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {criticalTasks} wymagających uwagi
                    </span>
                  </div>
                </div>
              </div>

              {/* Card Footer: Team members & Actions */}
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                {/* Team Avatars */}
                <div className="flex items-center -space-x-1.5 overflow-hidden">
                  {members.map((m) => (
                    <div
                      key={m.id}
                      className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 border-2 border-white dark:border-slate-900 text-[10px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-center"
                      title={`${m.name} (${m.role})`}
                    >
                      {m.initials}
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setViewingProject(project)}
                    className="p-1 text-slate-500 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950/40 rounded transition-colors"
                    title="Podgląd danych projektu bez wchodzenia w edycję"
                  >
                    <Eye className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                  </button>

                  <button
                    onClick={() => setFinancialsProject(project)}
                    className="p-1 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded transition-colors"
                    title="Wyceny Inwestorskie, Koszty (Mapa, Geologia, Uzgodnienia)"
                  >
                    <Receipt className="w-4 h-4 text-emerald-600" />
                  </button>

                  <button
                    onClick={() => openEditModal(project)}
                    className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                    title="Edytuj projekt i dane Zamawiającego"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => downloadIcsFile(projectTasks, `${project.key}-terminarz.ics`, project.name)}
                    className="p-1 text-slate-500 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950/40 rounded transition-colors"
                    title="Pobierz terminarz projektu (.ics)"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>

                  {/* Archive button for administrator */}
                  {currentUser.role === 'admin' && (
                    project.isArchived ? (
                      <button
                        onClick={() => handleRestoreProject(project)}
                        className="p-1 text-purple-600 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded transition-colors"
                        title="Przywróć projekt z archiwum do bieżącej pracy"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5 text-emerald-600" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRequestArchive(project)}
                        className="p-1 text-slate-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 rounded transition-colors"
                        title="Przenieś projekt do archiwum (Tylko Administrator)"
                      >
                        <Archive className="w-3.5 h-3.5 text-purple-600" />
                      </button>
                    )
                  )}

                  {/* Delete project button */}
                  {onDeleteProject && (
                    <button
                      onClick={() => setProjectToDelete(project)}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors"
                      title="Usuń projekt"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    onClick={() => onSelectProject(project.id)}
                    className="text-xs font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400 hover:underline px-1 py-0.5"
                  >
                    Otwórz →
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Financials Modal */}
      {financialsProject && (
        <ProjectFinancialsModal
          isOpen={true}
          onClose={() => setFinancialsProject(null)}
          project={financialsProject}
          tasks={tasks}
          onSaveProject={(updated) => {
            if (onUpdateProject) onUpdateProject(updated);
            setFinancialsProject(null);
          }}
        />
      )}

      {/* Project Detail Modal (Podgląd danych projektu bez wchodzenia w edycję) */}
      {viewingProject && (
        <ProjectDetailModal
          isOpen={true}
          onClose={() => setViewingProject(null)}
          project={viewingProject}
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
        <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-2.5 text-purple-600 dark:text-purple-400">
              <div className="p-2 bg-purple-100 dark:bg-purple-950/60 rounded-lg">
                <Archive className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Archiwizacja Projektu: [{projectToArchive.project.key}] {projectToArchive.project.name}
              </h3>
            </div>

            {projectToArchive.incompleteCount > 0 ? (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-lg flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
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
                Wszystkie zadania zostały zrealizowane. Projekt zostanie przeniesiony do zakładki "Archiwum projektów" i wykluczony z bieżących list operacyjnych.
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
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded font-semibold transition-colors shadow-xs"
              >
                Potwierdź archiwizację
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {projectToDelete && (
        <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-3 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
              <Trash2 className="w-5 h-5 shrink-0" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Usuń projekt</h4>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Czy na pewno chcesz bezpowrotnie usunąć temat <strong>{projectToDelete.key}: {projectToDelete.name}</strong> oraz wszystkie powiązane z nim zadania i pozycje kosztorysu?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setProjectToDelete(null)}
                className="px-3 py-1.5 rounded text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Anuluj
              </button>
              <button
                onClick={() => {
                  if (onDeleteProject) onDeleteProject(projectToDelete.id);
                  setProjectToDelete(null);
                }}
                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold shadow-xs"
              >
                Tak, usuń projekt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create or Edit Project */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {editingProject ? 'Edycja Projektu' : 'Rejestracja Nowego Projektu'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Kod projektu, Zamawiający, terminy i przypisani projektanci.
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* TEMPLATE PICKER - only when creating new project */}
              {!editingProject && (
                <div className="p-3 bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/50 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-purple-950 dark:text-purple-200 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-purple-600" />
                      <span>Użyj gotowego szablonu procesu</span>
                    </label>
                  </div>

                  <select
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

              {/* PROJECT CODE FIELD */}
              <div className="p-3 bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/50 rounded-lg space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-sky-950 dark:text-sky-200 block">
                    KOD Projektu (schemat np. 2026-01) *
                  </label>
                  <button
                    type="button"
                    onClick={() => setProjectCode(getNextProjectCode(projects))}
                    className="text-[11px] text-sky-700 dark:text-sky-400 hover:underline font-semibold"
                  >
                    Generuj kolejny nr
                  </button>
                </div>

                <div className="relative">
                  <input
                    type="text"
                    required
                    value={projectCode}
                    onChange={(e) => setProjectCode(e.target.value.toUpperCase())}
                    placeholder="np. 2026-04"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider text-slate-900 dark:text-white"
                  />
                  <div className="absolute right-2.5 top-2.5">
                    {isCodeAvailable && isCodeFormatValid ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded font-bold">
                        <Check className="w-3 h-3" /> Wolny
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded font-bold">
                        <X className="w-3 h-3" /> Zajęty
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Nazwa projektu *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="np. Budynek Usługowo-Biurowy Kat. XIV"
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Opis projektu</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Cel, zakres formalnoprawny, PZT, PAB, PT..."
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>

              {/* DANE ZAMAWIAJĄCEGO */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200 block text-[11px] uppercase tracking-wide flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-sky-600" />
                  <span>Zamawiający / Inwestor</span>
                </span>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400">Nazwa firmy / Inwestora</label>
                      {getClients().length > 0 && (
                        <select
                          onChange={(e) => {
                            const c = getClients().find((item) => item.id === e.target.value);
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
                          {getClients().map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <input
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="np. Nordic Development SA"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Osoba kontaktowa</label>
                    <input
                      type="text"
                      value={clientContactPerson}
                      onChange={(e) => setClientContactPerson(e.target.value)}
                      placeholder="np. Marek Zawadzki"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">NIP</label>
                    <input
                      type="text"
                      value={clientNip}
                      onChange={(e) => setClientNip(e.target.value)}
                      placeholder="525-00-00-000"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Telefon</label>
                    <input
                      type="text"
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      placeholder="+48 22 555 12 34"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">E-mail</label>
                    <input
                      type="email"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      placeholder="inwestycje@nordic.pl"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* LOKALIZACJA NA DYSKU / NAS */}
              <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-lg space-y-1.5">
                <span className="font-semibold text-amber-900 dark:text-amber-200 block text-[11px] uppercase tracking-wide flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Lokalizacja na dysku lokalnym lub serwerze NAS</span>
                </span>
                <input
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
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Data startu *</label>
                    <input
                      type="date"
                      required
                      value={startDate}
                      onChange={(e) => handleStartDateChange(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Czas trwania *
                    </label>
                    <div className="flex items-center">
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        required
                        value={durationDays}
                        onChange={(e) => handleDurationDaysChange(Number(e.target.value))}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono font-bold"
                      />
                      <span className="ml-1.5 font-mono text-slate-500">dni</span>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Termin końcowy</label>
                    <input
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
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Wartość Projektu (kwota umowy głównej)</span>
                </span>
                <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                  Kwota ta uwzględniana jest jako podstawowy przychód w bilansie i rentowności projektu.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Kwota netto (PLN) *</label>
                    <input
                      type="number"
                      min="0"
                      step="500"
                      value={projectValue}
                      onChange={(e) => setProjectValue(Number(e.target.value))}
                      placeholder="np. 150000"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Stawka VAT</label>
                    <select
                      value={projectVatRate}
                      onChange={(e) => setProjectVatRate(Number(e.target.value))}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    >
                      {getVatRates().map((v) => (
                        <option key={v.id} value={v.value ?? v.rate}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Wartość brutto (PLN)</label>
                    <input
                      type="text"
                      disabled
                      value={`${Math.round(projectValue * (1 + projectVatRate / 100)).toLocaleString('pl-PL')} zł`}
                      className="w-full bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 font-mono font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* Members */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Projektanci przypisani do zespołu:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {users.map((u) => {
                    const isSelected = selectedMemberIds.includes(u.id);
                    return (
                      <div
                        key={u.id}
                        onClick={() => toggleMember(u.id)}
                        className={`p-2 rounded border cursor-pointer flex items-center gap-2 transition-colors ${
                          isSelected
                            ? 'bg-sky-50 dark:bg-sky-950/50 border-sky-300 dark:border-sky-700 text-sky-900 dark:text-sky-200'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                          {u.initials}
                        </div>
                        <span className="text-xs truncate">{u.name}</span>
                      </div>
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
                  className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded shadow-xs"
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
