import React, { useState, useEffect } from 'react';
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
  ArrowLeft,
  Copy,
  Check,
  QrCode,
  ShieldAlert,
  FileText,
  Info
} from 'lucide-react';
import { CURRENT_APP_VERSION } from '../data/dockerConfig';
import { 
  generateQrCodeDataUrl, 
  formatSecretKey
} from '../utils/authSecurity';
import { copyToClipboard } from '../utils/clipboard';

interface LoginGateProps {
  users: User[];
  onLogin: (user: User) => void;
  onRegister?: (newUser: Omit<User, 'id' | 'initials'>) => void;
  onUpdateUserPassword?: (userId: string, newPass: string) => Promise<void> | void;
  onRefreshUsers?: () => Promise<void> | void;
  setupRequired?: boolean;
}

export const LoginGate: React.FC<LoginGateProps> = ({
  users,
  onLogin,
  onUpdateUserPassword,
  onRefreshUsers,
  setupRequired: propSetupRequired,
}) => {
  const [activeTab, setActiveTab] = useState<'login' | 'register' | 'recovery'>('login');
  
  // Setup admin wizard state (triggered when setupRequired === true on server)
  const [setupRequired, setSetupRequired] = useState<boolean>(() => {
    if (typeof propSetupRequired === 'boolean') return propSetupRequired;
    return users.length === 0;
  });
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminDepartment, setAdminDepartment] = useState('Główny Architekt & Zarząd Pracowni');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [adminSetupToken, setAdminSetupToken] = useState('');
  const [requireSetupToken, setRequireSetupToken] = useState(false);
  const [allowSelfRegistration, setAllowSelfRegistration] = useState(true);
  const [adminSetupError, setAdminSetupError] = useState<string | null>(null);
  const [isAdminSubmitting, setIsAdminSubmitting] = useState(false);

  // Step for 2FA
  const [authStep, setAuthStep] = useState<'credentials' | '2fa'>('credentials');
  const [pendingLoginEmail, setPendingLoginEmail] = useState('');
  const [totpInput, setTotpInput] = useState('');
  
  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Email Password Recovery state (Strict SMTP)
  const [isSmtpConfigured, setIsSmtpConfigured] = useState<boolean | null>(null);
  const [smtpStatusMessage, setSmtpStatusMessage] = useState<string | null>(null);
  const [recoveryStep, setRecoveryStep] = useState<'email' | 'code' | 'new_password' | 'success'>('email');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [enteredRecoveryCode, setEnteredRecoveryCode] = useState('');
  const [recoveryVerifiedTicket, setRecoveryVerifiedTicket] = useState('');
  const [newRecoveryPass, setNewRecoveryPass] = useState('');
  const [confirmRecoveryPass, setConfirmRecoveryPass] = useState('');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryInfoMsg, setRecoveryInfoMsg] = useState<string | null>(null);
  const [isRecoveryLoading, setIsRecoveryLoading] = useState(false);

  // Register form state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regRole, setRegRole] = useState<UserRole>('developer');
  const [regDepartment, setRegDepartment] = useState('Projektant Architektury');
  const [regPassword, setRegPassword] = useState('');
  const [regEnable2FA, setRegEnable2FA] = useState(false);
  const [regSuccess, setRegSuccess] = useState(false);
  const [registered2FASecret, setRegistered2FASecret] = useState<string | null>(null);
  const [registered2FABackupCodes, setRegistered2FABackupCodes] = useState<string[]>([]);
  const [registeredQrDataUrl, setRegisteredQrDataUrl] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  // Sync propSetupRequired if updated externally
  useEffect(() => {
    if (typeof propSetupRequired === 'boolean') {
      setSetupRequired(propSetupRequired);
    }
  }, [propSetupRequired]);

  // Check setup status from server on mount
  useEffect(() => {
    let isMounted = true;
    fetch('/api/auth/setup-status', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        if (data) {
          if (typeof data.setupRequired === 'boolean') {
            setSetupRequired(data.setupRequired);
          } else if (users.length === 0) {
            setSetupRequired(true);
          }
          if (typeof data.allowSelfRegistration === 'boolean') {
            setAllowSelfRegistration(data.allowSelfRegistration);
            if (!data.allowSelfRegistration) {
              setActiveTab((prev) => (prev === 'register' ? 'login' : prev));
            }
          }
          if (typeof data.requireSetupToken === 'boolean') {
            setRequireSetupToken(data.requireSetupToken);
          }
        } else if (users.length === 0) {
          setSetupRequired(true);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        if (users.length === 0) {
          setSetupRequired(true);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [users.length]);

  // Check SMTP status for password reset
  const checkSmtpStatus = async () => {
    try {
      const res = await fetch('/api/auth/password-reset/status', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        setIsSmtpConfigured(Boolean(data.enabled));
        setSmtpStatusMessage(data.message);
      } else {
        setIsSmtpConfigured(false);
      }
    } catch {
      setIsSmtpConfigured(false);
    }
  };

  useEffect(() => {
    checkSmtpStatus();
  }, []);

  // Initial Admin Setup Submission
  const handleAdminSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminSetupError(null);

    if (adminPassword.length < 12) {
      setAdminSetupError('Hasło administratora musi zawierać co najmniej 12 znaków.');
      return;
    }
    if (adminPassword !== adminConfirmPassword) {
      setAdminSetupError('Hasła nie są identyczne.');
      return;
    }
    if (requireSetupToken && !adminSetupToken.trim()) {
      setAdminSetupError('Wymagany jest token instalacyjny (SETUP_TOKEN).');
      return;
    }

    setIsAdminSubmitting(true);
    try {
      const res = await fetch('/api/auth/setup-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: adminName.trim(),
          email: adminEmail.trim(),
          department: adminDepartment.trim() || 'Główny Architekt & Zarząd Pracowni',
          password: adminPassword,
          setupToken: requireSetupToken ? adminSetupToken.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAdminSetupError(data.error || 'Nie udało się utworzyć konta administratora.');
        setIsAdminSubmitting(false);
        return;
      }

      setSetupRequired(false);
      if (onRefreshUsers) await onRefreshUsers();
      onLogin(data.user);
    } catch {
      setAdminSetupError('Błąd połączenia z serwerem podczas konfiguracji administratora.');
    } finally {
      setIsAdminSubmitting(false);
    }
  };

  // Login submission using server-side scrypt authentication
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const cleanEmail = loginEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setLoginError('Wprowadź adres e-mail.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: cleanEmail,
          password,
        }),
      });

      const data = await res.json();

      if (res.status === 429) {
        setLoginError(data.error || 'Zbyt wiele nieudanych prób logowania. Konto lub adres IP zablokowany na 15 minut.');
        setIsLoggingIn(false);
        return;
      }

      if (!res.ok) {
        setLoginError(data.error || 'Nieprawidłowy adres e-mail lub hasło.');
        setIsLoggingIn(false);
        return;
      }

      // If 2FA is required by server
      if (data.require2FA) {
        setPendingLoginEmail(cleanEmail);
        setAuthStep('2fa');
        setTotpInput('');
        setIsLoggingIn(false);
        return;
      }

      // Login success
      onLogin(data.user);
    } catch {
      setLoginError('Błąd połączenia z serwerem logowania.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // 2FA Verification via Server (strictly RFC 6238 or one of 8 backup codes)
  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const cleanEmail = pendingLoginEmail || loginEmail.trim().toLowerCase();
    if (!cleanEmail) return;

    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: cleanEmail,
          password,
          totpCode: totpInput.trim(),
        }),
      });

      const data = await res.json();

      if (res.status === 429) {
        setLoginError(data.error || 'Zbyt wiele nieudanych prób logowania. Konto lub adres IP zablokowany na 15 minut.');
        setIsLoggingIn(false);
        return;
      }

      if (!res.ok) {
        setLoginError(data.error || 'Nieprawidłowy 6-cyfrowy kod 2FA lub kod zapasowy.');
        setIsLoggingIn(false);
        return;
      }

      onLogin(data.user);
    } catch {
      setLoginError('Błąd połączenia z serwerem podczas weryfikacji 2FA.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Registration submission via Server API (Server generates secret + 8 backup codes)
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    if (!regName.trim() || !regEmail.trim()) return;

    if (regPassword.length < 8) {
      setRegError('Hasło musi zawierać co najmniej 8 znaków.');
      return;
    }

    setIsRegistering(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: regName.trim(),
          email: regEmail.trim(),
          role: regRole,
          department: regDepartment.trim(),
          password: regPassword,
          twoFactorEnabled: regEnable2FA,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setRegError(data.error || 'Rejestracja nie powiodła się.');
        setIsRegistering(false);
        return;
      }

      if (onRefreshUsers) await onRefreshUsers();

      if (data.twoFactor) {
        setRegistered2FASecret(data.twoFactor.secret);
        setRegistered2FABackupCodes(data.twoFactor.backupCodes || []);
        // Lokalne generowanie kodu QR bez zewnętrznych serwisów
        const qr = await generateQrCodeDataUrl(data.twoFactor.otpAuthUrl);
        setRegisteredQrDataUrl(qr);
      } else {
        setRegistered2FASecret(null);
        setRegistered2FABackupCodes([]);
        setRegisteredQrDataUrl(null);
      }

      setRegSuccess(true);
      setRegName('');
      setRegEmail('');
      setRegPassword('');
    } catch {
      setRegError('Błąd połączenia z serwerem podczas rejestracji.');
    } finally {
      setIsRegistering(false);
    }
  };

  // Password Recovery Handlers (Secure SMTP via server)
  const handleRequestRecoveryEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError(null);
    const clean = recoveryEmail.trim().toLowerCase();
    if (!clean) {
      setRecoveryError('Wprowadź adres e-mail przypisany do konta pracowni.');
      return;
    }

    setIsRecoveryLoading(true);
    try {
      const res = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: clean }),
      });

      const data = await res.json();
      if (!res.ok) {
        setRecoveryError(data.error || 'Wystąpił błąd podczas żądania resetu hasła.');
        setIsRecoveryLoading(false);
        return;
      }

      // Odpowiedź jest identyczna dla każdego adresu
      setRecoveryInfoMsg(data.message);
      setEnteredRecoveryCode('');
      setRecoveryStep('code');
    } catch {
      setRecoveryError('Błąd połączenia z serwerem pocztowym.');
    } finally {
      setIsRecoveryLoading(false);
    }
  };

  const handleVerifyRecoveryCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError(null);
    const code = enteredRecoveryCode.replace(/\s+/g, '').trim();

    if (!code || code.length !== 6) {
      setRecoveryError('Wprowadź 6-cyfrowy kod otrzymany w wiadomości e-mail.');
      return;
    }

    setIsRecoveryLoading(true);
    try {
      const res = await fetch('/api/auth/password-reset/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: recoveryEmail.trim(),
          code,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setRecoveryError(data.error || 'Nieprawidłowy kod weryfikacyjny.');
        setIsRecoveryLoading(false);
        return;
      }

      setRecoveryVerifiedTicket(data.verifiedTicket);
      setRecoveryStep('new_password');
      setNewRecoveryPass('');
      setConfirmRecoveryPass('');
    } catch {
      setRecoveryError('Błąd połączenia z serwerem podczas weryfikacji kodu.');
    } finally {
      setIsRecoveryLoading(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError(null);

    if (newRecoveryPass.length < 8) {
      setRecoveryError('Nowe hasło musi zawierać co najmniej 8 znaków.');
      return;
    }
    if (newRecoveryPass !== confirmRecoveryPass) {
      setRecoveryError('Wprowadzone hasła nie są identyczne.');
      return;
    }

    setIsRecoveryLoading(true);
    try {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: recoveryEmail.trim(),
          verifiedTicket: recoveryVerifiedTicket,
          newPassword: newRecoveryPass,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setRecoveryError(data.error || 'Błąd podczas zmiany hasła.');
        setIsRecoveryLoading(false);
        return;
      }

      setRecoveryStep('success');
    } catch {
      setRecoveryError('Błąd połączenia z serwerem podczas zapisywania hasła.');
    } finally {
      setIsRecoveryLoading(false);
    }
  };

  // If system has no administrator / users: render the Initial Administrator Setup Wizard
  if (setupRequired) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 relative overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-amber-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-sky-600/20 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-lg bg-slate-800/95 backdrop-blur-md rounded-2xl border border-amber-500/40 shadow-2xl p-6 sm:p-8 relative z-10 space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-xs mb-1">
              <ShieldAlert className="w-9 h-9" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Kreator Konfiguracji Administratora
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed max-w-md mx-auto">
              Wykryto pierwsze uruchomienie systemu lub brak konta administratora. 
              Utwórz główne konto z uprawnieniami administracyjnymi, aby rozpocząć zarządzanie pracownią.
            </p>
            <div className="inline-block px-2.5 py-0.5 rounded-full bg-slate-700/60 text-slate-300 font-mono text-[10px] border border-slate-600">
              Wydanie {CURRENT_APP_VERSION}
            </div>
          </div>

          {adminSetupError && (
            <div className="p-3 rounded-lg bg-rose-950/70 border border-rose-800 text-rose-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{adminSetupError}</span>
            </div>
          )}

          <form onSubmit={handleAdminSetupSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Imię i Nazwisko Administratora <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="np. Marcin Frączek"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Adres e-mail <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="np. admin@pracownia.pl"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Dział / Rola w Pracowni
              </label>
              <div className="relative">
                <Briefcase className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={adminDepartment}
                  onChange={(e) => setAdminDepartment(e.target.value)}
                  placeholder="np. Główny Architekt & Zarząd Pracowni"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300">
                  Hasło Administratora (min. 12 znaków) <span className="text-rose-400">*</span>
                </label>
                <span className={`text-[11px] font-mono font-semibold ${adminPassword.length >= 12 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {adminPassword.length}/12 znaków
                </span>
              </div>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={12}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Wprowadź silne hasło (min. 12 znaków)..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Hasło zostanie zabezpieczone serwerowym algorytmem scrypt z unikalną solą kryptograficzną.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Powtórz hasło <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={12}
                  value={adminConfirmPassword}
                  onChange={(e) => setAdminConfirmPassword(e.target.value)}
                  placeholder="Powtórz hasło administratora..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                />
              </div>
            </div>

            {requireSetupToken && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Token instalacyjny (SETUP_TOKEN) <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={adminSetupToken}
                    onChange={(e) => setAdminSetupToken(e.target.value)}
                    placeholder="Wprowadź token z konfiguracji środowiska..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Wymagany token autoryzacyjny pierwszego administratora zdefiniowany w zmiennej środowiskowej SETUP_TOKEN.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={isAdminSubmitting || adminPassword.length < 12 || (requireSetupToken && !adminSetupToken.trim())}
              className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs transition-colors shadow-lg shadow-amber-600/30 flex items-center justify-center gap-2 mt-4"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{isAdminSubmitting ? 'Inicjalizacja...' : 'Utwórz konto Administratora i przejdź do systemu'}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

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

        {/* Tab switcher: Logowanie vs Rejestracja vs Odzyskiwanie hasła */}
        <div className={`grid ${allowSelfRegistration ? 'grid-cols-3' : 'grid-cols-2'} p-1 bg-slate-900/60 rounded-xl border border-slate-700/60 text-xs font-semibold gap-1`}>
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

          {allowSelfRegistration && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('register');
                setLoginError(null);
                setRegError(null);
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
          )}

          <button
            type="button"
            onClick={() => {
              setActiveTab('recovery');
              setRecoveryStep('email');
              setRecoveryError(null);
              setRecoveryInfoMsg(null);
              checkSmtpStatus();
            }}
            className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'recovery'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Reset hasła</span>
          </button>
        </div>

        {/* TAB 1: LOGOWANIE (2FA STEP - STRICT RFC 6238 OR BACKUP CODE) */}
        {activeTab === 'login' && authStep === '2fa' && (
          <form onSubmit={handleTotpSubmit} className="space-y-4 animate-in fade-in">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto mb-2">
                <Smartphone className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-white text-sm">Weryfikacja dwuskładnikowa (2FA)</h3>
              <p className="text-xs text-slate-400">
                Wprowadź 6-cyfrowy kod z Google Authenticator lub jeden z jednorazowych kodów zapasowych dla konta <strong>{pendingLoginEmail}</strong>.
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
                Kod z aplikacji Google Authenticator lub kod zapasowy
              </label>
              <input
                type="text"
                required
                maxLength={10}
                value={totpInput}
                onChange={(e) => setTotpInput(e.target.value.toUpperCase())}
                placeholder="000000 lub XXXX-XXXX"
                autoFocus
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-center text-lg tracking-[0.2em] font-mono font-bold text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-[10px] text-slate-400 text-center mt-1">
                Tolerancja czasowa ±30 sekund. Użyty kod nie może zostać wykorzystany ponownie.
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoggingIn || totpInput.trim().length < 6}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs transition-colors shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{isLoggingIn ? 'Weryfikacja...' : 'Zweryfikuj kod i zaloguj'}</span>
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
                <span>Adres e-mail <span className="text-rose-400">*</span></span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => {
                    setLoginEmail(e.target.value);
                    setLoginError(null);
                  }}
                  placeholder="np. admin@pracownia.pl"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                <span>Hasło dostępu</span>
                <span className="text-[10px] text-emerald-400 font-medium">Bezpieczne scrypt (Serwer)</span>
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Wpisz hasło..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('recovery');
                  setRecoveryStep('email');
                  setRecoveryError(null);
                  setRecoveryInfoMsg(null);
                  checkSmtpStatus();
                }}
                className="text-[11px] text-sky-400 hover:text-sky-300 hover:underline flex items-center gap-1"
              >
                <KeyRound className="w-3 h-3" />
                <span>Nie pamiętasz hasła? Odzyskaj przez e-mail</span>
              </button>
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs transition-colors shadow-lg shadow-sky-600/30 flex items-center justify-center gap-2"
            >
              <UserCheck className="w-4 h-4" />
              <span>{isLoggingIn ? 'Logowanie...' : 'Zaloguj do pracowni'}</span>
            </button>
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

                {registered2FASecret && (
                  <div className="p-3 bg-slate-900 border border-emerald-700/60 rounded-xl space-y-3 text-left">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
                      <QrCode className="w-4 h-4 shrink-0" />
                      <span>Konfiguracja Google Authenticator (wyświetlana tylko raz!):</span>
                    </div>
                    <p className="text-[11px] text-slate-300">
                      Zeskanuj poniższy kod QR aparatem w aplikacji Google Authenticator lub wpisz klucz konfiguracyjny:
                    </p>

                    {registeredQrDataUrl && (
                      <div className="flex justify-center p-2 bg-white rounded-lg w-fit mx-auto shadow-md">
                        <img
                          src={registeredQrDataUrl}
                          alt="Kod QR Google Authenticator"
                          className="w-36 h-36"
                        />
                      </div>
                    )}

                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold block">Klucz konfiguracyjny (Secret Key):</span>
                      <div className="flex items-center justify-between bg-slate-950 p-2 rounded border border-slate-800">
                        <span className="font-mono text-xs text-emerald-300 tracking-wider font-bold">
                          {formatSecretKey(registered2FASecret)}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await copyToClipboard(registered2FASecret);
                            setCopiedKey(true);
                            setTimeout(() => setCopiedKey(false), 2000);
                          }}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[10px] flex items-center gap-1"
                        >
                          {copiedKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedKey ? 'Skopiowano' : 'Kopiuj'}</span>
                        </button>
                      </div>
                    </div>

                    {registered2FABackupCodes.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-amber-300 uppercase font-semibold flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            <span>8 jednorazowych kodów zapasowych:</span>
                          </span>
                          <button
                            type="button"
                            onClick={async () => {
                              await copyToClipboard(registered2FABackupCodes.join('\n'));
                              setCopiedCodes(true);
                              setTimeout(() => setCopiedCodes(false), 2000);
                            }}
                            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-[10px] flex items-center gap-1"
                          >
                            {copiedCodes ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedCodes ? 'Skopiowano kody' : 'Kopiuj wszystkie'}</span>
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-2 rounded border border-slate-800 font-mono text-xs text-slate-200">
                          {registered2FABackupCodes.map((code, idx) => (
                            <div key={idx} className="p-1 bg-slate-900/80 rounded text-center border border-slate-800/80">
                              {code}
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-amber-400/90 leading-tight">
                          Zapisz te 8 kodów w bezpiecznym miejscu. Umożliwią one logowanie w przypadku utraty telefonu. Każdy kod działa tylko raz.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('login');
                    setRegSuccess(false);
                    setRegistered2FASecret(null);
                    setRegistered2FABackupCodes([]);
                    setRegisteredQrDataUrl(null);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-md"
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

                {regError && (
                  <div className="p-3 rounded-lg bg-rose-950/70 border border-rose-800 text-rose-200 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{regError}</span>
                  </div>
                )}

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
                  <label className="block text-xs font-medium text-slate-300 mb-1">Hasło dostępu (min. 8 znaków) *</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Utwórz bezpieczne hasło (min. 8 znaków)..."
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
                      Serwer wygeneruje klucz TOTP i 8 jednorazowych kodów zapasowych
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
                  disabled={isRegistering}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs transition-colors shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 mt-2"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{isRegistering ? 'Rejestrowanie...' : 'Zarejestruj konto do zatwierdzenia'}</span>
                </button>
              </form>
            )}
          </div>
        )}

        {/* TAB 3: ODZYSKIWANIE HASŁA ZA POMOCĄ E-MAIL (SMTP) */}
        {activeTab === 'recovery' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center mx-auto mb-2">
                <Mail className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-white text-sm">Odzyskiwanie hasła przez e-mail</h3>
              <p className="text-xs text-slate-400">
                Wprowadź adres e-mail przypisany do Twojego konta w pracowni, aby zresetować hasło dostępu.
              </p>
            </div>

            {/* Informacja jeśli funkcja SMTP nie jest skonfigurowana */}
            {isSmtpConfigured === false && (
              <div className="p-4 rounded-xl bg-amber-950/60 border border-amber-800 text-amber-200 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold text-amber-300">
                  <Info className="w-4 h-4 shrink-0" />
                  <span>Funkcja resetowania hasła przez e-mail jest wyłączona</span>
                </div>
                <p className="leading-relaxed text-[11px] text-amber-200/90">
                  W konfiguracji systemu nie zdefiniowano serwera pocztowego SMTP (zmienne <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code>).
                </p>
                <div className="p-2.5 bg-slate-900 rounded-lg border border-amber-900/60 text-slate-200 text-[11px] space-y-1">
                  <strong>Co możesz zrobić?</strong>
                  <p>Skontaktuj się z <strong>Administratorem pracowni</strong>. Administrator może natychmiast ustawić nowe hasło dla Twojego konta w panelu <em>Ustawienia &rarr; Użytkownicy</em>.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('login');
                    setRecoveryError(null);
                  }}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition-colors mt-2"
                >
                  Powrót do logowania
                </button>
              </div>
            )}

            {isSmtpConfigured && recoveryError && (
              <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{recoveryError}</span>
              </div>
            )}

            {/* Krok 1: Wpisanie adresu e-mail */}
            {isSmtpConfigured && recoveryStep === 'email' && (
              <form onSubmit={handleRequestRecoveryEmail} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Adres e-mail użytkownika <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={recoveryEmail}
                      onChange={(e) => {
                        setRecoveryEmail(e.target.value);
                        setRecoveryError(null);
                      }}
                      placeholder="np. fraczek.marcin@gmail.com"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isRecoveryLoading}
                  className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs transition-colors shadow-lg shadow-sky-600/30 flex items-center justify-center gap-2"
                >
                  <Mail className="w-4 h-4" />
                  <span>{isRecoveryLoading ? 'Wysyłanie...' : 'Wyślij kod weryfikacyjny'}</span>
                </button>
              </form>
            )}

            {/* Krok 2: Wprowadzenie 6-cyfrowego kodu otrzymanego na e-mail (ŻADEN KOD NIE JEST POKAZYWANY NA EKRANIE) */}
            {isSmtpConfigured && recoveryStep === 'code' && (
              <form onSubmit={handleVerifyRecoveryCode} className="space-y-4">
                <div className="p-3 bg-sky-950/60 border border-sky-800 rounded-lg text-xs text-sky-200 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-sky-300">
                    <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                    <span>Żądanie wysłane</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {recoveryInfoMsg || 'Jeśli podany adres e-mail istnieje w bazie pracowni, wysłano na niego 6-cyfrowy kod weryfikacyjny. Kod jest ważny przez 10 minut.'}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5 text-center">
                    Wprowadź 6-cyfrowy kod z wiadomości e-mail
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={enteredRecoveryCode}
                    onChange={(e) => {
                      setEnteredRecoveryCode(e.target.value.replace(/\D/g, ''));
                      setRecoveryError(null);
                    }}
                    placeholder="000000"
                    autoFocus
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-center text-lg tracking-[0.3em] font-mono font-bold text-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <p className="text-[10px] text-slate-400 text-center mt-1">
                    Maksymalnie 5 prób weryfikacji.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isRecoveryLoading || enteredRecoveryCode.length < 6}
                  className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs transition-colors shadow-lg shadow-sky-600/30 flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isRecoveryLoading ? 'Weryfikacja...' : 'Potwierdź kod weryfikacyjny'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setRecoveryStep('email')}
                  className="w-full py-1 text-slate-400 hover:text-white text-xs flex items-center justify-center gap-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Zmień adres e-mail</span>
                </button>
              </form>
            )}

            {/* Krok 3: Ustawienie nowego hasła */}
            {isSmtpConfigured && recoveryStep === 'new_password' && (
              <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
                <div className="p-3 bg-slate-900/80 border border-slate-700 rounded-lg text-xs text-slate-300">
                  Adres e-mail: <strong className="text-white">{recoveryEmail}</strong>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Nowe hasło dostępu <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={newRecoveryPass}
                      onChange={(e) => setNewRecoveryPass(e.target.value)}
                      placeholder="Wprowadź nowe hasło (min. 8 znaków)..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Powtórz nowe hasło <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={confirmRecoveryPass}
                      onChange={(e) => setConfirmRecoveryPass(e.target.value)}
                      placeholder="Powtórz nowe hasło..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isRecoveryLoading || newRecoveryPass.length < 8}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs transition-colors shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>{isRecoveryLoading ? 'Zapisywanie...' : 'Zapisz nowe hasło'}</span>
                </button>
              </form>
            )}

            {/* Krok 4: Sukces */}
            {isSmtpConfigured && recoveryStep === 'success' && (
              <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-sm text-emerald-300">
                  Hasło zostało pomyślnie zmienione!
                </h4>
                <p className="text-xs text-emerald-200/90 leading-relaxed">
                  Twoje nowe hasło zostało zabezpieczone algorytmem scrypt na serwerze. Możesz się teraz zalogować.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('login');
                    setAuthStep('credentials');
                    setPassword(newRecoveryPass);
                  }}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-xs"
                >
                  Przejdź do logowania
                </button>
              </div>
            )}

            {isSmtpConfigured && recoveryStep !== 'success' && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('login');
                  setAuthStep('credentials');
                  setRecoveryError(null);
                }}
                className="w-full py-1 text-slate-400 hover:text-white text-xs flex items-center justify-center gap-1 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Wróć do ekranu logowania</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
