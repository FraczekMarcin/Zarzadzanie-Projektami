import React, { useState, useMemo } from 'react';
import { Task, Project, User } from '../types';
import { generateGoogleCalendarUrl, downloadIcsFile } from '../utils/calendar';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon, 
  Download, 
  ExternalLink, 
  Plus, 
  Diamond, 
  AlertCircle,
  Lock,
  ShieldAlert
} from 'lucide-react';
import { isApproachingOfficialDeadline, getBusinessDaysRemaining } from '../utils/businessDays';

interface CalendarViewProps {
  tasks: Task[];
  projects: Project[];
  users: User[];
  selectedProjectId: string | null;
  onSelectTask: (task: Task) => void;
  onOpenNewTaskWithDate: (dateStr: string) => void;
}

const MONTH_NAMES_PL = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
];

const DAY_NAMES_PL = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];

export const CalendarView: React.FC<CalendarViewProps> = ({
  tasks,
  projects,
  users,
  selectedProjectId,
  onSelectTask,
  onOpenNewTaskWithDate,
}) => {
  // Current calendar view date: defaulting to October 2026
  const [currentDate, setCurrentDate] = useState<Date>(new Date('2026-10-01T00:00:00'));

  const activeProject = useMemo(() => {
    return projects.find((p) => p.id === selectedProjectId);
  }, [projects, selectedProjectId]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (selectedProjectId && t.projectId !== selectedProjectId) return false;
      return true;
    });
  }, [tasks, selectedProjectId]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Navigation
  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const setToday = () => {
    setCurrentDate(new Date('2026-10-01T00:00:00'));
  };

  // Calendar cells generation (Monday to Sunday)
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Monday is 0, Sunday is 6
    let startingDayOfWeek = firstDay.getDay() - 1;
    if (startingDayOfWeek === -1) startingDayOfWeek = 6;

    const days = [];

    // Previous month padding
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const prevDate = new Date(year, month - 1, dayNum);
      const mStr = String(prevDate.getMonth() + 1).padStart(2, '0');
      const dStr = String(dayNum).padStart(2, '0');
      days.push({
        dateStr: `${prevDate.getFullYear()}-${mStr}-${dStr}`,
        dayNum,
        isCurrentMonth: false,
        date: prevDate,
      });
    }

    // Current month days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const mStr = String(month + 1).padStart(2, '0');
      const dStr = String(i).padStart(2, '0');
      days.push({
        dateStr: `${year}-${mStr}-${dStr}`,
        dayNum: i,
        isCurrentMonth: true,
        date: new Date(year, month, i),
      });
    }

    // Next month padding to fill complete weeks
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      const nextDate = new Date(year, month + 1, i);
      const mStr = String(nextDate.getMonth() + 1).padStart(2, '0');
      const dStr = String(i).padStart(2, '0');
      days.push({
        dateStr: `${nextDate.getFullYear()}-${mStr}-${dStr}`,
        dayNum: i,
        isCurrentMonth: false,
        date: nextDate,
      });
    }

    return days;
  }, [year, month]);

  const todayStr = '2026-10-24';

  const handleExportAllToIcs = () => {
    const pName = activeProject ? activeProject.name : 'Wszystkie Projekty';
    downloadIcsFile(filteredTasks, `terminarz-${year}-${month + 1}.ics`, pName);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm flex flex-col overflow-hidden transition-colors">
      {/* Calendar Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              {MONTH_NAMES_PL[month]} {year}
            </h2>
          </div>

          <div className="flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-xs p-0.5">
            <button
              onClick={prevMonth}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300 transition-colors"
              title="Poprzedni miesiąc"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={setToday}
              className="px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
            >
              Bieżący
            </button>
            <button
              onClick={nextMonth}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300 transition-colors"
              title="Następny miesiąc"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Action Buttons: Export to Google Calendar / .ics */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportAllToIcs}
            className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-medium px-3 py-1.5 rounded shadow-xs hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            title="Pobierz plik terminarza .ics kompatybilny z Google Calendar, Outlook i Apple Calendar"
          >
            <Download className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <span>Pobierz terminarz (.ics)</span>
          </button>

          <a
            href="https://calendar.google.com/calendar/r/settings/export"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium px-3 py-1.5 rounded shadow-xs transition-colors"
            title="Otwórz ustawienia importu Google Calendar"
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            <span>Importuj w Google Calendar</span>
            <ExternalLink className="w-3 h-3 opacity-80" />
          </a>
        </div>
      </div>

      {/* Weekdays Header */}
      <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/80 text-xs font-semibold text-slate-600 dark:text-slate-300">
        {DAY_NAMES_PL.map((name) => (
          <div key={name} className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700 last:border-r-0 text-center sm:text-left">
            <span className="hidden sm:inline">{name}</span>
            <span className="sm:hidden">{name.slice(0, 2)}</span>
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 divide-x divide-y divide-slate-200 dark:divide-slate-800 bg-slate-200/50 dark:bg-slate-800/50">
        {calendarDays.map((day) => {
          // Tasks due on this day or spanning this day
          const dayTasks = filteredTasks.filter(
            (t) => t.dueDate === day.dateStr || (t.startDate <= day.dateStr && t.dueDate >= day.dateStr)
          );

          const isToday = day.dateStr === todayStr;

          return (
            <div
              key={day.dateStr}
              onClick={() => onOpenNewTaskWithDate(day.dateStr)}
              className={`min-h-[110px] p-2 relative group flex flex-col justify-between transition-colors ${
                !day.isCurrentMonth
                  ? 'bg-slate-50/60 dark:bg-slate-950/60 text-slate-400 dark:text-slate-500'
                  : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200'
              } ${isToday ? 'ring-2 ring-inset ring-sky-500 bg-sky-50/20 dark:bg-sky-950/40' : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/60'}`}
            >
              {/* Day Number Header */}
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`text-xs font-mono tabular-nums ${
                    isToday
                      ? 'bg-sky-600 text-white font-bold w-5 h-5 rounded-full flex items-center justify-center'
                      : day.isCurrentMonth
                      ? 'text-slate-700 dark:text-slate-200 font-semibold'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {day.dayNum}
                </span>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenNewTaskWithDate(day.dateStr);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-800 p-0.5 rounded transition-opacity"
                  title={`Dodaj zadanie na dzień ${day.dateStr}`}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Tasks on this day */}
              <div className="space-y-1 flex-1 overflow-y-auto max-h-[85px]">
                {dayTasks.map((task) => {
                  const isDueToday = task.dueDate === day.dateStr;
                  const isOverdue = task.dueDate < todayStr && task.status !== 'done';
                  const isMilestone = task.type === 'milestone';

                  const isBlocked = task.status === 'blocked';
                  const isOfficialWarning = isApproachingOfficialDeadline(task);
                  const businessDaysRemaining = getBusinessDaysRemaining(task.dueDate);

                  let badgeColor = 'bg-slate-100 text-slate-800 border-slate-200';
                  if (isBlocked) {
                    badgeColor = 'task-blocked-style border-slate-300';
                  } else if (task.priority === 'critical') {
                    badgeColor = 'bg-rose-50 text-rose-800 border-rose-200';
                  } else if (task.priority === 'high') {
                    badgeColor = 'bg-amber-50 text-amber-900 border-amber-200';
                  } else if (task.status === 'done') {
                    badgeColor = 'bg-emerald-50 text-emerald-800 border-emerald-200';
                  }

                  return (
                    <div
                      key={task.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTask(task);
                      }}
                      className={`text-[11px] p-1 rounded border leading-tight cursor-pointer truncate transition-all hover:scale-[1.01] ${badgeColor} ${
                        isMilestone ? 'font-semibold' : ''
                      } ${isOfficialWarning ? 'animate-official-deadline' : ''}`}
                      title={`${task.code} - ${task.title} (${task.status})${
                        task.isOfficialDeadline ? ` [Termin urzędowy: pozostało ${businessDaysRemaining} dni roboczych]` : ''
                      }`}
                    >
                      <div className="flex items-center gap-1 truncate">
                        {isMilestone && <Diamond className="w-2.5 h-2.5 text-amber-600 fill-amber-500 shrink-0" />}
                        {isBlocked && <Lock className="w-2.5 h-2.5 text-rose-700 shrink-0" />}
                        {task.isOfficialDeadline && (
                          <ShieldAlert className={`w-2.5 h-2.5 shrink-0 ${isOfficialWarning ? 'text-rose-600 animate-pulse' : 'text-indigo-600'}`} />
                        )}
                        {isOverdue && isDueToday && (
                          <span title="Termin przekroczony!">
                            <AlertCircle className="w-2.5 h-2.5 text-rose-600 shrink-0" />
                          </span>
                        )}
                        <span className="font-mono text-[9px] opacity-75 shrink-0">{task.code}</span>
                        <span className="truncate font-medium">{task.title}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Day footer count */}
              {dayTasks.length > 3 && (
                <div className="text-[10px] text-slate-400 font-mono mt-1 text-right">
                  +{dayTasks.length - 3} więcej
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
