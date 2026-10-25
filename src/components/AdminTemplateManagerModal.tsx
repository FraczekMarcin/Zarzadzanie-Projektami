import React, { useState, useEffect } from 'react';
import { Project, Task, User, ProjectTemplate, TemplateTaskBlueprint } from '../types';
import { 
  loadAllProjectTemplates, 
  saveCustomProjectTemplate, 
  deleteCustomProjectTemplate, 
  createTemplateFromExistingProject 
} from '../utils/projectTemplates';
import { 
  X, 
  Layers, 
  Plus, 
  Copy, 
  Trash2, 
  CheckCircle2, 
  Building2, 
  Clock, 
  Calendar, 
  ShieldCheck, 
  FileText,
  AlertTriangle,
  FolderPlus,
  Eye
} from 'lucide-react';

interface AdminTemplateManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  tasks: Task[];
  currentUser: User;
  onSelectTemplateToCreate?: (template: ProjectTemplate) => void;
}

export const AdminTemplateManagerModal: React.FC<AdminTemplateManagerModalProps> = ({
  isOpen,
  onClose,
  projects,
  tasks,
  currentUser,
  onSelectTemplateToCreate,
}) => {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [activeTab, setActiveTab] = useState<'list' | 'from_project' | 'from_scratch'>('list');
  const [selectedPreviewTemplate, setSelectedPreviewTemplate] = useState<ProjectTemplate | null>(null);

  // Tab: from existing project
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || '');
  const [templateNameFromProj, setTemplateNameFromProj] = useState<string>('');
  const [templateCategoryFromProj, setTemplateCategoryFromProj] = useState<ProjectTemplate['category']>('kubaturowe');

  // Tab: from scratch
  const [scratchName, setScratchName] = useState('');
  const [scratchCategory, setScratchCategory] = useState<ProjectTemplate['category']>('kubaturowe');
  const [scratchDescription, setScratchDescription] = useState('');
  const [scratchDuration, setScratchDuration] = useState<number>(120);
  const [scratchBudget, setScratchBudget] = useState('150 000 PLN');
  const [scratchStages, setScratchStages] = useState<Array<{
    title: string;
    durationDays: number;
    offsetDays: number;
    isOfficialDeadline: boolean;
  }>>([
    { title: 'Badania geotechniczne i numeryczna mapa do celów projektowych', durationDays: 14, offsetDays: 0, isOfficialDeadline: false },
    { title: 'Uzyskanie Wypisu z MPZP lub Decyzji o Warunkach Zabudowy (WZ)', durationDays: 21, offsetDays: 0, isOfficialDeadline: true },
    { title: 'Projekt Zagospodarowania Terenu (PZT) i bilans mediów', durationDays: 20, offsetDays: 14, isOfficialDeadline: false },
    { title: 'Projekt Architektoniczno-Budowlany (PAB)', durationDays: 30, offsetDays: 30, isOfficialDeadline: false },
    { title: 'Narada koordynacyjna ZUD i uzgodnienia ppoż / sanepid', durationDays: 14, offsetDays: 50, isOfficialDeadline: true },
    { title: 'Złożenie wniosku o Pozwolenie na Budowę (PnB)', durationDays: 1, offsetDays: 65, isOfficialDeadline: true },
    { title: 'Projekt Techniczny (PT) wielobranżowy (Konstrukcja, Sanitarna, Elektryka)', durationDays: 45, offsetDays: 66, isOfficialDeadline: false },
  ]);

  const [notification, setNotification] = useState<string | null>(null);

  const refreshTemplates = () => {
    const list = loadAllProjectTemplates();
    setTemplates(list);
  };

  useEffect(() => {
    if (isOpen) {
      refreshTemplates();
      if (projects.length > 0 && !selectedProjectId) {
        setSelectedProjectId(projects[0].id);
      }
    }
  }, [isOpen, projects]);

  if (!isOpen) return null;

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  const handleCreateFromExisting = (e: React.FormEvent) => {
    e.preventDefault();
    const proj = projects.find((p) => p.id === selectedProjectId);
    if (!proj) return;

    const projTasks = tasks.filter((t) => t.projectId === proj.id);
    const created = createTemplateFromExistingProject(
      proj,
      projTasks,
      templateNameFromProj || `Szablon z [${proj.key}] ${proj.name}`,
      templateCategoryFromProj
    );

    refreshTemplates();
    showToast(`Szablon "${created.name}" został utworzony i zapisany!`);
    setActiveTab('list');
    setSelectedPreviewTemplate(created);
  };

  const handleAddScratchStage = () => {
    const last = scratchStages[scratchStages.length - 1];
    const newOffset = last ? last.offsetDays + last.durationDays : 0;
    setScratchStages([
      ...scratchStages,
      {
        title: `Nowy etap projektowy ${scratchStages.length + 1}`,
        durationDays: 14,
        offsetDays: newOffset,
        isOfficialDeadline: false,
      },
    ]);
  };

  const handleRemoveScratchStage = (index: number) => {
    setScratchStages(scratchStages.filter((_, idx) => idx !== index));
  };

  const handleSaveFromScratch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scratchName.trim()) return;

    const blueprints: TemplateTaskBlueprint[] = scratchStages.map((s, idx) => ({
      title: s.title,
      description: `Etap szablonu pracowni: ${s.title}`,
      type: s.durationDays === 1 && s.isOfficialDeadline ? 'milestone' : 'task',
      priority: s.isOfficialDeadline ? 'critical' : 'high',
      durationDays: Math.max(1, s.durationDays),
      offsetDays: Math.max(0, s.offsetDays),
      isOfficialDeadline: s.isOfficialDeadline,
      blockerIndices: idx > 0 ? [idx - 1] : [],
    }));

    const newTemplate: ProjectTemplate = {
      id: `custom-${Date.now()}`,
      name: scratchName.trim(),
      category: scratchCategory,
      description: scratchDescription.trim() || 'Szablon autorski administratora pracowni.',
      defaultDurationDays: Math.max(1, scratchDuration),
      defaultPriority: 'normal',
      defaultBudget: scratchBudget,
      tasks: blueprints,
      isCustom: true,
      createdAt: new Date().toISOString(),
    };

    saveCustomProjectTemplate(newTemplate);
    refreshTemplates();
    showToast(`Szablon "${newTemplate.name}" został pomyślnie utworzony!`);
    setActiveTab('list');
    setSelectedPreviewTemplate(newTemplate);
  };

  const handleDeleteTemplate = (id: string, name: string) => {
    if (confirm(`Czy na pewno usunąć szablon "${name}"?`)) {
      deleteCustomProjectTemplate(id);
      refreshTemplates();
      if (selectedPreviewTemplate?.id === id) {
        setSelectedPreviewTemplate(null);
      }
      showToast(`Szablon "${name}" został usunięty.`);
    }
  };

  const getCategoryLabel = (cat: ProjectTemplate['category']) => {
    switch (cat) {
      case 'kubaturowe':
        return 'Obiekty Kubaturowe';
      case 'mieszkaniowe':
        return 'Mieszkalnictwo';
      case 'przemyslowe':
        return 'Przemysł & Hale';
      case 'infrastruktura':
        return 'Infrastruktura & Sieci';
      case 'przebudowa':
        return 'Przebudowy & Zmiany Sposobu Użytkowania';
      default:
        return 'Ogólny';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-100 rounded-lg text-purple-700">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>Zarządzanie Szablonami Projektów Budowlanych</span>
                <span className="text-[10px] bg-purple-100 text-purple-800 font-semibold px-2 py-0.5 rounded-full border border-purple-300">
                  Panel Administratora
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Twórz szablony wielokrotnego użytku na podstawie gotowych projektów lub definiuj własne standardy pracowni.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notification Toast */}
        {notification && (
          <div className="bg-emerald-600 text-white text-xs px-6 py-2 flex items-center justify-between animate-in fade-in">
            <span className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              <span>{notification}</span>
            </span>
            <button onClick={() => setNotification(null)} className="text-emerald-200 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-slate-200 bg-white flex items-center gap-4 text-xs font-medium">
          <button
            onClick={() => setActiveTab('list')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'list'
                ? 'border-purple-600 text-purple-800 font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Katalog szablonów ({templates.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('from_project')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'from_project'
                ? 'border-purple-600 text-purple-800 font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-4 h-4 text-sky-600" />
            <span>Utwórz szablon z istniejącego projektu</span>
          </button>

          <button
            onClick={() => setActiveTab('from_scratch')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'from_scratch'
                ? 'border-purple-600 text-purple-800 font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Plus className="w-4 h-4 text-emerald-600" />
            <span>Zbuduj szablon od zera</span>
          </button>
        </div>

        {/* Tab 1: Templates List */}
        {activeTab === 'list' && (
          <div className="flex-1 flex overflow-hidden">
            {/* List sidebar */}
            <div className="w-72 border-r border-slate-200 bg-slate-50 p-4 space-y-2 overflow-y-auto">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block px-1">
                Dostępne szablony
              </span>
              {templates.map((tpl) => {
                const officialCount = tpl.tasks.filter((t) => t.isOfficialDeadline).length;
                const isSelected = selectedPreviewTemplate?.id === tpl.id;

                return (
                  <button
                    key={tpl.id}
                    onClick={() => setSelectedPreviewTemplate(tpl)}
                    className={`w-full text-left p-3 rounded-xl border text-xs transition-all space-y-1.5 ${
                      isSelected
                        ? 'bg-purple-50/80 border-purple-400 shadow-xs'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-bold text-slate-900 line-clamp-2">{tpl.name}</span>
                      {tpl.isCustom && (
                        <span className="shrink-0 text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded border border-amber-300">
                          Własny
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>{tpl.defaultDurationDays} dni</span>
                      </span>
                      <span>•</span>
                      <span>{tpl.tasks.length} zadań</span>
                    </div>
                    {officialCount > 0 && (
                      <div className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 inline-block">
                        {officialCount} terminy urzędowe KPA
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Template details preview */}
            <div className="flex-1 p-6 overflow-y-auto space-y-5 bg-white">
              {selectedPreviewTemplate ? (
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                          {getCategoryLabel(selectedPreviewTemplate.category)}
                        </span>
                        {selectedPreviewTemplate.isCustom && (
                          <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            Utworzony przez administratora
                          </span>
                        )}
                      </div>
                      <h4 className="text-lg font-bold text-slate-900">{selectedPreviewTemplate.name}</h4>
                      <p className="text-xs text-slate-500 mt-1">{selectedPreviewTemplate.description}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {onSelectTemplateToCreate && (
                        <button
                          onClick={() => {
                            onSelectTemplateToCreate(selectedPreviewTemplate);
                            onClose();
                          }}
                          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs transition-colors"
                        >
                          <FolderPlus className="w-4 h-4" />
                          <span>Użyj tego szablonu</span>
                        </button>
                      )}
                      {selectedPreviewTemplate.isCustom && (
                        <button
                          onClick={() => handleDeleteTemplate(selectedPreviewTemplate.id, selectedPreviewTemplate.name)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg border border-rose-200 transition-colors"
                          title="Usuń szablon niestandardowy"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Summary pills */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                      <span className="text-slate-500 block text-[11px]">Domyślny czas trwania:</span>
                      <strong className="text-slate-900 text-sm">{selectedPreviewTemplate.defaultDurationDays} dni roboczych</strong>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                      <span className="text-slate-500 block text-[11px]">Etapów i kamieni milowych:</span>
                      <strong className="text-slate-900 text-sm">{selectedPreviewTemplate.tasks.length} zadań</strong>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                      <span className="text-slate-500 block text-[11px]">Sugerowany budżet pracowni:</span>
                      <strong className="text-slate-900 text-sm">{selectedPreviewTemplate.defaultBudget || 'Nieokreślony'}</strong>
                    </div>
                  </div>

                  {/* Stage sequence table */}
                  <div className="space-y-2">
                    <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                      Sekwencja etapów w harmonogramie szablonu:
                    </h5>
                    <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100 text-xs">
                      {selectedPreviewTemplate.tasks.map((task, idx) => (
                        <div key={idx} className="p-3 flex items-center justify-between gap-4 hover:bg-slate-50">
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded-full bg-slate-100 font-mono text-[11px] font-bold text-slate-600 flex items-center justify-center shrink-0">
                              {idx + 1}
                            </span>
                            <div>
                              <div className="font-bold text-slate-900 flex items-center gap-2">
                                <span>{task.title}</span>
                                {task.isOfficialDeadline && (
                                  <span className="text-[10px] bg-rose-100 text-rose-800 font-bold px-1.5 py-0.2 rounded border border-rose-300">
                                    Termin urzędowy
                                  </span>
                                )}
                                {task.type === 'milestone' && (
                                  <span className="text-[10px] bg-sky-100 text-sky-800 font-bold px-1.5 py-0.2 rounded">
                                    Kamień milowy
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500 line-clamp-1">{task.description}</p>
                            </div>
                          </div>
                          <div className="text-right shrink-0 text-[11px]">
                            <span className="font-bold text-slate-800">{task.durationDays} dni</span>
                            <span className="text-slate-400 block text-[10px]">offset: +{task.offsetDays}d</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
                  <Layers className="w-12 h-12 stroke-[1.5] text-slate-300 mb-2" />
                  <p className="text-sm font-medium text-slate-600">Wybierz szablon z listy po lewej stronie</p>
                  <p className="text-xs text-slate-400">aby podejrzeć listę zadań, czasy trwania i relacje poprzedników.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Create Template from Existing Project */}
        {activeTab === 'from_project' && (
          <div className="flex-1 p-6 overflow-y-auto bg-slate-50">
            <form onSubmit={handleCreateFromExisting} className="max-w-2xl mx-auto bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-5">
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Zapisz istniejący projekt pracowni jako nowy szablon
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  System automatycznie skopiuje nazwy zadań, czasy trwania, przesunięcia czasowe oraz zależności poprzedników i terminy urzędowe.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Wybierz projekt źródłowy:
                  </label>
                  <select
                    value={selectedProjectId}
                    onChange={(e) => {
                      setSelectedProjectId(e.target.value);
                      const p = projects.find((proj) => proj.id === e.target.value);
                      if (p) setTemplateNameFromProj(`Szablon: ${p.name}`);
                    }}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {projects.map((p) => {
                      const count = tasks.filter((t) => t.projectId === p.id).length;
                      return (
                        <option key={p.id} value={p.id}>
                          [{p.key}] {p.name} ({count} zadań, {p.durationDays} dni)
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nazwa nowego szablonu:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="np. Szablon Projektu Budowlanego Biurowca"
                    value={templateNameFromProj}
                    onChange={(e) => setTemplateNameFromProj(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Kategoria obiektu:
                  </label>
                  <select
                    value={templateCategoryFromProj}
                    onChange={(e) => setTemplateCategoryFromProj(e.target.value as any)}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="kubaturowe">Obiekt Kubaturowy (Użyteczności publicznej / Komercyjny)</option>
                    <option value="mieszkaniowe">Budynek Mieszkalny Wielorodzinny / Jednorodzinny</option>
                    <option value="przemyslowe">Hala Przemysłowo-Magazynowa / Logistyczna</option>
                    <option value="przebudowa">Przebudowa, Modernizacja lub Zmiana Sposobu Użytkowania</option>
                    <option value="infrastruktura">Infrastruktura drogowa & Sieci uzbrojenia terenu</option>
                  </select>
                </div>

                {/* Selected Project Stats Preview */}
                {(() => {
                  const currentProj = projects.find((p) => p.id === selectedProjectId);
                  const currentTasks = tasks.filter((t) => t.projectId === selectedProjectId);
                  const officialCount = currentTasks.filter((t) => t.isOfficialDeadline).length;

                  if (!currentProj) return null;

                  return (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs space-y-1">
                      <span className="font-bold text-purple-900 block">Podsumowanie projektu źródłowego:</span>
                      <div className="text-purple-800 flex gap-4">
                        <span>Liczba zadań: <strong>{currentTasks.length}</strong></span>
                        <span>Czas trwania: <strong>{currentProj.durationDays} dni</strong></span>
                        <span>Terminy urzędowe: <strong>{officialCount}</strong></span>
                      </div>
                    </div>
                  );
                })()}

                <button
                  type="submit"
                  className="w-full py-2.5 bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Layers className="w-4 h-4" />
                  <span>Zapisz projekt jako szablon pracowni</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tab 3: Build from Scratch */}
        {activeTab === 'from_scratch' && (
          <div className="flex-1 p-6 overflow-y-auto bg-slate-50">
            <form onSubmit={handleSaveFromScratch} className="max-w-3xl mx-auto bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-5">
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Zdefiniuj autorski szablon projektowy od zera
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Skonfiguruj listę etapów, czasy trwania w dniach roboczych oraz oznacz terminy urzędowe KPA.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Nazwa szablonu:</label>
                  <input
                    type="text"
                    required
                    placeholder="np. Standard Projektowy Domów Jednorodzinnych"
                    value={scratchName}
                    onChange={(e) => setScratchName(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Kategoria:</label>
                  <select
                    value={scratchCategory}
                    onChange={(e) => setScratchCategory(e.target.value as any)}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="kubaturowe">Obiekt Kubaturowy</option>
                    <option value="mieszkaniowe">Budownictwo Mieszkaniowe</option>
                    <option value="przemyslowe">Budownictwo Przemysłowe</option>
                    <option value="przebudowa">Przebudowa & Adaptacja</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Szacowany czas (dni):</label>
                  <input
                    type="number"
                    min="10"
                    value={scratchDuration}
                    onChange={(e) => setScratchDuration(Number(e.target.value))}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Sugerowany budżet:</label>
                  <input
                    type="text"
                    value={scratchBudget}
                    onChange={(e) => setScratchBudget(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              {/* Dynamic Stages List */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Etapy projektowe ({scratchStages.length}):
                  </span>
                  <button
                    type="button"
                    onClick={handleAddScratchStage}
                    className="flex items-center gap-1 text-xs text-purple-700 hover:text-purple-900 font-bold bg-purple-50 px-2.5 py-1 rounded-md border border-purple-200"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Dodaj kolejny etap</span>
                  </button>
                </div>

                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
                  {scratchStages.map((stage, idx) => (
                    <div key={idx} className="p-3 bg-white flex items-center gap-3 text-xs">
                      <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 font-bold flex items-center justify-center shrink-0 text-[10px]">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={stage.title}
                        onChange={(e) => {
                          const updated = [...scratchStages];
                          updated[idx].title = e.target.value;
                          setScratchStages(updated);
                        }}
                        placeholder="Nazwa etapu projektowego"
                        className="flex-1 text-xs border border-slate-200 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] text-slate-500">Dni:</span>
                        <input
                          type="number"
                          min="1"
                          value={stage.durationDays}
                          onChange={(e) => {
                            const updated = [...scratchStages];
                            updated[idx].durationDays = Number(e.target.value);
                            setScratchStages(updated);
                          }}
                          className="w-14 text-xs border border-slate-200 rounded px-1.5 py-1 text-center"
                        />
                      </div>
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-700 shrink-0 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={stage.isOfficialDeadline}
                          onChange={(e) => {
                            const updated = [...scratchStages];
                            updated[idx].isOfficialDeadline = e.target.checked;
                            setScratchStages(updated);
                          }}
                          className="rounded text-rose-600 focus:ring-rose-500"
                        />
                        <span className={stage.isOfficialDeadline ? 'text-rose-700 font-bold' : ''}>Termin urzędowy</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemoveScratchStage(idx)}
                        className="p-1 text-slate-400 hover:text-rose-600 transition-colors shrink-0"
                        title="Usuń etap"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                <Layers className="w-4 h-4" />
                <span>Zapisz i opublikuj nowy szablon</span>
              </button>
            </form>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>Szablony są natychmiast dostępne podczas rejestracji nowych projektów budowlanych.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded transition-colors font-medium"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
