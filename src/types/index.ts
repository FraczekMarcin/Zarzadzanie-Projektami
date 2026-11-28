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

export type Permission =
  | 'projects.view'
  | 'projects.create'
  | 'projects.edit'
  | 'projects.delete'
  | 'projects.archive'
  | 'tasks.edit'
  | 'finance.view'
  | 'finance.edit'
  | 'economy.view'
  | 'tenders.view'
  | 'tenders.edit'
  | 'contractors.view'
  | 'contractors.edit'
  | 'clients.edit'
  | 'templates.manage'
  | 'trash.manage'
  | 'reports.view';

export interface PermissionGroup {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
}

export type RolePermissionsMap = Record<UserRole, Permission[]>;

export interface PermissionConfig {
  rolePermissions: RolePermissionsMap;
  permissionGroups: PermissionGroup[];
  companyMemberPermissions: Permission[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: UserRole;
  department: string;
  initials: string;
  password?: string;
  twoFactorEnabled?: boolean; // Google Authenticator 2FA
  backupCodesCount?: number;
  isDemo?: boolean;
  isApproved?: boolean; // Nowy użytkownik musi być zatwierdzony przez administratora
  hasCalendarToken?: boolean; // Czy użytkownik wygenerował prywatny token kalendarza
  calendarTokenCreatedAt?: string;
  emailReminders?: boolean; // Domyślnie true (undefined traktowane jako true)
  weeklySummary?: boolean; // Domyślnie true dla admin i project_manager
  registeredAt?: string;
  groupIds?: string[];
  companyIds?: string[];
  permissionGrants?: Permission[];
  permissionDenials?: Permission[];
  effectivePermissions?: Permission[];
  companyMemberPermissions?: Permission[];
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
  dueDate?: string; // Termin płatności YYYY-MM-DD
  isPaid?: boolean; // Znacznik: Zapłacono (rozliczone w bilansie)
  paidAt?: string;
  paidAmount?: number;
  isChosenOffer?: boolean; // Wycena kosztowa przeniesiona do kosztów jako wybrana oferta
  linkedCostId?: string; // ID powiązanej pozycji kosztu
  scheduledTaskId?: string; // ID zadania w harmonogramie utworzonego z terminu płatności
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
  vatRate?: number; // Stawka VAT (%)
  contractorName?: string; // np. Geodeta, Rzeczoznawca PPOŻ
  invoiceNumber?: string;
  date: string;
  dueDate?: string; // Termin płatności YYYY-MM-DD
  status: 'planned' | 'incurred' | 'paid';
  isPaid?: boolean; // Znacznik: Zapłacono
  paidAt?: string;
  sourceQuotationId?: string; // ID wyceny kosztowej, z której przeniesiono pozycję
  scheduledTaskId?: string; // ID zadania w harmonogramie utworzonego z terminu płatności
  notes?: string;
}

export interface PaymentTranche {
  id: string;
  title: string;
  amountNet: number;
  amountGross: number;
  dueDate?: string; // Termin płatności YYYY-MM-DD
  isPaid: boolean;
  paidAt?: string; // Data zapłaty YYYY-MM-DD
  paidAmount?: number; // Rzeczywista kwota zapłacona netto (PLN)
  scheduledTaskId?: string; // ID zadania w harmonogramie utworzonego z terminu płatności
  notes?: string;
}

export type ProjectNumberingScope = 'year' | 'company';

export interface Company {
  id: string;
  name: string;
  letter: string;
  color?: string;
  nip?: string;
  address?: string;
  isActive: boolean;
  vatPayer: boolean;
  vatExemptionBasis?: string;
}

export interface ProjectDeadlineSettings {
  warnDays: number;
  criticalDays: number;
  blinkEnabled: boolean;
}

export interface ProjectNumberingSettings {
  scope: ProjectNumberingScope;
  defaultCompanyId?: string;
}

export type ProjectMetaColorKey =
  | 'sky'
  | 'emerald'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'indigo'
  | 'purple'
  | 'slate';

export interface ProjectStatusOption {
  id: string;
  label: string;
  color: ProjectMetaColorKey;
  order: number;
  isDefault: boolean;
  isClosed: boolean;
  isSystem?: boolean;
}

export interface ProjectPriorityOption {
  id: string;
  label: string;
  color: ProjectMetaColorKey;
  order: number;
  isDefault: boolean;
  isSystem?: boolean;
}

export interface ProjectSubtypeOption {
  id: string;
  label: string;
  order: number;
  isActive: boolean;
}

export interface ProjectTypeOption {
  id: string;
  label: string;
  color: ProjectMetaColorKey;
  order: number;
  isActive: boolean;
  subtypes: ProjectSubtypeOption[];
}

export interface ProjectDeliverable {
  id: string;
  name: string;
  copies: number;
  unit: string;
  isDone: boolean;
  doneAt?: string;
  doneBy?: string;
  notes?: string;
}

export interface TemplateDeliverableBlueprint {
  id: string;
  name: string;
  copies: number;
  unit: string;
  notes?: string;
}

export type ProjectStatusId = 'active' | 'planning' | 'on_hold' | 'completed' | string;
export type ProjectPriorityId = Priority | string;

export interface Project {
  id: string;
  key: string;
  companyId?: string;
  name: string;
  shortName?: string;
  typeId?: string;
  subtypeId?: string;
  deliverables?: ProjectDeliverable[];
  description: string;
  priority: ProjectPriorityId;
  status: ProjectStatusId;
  startDate: string;
  dueDate: string;
  durationDays: number; // Project duration in days
  progress: number;
  budget?: string;
  // Wartość projektu (kwota umowy) uwzględniana w bilansie
  projectValue?: number; // Kwota netto w PLN
  projectValueGross?: number; // Kwota brutto w PLN
  projectVatRate?: number; // Stawka VAT (np. 23%)
  isBaseContractPaid?: boolean; // Czy umowa bazowa oznaczona jako opłacona
  ownerId?: string; // ID właściciela projektu (uprawnienia edycji finansów)
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
  // Wyceny, koszty i transze płatności
  quotations?: QuotationItem[];
  costs?: CostItem[];
  paymentTranches?: PaymentTranche[];
  isDemo?: boolean;
  // Powiązanie z przetargiem źródłowym (utworzenie projektu z wygranego przetargu)
  sourceTenderId?: string;
  // Archiwum projektów (tylko Administrator)
  isArchived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  // Rewizja zasobu (współbieżna synchronizacja)
  revision?: number;
}

export type TenderStatus = 'announced' | 'resolved' | 'cancelled';

export type TenderPriceBasis = 'net' | 'gross';

export interface Bidder {
  id: string;
  name: string;
  price?: number;
  isOurs: boolean;
  companyId?: string;
  isDisqualified?: boolean;
  notes?: string;
}

export interface Tender {
  id: string;
  name: string;
  contractingAuthority: string;
  referenceNumber?: string;
  description?: string;
  url?: string;
  announcementDate?: string;
  submissionDeadline?: string;
  resolutionDate: string;
  status: TenderStatus;
  priceBasis: TenderPriceBasis;
  authorityBudget?: number;
  scopeQuantity?: number;
  scopeUnit?: string;
  notes?: string;
  bidders: Bidder[];
  winnerBidderId?: string;
  linkedProjectId?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  revision: number;
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
  // Rewizja zasobu (współbieżna synchronizacja)
  revision?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLog {
  id: string;
  taskId?: string;
  projectId?: string;
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

export type TemplateAssigneeRole = 'owner' | 'reporter' | 'none';

export type LegacyTemplateCategory =
  | 'kubaturowe'
  | 'mieszkaniowe'
  | 'przemyslowe'
  | 'infrastruktura'
  | 'przebudowa'
  | 'ogolne';

export interface TemplateTaskBlueprint {
  key: string;
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  durationDays: number;
  offsetDays: number;
  isOfficialDeadline?: boolean;
  estimatedHours?: number;
  tags?: string[];
  parentKey?: string;
  blockerKeys?: string[];
  assigneeRole?: TemplateAssigneeRole;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  typeId: string;
  description: string;
  defaultDurationDays: number;
  defaultPriority: Priority;
  defaultBudget?: string;
  tasks: TemplateTaskBlueprint[];
  deliverables?: TemplateDeliverableBlueprint[];
  isCustom?: boolean;
  builtIn?: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  sourceProjectId?: string;
  revision?: number;
}

export interface ProjectTemplateSummary {
  id: string;
  name: string;
  typeId: string;
  description: string;
  defaultDurationDays: number;
  defaultPriority: Priority;
  defaultBudget?: string;
  taskCount: number;
  officialDeadlineCount: number;
  deliverableCount?: number;
  builtIn: boolean;
  isCustom?: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  sourceProjectId?: string;
  revision?: number;
}

export type TrashItemType = 'task' | 'project';

export interface TrashTaskLinks {
  parentId?: string;
  blockingTaskIds: string[];
  dependencies: string[];
  childTaskIds: string[];
  dependentTaskIds: string[];
}

export interface TrashTaskPayload {
  task: Task;
  comments: Comment[];
  links: TrashTaskLinks;
}

export interface TrashProjectPayload {
  project: Project;
  tasks: Task[];
  comments: Comment[];
}

export interface TrashEntry {
  id: string;
  type: TrashItemType;
  deletedAt: string;
  deletedBy: string;
  deletedByName: string;
  expiresAt: string;
  projectId: string;
  title: string;
  code: string;
  payload: TrashTaskPayload | TrashProjectPayload;
}

export interface TrashEntrySummary {
  id: string;
  type: TrashItemType;
  deletedAt: string;
  deletedBy: string;
  deletedByName: string;
  expiresAt: string;
  daysRemaining: number;
  projectId: string;
  projectName: string;
  projectKey: string;
  title: string;
  code: string;
  taskCount: number;
  commentCount: number;
  canRestore: boolean;
  canPurge: boolean;
}

