import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Task, Project, User, Priority } from '../types';
import { generateGoogleCalendarUrl } from '../utils/calendar';
import { 
  Calendar, 
  ExternalLink, 
  ChevronRight, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Diamond, 
  Bug, 
  Sparkles, 
  Layers, 
  Filter,
  Plus,
  Lock,
  GitMerge,
  ShieldAlert,
  Briefcase
} from 'lucide-react';
import { isApproachingOfficialDeadline, getBusinessDaysRemaining } from '../utils/businessDays';
import { getTodayIso, parseIsoDate } from '../utils/today';
import { isPolishHoliday } from '../utils/polishHolidays';

interface GanttChartProps {
  tasks: Task[];
  projects: Project[];
  users: User[];
  selectedProjectId: string | null;
  onSelectTask: (task: Task) => void;
  onOpenNewTask: () => void;
}

export const GanttChart: React.FC<GanttChartProps> = ({
  tasks,
  projects,
  users,
  selectedProjectId,
  onSelectTask,
  onOpenNewTask,
}) => {
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [zoomLevel, setZoomLevel] = useState<'days' | 'weeks'>('days');

  // Filter tasks based on selected project and priority
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (selectedProjectId && task.projectId !== selectedProjectId) return false;
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
      return true;
    });
  }, [tasks, selectedProjectId, priorityFilter]);

  const todayStr = getTodayIso();
  const todayDate = useMemo(() => parseIsoDate(todayStr), [todayStr]);

  // Determine timeline boundary dates
  const { minDate, maxDate, totalDays, daysList, monthsList } = useMemo(() => {
    let earliest = new Date(todayDate.getTime());
    let latest = new Date(todayDate.getTime());

    filteredTasks.forEach((t) => {
      if (t.startDate) {
        const s = parseIsoDate(t.startDate);
        if (s < earliest) earliest = s;
        if (s > latest) latest = s;
      }
      if (t.dueDate) {
        const e = parseIsoDate(t.dueDate);
        if (e < earliest) earliest = e;
        if (e > latest) latest = e;
      }
    });

    // min: początek miesiąca przed najwcześniejszą datą lub dziś
    const minD = new Date(earliest.getFullYear(), earliest.getMonth() - 1, 1);

    // max: koniec miesiąca po najpóźniejszej dacie
    const maxD = new Date(latest.getFullYear(), latest.getMonth() + 2, 0);

    const days: { date: Date; dateStr: string; dayNum: number; dayName: string; isWeekend: boolean; isHoliday?: boolean }[] = [];
    const monthsMap = new Map<string, { label: string; daysCount: number }>();

    const cur = new Date(minD.getFullYear(), minD.getMonth(), minD.getDate(), 12, 0, 0);
    const endTarget = new Date(maxD.getFullYear(), maxD.getMonth(), maxD.getDate(), 12, 0, 0);

    while (cur <= endTarget) {
      const year = cur.getFullYear();
      const month = String(cur.getMonth() + 1).padStart(2, '0');
      const day = String(cur.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const dayOfWeek = cur.getDay();

      const dayNames = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
      const isHoliday = isPolishHoliday(cur);
      days.push({
        date: new Date(cur),
        dateStr,
        dayNum: cur.getDate(),
        dayName: dayNames[dayOfWeek],
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        isHoliday,
      });

      const monthKey = `${year}-${month}`;
      const monthPolishNames = [
        'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
        'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
      ];
      const monthLabel = `${monthPolishNames[cur.getMonth()]} ${year}`;

      if (!monthsMap.has(monthKey)) {
        monthsMap.set(monthKey, { label: monthLabel, daysCount: 1 });
      } else {
        const item = monthsMap.get(monthKey)!;
        item.daysCount += 1;
      }

      cur.setDate(cur.getDate() + 1);
    }

    return {
      minDate: minD,
      maxDate: maxD,
      totalDays: days.length,
      daysList: days,
      monthsList: Array.from(monthsMap.values()),
    };
  }, [filteredTasks, todayDate]);

  const todayIdx = daysList.findIndex((d) => d.dateStr === todayStr);
  const todayOffsetDays = todayIdx !== -1 ? todayIdx : Math.floor(
    (todayDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const todayPercent = totalDays > 0 ? (todayOffsetDays / totalDays) * 100 : 0;

  const todayPolishMonthsShort = [
    'sty', 'lut', 'mar', 'kwi', 'maj', 'cze',
    'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'
  ];
  const todayLabel = `Dziś (${todayDate.getDate()} ${todayPolishMonthsShort[todayDate.getMonth()]})`;

  const dayColWidth = zoomLevel === 'days' ? 38 : 22;
  const chartWidthPx = Math.max(860, totalDays * dayColWidth);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const todayLineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        const todayPx = (todayOffsetDays / totalDays) * chartWidthPx;
        const targetScroll = Math.max(0, todayPx - container.clientWidth / 2 + 168);
        container.scrollTo({ left: targetScroll, behavior: 'smooth' });
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [totalDays, chartWidthPx, todayOffsetDays]);

  const getPriorityBadge = (priority: Priority) => {
    switch (priority) {
      case 'critical':
        return <span className="text-red-700 dark:text-red-400 font-semibold text-xs">Krytyczny</span>;
      case 'high':
        return <span className="text-amber-700 dark:text-amber-400 font-medium text-xs">Wysoki</span>;
      case 'normal':
        return <span className="text-blue-700 dark:text-blue-400 font-medium text-xs">Normalny</span>;
      case 'low':
        return <span className="text-slate-600 dark:text-slate-400 text-xs">Niski</span>;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'milestone':
        return <Diamond className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 fill-amber-500" aria-hidden="true" />;
      case 'bug':
        return <Bug className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" aria-hidden="true" />;
      case 'feature':
        return <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />;
      case 'phase':
        return <Layers className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" aria-hidden="true" />;
      default:
        return <CheckCircle2 className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400" aria-hidden="true" />;
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm flex flex-col overflow-hidden transition-colors">
      {/* Top Filter and Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
              Harmonogram Gantta & Drzewo Zależności
            </span>
            <span className="text-slate-500 dark:text-slate-400" aria-hidden="true">·</span>
            <span className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">{filteredTasks.length} zadań</span>
          </div>

          <div className="hidden sm:flex items-center gap-1 ml-4 bg-slate-200/70 dark:bg-slate-800 p-0.5 rounded-md">
            <button
              type="button"
              onClick={() => setZoomLevel('days')}
              aria-pressed={zoomLevel === 'days'}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                zoomLevel === 'days' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Widok dni
            </button>
            <button
              type="button"
              onClick={() => setZoomLevel('weeks')}
              aria-pressed={zoomLevel === 'weeks'}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                zoomLevel === 'weeks' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Widok kompaktowy
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
            <Filter className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <label htmlFor="gantt-priority-filter">Priorytet:</label>
            <select
              id="gantt-priority-filter"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as Priority | 'all')}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="all">Wszystkie priorytety</option>
              <option value="critical">Tylko krytyczne (P1)</option>
              <option value="high">Wysoki priorytet (P2)</option>
              <option value="normal">Normalny (P3 - Domyślny)</option>
              <option value="low">Niski priorytet (P4)</option>
            </select>
          </div>

          <button
            type="button"
            onClick={onOpenNewTask}
            className="flex items-center gap-1.5 bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-600 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Nowe zadanie</span>
          </button>
        </div>
      </div>

      {/* Main Gantt Split Container */}
      <div ref={scrollContainerRef} className="flex overflow-x-auto select-none" style={{ maxHeight: 'calc(100vh - 280px)' }}>
        {/* Left Column: Tasks Metadata & Hierarchy */}
        <div className="w-84 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky left-0 z-20 shadow-[2px_0_5px_rgba(0,0,0,0.03)]">
          {/* Table Header */}
          <div className="h-16 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/80 px-4 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
            <span>Zadanie / Drzewo zależności</span>
            <span className="text-slate-600 dark:text-slate-400 font-normal">Czas · Priorytet</span>
          </div>

          {/* Task Rows List */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredTasks.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-600 dark:text-slate-400">Brak zadań w wybranym filtrze.</div>
            ) : (
              filteredTasks.map((task) => {
                const assignee = users.find((u) => u.id === task.assigneeId);
                const taskProject = projects.find((p) => p.id === task.projectId);
                const isBlocked = task.status === 'blocked';
                const isOverdue = task.dueDate < todayStr && task.status !== 'done';
                const isOfficialWarning = isApproachingOfficialDeadline(task);
                const businessDaysRemaining = getBusinessDaysRemaining(task.dueDate);

                return (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectTask(task)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectTask(task);
                      }
                    }}
                    aria-label={`Zadanie ${task.code}: ${task.title}`}
                    className={`h-14 px-3 flex items-center justify-between cursor-pointer transition-colors group relative ${
                      isBlocked
                        ? 'task-blocked-style'
                        : 'hover:bg-sky-50/60 dark:hover:bg-slate-800/60 bg-white dark:bg-slate-900'
                    } ${isOfficialWarning ? 'animate-official-deadline' : ''}`}
                  >
                    <div className="flex flex-col justify-center min-w-0 pr-2 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {task.parentId && (
                          <span className="text-slate-600 dark:text-slate-400 ml-1" aria-hidden="true">↳</span>
                        )}
                        <span className="shrink-0">{getTypeIcon(task.type)}</span>
                        <span className="font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums shrink-0">{task.code}</span>
                        <span className={`text-xs font-medium truncate ${isBlocked ? 'text-slate-800 dark:text-slate-200 font-semibold' : 'text-slate-800 dark:text-slate-200'}`} title={task.title}>
                          {task.title}
                        </span>
                        {isOverdue && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1 rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 shrink-0"
                            title="Zadanie przeterminowane!"
                          >
                            <AlertTriangle className="w-2.5 h-2.5 text-rose-700 dark:text-rose-400" aria-hidden="true" />
                            <span>Po terminie</span>
                          </span>
                        )}
                        {task.isOfficialDeadline && (
                          <span
                            className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1 rounded border shrink-0 ${
                              isOfficialWarning
                                ? 'bg-rose-100 text-rose-800 border-rose-300 animate-pulse'
                                : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                            }`}
                            title={`Termin urzędowy. Dni robocze: ${businessDaysRemaining}`}
                          >
                            <ShieldAlert className="w-2.5 h-2.5 text-rose-700 dark:text-rose-400" aria-hidden="true" />
                            <span>{businessDaysRemaining}d</span>
                          </span>
                        )}
                        {isBlocked && (
                          <span title="Zadanie zablokowane (wymaga ukończenia poprzedników)">
                            <Lock className="w-3 h-3 text-rose-700 dark:text-rose-400 shrink-0" aria-hidden="true" />
                          </span>
                        )}
                      </div>
                      {taskProject && (
                        <div className="text-[10px] text-slate-600 dark:text-slate-400 truncate pl-5 flex items-center gap-1">
                          <span className="font-mono text-sky-700 dark:text-sky-400 font-semibold">{taskProject.key}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{taskProject.name}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono tabular-nums text-[11px] text-slate-700 dark:text-slate-300">
                        {task.durationDays || 1}d
                      </span>
                      {getPriorityBadge(task.priority)}
                      {assignee && (
                        <div
                          className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold flex items-center justify-center"
                          title={assignee.name}
                        >
                          {assignee.initials}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Area: Interactive Timeline Canvas */}
        <div className="flex-1 overflow-x-auto relative" style={{ minWidth: chartWidthPx }}>
          {/* Timeline Header: Months & Days */}
          <div className="h-16 border-b border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-800/90 sticky top-0 z-10">
            {/* Months Row */}
            <div className="flex h-8 border-b border-slate-200/80 dark:border-slate-700/80 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              {monthsList.map((m, idx) => (
                <div
                  key={idx}
                  style={{ width: `${(m.daysCount / totalDays) * 100}%` }}
                  className="px-3 border-r border-slate-200 dark:border-slate-700 flex items-center truncate"
                >
                  {m.label}
                </div>
              ))}
            </div>

            {/* Days Row */}
            <div className="flex h-8 text-[10px] font-mono tabular-nums text-slate-600 dark:text-slate-400">
              {daysList.map((d, idx) => (
                <div
                  key={idx}
                  style={{ width: `${(1 / totalDays) * 100}%` }}
                  className={`border-r border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center shrink-0 ${
                    d.isWeekend || d.isHoliday ? 'bg-slate-200/40 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400' : ''
                  } ${d.dateStr === todayStr ? 'bg-amber-100/70 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 font-bold' : ''}`}
                  title={d.isHoliday ? `Święto ustawowe (${d.dateStr})` : undefined}
                >
                  <span>{d.dayNum}</span>
                  <span className="text-[8px] font-sans uppercase text-slate-600 dark:text-slate-400">{d.dayName}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline Grid Background & Tasks Rows */}
          <div className="relative divide-y divide-slate-100 dark:divide-slate-800">
            {/* Today indicator vertical line */}
            {todayOffsetDays >= 0 && todayOffsetDays <= totalDays && (
              <div
                ref={todayLineRef}
                className="absolute top-0 bottom-0 pointer-events-none z-10 flex flex-col items-center"
                style={{ left: `${todayPercent}%` }}
              >
                <div className="bg-red-700 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap -translate-y-1">
                  {todayLabel}
                </div>
                <div className="w-[1.5px] h-full bg-red-500/80 dashed" />
              </div>
            )}

            {/* Tasks Gantt Bars */}
            {filteredTasks.map((task) => {
              const sIdx = daysList.findIndex((d) => d.dateStr === task.startDate);
              const eIdx = daysList.findIndex((d) => d.dateStr === task.dueDate);
              const startOffset = sIdx !== -1 ? sIdx : Math.max(0, Math.floor((parseIsoDate(task.startDate).getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)));
              const durationDays = eIdx !== -1 && eIdx >= startOffset ? eIdx - startOffset + 1 : Math.max(1, task.durationDays || 1);

              const leftPercent = totalDays > 0 ? Math.max(0, (startOffset / totalDays) * 100) : 0;
              const widthPercent = totalDays > 0 ? Math.min(100 - leftPercent, (durationDays / totalDays) * 100) : 0;

              const isMilestone = task.type === 'milestone';
              const isBlocked = task.status === 'blocked';
              const isOverdue = task.dueDate < todayStr && task.status !== 'done';
              const isOfficialWarning = isApproachingOfficialDeadline(task);
              const businessDaysRemaining = getBusinessDaysRemaining(task.dueDate);
              const project = projects.find((p) => p.id === task.projectId);
              const gCalUrl = generateGoogleCalendarUrl(task, project);

              return (
                <div
                  key={task.id}
                  className="h-14 relative flex items-center hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group"
                >
                  {/* Task Bar / Milestone marker */}
                  {isMilestone ? (
                    <div
                      role="button"
                      tabIndex={0}
                      style={{ left: `${leftPercent}%` }}
                      className={`absolute z-10 -ml-3 flex items-center cursor-pointer group/bar ${
                        isOfficialWarning ? 'animate-official-deadline rounded' : ''
                      }`}
                      onClick={() => onSelectTask(task)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectTask(task);
                        }
                      }}
                      aria-label={`Kamień milowy ${task.code}: ${task.title}`}
                    >
                      <div className={`w-6 h-6 rotate-45 shadow-sm border flex items-center justify-center hover:scale-110 transition-transform ${
                        isBlocked
                          ? 'task-blocked-style border-rose-400'
                          : isOverdue
                          ? 'bg-rose-700 border-rose-800 ring-2 ring-rose-400'
                          : 'bg-amber-700 border-amber-800'
                      }`}>
                        <Diamond className="w-3.5 h-3.5 text-white -rotate-45" aria-hidden="true" />
                      </div>
                      <span className={`ml-2 text-xs font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap shadow-xs ${
                        isBlocked
                          ? 'task-blocked-style text-slate-800 border-slate-300'
                          : isOverdue
                          ? 'bg-rose-50 text-rose-900 border-rose-300 font-bold'
                          : 'bg-amber-50/90 text-amber-900 border-amber-200'
                      }`}>
                        {task.title} {isOverdue && <span className="text-rose-700 font-bold ml-1">(Po terminie)</span>} {project && <span className="opacity-85 font-normal text-[10px]">[{project.key}: {project.name}]</span>}
                      </span>
                    </div>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      style={{
                        left: `${leftPercent}%`,
                        width: `${Math.max(2.2, widthPercent)}%`,
                      }}
                      onClick={() => onSelectTask(task)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectTask(task);
                        }
                      }}
                      aria-label={`Pasek zadania ${task.code}: ${task.title}`}
                      className={`absolute h-9 rounded-md cursor-pointer transition-all hover:ring-2 hover:ring-sky-400 shadow-xs flex items-center overflow-hidden border text-white text-[11px] font-medium group/bar ${
                        isBlocked
                          ? 'task-blocked-style border-slate-400 !text-slate-800'
                          : isOverdue
                          ? 'border-rose-500 ring-2 ring-rose-500/80 bg-slate-800'
                          : 'border-slate-300/80 bg-slate-700'
                      } ${isOfficialWarning ? 'animate-official-deadline' : ''}`}
                    >
                      {/* Completed Progress fill (if not blocked) */}
                      {!isBlocked && (
                        <div
                          style={{ width: `${task.progress}%` }}
                          className={`h-full absolute left-0 top-0 transition-all ${
                            task.status === 'done'
                              ? 'bg-emerald-700'
                              : isOverdue
                              ? 'bg-rose-700'
                              : task.priority === 'critical'
                              ? 'bg-rose-700'
                              : 'bg-sky-700'
                          }`}
                        />
                      )}

                      {/* Content inside bar with project name */}
                      <div className="relative z-10 px-2 flex items-center justify-between w-full min-w-0">
                        <div className="flex flex-col min-w-0 leading-tight">
                          <div className="flex items-center gap-1 min-w-0">
                            {isBlocked && <Lock className="w-3 h-3 text-rose-700 shrink-0" aria-hidden="true" />}
                            {task.isOfficialDeadline && (
                              <ShieldAlert className="w-3 h-3 text-rose-200 shrink-0" aria-hidden="true" />
                            )}
                            {isOverdue && (
                              <span className="bg-rose-700 text-white text-[9px] font-bold px-1 rounded shrink-0 mr-1" title="Zadanie przeterminowane!">
                                Po terminie
                              </span>
                            )}
                            <span className="truncate drop-shadow-xs font-semibold text-[11px]">{task.title}</span>
                          </div>
                          {project && (
                            <span className="truncate text-[9px] font-mono opacity-95 drop-shadow-xs text-sky-100">
                              [{project.key}] {project.name}
                            </span>
                          )}
                        </div>
                        <span className="font-mono tabular-nums text-[10px] ml-1.5 opacity-95 shrink-0 self-center">
                          {durationDays}d
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Project name information on hover */}
                  {project && (
                    <div
                      style={{ left: `${leftPercent + widthPercent}%` }}
                      className="absolute ml-2 hidden group-hover:flex items-center gap-1.5 z-20"
                    >
                      <div className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 px-2 py-0.5 rounded text-[11px] shadow-md transition-colors whitespace-nowrap font-medium">
                        <Briefcase className="w-3 h-3 text-sky-700 dark:text-sky-400 shrink-0" aria-hidden="true" />
                        <span className="font-mono text-sky-700 dark:text-sky-300 font-bold">[{project.key}]</span>
                        <span className="truncate max-w-[200px]">{project.name}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend Footer */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex flex-wrap items-center justify-between text-xs text-slate-600 dark:text-slate-400 gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3 rounded bg-sky-700 inline-block" aria-hidden="true" />
            <span className="dark:text-slate-300">W toku / Realizacja</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3 rounded bg-emerald-700 inline-block" aria-hidden="true" />
            <span className="dark:text-slate-300">Ukończone</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-3.5 rounded task-blocked-style inline-block border border-slate-300 dark:border-slate-700" aria-hidden="true" />
            <span className="font-semibold text-rose-800 dark:text-rose-400">Zablokowane</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3 rounded bg-rose-100 dark:bg-rose-950/60 border border-rose-400 dark:border-rose-800 animate-official-deadline inline-block" aria-hidden="true" />
            <span className="font-semibold text-rose-700 dark:text-rose-400">Termin urzędowy (alarm ≤ 3 dni robocze)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Diamond className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 fill-amber-500" aria-hidden="true" />
            <span className="dark:text-slate-300">Kamień milowy</span>
          </div>
        </div>

        <div className="text-slate-600 dark:text-slate-400 text-[11px]">
          Ukończenie zadań blokujących automatycznie odblokuje kolejne etapy i przeliczy ich terminy w dniach.
        </div>
      </div>
    </div>
  );
};
