import React, { useState } from 'react';
import { User } from '../types';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  QrCode,
  Copy,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Lock,
  ArrowRight,
} from 'lucide-react';
import { generateQrCodeDataUrl, formatSecretKey } from '../utils/authSecurity';
import { copyToClipboard } from '../utils/clipboard';

interface TwoFactorManagerProps {
  currentUser: User | null;
  onUserUpdated?: (updated: Partial<User>) => void;
}

export const TwoFactorManager: React.FC<TwoFactorManagerProps> = ({
  currentUser,
  onUserUpdated,
}) => {
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Setup form states
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [currentTotpCode, setCurrentTotpCode] = useState(''); // required if already enabled
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isSubmittingSetup, setIsSubmittingSetup] = useState(false);

  // Step 2 data
  const [generatedSecret, setGeneratedSecret] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [testCodeInput, setTestCodeInput] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [hasCopiedSecret, setHasCopiedSecret] = useState(false);
  const [hasCopiedBackupCodes, setHasCopiedBackupCodes] = useState(false);

  // Disable form states
  const [isDisableOpen, setIsDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);
  const [isSubmittingDisable, setIsSubmittingDisable] = useState(false);

  if (!currentUser) return null;

  const is2FAEnabled = Boolean(currentUser.twoFactorEnabled);

  // Start Setup Flow -> Step 1 (or reset)
  const handleStartSetup = () => {
    setIsSetupOpen(true);
    setIsDisableOpen(false);
    setStep(1);
    setPasswordInput('');
    setCurrentTotpCode('');
    setSetupError(null);
    setTestCodeInput('');
  };

  // Submit Step 1: verifies password and generates secret + 10 backup codes
  const handleSubmitStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError(null);

    if (!passwordInput) {
      setSetupError('Wprowadź swoje aktualne hasło.');
      return;
    }
    if (is2FAEnabled && !currentTotpCode) {
      setSetupError('Wprowadź aktualny 6-cyfrowy kod z Google Authenticator lub kod zapasowy.');
      return;
    }

    setIsSubmittingSetup(true);
    try {
      const res = await fetch(`/api/users/${currentUser.id}/2fa/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          currentPassword: passwordInput,
          code: is2FAEnabled ? currentTotpCode.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSetupError(data.error || 'Błąd inicjalizacji konfiguracji 2FA.');
        setIsSubmittingSetup(false);
        return;
      }

      setGeneratedSecret(data.secret);
      setBackupCodes(data.backupCodes || []);

      // Generowanie kodu QR lokalnie (zero połączeń zewnętrznych)
      const qrUrl = await generateQrCodeDataUrl(data.otpAuthUrl);
      setQrCodeDataUrl(qrUrl);

      setStep(2);
    } catch {
      setSetupError('Błąd połączenia z serwerem.');
    } finally {
      setIsSubmittingSetup(false);
    }
  };

  // Submit Step 2: verifies 6-digit test code from app and enables 2FA
  const handleSubmitStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError(null);

    const cleanCode = testCodeInput.replace(/[\s-]/g, '').trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setSetupError('Wprowadź poprawny 6-cyfrowy kod weryfikacyjny wygenerowany przez aplikację.');
      return;
    }

    setIsSubmittingSetup(true);
    try {
      const res = await fetch(`/api/users/${currentUser.id}/2fa/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          code: cleanCode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSetupError(data.error || 'Nieprawidłowy kod weryfikacyjny.');
        setIsSubmittingSetup(false);
        return;
      }

      if (onUserUpdated) {
        onUserUpdated({ twoFactorEnabled: true, backupCodesCount: data.backupCodesCount || 10 });
      }

      setStep(3);
    } catch {
      setSetupError('Błąd połączenia z serwerem podczas potwierdzania 2FA.');
    } finally {
      setIsSubmittingSetup(false);
    }
  };

  // Close wizard after step 3
  const handleFinishWizard = () => {
    setIsSetupOpen(false);
    setStep(1);
    setPasswordInput('');
    setTestCodeInput('');
    setGeneratedSecret('');
    setBackupCodes([]);
  };

  // Copy Secret Key
  const handleCopySecret = async () => {
    if (!generatedSecret) return;
    const ok = await copyToClipboard(generatedSecret);
    if (ok) {
      setHasCopiedSecret(true);
      setTimeout(() => setHasCopiedSecret(false), 2500);
    }
  };

  // Copy All 10 Backup Codes
  const handleCopyBackupCodes = async () => {
    if (!backupCodes || backupCodes.length === 0) return;
    const text = backupCodes.join('\n');
    const ok = await copyToClipboard(text);
    if (ok) {
      setHasCopiedBackupCodes(true);
      setTimeout(() => setHasCopiedBackupCodes(false), 2500);
    }
  };

  // Submit Disable 2FA
  const handleSubmitDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableError(null);

    if (!disablePassword) {
      setDisableError('Wprowadź swoje hasło do konta.');
      return;
    }
    if (!disableCode) {
      setDisableError('Wprowadź 6-cyfrowy kod z Google Authenticator lub jednorazowy kod zapasowy.');
      return;
    }

    setIsSubmittingDisable(true);
    try {
      const res = await fetch(`/api/users/${currentUser.id}/2fa/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          currentPassword: disablePassword,
          code: disableCode.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setDisableError(data.error || 'Błąd podczas wyłączania 2FA.');
        setIsSubmittingDisable(false);
        return;
      }

      if (onUserUpdated) {
        onUserUpdated({ twoFactorEnabled: false, backupCodesCount: 0 });
      }

      setIsDisableOpen(false);
      setDisablePassword('');
      setDisableCode('');
    } catch {
      setDisableError('Błąd połączenia z serwerem.');
    } finally {
      setIsSubmittingDisable(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
      {/* Header & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              is2FAEnabled
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {is2FAEnabled ? <ShieldCheck className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                Weryfikacja dwuskładnikowa (2FA / Google Authenticator)
              </h4>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  is2FAEnabled
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                }`}
              >
                {is2FAEnabled ? 'Aktywna' : 'Nieaktywna'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Chroni Twoje konto projektowe przed nieautoryzowanym dostępem przy użyciu aplikacji na telefonie (RFC 6238).
            </p>
          </div>
        </div>

        {/* Action button */}
        {!isSetupOpen && !isDisableOpen && (
          <div className="flex items-center gap-2 shrink-0">
            {is2FAEnabled ? (
              <button
                type="button"
                onClick={() => {
                  setIsDisableOpen(true);
                  setDisableError(null);
                }}
                className="px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold transition-colors flex items-center gap-1.5"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Wyłącz 2FA</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartSetup}
                className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Włącz 2FA</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 3-STEP SETUP WIZARD */}
      {isSetupOpen && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-sky-300 dark:border-sky-800/80 rounded-xl space-y-4 animate-in fade-in">
          {/* Step Progress Indicators */}
          <div className="flex items-center justify-between text-xs pb-3 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 font-semibold">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${
                  step === 1 ? 'bg-sky-600 text-white' : 'bg-emerald-600 text-white'
                }`}
              >
                {step > 1 ? <Check className="w-3 h-3" /> : '1'}
              </span>
              <span className={step === 1 ? 'text-sky-700 dark:text-sky-300 font-bold' : 'text-slate-500'}>
                Weryfikacja tożsamości
              </span>
              <ArrowRight className="w-3 h-3 text-slate-400" />

              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${
                  step === 2
                    ? 'bg-sky-600 text-white'
                    : step > 2
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {step > 2 ? <Check className="w-3 h-3" /> : '2'}
              </span>
              <span className={step === 2 ? 'text-sky-700 dark:text-sky-300 font-bold' : 'text-slate-500'}>
                Zeskanuj kod QR
              </span>
              <ArrowRight className="w-3 h-3 text-slate-400" />

              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${
                  step === 3
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                3
              </span>
              <span className={step === 3 ? 'text-sky-700 dark:text-sky-300 font-bold' : 'text-slate-500'}>
                10 kodów zapasowych
              </span>
            </div>

            {step !== 3 && (
              <button
                type="button"
                onClick={() => setIsSetupOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
              >
                Anuluj
              </button>
            )}
          </div>

          {/* STEP 1: Enter current password */}
          {step === 1 && (
            <form onSubmit={handleSubmitStep1} className="space-y-4 max-w-md">
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Aby skonfigurować aplikację uwierzytelniającą, potwierdź swoją tożsamość wprowadzając aktualne hasło do konta.
              </p>

              {setupError && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{setupError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Aktualne hasło do konta:
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    required
                    placeholder="Wpisz swoje hasło"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white pr-9 focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {is2FAEnabled && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Aktualny kod 2FA z aplikacji lub kod zapasowy (rekonfiguracja):
                  </label>
                  <input
                    type="text"
                    value={currentTotpCode}
                    onChange={(e) => setCurrentTotpCode(e.target.value)}
                    placeholder="6 cyfr lub XXXXX-XXXXX"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={isSubmittingSetup || !passwordInput}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center gap-2"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{isSubmittingSetup ? 'Weryfikacja...' : 'Dalej: Wygeneruj kod QR'}</span>
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: Show QR Code & Test Code */}
          {step === 2 && (
            <form onSubmit={handleSubmitStep2} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
                {/* Left: QR Code generated locally */}
                <div className="flex flex-col items-center bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                  <div className="flex items-center gap-2 mb-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                    <QrCode className="w-4 h-4 text-sky-600" />
                    <span>Zeskanuj w aplikacji</span>
                  </div>
                  {qrCodeDataUrl ? (
                    <img
                      src={qrCodeDataUrl}
                      alt="Kod QR do Google Authenticator"
                      className="w-44 h-44 border border-slate-200 rounded-lg shadow-xs p-1 bg-white"
                    />
                  ) : (
                    <div className="w-44 h-44 bg-slate-100 flex items-center justify-center rounded-lg text-slate-400 text-xs">
                      Generowanie kodu...
                    </div>
                  )}
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                    Użyj Google Authenticator, Microsoft Authenticator, 1Password lub innej zgodnej aplikacji.
                  </p>
                </div>

                {/* Right: Manual Secret Key & Verification Code */}
                <div className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Klucz konfiguracyjny (wpisanie ręczne):
                    </label>
                    <div className="flex gap-1.5 items-center">
                      <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs font-mono tracking-wider font-semibold text-sky-900 dark:text-sky-300 break-all select-all">
                        {formatSecretKey(generatedSecret)}
                      </div>
                      <button
                        type="button"
                        onClick={handleCopySecret}
                        className="p-2 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 transition-colors"
                        title="Kopiuj klucz"
                      >
                        {hasCopiedSecret ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    {hasCopiedSecret && (
                      <span className="text-[10px] text-emerald-600 font-semibold mt-0.5 block">
                        Skopiowano klucz do schowka!
                      </span>
                    )}
                  </div>

                  {setupError && (
                    <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{setupError}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                      Wprowadź 6-cyfrowy kod z aplikacji, aby aktywować:
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      autoFocus
                      value={testCodeInput}
                      onChange={(e) => setTestCodeInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-center text-lg font-mono font-bold tracking-widest text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={isSubmittingSetup || testCodeInput.length !== 6}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center justify-center gap-2"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>{isSubmittingSetup ? 'Sprawdzanie kodu...' : 'Zatwierdź i włącz 2FA'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* STEP 3: Display 10 Backup Codes */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl flex items-center gap-3">
                <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" />
                <div>
                  <h5 className="font-bold text-xs text-emerald-900 dark:text-emerald-200">
                    Uwierzytelnianie dwuskładnikowe 2FA zostało pomyślnie włączone!
                  </h5>
                  <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                    Pozostałe aktywne sesje tego konta zostały wylogowane dla bezpieczeństwa.
                  </p>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-bold text-xs">
                  <KeyRound className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Twoje 10 jednorazowych kodów zapasowych:</span>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Zapisz poniższe kody w bezpiecznym miejscu (np. w menedżerze haseł). Kody te nie zostaną ponownie wyświetlone!
                  Pozwolą zalogować się w przypadku zgubienia lub rozładowania telefonu.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
                  {backupCodes.map((c, i) => (
                    <div
                      key={i}
                      className="p-2 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-md font-mono text-center text-xs font-bold text-slate-800 dark:text-slate-200 select-all"
                    >
                      {c}
                    </div>
                  ))}
                </div>

                <div className="pt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyBackupCodes}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
                  >
                    {hasCopiedBackupCodes ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{hasCopiedBackupCodes ? 'Skopiowano wszystkie kody!' : 'Kopiuj wszystkie 10 kodów'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleFinishWizard}
                    className="px-4 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white rounded-lg text-xs font-bold transition-colors shadow-xs"
                  >
                    Zakończ i zamknij
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* DISABLE MODAL / INLINE FORM */}
      {isDisableOpen && (
        <form
          onSubmit={handleSubmitDisable}
          className="p-4 bg-rose-50/60 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-900 rounded-xl space-y-3 animate-in fade-in max-w-lg"
        >
          <div className="flex items-center gap-2 text-rose-800 dark:text-rose-200 font-bold text-xs">
            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Potwierdzenie wyłączenia uwierzytelniania 2FA</span>
          </div>
          <p className="text-xs text-rose-700 dark:text-rose-300">
            Wyłączenie 2FA wymaga podania Twojego hasła oraz aktualnego kodu z aplikacji Google Authenticator (lub kodu zapasowego).
          </p>

          {disableError && (
            <div className="p-2.5 rounded-lg bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{disableError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Hasło do Twojego konta:
            </label>
            <input
              type="password"
              required
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="Wprowadź hasło"
              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              6-cyfrowy kod z Google Authenticator lub kod zapasowy:
            </label>
            <input
              type="text"
              required
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              placeholder="6 cyfr lub XXXXX-XXXXX"
              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={isSubmittingDisable || !disablePassword || !disableCode}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>{isSubmittingDisable ? 'Wyłączanie...' : 'Wyłącz 2FA'}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsDisableOpen(false)}
              className="px-3 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 text-xs font-semibold rounded-lg transition-colors"
            >
              Anuluj
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
