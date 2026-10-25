export type Priority = 'critical' | 'high' | 'normal' | 'low';

export type TaskType = 'task' | 'milestone' | 'bug' | 'feature' | 'phase';

export type TaskStatus = 'to_do' | 'in_progress' | 'review' | 'done' | 'blocked';

export type UserRole = 'admin' | 'project_manager' | 'developer' | 'tester' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: UserRole;
  department: string;
  initials: string;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  priority: Priority;
  status: 'active' | 'planning' | 'on_hold' | 'completed';
  startDate: string;
  dueDate: string;
  durationDays: number; // Project duration in days
  progress: number;
  budget?: string;
  spentHours?: number;
  memberIds: string[];
  color: string;
}

export interface Task {
  id: string;
  projectId: string;
  code: string;
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  assigneeId?: string;
  reporterId: string;
  startDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  durationDays: number; // Task duration in days
  isOfficialDeadline?: boolean; // Termin urzędowy (3-dniowe ostrzeżenie robocze)
  estimatedHours?: number;
  spentHours?: number;
  progress: number; // 0-100
  blockingTaskIds?: string[]; // IDs of tasks that block this task
  dependencies?: string[]; // Alias for backward compatibility
  parentId?: string; // ID of higher-level parent task in hierarchy
  completedAt?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLog {
  id: string;
  taskId?: string;
  projectId: string;
  userId: string;
  action: string;
  timestamp: string;
  details?: string;
}

export interface Comment {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  createdAt: string;
}

export interface TemplateTaskBlueprint {
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  durationDays: number;
  offsetDays: number;
  isOfficialDeadline?: boolean;
  estimatedHours?: number;
  tags?: string[];
  blockerIndices?: number[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  category: 'kubaturowe' | 'mieszkaniowe' | 'przemyslowe' | 'infrastruktura' | 'przebudowa' | 'ogolne';
  description: string;
  defaultDurationDays: number;
  defaultPriority: Priority;
  defaultBudget?: string;
  tasks: TemplateTaskBlueprint[];
  isCustom?: boolean;
  createdAt?: string;
}
