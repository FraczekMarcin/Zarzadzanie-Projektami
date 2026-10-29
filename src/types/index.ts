export type Priority = 'critical' | 'high' | 'normal' | 'low';

export type TaskType = 
  | 'rysunek' // Rysunek architektoniczny / wykonawczy
  | 'opis' // Opis techniczny, specyfikacja, bilans
  | 'uzgodnienia' // Uzgodnienia branżowe i rzeczoznawcy
  | 'urzad' // Czekanie na urząd, decyzję, pozwolenie
  | 'task' | 'milestone' | 'bug' | 'feature' | 'phase' // Kompatybilność wsteczna
  | string;

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
  password?: string;
  isDemo?: boolean;
  isApproved?: boolean; // Nowy użytkownik musi być zatwierdzony przez administratora
  registeredAt?: string;
}

export interface QuotationItem {
  id: string;
  title: string; // Nazwa wyceny
  companyName?: string; // Firma / Oferent
  type?: 'przychod' | 'koszt'; // Kierunek: Przychód pracowni (wycena dla klienta) lub Koszt (oferta podwykonawcy)
  isSelected?: boolean; // Znacznik: Wybrana (tylko wybrana przechodzi do bilansu)
  taxType?: 'netto' | 'brutto' | 'zwolniony'; // Typ kalkulacji: Netto, Brutto lub Zwolniony z VAT
  quantity: number;
  unit: string; // np. 'kpl', 'szt', 'godz', 'm²'
  unitPriceNet: number;
  unitPriceGross?: number;
  vatRate: number; // np. 23 (%) lub 0
  totalNet: number;
  totalGross: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'invoiced';
  notes?: string;
}

export type CostCategory =
  | 'mapa' // Mapa do celów projektowych
  | 'geologia' // Badania geotechniczne i geologia gruntu
  | 'uzgodnienia' // Uzgodnienia formalne (ZUD, PPOŻ, Sanepid, Wody Polskie, Konserwator)
  | 'podwykonawca' // Podwykonawcy branżowi (Konstrukcja, Sanitarka, Elektryka, Drogi)
  | 'oplaty_urzedowe' // Opłaty skarbowe, wypisy i wyrysy z rejestru gruntów
  | 'inne'; // Inne koszty operacyjne

export interface CostItem {
  id: string;
  projectId: string;
  taskId?: string; // Powiązanie z konkretnym zadaniem
  title: string;
  category: CostCategory;
  amountNet: number;
  amountGross: number;
  contractorName?: string; // np. Geodeta, Rzeczoznawca PPOŻ
  invoiceNumber?: string;
  date: string;
  status: 'planned' | 'incurred' | 'paid';
  notes?: string;
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
  // Zamawiający / Inwestor
  clientName?: string;
  clientContactPerson?: string;
  clientPhone?: string;
  clientEmail?: string;
  clientNip?: string;
  clientAddress?: string;
  // Lokalizacja na dysku / serwerze NAS
  diskPath?: string;
  // Wyceny i koszty
  quotations?: QuotationItem[];
  costs?: CostItem[];
  isDemo?: boolean;
  // Archiwum projektów
  isArchived?: boolean;
  archivedAt?: string;
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
  costIds?: string[]; // Powiązane koszty
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
