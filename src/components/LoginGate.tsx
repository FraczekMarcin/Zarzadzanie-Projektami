import React, { useState } from 'react';
import { User, UserRole } from '../types';
import { 
  Building2, 
  Lock, 
  UserCheck, 
  UserPlus, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  KeyRound,
  Mail,
  User as UserIcon,
  Briefcase,
  Smartphone,
  ArrowLeft
} from 'lucide-react';
import { CURRENT_APP_VERSION } from '../data/dockerConfig';
import { hashPassword, verifyUserPassword, verifyTotpCode } from '../utils/authSecurity';

interface LoginGateProps {
  users: User[];
  onLogin: (user: User) => void;
  onRegister: (newUser: Omit<User, 'id' | 'initials'>) => void;
}

export const LoginGate: React.FC<LoginGateProps> = ({
  users,
  onLogin,
  onRegister,
}) => {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  
  // Step for 2FA
  const [authStep, setAuthStep] = useState<'credentials' | '2fa'>('credentials');
  const [pendingUser2FA, setPendingUser2FA] = useState<User | null>(null);
  const [totpInput, setTotpInput] = useState('');
  
  // Login form state
  const [selectedUserId, setSelectedUserId] = useState<string>(users[0]?.id || '');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // Register form state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regRole, setRegRole] = useState<UserRole>('developer');
  const [regDepartment, setRegDepartment] = useState('Projektant Architektury');
  const [regPassword, setRegPassword] = useState('');
  const [regEnable2FA, setRegEnable2FA] = useState(false);
  const [regSuccess, setRegSuccess] = useState(false);

  const approvedUsers = users.filter((u) => u.isApproved !== false);
  const pendingUsers = users.filter((u) => u.isApproved === false);

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const targetUser = users.find((u) => u.id === selectedUserId);
    if (!targetUser) {
      setLoginError('Wybierz użytkownika z listy.');
      return;
    }

    // Check if user is approved by administrator
    if (targetUser.isApproved === false) {
      setLoginError(
        `Konto "${targetUser.name}" oczekuje na zatwierdzenie przez Administratora pracowni. Przed rozpoczęciem pracy w systemie administrator musi potwierdzić Twoje konto.`
      );
      return;
    }

    // Password verification using salted SHA-256 hash
    const isValid = verifyUserPassword(password, targetUser);
    if (!isValid) {
      setLoginError('Nieprawidłowe hasło dostępu dla tego użytkownika.');
      return;
    }

    // Two-factor authentication check (Google Authenticator)
    if (targetUser.twoFactorEnabled) {
      setPendingUser2FA(targetUser);
      setAuthStep('2fa');
      setTotpInput('');
      return;
    }

    onLogin(targetUser);
  };

  const handleTotpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    if (!pendingUser2FA) return;

    const valid = verifyTotpCode(totpInput, pendingUser2FA.twoFactorSecret || 'PRJSECRET2026');
    if (!valid) {
      setLoginError('Nieprawidłowy 6-cyfrowy kod z Google Authenticator. Sprawdź czas na telefonie i spróbuj ponownie.');
      return;
    }

    onLogin(pendingUser2FA);
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regEmail.trim()) return;

    const passToHash = regPassword || 'Pracownia2026!';
    const passwordHash = await hashPassword(passToHash);

    onRegister({
      name: regName.trim(),
      email: regEmail.trim(),
      role: regRole,
      department: regDepartment.trim(),
      password: passToHash,
      passwordHash,
      twoFactorEnabled: regEnable2FA,
      twoFactorSecret: regEnable2FA ? 'JBSWY3DPEHPK3PXP' : undefined,
      isDemo: false,
      isApproved: false, // Must be approved by administrator!
      registeredAt: new Date().toISOString(),
    });

    setRegSuccess(true);
    setRegName('');
    setRegEmail('');
    setRegPassword('');
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      {/* Background architectural glow */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-sky-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-emerald-600/20 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-800/90 backdrop-blur-md rounded-2xl border border-slate-700 shadow-2xl p-6 sm:p-8 relative z-10 space-y-6">
        {/* Brand header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20 shadow-xs mb-1">
            <Building2 className="w-8 h-8" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Pracownia Projektowa
          </h1>
          <p className="text-xs text-slate-400">
            System Zarządzania Projektami & Harmonogramami Pracowni
          </p>
          <div className="inline-block px-2.5 py-0.5 rounded-full bg-slate-700/60 text-slate-300 font-mono text-[10px] border border-slate-600">
            Wydanie {CURRENT_APP_VERSION}
          </div>
        </div>

        {/* Tab switcher: Logowanie vs Rejestracja */}
        <div className="grid grid-cols-2 p-1 bg-slate-900/60 rounded-xl border border-slate-700/60 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setActiveTab('login');
              setRegSuccess(false);
              setLoginError(null);
            }}
            className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'login'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Logowanie</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('register');
              setLoginError(null);
            }}
            className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'register'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Nowe konto</span>
          </button>
        </div>

        {/* TAB 1: LOGOWANIE */}
        {activeTab === 'login' && authStep === '2fa' && (
          <form onSubmit={handleTotpSubmit} className="space-y-4 animate-in fade-in">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto mb-2">
                <Smartphone className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-white text-sm">Uwierzytelnianie dwuskładnikowe (2FA)</h3>
              <p className="text-xs text-slate-400">
                Wprowadź 6-cyfrowy kod z aplikacji Google Authenticator dla profilu <strong>{pendingUser2FA?.name}</strong>.
              </p>
            </div>

            {loginError && (
              <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{loginError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 text-center">
                Kod z aplikacji Google Authenticator
              </label>
              <input
                type="text"
                required
                maxLength={6}
                value={totpInput}
                onChange={(e) => setTotpInput(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoFocus
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-center text-lg tracking-[0.3em] font-mono font-bold text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs transition-colors shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Zweryfikuj kod i wejdź</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthStep('credentials');
                setLoginError(null);
              }}
              className="w-full py-1.5 text-slate-400 hover:text-white text-xs flex items-center justify-center gap-1 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Powrót do logowania</span>
            </button>
          </form>
        )}

        {/* TAB 1: LOGOWANIE (CREDENTIALS) */}
        {activeTab === 'login' && authStep === 'credentials' && (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            {loginError && (
              <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-start gap-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{loginError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                <span>Wybierz profil użytkownika</span>
                {approvedUsers.length > 0 && (
                  <span className="text-[10px] text-slate-400">Aktywne konta: {approvedUsers.length}</span>
                )}
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => {
                  setSelectedUserId(e.target.value);
                  setLoginError(null);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <optgroup label="Zatwierdzone konta pracowników">
                  {approvedUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.department} ({u.role === 'admin' ? 'Administrator' : 'Projektant'}){u.twoFactorEnabled ? ' [2FA]' : ''}
                    </option>
                  ))}
                </optgroup>
                {pendingUsers.length > 0 && (
                  <optgroup label="Konta oczekujące na zatwierdzenie admina">
                    {pendingUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        ⏳ {u.name} — (Oczekuje na akceptację)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                <span>Hasło (opcjonalne w trybie roboczym)</span>
                <span className="text-[10px] text-slate-500">Zaszyfrowane w bazie danych (Hash)</span>
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Wpisz hasło..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-semibold text-xs transition-colors shadow-lg shadow-sky-600/30 flex items-center justify-center gap-2"
            >
              <UserCheck className="w-4 h-4" />
              <span>Zaloguj do pracowni</span>
            </button>

            {pendingUsers.length > 0 && (
              <p className="text-[11px] text-amber-400/90 text-center flex items-center justify-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span>W systemie zarejestrowano {pendingUsers.length} konto oczekujące na potwierdzenie.</span>
              </p>
            )}
          </form>
        )}

        {/* TAB 2: REJESTRACJA NOWEGO UŻYTKOWNIKA */}
        {activeTab === 'register' && (
          <div className="space-y-4">
            {regSuccess ? (
              <div className="p-4 rounded-xl bg-emerald-950/50 border border-emerald-800 text-center space-y-3 animate-in fade-in">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-sm text-emerald-300">
                  Rejestracja zakończona sukcesem!
                </h4>
                <p className="text-xs text-emerald-200/90 leading-relaxed">
                  Twoje konto zostało utworzone i przesłane do weryfikacji. 
                  Przed rozpoczęciem pracy w systemie konto <strong>musi zostać zatwierdzone przez Administratora pracowni</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('login');
                    setRegSuccess(false);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold"
                >
                  Przejdź do strony logowania
                </button>
              </div>
            ) : (
              <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
                <div className="p-3 bg-slate-900/40 rounded-lg border border-slate-700/60 text-[11px] text-slate-300 flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <span>
                    Każdy nowo zarejestrowany użytkownik przed uzyskaniem dostępu do projektów musi zostać zatwierdzony przez Administratora.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Imię i Nazwisko *</label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="np. Michał Dąbrowski"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Adres E-mail *</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="np. m.dabrowski@pracownia.pl"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">Rola w systemie</label>
                    <select
                      value={regRole}
                      onChange={(e) => setRegRole(e.target.value as UserRole)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                    >
                      <option value="developer">Projektant</option>
                      <option value="project_manager">Kierownik Projektu</option>
                      <option value="tester">Asystent / Weryfikator</option>
                      <option value="viewer">Podgląd (Obserwator)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">Specjalizacja / Dział</label>
                    <input
                      type="text"
                      value={regDepartment}
                      onChange={(e) => setRegDepartment(e.target.value)}
                      placeholder="np. Architektura"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white placeholder-slate-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Hasło dostępu *</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Utwórz bezpieczne hasło..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                    />
                  </div>
                </div>

                <div className="p-3 bg-slate-900/60 border border-slate-700/80 rounded-lg flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-white block text-xs flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Uwierzytelnianie 2FA (Google Authenticator)</span>
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Wymagaj 6-cyfrowego kodu jednorazowego przy każdym logowaniu
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={regEnable2FA}
                    onChange={(e) => setRegEnable2FA(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 bg-slate-800 border-slate-600"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs transition-colors shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 mt-2"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Zarejestruj konto do zatwierdzenia</span>
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
