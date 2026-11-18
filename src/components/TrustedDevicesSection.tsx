import React, { useEffect, useState } from 'react';
import { Laptop, Trash2, RefreshCw } from 'lucide-react';
import type { PublicTrustedDevice } from '../utils/trustedDevices';

export interface TrustedDevicesSectionProps {
  isOpen: boolean;
  targetUserId?: string;
  targetUserName?: string;
}

export const TrustedDevicesSection: React.FC<TrustedDevicesSectionProps> = ({
  isOpen,
  targetUserId,
  targetUserName,
}) => {
  const [devices, setDevices] = useState<PublicTrustedDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRevokingAll, setIsRevokingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isAdminTarget = Boolean(targetUserId);
  const baseUrl = isAdminTarget
    ? `/api/users/${encodeURIComponent(targetUserId!)}/devices`
    : '/api/auth/devices';

  const loadDevices = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(baseUrl, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Nie udało się pobrać listy zaufanych urządzeń.');
        return;
      }
      setDevices(Array.isArray(data.devices) ? data.devices : []);
    } catch (err: any) {
      setError(err?.message || 'Błąd połączenia z serwerem.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadDevices();
    }
  }, [isOpen, targetUserId]);

  const handleRevokeOne = async (deviceId: string) => {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${baseUrl}/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Nie udało się usunąć zaufania dla urządzenia.');
        return;
      }
      setSuccess('Usunięto zaufanie dla wybranego urządzenia.');
      await loadDevices();
    } catch (err: any) {
      setError(err?.message || 'Błąd połączenia z serwerem.');
    }
  };

  const handleRevokeAll = async () => {
    const confirmMsg = isAdminTarget
      ? `Czy na pewno chcesz usunąć wszystkie zaufane urządzenia użytkownika ${targetUserName || targetUserId}?`
      : 'Czy na pewno chcesz usunąć wszystkie zaufane urządzenia dla swojego konta? Przy kolejnym otwarciu aplikacji będzie wymagane hasło.';
    if (!window.confirm(confirmMsg)) return;

    setIsRevokingAll(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(baseUrl, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Nie udało się usunąć zaufanych urządzeń.');
        return;
      }
      setSuccess('Usunięto wszystkie zaufane urządzenia.');
      await loadDevices();
    } catch (err: any) {
      setError(err?.message || 'Błąd połączenia z serwerem.');
    } finally {
      setIsRevokingAll(false);
    }
  };

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Laptop className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">
              {isAdminTarget
                ? `Zaufane urządzenia — ${targetUserName || targetUserId} (${devices.length})`
                : `Zaufane urządzenia (${devices.length})`}
            </span>
            {isLoading && (
              <span className="text-[11px] text-slate-600 dark:text-slate-400 animate-pulse">
                Ładowanie...
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            Przeglądarki zapamiętane opcją „Ufaj temu urządzeniu”, które automatycznie odnawiają sesję bez ponownego wpisywania hasła.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadDevices}
            disabled={isLoading}
            className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Odśwież</span>
          </button>

          {devices.length > 0 && (
            <button
              type="button"
              onClick={handleRevokeAll}
              disabled={isRevokingAll}
              className="px-3 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded hover:bg-rose-100 dark:hover:bg-rose-900 transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isRevokingAll ? 'Usuwanie...' : 'Usuń wszystkie'}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs">
          {error}
        </div>
      )}

      {success && (
        <div role="status" className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs">
          {success}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100/70 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th scope="col" className="py-2.5 px-3 font-semibold">Urządzenie</th>
              <th scope="col" className="py-2.5 px-3 font-semibold">Ostatnie użycie</th>
              <th scope="col" className="py-2.5 px-3 font-semibold">Adres IP</th>
              <th scope="col" className="py-2.5 px-3 font-semibold">Wygasa</th>
              <th scope="col" className="py-2.5 px-3 font-semibold text-right">Akcja</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
            {devices.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-600 dark:text-slate-400">
                  {isLoading
                    ? 'Ładowanie zaufanych urządzeń...'
                    : 'Brak zaufanych urządzeń powiązanych z tym kontem.'}
                </td>
              </tr>
            ) : (
              devices.map((device) => (
                <tr key={device.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {device.label}
                      </span>
                      {device.current && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-800">
                          To urządzenie
                        </span>
                      )}
                    </div>
                    {device.userAgent && (
                      <div
                        className="text-[10px] text-slate-600 dark:text-slate-400 font-mono truncate max-w-xs"
                        title={device.userAgent}
                      >
                        {device.userAgent}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[11px] whitespace-nowrap">
                    {new Date(device.lastUsedAt).toLocaleString('pl-PL')}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300 text-[11px]">
                    {device.ip || '—'}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[11px] whitespace-nowrap">
                    {new Date(device.expiresAt).toLocaleString('pl-PL')}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleRevokeOne(device.id)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded border border-rose-200 dark:border-rose-900 transition-colors"
                      title="Usuń zaufanie dla tego urządzenia"
                    >
                      Usuń zaufanie
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TrustedDevicesSection;
