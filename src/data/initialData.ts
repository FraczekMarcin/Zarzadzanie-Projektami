import { User, Project, Task, ActivityLog } from '../types';

export const INITIAL_USERS: User[] = [
  {
    id: 'usr-1',
    name: 'Marcin Frączek',
    email: 'fraczek.marcin@gmail.com',
    role: 'admin',
    department: 'Główny Architekt & Zarząd Pracowni',
    initials: 'MF',
    passwordHash: 'sha256:86ea62c5ba0e6cf87b182765caff5b00c80980c528b86fea84c023372bfd2034',
    isDemo: false,
    isApproved: true,
  },
];

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
