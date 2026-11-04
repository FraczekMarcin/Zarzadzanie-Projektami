import { Project, Task, ActivityLog } from '../types';


export const INITIAL_PROJECTS: Project[] = [];

export const INITIAL_TASKS: Task[] = [];

export const INITIAL_ACTIVITY: ActivityLog[] = [
  {
    id: 'act-init',
    timestamp: new Date().toISOString(),
    projectId: 'system',
    action: 'Inicjalizacja czystego systemu produkcyjnego Zarządzanie Projektami',
    userId: 'usr-1',
    details: 'Wersja produkcyjna gotowa do rejestracji nowych projektów i zadań architektoniczno-inżynieryjnych.',
  },
];
