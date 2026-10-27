import React, { useState } from 'react';
import { User, UserRole, ActivityLog } from '../types';
import { 
  X, 
  Users, 
  Shield, 
  Lock, 
  Plus, 
  History, 
  LogIn, 
  CheckCircle2,
  Trash2,
  KeyRound,
  LogOut,
  AlertCircle,
  Eye,
  EyeOff
} from 'lucide-react';

interface UserAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  users: User[];
  onSwitchUser: (user: User) => void;
  onAddUser: (newUser: Omit<User, 'id' | 'initials'>) => void;
  onDeleteUser?: (userId: string) => void;
  onDeleteDemoUsers?: () => void;
  onUpdateUserPassword?: (userId: string, newPass: string) => void;
  onLogout?: () => void;
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
  onDeleteUser,
  onDeleteDemoUsers,
  onUpdateUserPassword,
  onLogout,
  activityLogs,
  onOpenTemplateManager,
}) => {
  const [activeTab, setActiveTab] = useState<'switch' | 'new_user' | 'password' | 'logs'>('switch');

  // Password verification for switching
  const [targetUser, setTargetUser] = useState<User | null>(null);
  const [enteredPassword, setEnteredPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // New user form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('developer');
  const [department, setDepartment] = useState('Pracownia Konstrukcji Budowlanych');

  // Change password state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState(false);

  // Delete confirmation
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  if (!isOpen) return null;

  const handleInitiateSwitch = (u: User) => {
    if (currentUser && u.id === currentUser.id) return;
    setTargetUser(u);
    setEnteredPassword('');
    setPasswordError(null);
  };

  const handleConfirmLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUser) return;

    const validPassword = targetUser.password || 'admin2026';
    if (enteredPassword.trim() === validPassword.trim()) {
      onSwitchUser(targetUser);
      setTargetUser(null);
      setEnteredPassword('');
      setPasswordError(null);
      onClose();
    } else {
      setPasswordError('Nieprawidłowe hasło. Dla kont demo domyślne hasło to: admin2026');
    }
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    onAddUser({
      name,
      email,
      role,
      department,
      password: password.trim() || 'haslo123',
      isDemo: false,
    });

    setName('');
    setEmail('');
    setPassword('');
    setActiveTab('switch');
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !onUpdateUserPassword) return;
    if (newPassword.length < 4) {
      setPasswordError('Hasło musi mieć co najmniej 4 znaki');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Hasła nie są identyczne');
      return;
    }

    onUpdateUserPassword(currentUser.id, newPassword);
    setPasswordChangeSuccess(true);
    setNewPassword('');
    setConfirmPassword('');
    setTimeout(() => setPasswordChangeSuccess(false), 3000);
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300 px-2 py-0.5 rounded border border-rose-200 dark:border-rose-900/50">Główny Architekt (Admin)</span>;
      case 'project_manager':
        return <span className="text-[11px] font-semibold text-purple-700 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300 px-2 py-0.5 rounded border border-purple-200 dark:border-purple-900/50">Koordynator Projektu</span>;
      case 'developer':
        return <span className="text-[11px] font-medium text-sky-700 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300 px-2 py-0.5 rounded border border-sky-200 dark:border-sky-900/50">Projektant Branżowy</span>;
      case 'tester':
        return <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-900/50">Sprawdzający / Rzeczoznawca</span>;
      default:
        return <span className="text-[11px] text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Inwestor / Obserwator</span>;
    }
  };

  const demoUsersCount = users.filter((u) => u.isDemo).length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-900 dark:bg-sky-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
              {currentUser?.initials || '??'}
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Uwierzytelnianie & Zespół Pracowni</span>
                {currentUser && (
                  <span className="text-[10px] font-normal px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 rounded border border-emerald-200 dark:border-emerald-800">
                    Zalogowano
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {currentUser ? (
                  <>Aktywny projektant: <strong className="text-slate-800 dark:text-slate-200">{currentUser.name}</strong> ({currentUser.email})</>
                ) : (
                  'Brak aktywnej sesji — wybierz użytkownika i wprowadź hasło'
                )}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {currentUser && onLogout && (
              <button
                onClick={() => {
                  onLogout();
                  setActiveTab('switch');
                }}
                title="Wyloguj z systemu"
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded border border-rose-200 dark:border-rose-900/40 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Wyloguj</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab switchers */}
        <div className="px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3 text-xs font-medium overflow-x-auto">
          <button
            onClick={() => {
              setActiveTab('switch');
              setTargetUser(null);
            }}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'switch'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Wybór i logowanie ({users.length})</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('new_user');
              setTargetUser(null);
            }}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'new_user'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>Nowy użytkownik</span>
          </button>

          {currentUser && onUpdateUserPassword && (
            <button
              onClick={() => {
                setActiveTab('password');
                setTargetUser(null);
              }}
              className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'password'
                  ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>Zmień hasło</span>
            </button>
          )}

          <button
            onClick={() => {
              setActiveTab('logs');
              setTargetUser(null);
            }}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'logs'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Dziennik audytu</span>
          </button>
        </div>

        {/* Tab 1: User Switching with Password Requirement */}
        {activeTab === 'switch' && (
          <div className="p-6 overflow-y-auto space-y-4 flex-1">
            {/* Banner for demo users */}
            {demoUsersCount > 0 && onDeleteDemoUsers && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Wykryto {demoUsersCount} użytkowników pokazowych (domyślne hasło: <strong>admin2026</strong>).</span>
                </div>
                <button
                  onClick={onDeleteDemoUsers}
                  className="px-2.5 py-1 text-[11px] font-medium bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors"
                >
                  Usuń konta pokazowe
                </button>
              </div>
            )}

            {/* Target user login prompt if selected */}
            {targetUser ? (
              <form onSubmit={handleConfirmLogin} className="p-4 bg-sky-50/70 dark:bg-sky-950/40 border border-sky-300 dark:border-sky-800 rounded-xl space-y-3 animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center">
                      {targetUser.initials}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                        Logowanie: {targetUser.name}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {targetUser.email} · {targetUser.department}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTargetUser(null);
                      setEnteredPassword('');
                      setPasswordError(null);
                    }}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                  >
                    Anuluj
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Wprowadź hasło użytkownika <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoFocus
                      required
                      value={enteredPassword}
                      onChange={(e) => {
                        setEnteredPassword(e.target.value);
                        setPasswordError(null);
                      }}
                      placeholder="Wprowadź hasło (demo: admin2026)"
                      className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-md px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 pr-9 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {passwordError && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {passwordError}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                    🔒 Bezpieczne logowanie: wymagane hasło przy każdej zmianie konta projektanta.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setTargetUser(null)}
                    className="px-3 py-1.5 rounded text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Wróć
                  </button>
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded text-xs font-semibold shadow-xs transition-colors"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Zaloguj jako {targetUser.name.split(' ')[0]}</span>
                  </button>
                </div>
              </form>
            ) : null}

            {/* User List */}
            <div className="space-y-2">
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                Wybierz konto projektanta i wprowadź hasło, aby się zalogować:
              </p>

              {users.map((u) => {
                const isActive = currentUser ? u.id === currentUser.id : false;
                return (
                  <div
                    key={u.id}
                    className={`p-3 rounded-lg border flex items-center justify-between transition-all ${
                      isActive
                        ? 'bg-sky-50/80 dark:bg-sky-950/40 border-sky-300 dark:border-sky-700 ring-1 ring-sky-300 dark:ring-sky-700'
                        : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center justify-center">
                        {u.initials}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">{u.name}</span>
                          {isActive && (
                            <span className="text-[10px] text-sky-700 dark:text-sky-300 font-semibold bg-sky-100 dark:bg-sky-950/60 px-1.5 py-0.2 rounded">
                              Aktywna sesja
                            </span>
                          )}
                          {u.isDemo && (
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.2 rounded">
                              Demo
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {u.email} · {u.department}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {getRoleBadge(u.role)}

                      {!isActive ? (
                        <button
                          onClick={() => handleInitiateSwitch(u)}
                          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 hover:bg-sky-600 hover:text-white dark:hover:bg-sky-600 border border-sky-200 dark:border-sky-800 transition-colors font-medium"
                        >
                          <Lock className="w-3 h-3" />
                          <span>Zaloguj</span>
                        </button>
                      ) : (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Zalogowany</span>
                        </span>
                      )}

                      {/* Delete user button (disabled for active or last user) */}
                      {onDeleteUser && users.length > 1 && (
                        <button
                          onClick={() => setUserToDelete(u)}
                          disabled={isActive}
                          title={isActive ? 'Nie możesz usunąć aktualnie zalogowanego użytkownika' : 'Usuń użytkownika'}
                          className={`p-1 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors ${
                            isActive ? 'opacity-30 cursor-not-allowed' : 'hover:bg-rose-50 dark:hover:bg-rose-950/40'
                          }`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
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
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Imię i nazwisko *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="np. inż. Jan Kowalski"
                className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Adres e-mail *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="j.kowalski@twojadomena.pl"
                className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Rola w systemie *</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="admin">Główny Architekt / Szef Pracowni (Admin)</option>
                  <option value="project_manager">Koordynator Projektu / KPA</option>
                  <option value="developer">Projektant Branżowy (Konstrukcja / Instalacje)</option>
                  <option value="tester">Sprawdzający / Rzeczoznawca PPOŻ / Sanepid</option>
                  <option value="viewer">Inwestor / Zamawiający (Tylko odczyt)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Pracownia / Dział branżowy</label>
                <input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="np. Pracownia Konstrukcji Budowlanych"
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Hasło początkowe *</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Wpisz hasło do logowania"
                className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Użytkownik będzie musiał podać to hasło podczas logowania.
              </span>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                className="bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 text-white font-medium px-4 py-2 rounded text-xs transition-colors"
              >
                Zarejestruj i utwórz konto
              </button>
            </div>
          </form>
        )}

        {/* Tab 3: Change Password */}
        {activeTab === 'password' && currentUser && (
          <form onSubmit={handleChangePassword} className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
            <div className="p-3 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 rounded-md">
              <p className="text-slate-700 dark:text-slate-300">
                Zmiana hasła dla użytkownika: <strong>{currentUser.name}</strong> ({currentUser.email})
              </p>
            </div>

            {passwordChangeSuccess && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Hasło zostało pomyślnie zaktualizowane!</span>
              </div>
            )}

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Nowe hasło *</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setPasswordError(null);
                }}
                placeholder="Wpisz nowe hasło (min. 4 znaki)"
                className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Powtórz nowe hasło *</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setPasswordError(null);
                }}
                placeholder="Wpisz ponownie nowe hasło"
                className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
              />
            </div>

            {passwordError && (
              <p className="text-rose-600 dark:text-rose-400 text-xs font-medium">{passwordError}</p>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                className="bg-sky-600 hover:bg-sky-700 text-white font-medium px-4 py-2 rounded text-xs transition-colors"
              >
                Zapisz nowe hasło
              </button>
            </div>
          </form>
        )}

        {/* Tab 4: Audit Log */}
        {activeTab === 'logs' && (
          <div className="p-6 overflow-y-auto space-y-3 flex-1 text-xs">
            <p className="text-slate-600 dark:text-slate-400 mb-2">
              Śledzenie edycji w czasie rzeczywistym — każda modyfikacja zadań przez różnych użytkowników jest rejestrowana:
            </p>

            <div className="space-y-2">
              {activityLogs.map((log) => {
                const user = users.find((u) => u.id === log.userId);
                return (
                  <div key={log.id} className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-md">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{user?.name || 'Użytkownik'}</span>
                      <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                        {log.timestamp.slice(0, 10)} {log.timestamp.slice(11, 16)}
                      </span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300">{log.action}</p>
                    {log.details && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{log.details}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Delete user confirmation sub-modal */}
        {userToDelete && (
          <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-sm w-full shadow-2xl space-y-3 animate-in fade-in zoom-in-95">
              <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
                <Trash2 className="w-5 h-5 shrink-0" />
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Usuń użytkownika</h4>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Czy na pewno chcesz bezpowrotnie usunąć profil <strong>{userToDelete.name}</strong> ({userToDelete.email})?
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setUserToDelete(null)}
                  className="px-3 py-1.5 rounded text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Anuluj
                </button>
                <button
                  onClick={() => {
                    if (onDeleteUser) onDeleteUser(userToDelete.id);
                    setUserToDelete(null);
                  }}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold shadow-xs"
                >
                  Tak, usuń użytkownika
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
