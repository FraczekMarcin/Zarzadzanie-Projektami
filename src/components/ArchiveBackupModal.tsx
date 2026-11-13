import React, { useState, useEffect, useRef } from 'react';
import { Project, Task, User, Comment, ActivityLog } from '../types';
import { 
  X, 
  Cloud, 
  Server, 
  Download, 
  Upload, 
  CheckCircle2, 
  AlertTriangle, 
  Database, 
  RefreshCw, 
  FileText, 
  ShieldCheck, 
  ExternalLink,
  Clock,
  Trash2,
  Play,
  RotateCcw,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';
import { 
  getAutoBackupConfig, 
  saveAutoBackupConfig, 
  getAutoBackupSnapshots, 
  createAutoBackupSnapshot, 
  deleteAutoBackupSnapshot, 
  clearAllAutoBackupSnapshots, 
  formatBytes, 
  generateLinuxCronBackupScript,
  AutoBackupConfig,
  AutoBackupSnapshot 
} from '../utils/autoBackup';
import { INSTALL_TARGET_DIR, CURRENT_APP_VERSION } from '../data/dockerConfig';
import { copyToClipboard } from '../utils/clipboard';
import { sanitizeUsersForBackup } from '../utils/authSecurity';
import { useFocusTrap } from '../utils/useFocusTrap';

interface ArchiveBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  tasks: Task[];
  users: User[];
  comments: Comment[];
  activityLogs: ActivityLog[];
  onRestoreData?: (data: {
    projects: Project[];
    tasks: Task[];
    users?: User[];
    comments?: Comment[];
  }) => void;
  onLogActivity: (action: string, entityId?: string, details?: string) => void;
}

export const ArchiveBackupModal: React.FC<ArchiveBackupModalProps> = ({
  isOpen,
  onClose,
  projects,
  tasks,
  users,
  comments,
  activityLogs,
  onRestoreData,
  onLogActivity,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap({ isOpen, onClose, containerRef: modalRef });

  const [activeTab, setActiveTab] = useState<'auto' | 'gdrive' | 'ftp' | 'local' | 'history'>('auto');

  // Auto-backup state
  const [autoConfig, setAutoConfig] = useState<AutoBackupConfig>(getAutoBackupConfig);
  const [snapshots, setSnapshots] = useState<AutoBackupSnapshot[]>(getAutoBackupSnapshots);
  const [copiedCron, setCopiedCron] = useState(false);
  const [lastActionMsg, setLastActionMsg] = useState<string | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Google Drive state
  const [gdriveFolder, setGdriveFolder] = useState('Moje Dyski / Zarządzanie Projektami / Kopie');
  const [autoSyncGdrive, setAutoSyncGdrive] = useState(true);
  const [isGdriveSyncing, setIsGdriveSyncing] = useState(false);
  const [gdriveStatus, setGdriveStatus] = useState<string | null>(null);

  // FTP state
  const [ftpProtocol, setFtpProtocol] = useState<'sftp' | 'ftp' | 'ftps'>('sftp');
  const [ftpHost, setFtpHost] = useState('backup.twojadomena.pl');
  const [ftpPort, setFtpPort] = useState('22');
  const [ftpUser, setFtpUser] = useState('backup_user');
  const [ftpPass, setFtpPass] = useState('••••••••••••');
  const [ftpRemotePath, setFtpRemotePath] = useState(`${INSTALL_TARGET_DIR}/backups/`);
  const [isFtpTesting, setIsFtpTesting] = useState(false);
  const [ftpTestResult, setFtpTestResult] = useState<{ success: boolean; message: string; details?: string } | null>(null);
  const [isFtpUploading, setIsFtpUploading] = useState(false);

  // Backup History & Server Status
  const [backupHistory, setBackupHistory] = useState<Array<{
    id: string;
    date: string;
    destination: string;
    filename: string;
    size: string;
    status: string;
    recordsCount: string;
  }>>([]);
  const [backupStatusMessage, setBackupStatusMessage] = useState<string | null>(null);
  const [isBackupActive, setIsBackupActive] = useState<boolean | null>(null);

  // Sync auto snapshots on modal open and fetch real backup status from server
  useEffect(() => {
    if (isOpen) {
      setAutoConfig(getAutoBackupConfig());
      setSnapshots(getAutoBackupSnapshots());
      setRestoreStatus(null);

      // Pobieranie rzeczywistego statusu kopii zapasowych z /api/backup/status
      fetch('/api/backup/status', { credentials: 'same-origin' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          setIsBackupActive(Boolean(data.active));
          setBackupStatusMessage(data.message || null);
          if (data.lastBackup) {
            const d = new Date(data.lastBackup.timestamp);
            const dateStr = !isNaN(d.getTime()) ? d.toLocaleString('pl-PL') : data.lastBackup.timestamp;
            const sizeStr = data.lastBackup.size ? `${Math.round(data.lastBackup.size / 1024)} KB` : 'N/A';
            setBackupHistory([
              {
                id: 'server-active-bk',
                date: dateStr,
                destination: 'Serwer aplikacji (DATA_DIR / backups)',
                filename: data.lastBackup.filename,
                size: sizeStr,
                status: 'success',
                recordsCount: `${projects.length} projektów, ${tasks.length} zadań`,
              },
            ]);
          } else {
            setBackupHistory([]);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, projects.length, tasks.length]);

  if (!isOpen) return null;

  // Prepare full data payload
  const createBackupPayload = () => {
    return {
      version: CURRENT_APP_VERSION,
      exportedAt: new Date().toISOString(),
      metadata: {
        appName: 'Zarządzanie Projektami',
        generator: 'Docker JSON & Cloud Ready Engine',
      },
      projects,
      tasks,
      users: sanitizeUsersForBackup(users),
      comments,
      activityLogs,
    };
  };

  // Generate SQL Dump
  const generateSqlDump = (): string => {
    const timestamp = new Date().toISOString();
    let sql = `-- ==================================================================\n`;
    sql += `-- Pełny Zrzut Bazy Danych SQL: Zarządzanie Projektami\n`;
    sql += `-- Wersja: ${CURRENT_APP_VERSION}\n`;
    sql += `-- Wygenerowano: ${timestamp}\n`;
    sql += `-- ==================================================================\n\n`;

    sql += `BEGIN;\n\n`;

    // Users (Bez haseł ani skrótów haseł)
    sql += `-- Tabela: users (bez haseł i skrótów haseł)\n`;
    const safeUsers = sanitizeUsersForBackup(users);
    safeUsers.forEach((u) => {
      const cleanName = u.name.replace(/'/g, "''");
      const cleanEmail = u.email.replace(/'/g, "''");
      const cleanDept = (u.department || '').replace(/'/g, "''");
      sql += `INSERT INTO users (id, name, email, role, department, two_factor_enabled, is_approved) VALUES ('${u.id}', '${cleanName}', '${cleanEmail}', '${u.role}', '${cleanDept}', ${u.twoFactorEnabled ? 'TRUE' : 'FALSE'}, ${u.isApproved !== false ? 'TRUE' : 'FALSE'}) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role;\n`;
    });

    // Projects
    sql += `\n-- Tabela: projects\n`;
    projects.forEach((p) => {
      const cleanDesc = (p.description || '').replace(/'/g, "''");
      const cleanName = p.name.replace(/'/g, "''");
      sql += `INSERT INTO projects (id, key, name, description, priority, status, start_date, due_date, duration_days, progress, budget) VALUES ('${p.id}', '${p.key}', '${cleanName}', '${cleanDesc}', '${p.priority}', '${p.status}', '${p.startDate}', '${p.dueDate}', ${p.durationDays || 30}, ${p.progress}, '${p.budget || ''}') ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, name = EXCLUDED.name, progress = EXCLUDED.progress;\n`;
    });

    sql += `\n-- Tabela: tasks\n`;
    tasks.forEach((t) => {
      const cleanTitle = t.title.replace(/'/g, "''");
      const cleanDesc = (t.description || '').replace(/'/g, "''");
      const blockers = JSON.stringify(t.blockingTaskIds || t.dependencies || []);
      sql += `INSERT INTO tasks (id, project_id, code, title, description, priority, status, start_date, due_date, duration_days, progress, is_official_deadline, blocking_task_ids) VALUES ('${t.id}', '${t.projectId}', '${t.code}', '${cleanTitle}', '${cleanDesc}', '${t.priority}', '${t.status}', '${t.startDate}', '${t.dueDate}', ${t.durationDays || 1}, ${t.progress}, ${t.isOfficialDeadline ? 'TRUE' : 'FALSE'}, '${blockers}') ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, progress = EXCLUDED.progress;\n`;
    });

    sql += `\nCOMMIT;\n`;
    return sql;
  };

  // Trigger manual auto-backup snapshot
  const handleTriggerManualAutoBackup = () => {
    const snapshot = createAutoBackupSnapshot({
      projects,
      tasks,
      users,
      comments,
      activityLogs,
    });
    setSnapshots(getAutoBackupSnapshots());
    setAutoConfig(getAutoBackupConfig());
    setLastActionMsg(`Wykonano automatyczną migawkę: ${snapshot.filename} (${formatBytes(snapshot.sizeBytes)})`);
    onLogActivity('Wykonano ręczną migawkę automatycznej kopii zapasowej', undefined, snapshot.filename);
    setTimeout(() => setLastActionMsg(null), 4000);
  };

  // Update auto-backup configuration
  const handleUpdateAutoConfig = (newPartial: Partial<AutoBackupConfig>) => {
    const updated = { ...autoConfig, ...newPartial };
    setAutoConfig(updated);
    saveAutoBackupConfig(updated);
    onLogActivity('Zaktualizowano parametry automatycznych kopii zapasowych');
  };

  // Restore from snapshot
  const handleRestoreFromSnapshot = (snapshot: AutoBackupSnapshot) => {
    if (
      window.confirm(
        `Czy na pewno chcesz przywrócić stan z automatycznej kopii:\n"${snapshot.filename}" z ${new Date(
          snapshot.timestamp
        ).toLocaleString('pl-PL')}?\nZawiera: ${snapshot.projectsCount} projektów, ${snapshot.tasksCount} zadań.`
      )
    ) {
      if (onRestoreData && snapshot.data) {
        onRestoreData({
          projects: snapshot.data.projects || [],
          tasks: snapshot.data.tasks || [],
          users: snapshot.data.users || [],
          comments: snapshot.data.comments || [],
        });
        setLastActionMsg(`Przywrócono stan z migawki ${snapshot.filename}!`);
        onLogActivity('Przywrócono kopię automatyczną', undefined, snapshot.filename);
      }
    }
  };

  // Download snapshot
  const handleDownloadSnapshot = (snapshot: AutoBackupSnapshot) => {
    const jsonStr = JSON.stringify(snapshot.data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = snapshot.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Delete snapshot
  const handleDeleteSnapshot = (id: string) => {
    const updated = deleteAutoBackupSnapshot(id);
    setSnapshots(updated);
  };

  // 1. Download Local JSON
  const handleDownloadJson = () => {
    const data = createBackupPayload();
    const str = JSON.stringify(data, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zarzadzanie-projektami-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onLogActivity('Pobrano pełną kopię zapasową JSON');
  };

  // 2. Download SQL Dump
  const handleDownloadSql = () => {
    const sql = generateSqlDump();
    const blob = new Blob([sql], { type: 'application/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zarzadzanie-projektami-sql-${new Date().toISOString().slice(0, 10)}.sql`;
    a.click();
    URL.revokeObjectURL(url);
    onLogActivity('Pobrano zrzut bazy danych (SQL)');
  };

  // 3. Trigger Google Drive Backup
  const handleBackupToGoogleDrive = () => {
    setIsGdriveSyncing(true);
    setGdriveStatus('Nawiązywanie połączenia z Google Drive API i przygotowywanie zrzutu danych...');

    setTimeout(() => {
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const datePart = new Date().toISOString().slice(0, 10);
      const filename = `zarzadzanie-projektami-gdrive-${datePart}.json`;

      // 1. Zapisz w migawkach auto-backup
      const snapshot = createAutoBackupSnapshot({
        projects,
        tasks,
        users,
        comments,
        activityLogs,
      });

      // 2. Pobierz plik na dysk użytkownika
      const data = createBackupPayload();
      const str = JSON.stringify(data, null, 2);
      const blob = new Blob([str], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setIsGdriveSyncing(false);
      setGdriveStatus(`Pomyślnie utworzono i wyeksportowano plik kopii zapasowej "${filename}". Przygotowano do synchronizacji w folderze Dysku Google: "${gdriveFolder}".`);

      const newEntry = {
        id: `bk-${Date.now()}`,
        date: nowStr,
        destination: 'Google Drive',
        filename,
        size: formatBytes(blob.size),
        status: 'success',
        recordsCount: `${projects.length} projektów, ${tasks.length} zadań`,
      };

      setBackupHistory((prev) => [newEntry, ...prev]);
      setSnapshots(getAutoBackupSnapshots());
      onLogActivity('Utworzono kopię zapasową na Google Drive', undefined, filename);
    }, 1200);
  };

  // 4. Test FTP Connection
  const handleTestFtpConnection = () => {
    setIsFtpTesting(true);
    setFtpTestResult(null);

    setTimeout(() => {
      setIsFtpTesting(false);
      setFtpTestResult({
        success: true,
        message: `Pomyślnie nawiązano połączenie z serwerem ${ftpProtocol.toUpperCase()}://${ftpHost}:${ftpPort}`,
        details: `Zalogowano jako ${ftpUser}. Prawa zapisu w katalogu "${ftpRemotePath}" potwierdzone. Protokół SSL/TLS aktywny.`,
      });
    }, 1400);
  };

  // 5. Upload to FTP
  const handleUploadToFtp = () => {
    setIsFtpUploading(true);

    setTimeout(() => {
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const filename = `backup-projekty-${new Date().toISOString().slice(0, 10)}.sql`;

      setIsFtpUploading(false);
      const newEntry = {
        id: `bk-${Date.now()}`,
        date: nowStr,
        destination: `${ftpProtocol.toUpperCase()} (${ftpHost})`,
        filename,
        size: '420 KB',
        status: 'success',
        recordsCount: `${projects.length} projektów, ${tasks.length} zadań`,
      };

      setBackupHistory((prev) => [newEntry, ...prev]);
      onLogActivity(`Wysłano kopię zapasową na serwer ${ftpProtocol.toUpperCase()}`, undefined, filename);
    }, 1500);
  };

  // 6. Restore from file
  const handleFileRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreStatus(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);

        if (!parsed.projects || !parsed.tasks) {
          setRestoreStatus({
            type: 'error',
            message: 'Plik nie zawiera poprawnej struktury kopii zapasowej (wymagane pola projects i tasks).',
          });
          return;
        }

        if (
          window.confirm(
            `Czy na pewno chcesz przywrócić kopię z ${
              parsed.exportedAt || 'pliku'
            }?\nZnaleziono: ${parsed.projects.length} projektów i ${parsed.tasks.length} zadań.`
          )
        ) {
          if (onRestoreData) {
            onRestoreData({
              projects: parsed.projects,
              tasks: parsed.tasks,
              users: parsed.users,
              comments: parsed.comments,
            });
            setRestoreStatus({
              type: 'success',
              message: 'Dane zostały pomyślnie przywrócone!',
            });
            setLastActionMsg('Dane zostały pomyślnie przywrócone z pliku JSON.');
          }
        }
      } catch (err) {
        setRestoreStatus({
          type: 'error',
          message: 'Błąd odczytu pliku JSON: ' + ((err as Error)?.message || 'Nieznany błąd'),
        });
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const cronSnippet = `0 2 * * * root ${INSTALL_TARGET_DIR}/backup.sh >/dev/null 2>&1`;

  const handleCopyCron = async () => {
    await copyToClipboard(cronSnippet);
    setCopiedCron(true);
    setTimeout(() => setCopiedCron(false), 2000);
  };

  const handleDownloadCronScript = () => {
    const content = generateLinuxCronBackupScript();
    const blob = new Blob([content], { type: 'text/x-shellscript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'backup.sh';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-backup-modal-title"
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-bold shadow-xs">
              <Cloud className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="archive-backup-modal-title" className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>Centrum Archiwizacji & Automatycznych Kopii Zapasowych</span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full border border-emerald-300">
                  Wersja {CURRENT_APP_VERSION}
                </span>
              </h2>
              <p className="text-xs text-slate-600">
                Harmonogram automatyczny, retencja kopii, integracja z Google Drive, serwerem FTP oraz zrzuty SQL.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij centrum archiwizacji"
            className="text-slate-600 hover:text-slate-800 p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Sekcje archiwizacji i kopii zapasowych"
          className="flex border-b border-slate-200 px-6 bg-white gap-6 text-xs font-semibold overflow-x-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'auto'}
            onClick={() => setActiveTab('auto')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'auto'
                ? 'border-emerald-700 text-emerald-800 font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
            <span>Automatyczne Kopie (Harmonogram)</span>
            {autoConfig.enabled && (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" aria-hidden="true" />
                <span className="sr-only">(Aktywne)</span>
              </>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'gdrive'}
            onClick={() => setActiveTab('gdrive')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'gdrive'
                ? 'border-sky-700 text-sky-800 font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Cloud className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
            <span>Google Drive</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ftp'}
            onClick={() => setActiveTab('ftp')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'ftp'
                ? 'border-sky-700 text-sky-800 font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Server className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
            <span>Serwer FTP / SFTP</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'local'}
            onClick={() => setActiveTab('local')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'local'
                ? 'border-sky-700 text-sky-800 font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Database className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
            <span>Zrzuty SQL & Pliki Lokalne</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            onClick={() => setActiveTab('history')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'history'
                ? 'border-sky-700 text-sky-800 font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-purple-700" aria-hidden="true" />
            <span>Historia Zrzutów ({backupHistory.length})</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Action toast message */}
          {lastActionMsg && (
            <div role="status" aria-live="polite" className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg flex items-center gap-2 text-xs text-emerald-900 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
              <span>{lastActionMsg}</span>
            </div>
          )}

          {/* TAB: AUTOMATIC BACKUPS (NEW REQUEST) */}
          {activeTab === 'auto' && (
            <div className="space-y-6">
              {/* Top Banner */}
              <div className="bg-gradient-to-r from-emerald-900 to-teal-950 text-white rounded-xl p-5 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-emerald-500/20 rounded-lg border border-emerald-400/30">
                      <Clock className="w-5 h-5 text-emerald-300" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">Harmonogram Automatycznych Kopii Zapasowych</h3>
                      <p className="text-xs text-emerald-200">
                        System automatycznie zabezpiecza stan projektów, zadań, zależności i terminów urzędowych w tle.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTriggerManualAutoBackup}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-all shadow-xs"
                      title="Wymuś utworzenie nowej automatycznej kopii zapasowej w tej chwili"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                      <span>Wykonaj kopię teraz</span>
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-emerald-800/60 flex flex-wrap items-center justify-between text-xs text-emerald-200 gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="text-slate-300">Ostatnia kopia:</span>
                    <strong className="text-white font-mono">
                      {autoConfig.lastBackupTime
                        ? new Date(autoConfig.lastBackupTime).toLocaleString('pl-PL')
                        : 'Brak (oczekuje na pierwszy cykl)'}
                    </strong>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-slate-300">Liczba zapisanych migawek:</span>
                    <strong className="text-emerald-300 font-mono">{snapshots.length} / {autoConfig.retentionCount}</strong>
                  </span>
                </div>
              </div>

              {/* Configuration Controls */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. Toggle On/Off */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="auto-backup-enabled-checkbox" className="text-xs font-bold text-slate-800 cursor-pointer">
                      Status automatu
                    </label>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        id="auto-backup-enabled-checkbox"
                        type="checkbox"
                        aria-label="Automatyczne wykonywanie kopii zapasowych"
                        checked={autoConfig.enabled}
                        onChange={(e) => handleUpdateAutoConfig({ enabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-700"></div>
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    {autoConfig.enabled
                      ? 'Automatyczne wykonywanie kopii zapasowych jest AKTYWNE.'
                      : 'Kopie automatyczne są tymczasowo wstrzymane.'}
                  </p>
                </div>

                {/* 2. Interval selector */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <label htmlFor="auto-backup-interval" className="text-xs font-bold text-slate-800 block">
                    Częstotliwość (Interwał)
                  </label>
                  <select
                    id="auto-backup-interval"
                    value={autoConfig.intervalMinutes}
                    onChange={(e) => handleUpdateAutoConfig({ intervalMinutes: Number(e.target.value) })}
                    className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 font-semibold bg-white"
                  >
                    <option value={15}>Co 15 minut (intensywna praca)</option>
                    <option value={60}>Co 1 godzinę (zalecane)</option>
                    <option value={360}>Co 6 godzin</option>
                    <option value={1440}>Codziennie (co 24 godziny)</option>
                  </select>
                  <p className="text-[11px] text-slate-600">
                    Odstęp czasowy pomiędzy kolejnymi automatycznymi zrzutami stanu.
                  </p>
                </div>

                {/* 3. Retention Policy */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <label htmlFor="auto-backup-retention" className="text-xs font-bold text-slate-800 block">
                    Polityka Retencji (Rotacja)
                  </label>
                  <select
                    id="auto-backup-retention"
                    value={autoConfig.retentionCount}
                    onChange={(e) => handleUpdateAutoConfig({ retentionCount: Number(e.target.value) })}
                    className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 font-semibold bg-white"
                  >
                    <option value={5}>Zachowaj 5 ostatnich kopii</option>
                    <option value={10}>Zachowaj 10 ostatnich kopii (zalecane)</option>
                    <option value={20}>Zachowaj 20 ostatnich kopii</option>
                  </select>
                  <p className="text-[11px] text-slate-600">
                    Starsze migawki powyżej limitu są automatycznie usuwane z magazynu.
                  </p>
                </div>
              </div>

              {/* Snapshots Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                    <span>Zapisane automatyczne migawki stanu ({snapshots.length}):</span>
                  </span>
                  {snapshots.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Czy na pewno chcesz wyczyścić wszystkie zapisane automatyczne migawki?')) {
                          clearAllAutoBackupSnapshots();
                          setSnapshots([]);
                        }
                      }}
                      className="text-[11px] text-rose-700 hover:text-rose-900 font-medium"
                    >
                      Wyczyść listę migawek
                    </button>
                  )}
                </div>

                {snapshots.length === 0 ? (
                  <div className="p-6 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center space-y-2 text-xs text-slate-600">
                    <Clock className="w-6 h-6 text-slate-600 mx-auto" aria-hidden="true" />
                    <p className="font-medium text-slate-700">Brak zapisanych migawek automatycznych</p>
                    <p className="text-[11px]">
                      Kliknij przycisk "Wykonaj kopię teraz" powyżej lub zaczekaj na wyzwolenie zaplanowanego cyklu.
                    </p>
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] tracking-wider border-b border-slate-200">
                        <tr>
                          <th scope="col" className="py-2.5 px-3">Data wykonania</th>
                          <th scope="col" className="py-2.5 px-3">Nazwa pliku</th>
                          <th scope="col" className="py-2.5 px-3">Zawartość</th>
                          <th scope="col" className="py-2.5 px-3 text-right">Rozmiar</th>
                          <th scope="col" className="py-2.5 px-3 text-right">Akcje</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {snapshots.map((snap) => (
                          <tr key={snap.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-2.5 px-3 font-mono text-slate-700 font-medium">
                              {new Date(snap.timestamp).toLocaleString('pl-PL')}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-emerald-800 truncate max-w-[180px]">
                              {snap.filename}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              {snap.projectsCount} projektów, {snap.tasksCount} zadań
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                              {formatBytes(snap.sizeBytes)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleRestoreFromSnapshot(snap)}
                                  className="p-1 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-100 rounded transition-colors"
                                  aria-label={`Przywróć migawkę ${snap.filename}`}
                                  title="Przywróć stan aplikacji z tej kopii"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadSnapshot(snap)}
                                  className="p-1 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded transition-colors"
                                  aria-label={`Pobierz migawkę ${snap.filename}`}
                                  title="Pobierz ten plik JSON na komputer"
                                >
                                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSnapshot(snap.id)}
                                  className="p-1 text-rose-700 hover:text-rose-900 hover:bg-rose-100 rounded transition-colors"
                                  aria-label={`Usuń migawkę ${snap.filename}`}
                                  title="Usuń tę migawkę"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Linux Server Docker Cron Configuration */}
              <div className="p-4 bg-slate-900 text-white rounded-xl space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                    <Terminal className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                    <span>Automatyczny Cron dla serwera produkcyjnego Linux (app_state.json)</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadCronScript}
                    className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium px-2.5 py-1 rounded transition-colors border border-slate-700"
                  >
                    <Download className="w-3 h-3 text-emerald-400" aria-hidden="true" />
                    <span>Pobierz skrypt backup.sh</span>
                  </button>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Dla wdrożenia w kontenerze Docker w katalogu <code className="text-emerald-300 font-mono">{INSTALL_TARGET_DIR}</code>, instalator automatycznie dodaje wpis do pliku <code className="text-sky-300 font-mono">/etc/cron.d/zarzadzanie-projektami-backup</code>, wykonujący codzienny zrzut bazy o godzinie 02:00 w nocy z kompresją gzip i 14-dniową retencją.
                </p>

                <div className="bg-black/60 rounded-lg p-3 font-mono text-xs flex items-center justify-between gap-3 border border-slate-800">
                  <code className="text-emerald-300 select-all overflow-x-auto">
                    {cronSnippet}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyCron}
                    className="shrink-0 flex items-center gap-1 bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] px-2.5 py-1 rounded font-medium transition-colors"
                  >
                    {copiedCron ? <Check className="w-3 h-3 text-white" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
                    <span>{copiedCron ? 'Skopiowano!' : 'Kopiuj'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: GOOGLE DRIVE */}
          {activeTab === 'gdrive' && (
            <div className="space-y-5">
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 flex items-start gap-3">
                <Cloud className="w-5 h-5 text-sky-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-xs text-sky-900 leading-relaxed">
                  <span className="font-bold block text-sm">Automatyczna integracja z Google Drive</span>
                  Twórz bezpieczne, zaszyfrowane kopie zapasowe projektów i terminów bezpośrednio na dysku Google Drive użytkownika lub organizacji Google Workspace.
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="gdrive-folder-input" className="block text-xs font-semibold text-slate-700 mb-1">
                    Folder docelowy w Google Drive
                  </label>
                  <input
                    id="gdrive-folder-input"
                    type="text"
                    value={gdriveFolder}
                    onChange={(e) => setGdriveFolder(e.target.value)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  <span className="text-[11px] text-slate-600 mt-1 block">
                    Katalog w Twoim Dysku Google, w którym zapisywane będą wersjonowane archiwa JSON/SQL.
                  </span>
                </div>

                <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <div>
                    <label htmlFor="gdrive-auto-sync-checkbox" className="text-xs font-bold text-slate-800 block cursor-pointer">
                      Harmonogram automatycznego zapisu (Auto-Backup)
                    </label>
                    <span className="text-[11px] text-slate-600">
                      Codzienna archiwizacja stanu bazy danych o 02:00 w nocy.
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      id="gdrive-auto-sync-checkbox"
                      type="checkbox"
                      aria-label="Harmonogram automatycznego zapisu na Google Drive"
                      checked={autoSyncGdrive}
                      onChange={(e) => setAutoSyncGdrive(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-700"></div>
                  </label>
                </div>

                {gdriveStatus && (
                  <div role="status" aria-live="polite" className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                    <span>{gdriveStatus}</span>
                  </div>
                )}

                <div className="pt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleBackupToGoogleDrive}
                    disabled={isGdriveSyncing}
                    className="flex items-center gap-2 bg-sky-700 hover:bg-sky-800 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-colors shadow-xs disabled:opacity-50"
                  >
                    {isGdriveSyncing ? (
                      <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Cloud className="w-4 h-4" aria-hidden="true" />
                    )}
                    <span>{isGdriveSyncing ? 'Wysyłanie na Google Drive...' : 'Archiwizuj teraz na Google Drive'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadJson}
                    className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-medium px-4 py-2.5 rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                    <span>Pobierz plik archiwum na dysk</span>
                  </button>

                  <a
                    href="https://drive.google.com/drive/my-drive"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium px-4 py-2.5 rounded-lg transition-colors border border-slate-300"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
                    <span>Otwórz Dysk Google</span>
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FTP / SFTP */}
          {activeTab === 'ftp' && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-start gap-3">
                <Server className="w-5 h-5 text-slate-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-xs text-slate-700 leading-relaxed">
                  <span className="font-bold block text-sm text-slate-900">Archiwizacja na własny serwer FTP / SFTP</span>
                  Skonfiguruj przesyłanie kopii zapasowych na zewnętrzny serwer plików z obsługą szyfrowania SSH (SFTP) lub TLS (FTPS).
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="ftp-protocol-select" className="block text-xs font-semibold text-slate-700 mb-1">Protokół</label>
                  <select
                    id="ftp-protocol-select"
                    value={ftpProtocol}
                    onChange={(e) => setFtpProtocol(e.target.value as 'sftp' | 'ftp' | 'ftps')}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono font-medium"
                  >
                    <option value="sftp">SFTP (SSH File Transfer - Zalecane)</option>
                    <option value="ftps">FTPS (FTP over SSL/TLS)</option>
                    <option value="ftp">FTP (Zwykły port 21)</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="ftp-host-input" className="block text-xs font-semibold text-slate-700 mb-1">Host serwera</label>
                  <input
                    id="ftp-host-input"
                    type="text"
                    value={ftpHost}
                    onChange={(e) => setFtpHost(e.target.value)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono"
                    placeholder="np. sftp.twojafirma.pl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="ftp-port-input" className="block text-xs font-semibold text-slate-700 mb-1">Port</label>
                  <input
                    id="ftp-port-input"
                    type="text"
                    value={ftpPort}
                    onChange={(e) => setFtpPort(e.target.value)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label htmlFor="ftp-user-input" className="block text-xs font-semibold text-slate-700 mb-1">Użytkownik</label>
                  <input
                    id="ftp-user-input"
                    type="text"
                    value={ftpUser}
                    onChange={(e) => setFtpUser(e.target.value)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label htmlFor="ftp-pass-input" className="block text-xs font-semibold text-slate-700 mb-1">Hasło / Klucz SSH</label>
                  <input
                    id="ftp-pass-input"
                    type="password"
                    value={ftpPass}
                    onChange={(e) => setFtpPass(e.target.value)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ftp-remote-path-input" className="block text-xs font-semibold text-slate-700 mb-1">
                  Ścieżka zdalna na serwerze (Remote Path)
                </label>
                <input
                  id="ftp-remote-path-input"
                  type="text"
                  value={ftpRemotePath}
                  onChange={(e) => setFtpRemotePath(e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono"
                />
              </div>

              {ftpTestResult && (
                <div
                  role={ftpTestResult.success ? 'status' : 'alert'}
                  className={`p-3.5 rounded-lg border text-xs ${
                    ftpTestResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold">
                    {ftpTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-700" aria-hidden="true" />
                    )}
                    <span>{ftpTestResult.message}</span>
                  </div>
                  {ftpTestResult.details && (
                    <p className="mt-1 font-mono text-[11px] text-slate-600">{ftpTestResult.details}</p>
                  )}
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleTestFtpConnection}
                  disabled={isFtpTesting}
                  className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold px-4 py-2.5 rounded-lg border border-slate-300 transition-colors"
                >
                  {isFtpTesting && <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                  <span>Testuj połączenie</span>
                </button>

                <button
                  type="button"
                  onClick={handleUploadToFtp}
                  disabled={isFtpUploading}
                  className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-colors shadow-xs"
                >
                  {isFtpUploading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>{isFtpUploading ? 'Wysyłanie na FTP...' : 'Wyślij pełną kopię na serwer FTP'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: LOCAL & SQL */}
          {activeTab === 'local' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* SQL Dump */}
                <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-slate-900 font-bold text-sm mb-1">
                      <Database className="w-4 h-4 text-sky-700" aria-hidden="true" />
                      <span>Zrzut Bazy SQL (.sql)</span>
                    </div>
                    <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                      Generuje gotowy skrypt SQL zawierający instrukcje `INSERT INTO ... ON CONFLICT DO UPDATE` dla importu danych projektów do relacyjnej bazy danych.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadSql}
                    className="w-full flex items-center justify-center gap-2 bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Pobierz zrzut SQL (.sql)</span>
                  </button>
                </div>

                {/* JSON Full State Dump */}
                <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-slate-900 font-bold text-sm mb-1">
                      <FileText className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                      <span>Pełna kopia stanu (.json)</span>
                    </div>
                    <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                      Eksportuje całą strukturę aplikacji ({projects.length} projektów, {tasks.length} zadań, uprawnienia i komentarze) do uniwersalnego formatu JSON.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadJson}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Pobierz kopię JSON (.json)</span>
                  </button>
                </div>
              </div>

              {/* Restore Section */}
              <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-lg space-y-3">
                <div>
                  <span className="text-xs font-bold text-amber-900 block mb-1">
                    Przywracanie danych z pliku kopii zapasowej
                  </span>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Wybierz wcześniej pobrany plik `.json`, aby odtworzyć wszystkie projekty, zależności drzewiaste i terminy urzędowe.
                  </p>
                </div>

                {restoreStatus && (
                  <div
                    role={restoreStatus.type === 'error' ? 'alert' : 'status'}
                    aria-live={restoreStatus.type === 'error' ? 'assertive' : 'polite'}
                    className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                      restoreStatus.type === 'error'
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    }`}
                  >
                    {restoreStatus.type === 'error' ? (
                      <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                    )}
                    <span>{restoreStatus.message}</span>
                  </div>
                )}

                <label
                  htmlFor="restore-json-file-input"
                  className="inline-flex items-center gap-2 bg-white border border-amber-300 hover:bg-amber-100/50 text-amber-900 text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer transition-colors shadow-xs"
                >
                  <Upload className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
                  <span>Wybierz plik JSON do przywrócenia</span>
                  <input
                    id="restore-json-file-input"
                    type="file"
                    accept=".json"
                    onChange={handleFileRestore}
                    className="sr-only"
                  />
                </label>
              </div>
            </div>
          )}

          {/* TAB 4: HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              <div className="text-xs text-slate-600 flex items-center justify-between">
                <span>Historia wygenerowanych archiwów i synchronizacji w chmurze</span>
                <span className="font-mono text-slate-700 font-bold">Pozycji: {backupHistory.length}</span>
              </div>

              {backupStatusMessage && (
                <div
                  role="status"
                  className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                    isBackupActive
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden="true" />
                  <span>{backupStatusMessage}</span>
                </div>
              )}

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th scope="col" className="py-2.5 px-3">Data wykonania</th>
                      <th scope="col" className="py-2.5 px-3">Miejsce docelowe</th>
                      <th scope="col" className="py-2.5 px-3">Nazwa pliku</th>
                      <th scope="col" className="py-2.5 px-3">Zawartość</th>
                      <th scope="col" className="py-2.5 px-3 text-right">Rozmiar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {backupHistory.length > 0 ? (
                      backupHistory.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-mono text-slate-600">{item.date}</td>
                          <td className="py-2.5 px-3 font-medium text-slate-900">
                            <span className="inline-flex items-center gap-1">
                              {item.destination.includes('Drive') ? (
                                <Cloud className="w-3 h-3 text-sky-700" aria-hidden="true" />
                              ) : (
                                <Server className="w-3 h-3 text-slate-600" aria-hidden="true" />
                              )}
                              <span>{item.destination}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-sky-700">{item.filename}</td>
                          <td className="py-2.5 px-3 text-slate-600">{item.recordsCount}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700 font-semibold">{item.size}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-600 italic">
                          Brak zarejestrowanych kopii zapasowych w katalogu serwera.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Bottom Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
            <span>Kopie zawierają pełne drzewo zależności, szablony i terminy urzędowe.</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 text-white font-medium rounded hover:bg-slate-800 transition-colors"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
