import { User, Project } from '../types';

export const DEMO_USER_IDS = ['usr-1', 'usr-2', 'usr-3', 'usr-4', 'usr-5'];

export const DEMO_PROJECT_KEYS = ['2026-01', '2026-02', '2026-03'];
export const DEMO_PROJECT_IDS = ['prj-1', 'prj-2', 'prj-3'];

export function isDemoUser(user: User): boolean {
  if (user.isDemo === true) return true;
  if (DEMO_USER_IDS.includes(user.id)) return true;
  if (user.email && user.email.includes('@biuro-projektowe.pl')) return true;
  if (user.name === 'Marcin Frączek' && user.email === 'fraczek.marcin@gmail.com') return true;
  return false;
}

export function isDemoProject(project: Project): boolean {
  if (project.isDemo === true) return true;
  if (DEMO_PROJECT_IDS.includes(project.id)) return true;
  if (DEMO_PROJECT_KEYS.includes(project.key)) return true;
  if (project.name && (
    project.name.includes('Nordic Tower') ||
    project.name.includes('Zielone Tarasy') ||
    project.name.includes('Hala Przemysłowo')
  )) {
    return true;
  }
  return false;
}
