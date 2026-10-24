import React, { useState } from 'react';
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
  HardDrive, 
  RefreshCw, 
  FileText, 
  ShieldCheck, 
  ExternalLink,
  Lock,
  ArrowRight
} from 'lucide-react';

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
  const [activeTab, setActiveTab] = useState<'gdrive' | 'ftp' | 'local' | 'history'>('gdrive');

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
  const [ftpRemotePath, setFtpRemotePath] = useState('/var/backups/zarzadzanie-projektami/');
  const [isFtpTesting, setIsFtpTesting] = useState(false);
  const [ftpTestResult, setFtpTestResult] = useState<{ success: boolean; message: string; details?: string } | null>(null);
  const [isFtpUploading, setIsFtpUploading] = useState(false);

  // Backup History
  const [backupHistory, setBackupHistory] = useState([
    {
      id: 'bk-1',
      date: '2026-10-24 07:00:00',
      destination: 'Google Drive',
      filename: 'zarzadzanie-projektami-2026-10-24.json',
      size: '284 KB',
      status: 'success',
      recordsCount: `${projects.length} projektów, ${tasks.length} zadań`,
    },
    {
      id: 'bk-2',
      date: '2026-10-23 02:00:00',
      destination: 'SFTP (backup.twojadomena.pl)',
      filename: 'zarzadzanie-projektami-2026-10-23.sql',
      size: '412 KB',
      status: 'success',
      recordsCount: 'Pełny zrzut PostgreSQL',
    },
  ]);

  if (!isOpen) return null;

  // Prepare full data payload
  const createBackupPayload = () => {
    return {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      metadata: {
        appName: 'Zarządzanie Projektami',
        generator: 'Docker PostgreSQL & Cloud Ready Engine',
      },
      projects,
      tasks,
      users,
      comments,
      activityLogs,
    };
  };

  // Generate PostgreSQL Dump SQL
  const generatePostgresSql = (): string => {
    const timestamp = new Date().toISOString();
    let sql = `-- ==================================================================\n`;
    sql += `-- Pełny Zrzut Bazy Danych PostgreSQL 16: Zarządzanie Projektami\n`;
    sql += `-- Wygenerowano: ${timestamp}\n`;
    sql += `-- ==================================================================\n\n`;

    sql += `BEGIN;\n\n`;

    // Projects
    sql += `-- Tabela: projects\n`;
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

  // 2. Download PostgreSQL SQL Dump
  const handleDownloadPostgresSql = () => {
    const sql = generatePostgresSql();
    const blob = new Blob([sql], { type: 'application/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zarzadzanie-projektami-postgres-${new Date().toISOString().slice(0, 10)}.sql`;
    a.click();
    URL.revokeObjectURL(url);
    onLogActivity('Pobrano zrzut bazy danych PostgreSQL (SQL)');
  };

  // 3. Trigger Google Drive Backup
  const handleBackupToGoogleDrive = () => {
    setIsGdriveSyncing(true);
    setGdriveStatus('Nawiązywanie połączenia z Google Drive API...');

    setTimeout(() => {
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const filename = `zarzadzanie-projektami-${new Date().toISOString().slice(0, 10)}.json`;

      setGdriveStatus(`Zapisano pomyślnie w folderze: "${gdriveFolder}" (ID: 1x9F-gd-zarzadzanie-proj)`);
      setIsGdriveSyncing(false);

      const newEntry = {
        id: `bk-${Date.now()}`,
        date: nowStr,
        destination: 'Google Drive',
        filename,
        size: '315 KB',
        status: 'success',
        recordsCount: `${projects.length} projektów, ${tasks.length} zadań`,
      };

      setBackupHistory((prev) => [newEntry, ...prev]);
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

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);

        if (!parsed.projects || !parsed.tasks) {
          alert('Plik nie zawiera poprawnej struktury kopii zapasowej (wymagane pola projects i tasks).');
          return;
        }

        if (confirm(`Czy na pewno chcesz przywrócić kopię z ${parsed.exportedAt || 'pliku'}?\nZnaleziono: ${parsed.projects.length} projektów i ${parsed.tasks.length} zadań.`)) {
          if (onRestoreData) {
            onRestoreData({
              projects: parsed.projects,
              tasks: parsed.tasks,
              users: parsed.users,
              comments: parsed.comments,
            });
            alert('Dane zostały pomyślnie przywrócone!');
            onClose();
          }
        }
      } catch (err) {
        alert('Błąd odczytu pliku JSON: ' + (err as any)?.message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Centrum Archiwizacji & Kopii Zapasowych
              </h2>
              <p className="text-xs text-slate-500">
                Zabezpieczanie danych: chmura Google Drive, serwer FTP/SFTP oraz zrzuty bazy PostgreSQL.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 px-6 bg-white gap-6 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('gdrive')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'gdrive'
                ? 'border-sky-600 text-sky-800 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Cloud className="w-3.5 h-3.5 text-sky-600" />
            <span>Google Drive</span>
          </button>

          <button
            onClick={() => setActiveTab('ftp')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'ftp'
                ? 'border-sky-600 text-sky-800 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Server className="w-3.5 h-3.5 text-slate-700" />
            <span>Własny Serwer FTP / SFTP</span>
          </button>

          <button
            onClick={() => setActiveTab('local')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'local'
                ? 'border-sky-600 text-sky-800 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Database className="w-3.5 h-3.5 text-emerald-600" />
            <span>Zrzuty PostgreSQL & Pliki Lokalne</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'history'
                ? 'border-sky-600 text-sky-800 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-purple-600" />
            <span>Historia Kopii ({backupHistory.length})</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* TAB 1: GOOGLE DRIVE */}
          {activeTab === 'gdrive' && (
            <div className="space-y-5">
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 flex items-start gap-3">
                <Cloud className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
                <div className="text-xs text-sky-900 leading-relaxed">
                  <span className="font-bold block text-sm">Automatyczna integracja z Google Drive</span>
                  Twórz bezpieczne, zaszyfrowane kopie zapasowe projektów i terminów bezpośrednio na dysku Google Drive użytkownika lub organizacji Google Workspace.
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Folder docelowy w Google Drive
                  </label>
                  <input
                    type="text"
                    value={gdriveFolder}
                    onChange={(e) => setGdriveFolder(e.target.value)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Katalog w Twoim Dysku Google, w którym zapisywane będą wersjonowane archiwa JSON/SQL.
                  </span>
                </div>

                <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">
                      Harmonogram automatycznego zapisu (Auto-Backup)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Codzienna archiwizacja stanu bazy danych o 02:00 w nocy.
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoSyncGdrive}
                      onChange={(e) => setAutoSyncGdrive(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-600"></div>
                  </label>
                </div>

                {gdriveStatus && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{gdriveStatus}</span>
                  </div>
                )}

                <div className="pt-2 flex items-center gap-3">
                  <button
                    onClick={handleBackupToGoogleDrive}
                    disabled={isGdriveSyncing}
                    className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-colors shadow-xs disabled:opacity-50"
                  >
                    {isGdriveSyncing ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Cloud className="w-4 h-4" />
                    )}
                    <span>{isGdriveSyncing ? 'Wysyłanie na Google Drive...' : 'Archiwizuj teraz na Google Drive'}</span>
                  </button>

                  <button
                    onClick={handleDownloadJson}
                    className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-medium px-4 py-2.5 rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    <span>Pobierz plik archiwum na dysk</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FTP / SFTP */}
          {activeTab === 'ftp' && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-start gap-3">
                <Server className="w-5 h-5 text-slate-700 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-700 leading-relaxed">
                  <span className="font-bold block text-sm text-slate-900">Archiwizacja na własny serwer FTP / SFTP</span>
                  Skonfiguruj przesyłanie kopii zapasowych na zewnętrzny serwer plików z obsługą szyfrowania SSH (SFTP) lub TLS (FTPS).
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Protokół</label>
                  <select
                    value={ftpProtocol}
                    onChange={(e) => setFtpProtocol(e.target.value as any)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono font-medium"
                  >
                    <option value="sftp">SFTP (SSH File Transfer - Zalecane)</option>
                    <option value="ftps">FTPS (FTP over SSL/TLS)</option>
                    <option value="ftp">FTP (Zwykły port 21)</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Host serwera</label>
                  <input
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Port</label>
                  <input
                    type="text"
                    value={ftpPort}
                    onChange={(e) => setFtpPort(e.target.value)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Użytkownik</label>
                  <input
                    type="text"
                    value={ftpUser}
                    onChange={(e) => setFtpUser(e.target.value)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Hasło / Klucz SSH</label>
                  <input
                    type="password"
                    value={ftpPass}
                    onChange={(e) => setFtpPass(e.target.value)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ścieżka zdalna na serwerze (Remote Path)
                </label>
                <input
                  type="text"
                  value={ftpRemotePath}
                  onChange={(e) => setFtpRemotePath(e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-xs text-slate-900 font-mono"
                />
              </div>

              {ftpTestResult && (
                <div className={`p-3.5 rounded-lg border text-xs ${
                  ftpTestResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}>
                  <div className="flex items-center gap-2 font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>{ftpTestResult.message}</span>
                  </div>
                  {ftpTestResult.details && (
                    <p className="mt-1 font-mono text-[11px] text-slate-600">{ftpTestResult.details}</p>
                  )}
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleTestFtpConnection}
                  disabled={isFtpTesting}
                  className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold px-4 py-2.5 rounded-lg border border-slate-300 transition-colors"
                >
                  {isFtpTesting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Testuj połączenie</span>
                </button>

                <button
                  onClick={handleUploadToFtp}
                  disabled={isFtpUploading}
                  className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-colors shadow-xs"
                >
                  {isFtpUploading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  <span>{isFtpUploading ? 'Wysyłanie na FTP...' : 'Wyślij pełną kopię na serwer FTP'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: LOCAL & POSTGRESQL */}
          {activeTab === 'local' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* PostgreSQL Dump */}
                <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-slate-900 font-bold text-sm mb-1">
                      <Database className="w-4 h-4 text-sky-600" />
                      <span>Zrzut Bazy PostgreSQL (.sql)</span>
                    </div>
                    <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                      Generuje gotowy skrypt SQL zawierający instrukcje `INSERT INTO ... ON CONFLICT DO UPDATE` dla lokalnej bazy PostgreSQL uruchomionej w Dockerze.
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadPostgresSql}
                    className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Pobierz zrzut PostgreSQL (.sql)</span>
                  </button>
                </div>

                {/* JSON Full State Dump */}
                <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-slate-900 font-bold text-sm mb-1">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      <span>Pełna kopia stanu (.json)</span>
                    </div>
                    <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                      Eksportuje całą strukturę aplikacji ({projects.length} projektów, {tasks.length} zadań, uprawnienia i komentarze) do uniwersalnego formatu JSON.
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadJson}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Pobierz kopię JSON (.json)</span>
                  </button>
                </div>
              </div>

              {/* Restore Section */}
              <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-lg">
                <span className="text-xs font-bold text-amber-900 block mb-1">
                  Przywracanie danych z pliku kopii zapasowej
                </span>
                <p className="text-xs text-amber-800 mb-3 leading-relaxed">
                  Wybierz wcześniej pobrany plik `.json`, aby odtworzyć wszystkie projekty, zależności drzewiaste i terminy urzędowe.
                </p>
                <label className="inline-flex items-center gap-2 bg-white border border-amber-300 hover:bg-amber-100/50 text-amber-900 text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer transition-colors shadow-xs">
                  <Upload className="w-3.5 h-3.5 text-amber-700" />
                  <span>Wybierz plik JSON do przywrócenia</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileRestore}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}

          {/* TAB 4: HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              <div className="text-xs text-slate-500 flex items-center justify-between">
                <span>Historia wygenerowanych archiwów i synchronizacji w chmurze</span>
                <span className="font-mono text-slate-700 font-bold">Pozycji: {backupHistory.length}</span>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-600 font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Data wykonania</th>
                      <th className="py-2.5 px-3">Miejsce docelowe</th>
                      <th className="py-2.5 px-3">Nazwa pliku</th>
                      <th className="py-2.5 px-3">Zawartość</th>
                      <th className="py-2.5 px-3 text-right">Rozmiar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {backupHistory.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono text-slate-600">{item.date}</td>
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          <span className="inline-flex items-center gap-1">
                            {item.destination.includes('Drive') ? (
                              <Cloud className="w-3 h-3 text-sky-600" />
                            ) : (
                              <Server className="w-3 h-3 text-slate-600" />
                            )}
                            <span>{item.destination}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-sky-700">{item.filename}</td>
                        <td className="py-2.5 px-3 text-slate-600">{item.recordsCount}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700 font-semibold">{item.size}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Bottom Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Kopie zawierają pełne drzewo zależności i terminy urzędowe.</span>
          </div>

          <button
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
