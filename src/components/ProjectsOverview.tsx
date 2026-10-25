import React, { useState, useEffect } from 'react';
import { Project, Task, User, Priority, ProjectTemplate } from '../types';
import { downloadIcsFile } from '../utils/calendar';
import { getNextProjectCode, isProjectCodeAvailable, isValidProjectCodeFormat } from '../utils/projectCode';
import { loadAllProjectTemplates } from '../utils/projectTemplates';
import { AdminTemplateManagerModal } from './AdminTemplateManagerModal';
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
  Sparkles,
  Building2
} from 'lucide-react';

interface ProjectsOverviewProps {
  projects: Project[];
  tasks: Task[];
  users: User[];
  currentUser: User;
  onSelectProject: (projectId: string) => void;
  onAddProject: (newProject: Omit<Project, 'id'>, selectedTemplate?: ProjectTemplate) => void;
  onUpdateProject?: (updatedProject: Project) => void;
}

export const ProjectsOverview: React.FC<ProjectsOverviewProps> = ({
  projects,
  tasks,
  users,
  currentUser,
  onSelectProject,
  onAddProject,
  onUpdateProject,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('none');

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
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(['usr-1', 'usr-2']);

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
    }
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
    setDescription(project.description || '');
    setPriority(project.priority || 'normal');
    setStatus(project.status || 'active');
    setStartDate(project.startDate || '2026-10-24');
    setDurationDays(project.durationDays || 30);
    setDueDate(project.dueDate || '2026-11-23');
    setBudget(project.budget || '');
    setSelectedMemberIds(project.memberIds || ['usr-1']);
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;

    const cleanKey = projectCode.trim().toUpperCase();
    const chosenTemplate = selectedTemplateId !== 'none'
      ? availableTemplates.find((t) => t.id === selectedTemplateId)
      : undefined;

    if (editingProject && onUpdateProject) {
      onUpdateProject({
        ...editingProject,
        key: cleanKey,
        name: name.trim(),
        description,
        priority,
        status,
        startDate,
        dueDate,
        durationDays: Number(durationDays) || 30,
        budget,
        memberIds: selectedMemberIds,
      });
    } else {
      onAddProject(
        {
          key: cleanKey,
          name: name.trim(),
          description,
          priority,
          status,
          startDate,
          dueDate,
          durationDays: Number(durationDays) || 30,
          progress: 0,
          budget,
          spentHours: 0,
          memberIds: selectedMemberIds,
          color: '#0284c7',
        },
        chosenTemplate
      );
    }

    setIsModalOpen(false);
  };

  const toggleMember = (userId: string) => {
    if (selectedMemberIds.includes(userId)) {
      setSelectedMemberIds(selectedMemberIds.filter((id) => id !== userId));
    } else {
      setSelectedMemberIds([...selectedMemberIds, userId]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white border border-slate-200 rounded-lg shadow-sm">
        <div>
          <h2 className="text-base font-bold text-slate-900">Portfolio Projektów</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Zarządzaj nadrzędnymi projektami, kodami projektów (schemat YYYY-NN), czasem trwania w dniach i budżetem.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {currentUser.role === 'admin' && (
            <button
              onClick={() => setIsTemplateManagerOpen(true)}
              className="flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 text-xs font-semibold px-3 py-2 rounded transition-colors shadow-xs"
              title="Zarządzaj szablonami projektów budowlanych pracowni"
            >
              <Layers className="w-4 h-4 text-purple-600" />
              <span>Szablony projektów (Admin)</span>
            </button>
          )}

          <button
            onClick={() => openCreateModal()}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2 rounded transition-colors shadow-xs"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Zarejestruj nowy projekt</span>
          </button>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {projects.map((project) => {
          const projectTasks = tasks.filter((t) => t.projectId === project.id);
          const completedTasks = projectTasks.filter((t) => t.status === 'done').length;
          const criticalTasks = projectTasks.filter((t) => t.priority === 'critical' && t.status !== 'done').length;
          const members = users.filter((u) => project.memberIds?.includes(u.id));

          return (
            <div
              key={project.id}
              className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                {/* Top badges */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-sky-800 bg-sky-100 px-2.5 py-0.5 rounded border border-sky-300">
                      {project.key}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {project.status === 'active' ? 'Aktywny' : project.status === 'planning' ? 'Planowanie' : project.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-semibold ${
                        project.priority === 'critical'
                          ? 'text-rose-600'
                          : project.priority === 'high'
                          ? 'text-amber-600'
                          : project.priority === 'normal'
                          ? 'text-blue-600'
                          : 'text-slate-600'
                      }`}
                    >
                      {project.priority === 'normal' ? 'Normalny' : project.priority.toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Project Title & Description */}
                <h3
                  onClick={() => onSelectProject(project.id)}
                  className="text-base font-bold text-slate-900 hover:text-sky-600 cursor-pointer transition-colors"
                >
                  {project.name}
                </h3>
                <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                  {project.description}
                </p>

                {/* Dates & Schedule with Duration in days */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-600" />
                    <span className="font-bold text-slate-900 font-mono">
                      {project.durationDays || 30} dni
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">({project.startDate} · {project.dueDate})</span>
                  </div>
                  {project.budget && <span className="font-mono tabular-nums text-slate-700 font-semibold">{project.budget}</span>}
                </div>

                {/* Progress bar */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-600 font-medium">Postęp realizacji</span>
                    <span className="font-mono tabular-nums text-slate-700 font-bold">{project.progress}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
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
                <div className="grid grid-cols-2 gap-2 mt-4 text-xs bg-slate-50 p-2.5 rounded border border-slate-100">
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-semibold">Zadania</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-800">
                      {completedTasks} / {projectTasks.length} ukończonych
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-semibold">Zadania krytyczne</span>
                    <span
                      className={`font-mono tabular-nums font-semibold ${
                        criticalTasks > 0 ? 'text-rose-600' : 'text-slate-700'
                      }`}
                    >
                      {criticalTasks} wymagających uwagi
                    </span>
                  </div>
                </div>
              </div>

              {/* Card Footer: Team members & Actions */}
              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                {/* Team Avatars */}
                <div className="flex items-center -space-x-1.5 overflow-hidden">
                  {members.map((m) => (
                    <div
                      key={m.id}
                      className="w-6 h-6 rounded-full bg-slate-200 border-2 border-white text-[10px] font-bold text-slate-700 flex items-center justify-center"
                      title={`${m.name} (${m.role})`}
                    >
                      {m.initials}
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  {currentUser.role === 'admin' && (
                    <button
                      onClick={() => setIsTemplateManagerOpen(true)}
                      className="p-1 text-slate-500 hover:text-purple-700 hover:bg-purple-50 rounded transition-colors"
                      title="Zapisz projekt jako szablon pracowni (Admin)"
                    >
                      <Layers className="w-3.5 h-3.5 text-purple-600" />
                    </button>
                  )}

                  <button
                    onClick={() => openEditModal(project)}
                    className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors"
                    title="Edytuj projekt i kod projektu"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => downloadIcsFile(projectTasks, `${project.key}-terminarz.ics`, project.name)}
                    className="p-1 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors"
                    title="Pobierz terminarz projektu (.ics) do Google Calendar"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => onSelectProject(project.id)}
                    className="text-xs font-semibold text-sky-600 hover:text-sky-700 hover:underline px-1 py-0.5"
                  >
                    Otwórz →
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal: Create or Edit Project */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-lg p-6 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingProject ? 'Edycja Projektu' : 'Rejestracja Nowego Projektu'}
                </h3>
                <p className="text-xs text-slate-500">
                  {editingProject
                    ? 'Zaktualizuj kod projektu, parametry harmonogramu i zespół.'
                    : 'Kod projektu nadawany jest automatycznie w schemacie YYYY-NN z możliwością edycji.'}
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {/* TEMPLATE PICKER - only when creating new project */}
              {!editingProject && (
                <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-purple-950 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-purple-700" />
                      <span>Stwórz projekt z szablonu (Opcjonalnie):</span>
                    </label>
                    {currentUser.role === 'admin' && (
                      <button
                        type="button"
                        onClick={() => setIsTemplateManagerOpen(true)}
                        className="text-[11px] text-purple-700 hover:underline font-semibold"
                      >
                        Kreator szablonów →
                      </button>
                    )}
                  </div>

                  <select
                    value={selectedTemplateId}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                    className="w-full bg-white border border-purple-300 rounded px-2.5 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-purple-500"
                  >
                    <option value="none">-- Czysty projekt (wprowadź własne etapy) --</option>
                    {availableTemplates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name} ({tpl.tasks.length} zadań, {tpl.defaultDurationDays} dni) {tpl.isCustom ? '[Własny]' : ''}
                      </option>
                    ))}
                  </select>

                  {selectedTemplateId !== 'none' && (() => {
                    const chosen = availableTemplates.find((t) => t.id === selectedTemplateId);
                    if (!chosen) return null;
                    const officialCount = chosen.tasks.filter((t) => t.isOfficialDeadline).length;
                    return (
                      <div className="bg-white/90 p-2 rounded border border-purple-200 text-[11px] space-y-1">
                        <div className="text-purple-900 font-bold flex items-center justify-between">
                          <span>✓ Szablon: {chosen.name}</span>
                          <span className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-mono font-bold">
                            {chosen.defaultDurationDays} dni roboczych
                          </span>
                        </div>
                        <p className="text-slate-600 line-clamp-2">{chosen.description}</p>
                        <div className="text-emerald-700 font-medium pt-0.5 flex items-center gap-2">
                          <span>• Automatycznie utworzy {chosen.tasks.length} etapów</span>
                          {officialCount > 0 && (
                            <span className="text-rose-700 font-bold">• {officialCount} terminów urzędowych KPA</span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* PROJECT CODE FIELD WITH AVAILABILITY CHECK */}
              <div className="p-3 bg-sky-50/70 border border-sky-200 rounded-lg space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-sky-950 block">
                    KOD Projektu (schemat np. 2026-01) *
                  </label>
                  <button
                    type="button"
                    onClick={() => setProjectCode(getNextProjectCode(projects))}
                    className="text-[11px] text-sky-700 hover:underline font-semibold"
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
                    className={`w-full bg-white border rounded px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider focus:outline-none focus:ring-1 ${
                      !isCodeFormatValid
                        ? 'border-rose-300 focus:ring-rose-500'
                        : isCodeAvailable
                        ? 'border-emerald-300 focus:ring-emerald-500 text-emerald-950'
                        : 'border-rose-400 focus:ring-rose-500 text-rose-950'
                    }`}
                  />
                  <div className="absolute right-2.5 top-2.5">
                    {isCodeAvailable && isCodeFormatValid ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-700 font-bold bg-emerald-100 px-1.5 py-0.5 rounded">
                        <Check className="w-3 h-3" /> Wolny
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-rose-700 font-bold bg-rose-100 px-1.5 py-0.5 rounded">
                        <X className="w-3 h-3" /> Zajęty
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-[11px]">
                  {isCodeAvailable && isCodeFormatValid ? (
                    <span className="text-emerald-700 font-medium">
                      ✓ Kod <strong className="font-mono">{projectCode}</strong> jest wolny i dostępny do przypisania.
                    </span>
                  ) : !isCodeFormatValid ? (
                    <span className="text-rose-600 font-medium">
                      Wprowadź poprawny kod projektu (min. 2 znaki alfanumeryczne, np. 2026-01).
                    </span>
                  ) : (
                    <span className="text-rose-600 font-bold">
                      ⚠ Kod <strong className="font-mono">{projectCode}</strong> jest już zajęty przez inny projekt! Zmień na unikalny numer.
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nazwa projektu *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="np. Wdrożenie Platformy B2B"
                  className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500 font-medium"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Opis projektu</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Krótki cel i zakres projektu..."
                  className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              {/* DURATION IN DAYS ASSIGNMENT */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <span className="font-semibold text-slate-800 block text-[11px] uppercase tracking-wide">
                  Harmonogram i Czas trwania w dniach
                </span>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Data startu *</label>
                    <input
                      type="date"
                      required
                      value={startDate}
                      onChange={(e) => handleStartDateChange(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
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
                        className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 font-mono font-bold"
                      />
                      <span className="ml-1.5 font-mono text-slate-500">dni</span>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Termin końcowy</label>
                    <input
                      type="date"
                      required
                      value={dueDate}
                      onChange={(e) => handleDueDateChange(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Priorytet projektu
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as Priority)}
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500 font-medium"
                  >
                    <option value="critical">Krytyczny (P1)</option>
                    <option value="high">Wysoki (P2)</option>
                    <option value="normal">Normalny (P3 - Domyślny)</option>
                    <option value="low">Niski (P4)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    <option value="active">Aktywny</option>
                    <option value="planning">W planowaniu</option>
                    <option value="on_hold">Wstrzymany</option>
                    <option value="completed">Zakończony</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Szacowany budżet</label>
                <input
                  type="text"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="np. 150 000 PLN"
                  className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Zespół projektowy</label>
                <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto p-2 border border-slate-200 rounded bg-slate-50">
                  {users.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedMemberIds.includes(u.id)}
                        onChange={() => toggleMember(u.id)}
                        className="rounded text-sky-600 focus:ring-0"
                      />
                      <span>{u.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded transition-colors"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={!isFormValid}
                  className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition-colors shadow-xs"
                >
                  {editingProject ? 'Zapisz zmiany w projekcie' : 'Zarejestruj projekt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Template Manager Modal */}
      <AdminTemplateManagerModal
        isOpen={isTemplateManagerOpen}
        onClose={() => setIsTemplateManagerOpen(false)}
        projects={projects}
        tasks={tasks}
        currentUser={currentUser}
        onSelectTemplateToCreate={(tpl) => openCreateModal(tpl)}
      />
    </div>
  );
};
