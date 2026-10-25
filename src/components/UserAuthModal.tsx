import React, { useState } from 'react';
import { User, UserRole, ActivityLog } from '../types';
import { 
  X, 
  Users, 
  UserCheck, 
  Shield, 
  Lock, 
  Plus, 
  History, 
  LogIn, 
  CheckCircle2,
  Clock,
  Layers,
  Building2
} from 'lucide-react';

interface UserAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  users: User[];
  onSwitchUser: (user: User) => void;
  onAddUser: (newUser: Omit<User, 'id' | 'initials'>) => void;
  activityLogs: ActivityLog[];
  onOpenTemplateManager?: () => void;
}

export const UserAuthModal: React.FC<UserAuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  users,
  onSwitchUser,
  onAddUser,
  activityLogs,
  onOpenTemplateManager,
}) => {
  const [activeTab, setActiveTab] = useState<'switch' | 'new_user' | 'logs'>('switch');

  // New user form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('developer');
  const [department, setDepartment] = useState('Pracownia Konstrukcji Budowlanych');

  if (!isOpen) return null;

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    onAddUser({
      name,
      email,
      role,
      department,
    });

    setName('');
    setEmail('');
    setPassword('');
    setActiveTab('switch');
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">Główny Architekt (Admin)</span>;
      case 'project_manager':
        return <span className="text-[11px] font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">Koordynator Projektu</span>;
      case 'developer':
        return <span className="text-[11px] font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">Projektant Branżowy</span>;
      case 'tester':
        return <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Sprawdzający / Rzeczoznawca</span>;
      default:
        return <span className="text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">Inwestor / Obserwator</span>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center">
              {currentUser.initials}
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Uwierzytelnianie & Zespół Pracowni Projektowej</h3>
              <p className="text-xs text-slate-500">
                Zalogowany jako: <strong className="text-slate-800">{currentUser.name}</strong> ({currentUser.email})
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

        {/* Administrator Quick Action Banner */}
        {currentUser.role === 'admin' && onOpenTemplateManager && (
          <div className="bg-purple-50 border-b border-purple-200 px-6 py-2.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-purple-900 font-semibold">
              <Shield className="w-4 h-4 text-purple-600" />
              <span>Uprawnienia Administratora: Szablony Projektów Budowlanych</span>
            </div>
            <button
              onClick={() => {
                onClose();
                onOpenTemplateManager();
              }}
              className="flex items-center gap-1.5 px-3 py-1 bg-purple-700 hover:bg-purple-800 text-white rounded font-bold text-xs transition-colors shadow-2xs"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Otwórz kreator szablonów</span>
            </button>
          </div>
        )}

        {/* Tab switchers */}
        <div className="px-6 border-b border-slate-200 bg-white flex items-center gap-4 text-xs font-medium">
          <button
            onClick={() => setActiveTab('switch')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'switch'
                ? 'border-sky-600 text-sky-700 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Przełącz aktywnego projektanta</span>
          </button>

          <button
            onClick={() => setActiveTab('new_user')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'new_user'
                ? 'border-sky-600 text-sky-700 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>Dodaj nowe konto</span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'logs'
                ? 'border-sky-600 text-sky-700 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Dziennik audytu zmian</span>
          </button>
        </div>

        {/* Tab 1: User Switching */}
        {activeTab === 'switch' && (
          <div className="p-6 overflow-y-auto space-y-3 flex-1">
            <p className="text-xs text-slate-600 mb-2">
              Wybierz profil członka zespołu, aby przetestować symulację pracy wieloosobowej, uprawnień i historii edycji zadań:
            </p>

            <div className="space-y-2">
              {users.map((u) => {
                const isActive = u.id === currentUser.id;
                return (
                  <div
                    key={u.id}
                    onClick={() => {
                      onSwitchUser(u);
                      onClose();
                    }}
                    className={`p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${
                      isActive
                        ? 'bg-sky-50/80 border-sky-300 ring-1 ring-sky-300'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-800 text-xs font-bold flex items-center justify-center">
                        {u.initials}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">{u.name}</span>
                          {isActive && (
                            <span className="text-[10px] text-sky-700 font-semibold bg-sky-100 px-1.5 py-0.2 rounded">
                              Aktywna sesja
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {u.email} · {u.department}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {getRoleBadge(u.role)}
                      <button
                        className={`text-xs px-2.5 py-1 rounded transition-colors ${
                          isActive
                            ? 'bg-sky-600 text-white font-medium'
                            : 'text-slate-600 hover:bg-slate-200 bg-slate-100'
                        }`}
                      >
                        {isActive ? 'Aktywny' : 'Zaloguj jako'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: Register New User */}
        {activeTab === 'new_user' && (
          <form onSubmit={handleCreateUser} className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Imię i nazwisko *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="np. Jan Kowalski"
                className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Adres e-mail *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jan.kowalski@twojadomena.pl"
                className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Rola w systemie *</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="admin">Główny Architekt / Szef Pracowni (Admin)</option>
                  <option value="project_manager">Koordynator Projektu / KPA</option>
                  <option value="developer">Projektant Branżowy (Konstrukcja / Instalacje)</option>
                  <option value="tester">Sprawdzający / Rzeczoznawca PPOŻ / Sanepid</option>
                  <option value="viewer">Inwestor / Zamawiający (Tylko odczyt)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Pracownia / Dział branżowy</label>
                <input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="np. Pracownia Konstrukcji Budowlanych"
                  className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Hasło początkowe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                W PostgreSQL hasło jest haszowane algorytmem bcrypt / Argon2id.
              </span>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                className="bg-slate-900 hover:bg-slate-800 text-white font-medium px-4 py-2 rounded text-xs transition-colors"
              >
                Zarejestruj i dodaj użytkownika
              </button>
            </div>
          </form>
        )}

        {/* Tab 3: Audit Log of user actions */}
        {activeTab === 'logs' && (
          <div className="p-6 overflow-y-auto space-y-3 flex-1 text-xs">
            <p className="text-slate-600 mb-2">
              Śledzenie edycji w czasie rzeczywistym — każda modyfikacja zadań przez różnych użytkowników jest rejestrowana:
            </p>

            <div className="space-y-2">
              {activityLogs.map((log) => {
                const user = users.find((u) => u.id === log.userId);
                return (
                  <div key={log.id} className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-slate-900">{user?.name || 'Użytkownik'}</span>
                      <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                        {log.timestamp.slice(0, 10)} {log.timestamp.slice(11, 16)}
                      </span>
                    </div>
                    <p className="text-slate-700">{log.action}</p>
                    {log.details && <p className="text-[11px] text-slate-500 mt-0.5">{log.details}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
