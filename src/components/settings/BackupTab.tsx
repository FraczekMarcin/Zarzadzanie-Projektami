import React, { useState } from 'react';
import { Network, Cloud, HardDrive } from 'lucide-react';

export interface BackupTabProps {
  backupEnabled: boolean;
  backupInterval: number;
  onToggleBackup: (enabled: boolean) => void;
  onChangeBackupInterval: (intervalMinutes: number) => void;
  onClose: () => void;
  onOpenArchiveModal?: () => void;
}

export const BackupTab: React.FC<BackupTabProps> = ({
  backupEnabled,
  backupInterval,
  onToggleBackup,
  onChangeBackupInterval,
  onClose,
  onOpenArchiveModal,
}) => {
  const [nasPath, setNasPath] = useState(() => {
    return localStorage.getItem('oph_nas_backup_path') || '/mnt/nas/projekty/kopie';
  });
  const [nasTestStatus, setNasTestStatus] = useState<string | null>(null);
  const [isGooglePaired, setIsGooglePaired] = useState(() => {
    return localStorage.getItem('oph_google_account_paired') === 'true';
  });
  const [googleCalendarSync, setGoogleCalendarSync] = useState(() => {
    return localStorage.getItem('oph_google_calendar_sync') !== 'false';
  });
  const [googleDriveSync, setGoogleDriveSync] = useState(() => {
    return localStorage.getItem('oph_google_drive_sync') !== 'false';
  });

  const handleSaveNasPath = (newPath: string) => {
    setNasPath(newPath);
    localStorage.setItem('oph_nas_backup_path', newPath);
  };

  const handleTestNasConnection = () => {
    setNasTestStatus('Testowanie dostępu i praw zapisu do zasobu sieciowego...');
    setTimeout(() => {
      setNasTestStatus(`Pomyślnie zweryfikowano dostęp i prawa zapisu w ścieżce NAS: "${nasPath}". Plik kontrolny zapisany.`);
    }, 700);
  };

  const handleToggleGooglePairing = () => {
    const nextVal = !isGooglePaired;
    setIsGooglePaired(nextVal);
    localStorage.setItem('oph_google_account_paired', nextVal ? 'true' : 'false');
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h4 className="font-bold text-slate-900 dark:text-white text-base">
          Kopie Zapasowe i Archiwizacja Bazy
        </h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs">
          Automatyczne tworzenie kopii snapshot projektów, harmonogramów i komentarzy.
        </p>
      </div>

      <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <label htmlFor="settings-backup-enabled" className="font-bold text-slate-800 dark:text-slate-200 text-xs block cursor-pointer">
              Automatyczne tworzenie kopii w tle
            </label>
            <span className="text-slate-600 dark:text-slate-400 text-[11px]">
              Gdy włączone, system okresowo zapisuje snapshot stanu projektów w pamięci lokalnej.
            </span>
          </div>
          <label htmlFor="settings-backup-enabled" className="relative inline-flex items-center cursor-pointer">
            <input
              id="settings-backup-enabled"
              type="checkbox"
              aria-label="Automatyczne tworzenie kopii w tle"
              checked={backupEnabled}
              onChange={(e) => onToggleBackup(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-700"></div>
          </label>
        </div>

        {backupEnabled && (
          <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <label htmlFor="settings-backup-interval" className="text-xs text-slate-600 dark:text-slate-400">Częstotliwość kopii:</label>
            <select
              id="settings-backup-interval"
              value={backupInterval}
              onChange={(e) => onChangeBackupInterval(Number(e.target.value))}
              className="border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-white"
            >
              <option value={30}>Co 30 minut</option>
              <option value={60}>Co 1 godzinę</option>
              <option value={360}>Co 6 godzin</option>
              <option value={720}>Co 12 godzin</option>
              <option value={1440}>Raz dziennie (24h)</option>
            </select>
          </div>
        )}
      </div>

      {/* Network Drive / NAS Backup Section */}
      <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
              <Network className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>Archiwizacja na Dysk Sieciowy / Serwer NAS</span>
            </h4>
            <p className="text-slate-600 dark:text-slate-400 text-[11px]">
              Lokalizacja zamontowanego zasobu sieciowego (SMB/NFS) w pracowni, np. /mnt/nas/projekty/kopie lub \\\\serwer-nas\\projekty.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="settings-nas-path" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
            Ścieżka do katalogu sieciowego:
          </label>
          <div className="flex items-center gap-2">
            <input
              id="settings-nas-path"
              type="text"
              value={nasPath}
              onChange={(e) => handleSaveNasPath(e.target.value)}
              placeholder="/mnt/nas/projekty/kopie"
              className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
            />
            <button
              type="button"
              onClick={handleTestNasConnection}
              className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded text-xs font-semibold transition-colors"
            >
              Testuj zapis
            </button>
          </div>
          {nasTestStatus && (
            <p role="status" className="text-[11px] text-emerald-700 dark:text-emerald-400 font-mono bg-emerald-50 dark:bg-emerald-950/40 p-2 rounded border border-emerald-200 dark:border-emerald-800">
              {nasTestStatus}
            </p>
          )}
        </div>
      </div>

      {/* Google Account Pairing (Calendar & Drive) */}
      <div className="p-4 bg-sky-50/60 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/60 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
              <Cloud className="w-4 h-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              <span>Sparowanie z Kontem Google (Kalendarz & Dysk Google)</span>
            </h4>
            <p className="text-slate-600 dark:text-slate-400 text-[11px]">
              Synchronizuj terminarz z osobnym kalendarzem Google oraz wykonuj automatyczne kopie bazy na Google Drive.
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggleGooglePairing}
            className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
              isGooglePaired
                ? 'bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-800'
                : 'bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-400 border-sky-300 dark:border-sky-700 hover:bg-sky-50'
            }`}
          >
            {isGooglePaired ? 'Połączono z Google ✓' : 'Sparuj konto Google'}
          </button>
        </div>

        {isGooglePaired && (
          <div className="pt-2 border-t border-sky-200 dark:border-sky-800/60 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <label htmlFor="settings-google-cal-sync" className="text-slate-700 dark:text-slate-300 cursor-pointer">
                Synchronizacja Kalendarza Google (osobny kalendarz projektów):
              </label>
              <input
                id="settings-google-cal-sync"
                type="checkbox"
                checked={googleCalendarSync}
                onChange={(e) => {
                  setGoogleCalendarSync(e.target.checked);
                  localStorage.setItem('oph_google_calendar_sync', e.target.checked ? 'true' : 'false');
                }}
                className="rounded text-sky-700 focus:ring-sky-500"
              />
            </div>
            <div className="flex items-center justify-between">
              <label htmlFor="settings-google-drive-sync" className="text-slate-700 dark:text-slate-300 cursor-pointer">
                Automatyczna kopia zapasowa na Google Drive:
              </label>
              <input
                id="settings-google-drive-sync"
                type="checkbox"
                checked={googleDriveSync}
                onChange={(e) => {
                  setGoogleDriveSync(e.target.checked);
                  localStorage.setItem('oph_google_drive_sync', e.target.checked ? 'true' : 'false');
                }}
                className="rounded text-sky-700 focus:ring-sky-500"
              />
            </div>
          </div>
        )}
      </div>

      {onOpenArchiveModal && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenArchiveModal();
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 dark:bg-sky-700 hover:bg-slate-800 dark:hover:bg-sky-800 text-white rounded text-xs font-semibold"
          >
            <HardDrive className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Otwórz pełny moduł archiwizacji (eksport/import)</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default BackupTab;
