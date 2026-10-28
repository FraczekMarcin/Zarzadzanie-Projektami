import React, { useState, useMemo } from 'react';
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
  ShieldAlert
} from 'lucide-react';
import { isApproachingOfficialDeadline, getBusinessDaysRemaining } from '../utils/businessDays';

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

  // Determine timeline boundary dates
  const { minDate, maxDate, totalDays, daysList, monthsList } = useMemo(() => {
    let start = new Date('2026-10-01T00:00:00');
    let end = new Date('2026-12-15T00:00:00');

    filteredTasks.forEach((t) => {
      const s = new Date(t.startDate + 'T00:00:00');
      const e = new Date(t.dueDate + 'T00:00:00');
      if (s < start) start = s;
      if (e > end) end = e;
    });

    const minD = new Date(start);
    minD.setDate(minD.getDate() - 2);
    const maxD = new Date(end);
    maxD.setDate(maxD.getDate() + 5);

    const diffTime = maxD.getTime() - minD.getTime();
    const count = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const days: { date: Date; dateStr: string; dayNum: number; dayName: string; isWeekend: boolean }[] = [];
    const monthsMap = new Map<string, { label: string; daysCount: number }>();

    for (let i = 0; i < count; i++) {
      const cur = new Date(minD);
      cur.setDate(minD.getDate() + i);
      const year = cur.getFullYear();
      const month = String(cur.getMonth() + 1).padStart(2, '0');
      const day = String(cur.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const dayOfWeek = cur.getDay();

      const dayNames = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
      days.push({
        date: cur,
        dateStr,
        dayNum: cur.getDate(),
        dayName: dayNames[dayOfWeek],
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
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
    }

    return {
      minDate: minD,
      maxDate: maxD,
      totalDays: count,
      daysList: days,
      monthsList: Array.from(monthsMap.values()),
    };
  }, [filteredTasks]);

  const todayStr = '2026-10-24';
  const todayOffsetDays = Math.floor(
    (new Date(todayStr + 'T00:00:00').getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const todayPercent = (todayOffsetDays / totalDays) * 100;

  const dayColWidth = zoomLevel === 'days' ? 38 : 22;
  const chartWidthPx = Math.max(860, totalDays * dayColWidth);

  const getPriorityBadge = (priority: Priority) => {
    switch (priority) {
      case 'critical':
        return <span className="text-red-600 font-semibold text-xs">Krytyczny</span>;
      case 'high':
        return <span className="text-amber-600 font-medium text-xs">Wysoki</span>;
      case 'normal':
        return <span className="text-blue-600 font-medium text-xs">Normalny</span>;
      case 'low':
        return <span className="text-slate-500 text-xs">Niski</span>;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'milestone':
        return <Diamond className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />;
      case 'bug':
        return <Bug className="w-3.5 h-3.5 text-rose-500" />;
      case 'feature':
        return <Sparkles className="w-3.5 h-3.5 text-indigo-500" />;
      case 'phase':
        return <Layers className="w-3.5 h-3.5 text-slate-700" />;
      default:
        return <CheckCircle2 className="w-3.5 h-3.5 text-sky-600" />;
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
            <span className="text-slate-400">·</span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">{filteredTasks.length} zadań</span>
          </div>

          <div className="hidden sm:flex items-center gap-1 ml-4 bg-slate-200/70 dark:bg-slate-800 p-0.5 rounded-md">
            <button
              onClick={() => setZoomLevel('days')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                zoomLevel === 'days' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Widok dni
            </button>
            <button
              onClick={() => setZoomLevel('weeks')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                zoomLevel === 'weeks' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Widok kompaktowy
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Priorytet:</span>
            <select
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
            onClick={onOpenNewTask}
            className="flex items-center gap-1.5 bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nowe zadanie</span>
          </button>
        </div>
      </div>

      {/* Main Gantt Split Container */}
      <div className="flex overflow-x-auto select-none" style={{ maxHeight: 'calc(100vh - 280px)' }}>
        {/* Left Column: Tasks Metadata & Hierarchy */}
        <div className="w-84 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky left-0 z-20 shadow-[2px_0_5px_rgba(0,0,0,0.03)]">
          {/* Table Header */}
          <div className="h-16 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/80 px-4 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
            <span>Zadanie / Drzewo zależności</span>
            <span className="text-slate-500 dark:text-slate-400 font-normal">Czas · Priorytet</span>
          </div>

          {/* Task Rows List */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredTasks.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">Brak zadań w wybranym filtrze.</div>
            ) : (
              filteredTasks.map((task) => {
                const assignee = users.find((u) => u.id === task.assigneeId);
                const taskProject = projects.find((p) => p.id === task.projectId);
                const isBlocked = task.status === 'blocked';
                const isOfficialWarning = isApproachingOfficialDeadline(task);
                const businessDaysRemaining = getBusinessDaysRemaining(task.dueDate);

                return (
                  <div
                    key={task.id}
                    onClick={() => onSelectTask(task)}
                    className={`h-14 px-3 flex items-center justify-between cursor-pointer transition-colors group relative ${
                      isBlocked
                        ? 'task-blocked-style'
                        : 'hover:bg-sky-50/60 dark:hover:bg-slate-800/60 bg-white dark:bg-slate-900'
                    } ${isOfficialWarning ? 'animate-official-deadline' : ''}`}
                  >
                    <div className="flex flex-col justify-center min-w-0 pr-2 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {task.parentId && (
                          <span className="text-slate-300 dark:text-slate-600 ml-1">↳</span>
                        )}
                        <span className="shrink-0">{getTypeIcon(task.type)}</span>
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">{task.code}</span>
                        <span className={`text-xs font-medium truncate ${isBlocked ? 'text-slate-700 dark:text-slate-200 font-semibold' : 'text-slate-800 dark:text-slate-200'}`} title={task.title}>
                          {task.title}
                        </span>
                        {task.isOfficialDeadline && (
                          <span
                            className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1 rounded border shrink-0 ${
                              isOfficialWarning
                                ? 'bg-rose-100 text-rose-800 border-rose-300 animate-pulse'
                                : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                            }`}
                            title={`Termin urzędowy. Dni robocze: ${businessDaysRemaining}`}
                          >
                            <ShieldAlert className="w-2.5 h-2.5 text-rose-600" />
                            <span>{businessDaysRemaining}d</span>
                          </span>
                        )}
                        {isBlocked && (
                          <span title="Zadanie zablokowane (wymaga ukończenia poprzedników)">
                            <Lock className="w-3 h-3 text-rose-700 shrink-0" />
                          </span>
                        )}
                      </div>
                      {taskProject && (
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate pl-5 flex items-center gap-1">
                          <span className="font-mono text-sky-700 dark:text-sky-400 font-semibold">{taskProject.key}</span>
                          <span>·</span>
                          <span className="truncate">{taskProject.name}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono tabular-nums text-[11px] text-slate-600">
                        {task.durationDays || 1}d
                      </span>
                      {getPriorityBadge(task.priority)}
                      {assignee && (
                        <div
                          className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center justify-center"
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
            <div className="flex h-8 text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {daysList.map((d, idx) => (
                <div
                  key={idx}
                  style={{ width: `${(1 / totalDays) * 100}%` }}
                  className={`border-r border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center shrink-0 ${
                    d.isWeekend ? 'bg-slate-200/40 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500' : ''
                  } ${d.dateStr === todayStr ? 'bg-amber-100/70 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 font-bold' : ''}`}
                >
                  <span>{d.dayNum}</span>
                  <span className="text-[8px] font-sans uppercase text-slate-400 dark:text-slate-500">{d.dayName}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline Grid Background & Tasks Rows */}
          <div className="relative divide-y divide-slate-100 dark:divide-slate-800">
            {/* Today indicator vertical line */}
            {todayOffsetDays >= 0 && todayOffsetDays <= totalDays && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-10 flex flex-col items-center"
                style={{ left: `${todayPercent}%` }}
              >
                <div className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap -translate-y-1">
                  Dziś (24 paź)
                </div>
                <div className="w-[1.5px] h-full bg-red-500/80 dashed" />
              </div>
            )}

            {/* Tasks Gantt Bars */}
            {filteredTasks.map((task) => {
              const startD = new Date(task.startDate + 'T00:00:00');
              const dueD = new Date(task.dueDate + 'T00:00:00');
              const startOffset = Math.floor((startD.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
              const durationDays = Math.max(1, Math.floor((dueD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)) + 1);

              const leftPercent = Math.max(0, (startOffset / totalDays) * 100);
              const widthPercent = Math.min(100 - leftPercent, (durationDays / totalDays) * 100);

              const isMilestone = task.type === 'milestone';
              const isBlocked = task.status === 'blocked';
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
                      style={{ left: `${leftPercent}%` }}
                      className={`absolute z-10 -ml-3 flex items-center cursor-pointer group/bar ${
                        isOfficialWarning ? 'animate-official-deadline rounded' : ''
                      }`}
                      onClick={() => onSelectTask(task)}
                    >
                      <div className={`w-6 h-6 rotate-45 shadow-sm border flex items-center justify-center hover:scale-110 transition-transform ${
                        isBlocked
                          ? 'task-blocked-style border-rose-400'
                          : 'bg-amber-500 border-amber-600'
                      }`}>
                        <Diamond className="w-3.5 h-3.5 text-white -rotate-45" />
                      </div>
                      <span className={`ml-2 text-xs font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap shadow-xs ${
                        isBlocked
                          ? 'task-blocked-style text-slate-800 border-slate-300'
                          : 'bg-amber-50/90 text-amber-900 border-amber-200'
                      }`}>
                        {task.title} {taskProject && <span className="opacity-75 font-normal text-[10px]">[{taskProject.key}: {taskProject.name}]</span>}
                      </span>
                    </div>
                  ) : (
                    <div
                      style={{
                        left: `${leftPercent}%`,
                        width: `${Math.max(2.2, widthPercent)}%`,
                      }}
                      onClick={() => onSelectTask(task)}
                      className={`absolute h-9 rounded-md cursor-pointer transition-all hover:ring-2 hover:ring-sky-400 shadow-xs flex items-center overflow-hidden border text-white text-[11px] font-medium group/bar ${
                        isBlocked
                          ? 'task-blocked-style border-slate-400 !text-slate-800'
                          : 'border-slate-300/80 bg-slate-700'
                      } ${isOfficialWarning ? 'animate-official-deadline' : ''}`}
                    >
                      {/* Completed Progress fill (if not blocked) */}
                      {!isBlocked && (
                        <div
                          style={{ width: `${task.progress}%` }}
                          className={`h-full absolute left-0 top-0 transition-all ${
                            task.status === 'done'
                              ? 'bg-emerald-600'
                              : task.priority === 'critical'
                              ? 'bg-rose-600'
                              : 'bg-sky-600'
                          }`}
                        />
                      )}

                      {/* Content inside bar with project name */}
                      <div className="relative z-10 px-2 flex items-center justify-between w-full min-w-0">
                        <div className="flex flex-col min-w-0 leading-tight">
                          <div className="flex items-center gap-1 min-w-0">
                            {isBlocked && <Lock className="w-3 h-3 text-rose-700 shrink-0" />}
                            {task.isOfficialDeadline && (
                              <ShieldAlert className="w-3 h-3 text-rose-600 shrink-0" />
                            )}
                            <span className="truncate drop-shadow-xs font-semibold text-[11px]">{task.title}</span>
                          </div>
                          {taskProject && (
                            <span className="truncate text-[9px] font-mono opacity-90 drop-shadow-xs text-sky-100">
                              [{taskProject.key}] {taskProject.name}
                            </span>
                          )}
                        </div>
                        <span className="font-mono tabular-nums text-[10px] ml-1.5 opacity-90 shrink-0 self-center">
                          {task.durationDays || 1}d
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Quick Google Calendar action on hover */}
                  <div
                    style={{ left: `${leftPercent + widthPercent}%` }}
                    className="absolute ml-2 hidden group-hover:flex items-center gap-1.5 z-20"
                  >
                    <a
                      href={gCalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Dodaj termin do Kalendarza Google"
                      className="flex items-center gap-1 bg-white border border-slate-200 hover:border-sky-500 text-slate-700 hover:text-sky-600 px-2 py-0.5 rounded text-[11px] shadow-sm transition-colors whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Calendar className="w-3 h-3 text-sky-600" />
                      <span>Do Google Calendar</span>
                      <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                    </a>
                  </div>
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
            <span className="w-3.5 h-3 rounded bg-sky-600 inline-block" />
            <span className="dark:text-slate-300">W toku / Realizacja</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3 rounded bg-emerald-600 inline-block" />
            <span className="dark:text-slate-300">Ukończone</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-3.5 rounded task-blocked-style inline-block border border-slate-300 dark:border-slate-700" />
            <span className="font-semibold text-rose-800 dark:text-rose-400">Zablokowane</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3 rounded bg-rose-100 dark:bg-rose-950/60 border border-rose-400 dark:border-rose-800 animate-official-deadline inline-block" />
            <span className="font-semibold text-rose-700 dark:text-rose-400">Termin urzędowy (alarm ≤ 3 dni robocze)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Diamond className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            <span className="dark:text-slate-300">Kamień milowy</span>
          </div>
        </div>

        <div className="text-slate-500 dark:text-slate-400 text-[11px]">
          Ukończenie zadań blokujących automatycznie odblokuje kolejne etapy i przeliczy ich terminy w dniach.
        </div>
      </div>
    </div>
  );
};
