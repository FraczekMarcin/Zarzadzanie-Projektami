import React, { useState } from 'react';
import { 
  DOCKER_FILES, 
  DockerConfigFile, 
  INSTALL_SCRIPT_CONTENT,
  GITHUB_REPO_URL,
  RAW_INSTALL_SCRIPT_URL,
  CURRENT_APP_VERSION,
  INSTALL_TARGET_DIR
} from '../data/dockerConfig';
import { 
  X, 
  Copy, 
  Check, 
  Download, 
  Server, 
  Database, 
  Terminal, 
  ShieldCheck, 
  FileCode, 
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  Zap,
  Code
} from 'lucide-react';

interface DockerDeploymentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DockerDeploymentModal: React.FC<DockerDeploymentModalProps> = ({ isOpen, onClose }) => {
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'one_command' | 'files' | 'guide' | 'postgres' | 'persistence'>('one_command');

  if (!isOpen) return null;

  const currentFile = DOCKER_FILES[selectedFileIndex];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyCmd = (cmd: string, key: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(key);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const handleDownloadSingleFile = (file: DockerConfigFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAllFiles = () => {
    DOCKER_FILES.forEach((f, idx) => {
      setTimeout(() => {
        handleDownloadSingleFile(f);
      }, idx * 250);
    });
  };

  const oneLinerCurl = `curl -fsSL ${RAW_INSTALL_SCRIPT_URL} | sudo bash`;
  const oneLinerWget = `wget -qO- ${RAW_INSTALL_SCRIPT_URL} | sudo bash`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Modal Top Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-100 rounded-lg text-sky-700">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>Wdrożenie Self-Hosted: Zarządzanie Projektami</span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full border border-emerald-300">
                  {CURRENT_APP_VERSION}
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Instalacja 1-poleceniem w katalogu <code className="font-mono text-slate-700 font-semibold">{INSTALL_TARGET_DIR}</code> z automatycznymi kopiami zapasowymi i PostgreSQL 16.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadAllFiles}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors shadow-xs"
              title="Pobierz wszystkie pliki wdrożeniowe do jednego folderu"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Pobierz komplet plików</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-slate-200 bg-white flex items-center gap-3 text-xs font-medium overflow-x-auto">
          <button
            onClick={() => setActiveTab('one_command')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'one_command'
                ? 'border-emerald-600 text-emerald-800 font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
            <span>Instalacja 1-poleceniem (curl | bash)</span>
          </button>

          <button
            onClick={() => setActiveTab('files')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'files'
                ? 'border-sky-600 text-sky-700 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileCode className="w-4 h-4" />
            <span>Pliki konfiguracyjne (Docker / SQL)</span>
          </button>

          <button
            onClick={() => setActiveTab('guide')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'guide'
                ? 'border-sky-600 text-sky-700 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Instrukcja krok po kroku</span>
          </button>

          <button
            onClick={() => setActiveTab('postgres')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'postgres'
                ? 'border-sky-600 text-sky-700 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Architektura PostgreSQL 16</span>
          </button>

          <button
            onClick={() => setActiveTab('persistence')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
              activeTab === 'persistence'
                ? 'border-emerald-600 text-emerald-800 font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Trwałość danych (Aktualizacje)</span>
          </button>
        </div>

        {/* Tab Content: One Command Quick Installer */}
        {activeTab === 'one_command' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-slate-50">
            {/* Hero Banner */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white rounded-xl p-6 shadow-md border border-slate-700">
              <div className="flex items-start justify-between">
                <div className="space-y-2 max-w-2xl">
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-500/30">
                    <Zap className="w-3.5 h-3.5 fill-emerald-300 text-emerald-300" />
                    <span>Najszybsza metoda wdrożenia (ok. 60 sekund)</span>
                  </div>
                  <h4 className="text-xl font-bold tracking-tight">
                    Zainstaluj Zarządzanie Projektami jednym poleceniem w terminalu
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Wklej poniższe polecenie w terminalu swojego serwera Linux (Ubuntu, Debian, CentOS, RHEL, Rocky, AlmaLinux lub serwer VPS/NAS). Skrypt automatycznie pobiera repozytorium z GitHub, konfiguruje PostgreSQL 16 oraz uruchamia automatyczny harmonogram kopii zapasowych (Cron).
                  </p>
                </div>
                <div className="hidden sm:flex flex-col items-end gap-2">
                  <button
                    onClick={() => handleDownloadSingleFile(DOCKER_FILES[0])}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-medium border border-white/20 transition-all shadow-xs"
                  >
                    <Download className="w-4 h-4 text-emerald-400" />
                    <span>Pobierz plik install.sh</span>
                  </button>
                  <span className="text-[11px] text-slate-400">100% On-Premises & Open-Source</span>
                </div>
              </div>

              {/* 1-Liner Box - CURL */}
              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-300 font-medium">
                  <span className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-sky-400" />
                    <span>Wariant zalecany (cURL):</span>
                  </span>
                  <span className="text-[11px] text-slate-400">Wymaga dostępu root / sudo</span>
                </div>

                <div className="relative group bg-black/60 backdrop-blur-xs rounded-lg border border-slate-700/80 p-3.5 flex items-center justify-between gap-4">
                  <code className="text-xs font-mono text-emerald-300 break-all select-all">
                    {oneLinerCurl}
                  </code>
                  <button
                    onClick={() => handleCopyCmd(oneLinerCurl, 'curl')}
                    className="shrink-0 flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3.5 py-1.5 rounded transition-all shadow-xs"
                  >
                    {copiedCmd === 'curl' ? (
                      <>
                        <Check className="w-4 h-4 text-white" />
                        <span>Skopiowano!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Kopiuj</span>
                      </>
                    )}
                  </button>
                </div>

                {/* 1-Liner Box - WGET */}
                <div className="flex items-center justify-between text-xs text-slate-300 font-medium pt-2">
                  <span className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-amber-400" />
                    <span>Wariant alternatywny (Wget):</span>
                  </span>
                </div>
                <div className="relative group bg-black/60 backdrop-blur-xs rounded-lg border border-slate-700/80 p-3 flex items-center justify-between gap-4">
                  <code className="text-xs font-mono text-sky-200 break-all select-all">
                    {oneLinerWget}
                  </code>
                  <button
                    onClick={() => handleCopyCmd(oneLinerWget, 'wget')}
                    className="shrink-0 flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-3 py-1.5 rounded border border-slate-600 transition-all shadow-xs"
                  >
                    {copiedCmd === 'wget' ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span>Skopiowano!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Kopiuj</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* What the script does step-by-step */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
              <h5 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4.5 h-4.5 text-emerald-600" />
                <span>Co automatycznie wykonuje skrypt instalacyjny?</span>
              </h5>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                  <div className="w-6 h-6 rounded-full bg-sky-100 text-sky-800 font-bold flex items-center justify-center text-xs">1</div>
                  <span className="font-bold text-slate-900 block">Weryfikacja środowiska</span>
                  <p className="text-slate-600 leading-relaxed text-[11px]">
                    Sprawdza obecność Dockera i Docker Compose v2. Jeśli ich brakuje, instaluje oficjalne pakiety silnika kontenerów ze strony docker.com.
                  </p>
                </div>
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                  <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs">2</div>
                  <span className="font-bold text-slate-900 block">Katalog & Auto-Backup</span>
                  <p className="text-slate-600 leading-relaxed text-[11px]">
                    Katalog <code className="text-slate-800 font-mono font-bold">/opt/zarzadzanie-projektami</code>, losowe hasła PostgreSQL, dedykowany wolumen danych oraz harmonogram crona o 02:00.
                  </p>
                </div>
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                  <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-800 font-bold flex items-center justify-center text-xs">3</div>
                  <span className="font-bold text-slate-900 block">Uruchomienie w tle</span>
                  <p className="text-slate-600 leading-relaxed text-[11px]">
                    Startuje kontenery w trybie daemon (<code className="text-slate-800 font-mono font-bold">docker compose up -d</code>) z automatycznym restartem po restarcie serwera.
                  </p>
                </div>
              </div>
            </div>

            {/* Data Safety & Updates Note */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-950 space-y-1">
                <span className="font-bold text-sm block">Gwarancja trwałości danych przy kolejnych aktualizacjach</span>
                <p className="leading-relaxed">
                  Baza danych zapisywana jest w niezależnym wolumenie <code className="bg-emerald-100 font-mono font-bold px-1 rounded text-emerald-900">postgres_data</code> (ścieżka hosta <code className="font-mono text-emerald-900">/var/lib/docker/volumes/...</code>). Zaktualizowanie obrazów kontenera nowszą wersją kodu nie narusza zawartości bazy danych ani projektów pracowni.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content: Files */}
        {activeTab === 'files' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left file sidebar */}
            <div className="w-60 border-r border-slate-200 bg-slate-50 p-3 space-y-1 overflow-y-auto">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block px-2 mb-2">
                Pliki wdrożenia
              </span>
              {DOCKER_FILES.map((file, idx) => (
                <button
                  key={file.filename}
                  onClick={() => {
                    setSelectedFileIndex(idx);
                    setCopied(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded text-xs transition-colors flex items-center justify-between ${
                    selectedFileIndex === idx
                      ? 'bg-white text-sky-700 font-semibold shadow-xs border border-slate-200'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="truncate">{file.filename}</span>
                  <span className="text-[10px] uppercase font-mono text-slate-400">{file.language}</span>
                </button>
              ))}

              <div className="mt-6 p-3 bg-sky-50 rounded-lg border border-sky-100 text-xs text-sky-900 space-y-1">
                <span className="font-semibold block">Gotowe do uruchomienia</span>
                <p className="text-[11px] leading-relaxed text-sky-800">
                  Wystarczy utworzyć katalog na serwerze, zapisać te 4 pliki i wpisać <code className="font-mono bg-sky-100 px-1 rounded">docker compose up -d</code>.
                </p>
              </div>
            </div>

            {/* Right code viewer */}
            <div className="flex-1 flex flex-col bg-slate-900 text-slate-100 overflow-hidden">
              {/* Code viewer bar */}
              <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs">
                <div>
                  <span className="font-mono text-emerald-400 font-semibold">{currentFile.filename}</span>
                  <span className="text-slate-400 ml-2 hidden sm:inline">{currentFile.description}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded text-xs transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Skopiowano!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Kopiuj kod</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleDownloadSingleFile(currentFile)}
                    className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded text-xs transition-colors"
                    title="Pobierz ten plik"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Pobierz</span>
                  </button>
                </div>
              </div>

              {/* Code content */}
              <pre className="p-4 overflow-auto flex-1 font-mono text-[12px] leading-relaxed text-slate-200 select-all">
                <code>{currentFile.content}</code>
              </pre>
            </div>
          </div>
        )}

        {/* Tab Content: Guide */}
        {activeTab === 'guide' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-6 text-xs text-slate-800 leading-relaxed">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <span className="font-semibold text-slate-900 block text-sm mb-1">Wymagania systemowe</span>
                <ul className="list-disc list-inside space-y-1 text-slate-600">
                  <li>System operacyjny: Linux (Ubuntu 22.04+, Debian, AlmaLinux), Synology DSM 7+ lub Windows Server</li>
                  <li>Docker Engine 24.0+ oraz Docker Compose v2+</li>
                  <li>Minimum 2 GB RAM (zalecane 4 GB dla PostgreSQL i pgAdmin)</li>
                  <li>Wolne porty: 3000 (aplikacja), 5432 (baza danych opcjonalnie), 5050 (pgAdmin)</li>
                </ul>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <span className="font-semibold text-emerald-950 block text-sm mb-1">Bezpieczeństwo danych</span>
                <p className="text-emerald-900 text-xs">
                  Baza danych przechowuje dane w trwałym wolumenie Docker (<code className="font-mono bg-emerald-100 px-1 rounded">postgres_data</code>), co gwarantuje pełną odporność na restarty i aktualizacje obrazów kontenera.
                </p>
              </div>
            </div>

            {/* Steps */}
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-slate-900">Kroki instalacji w 3 minuty:</h4>

              <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-[10px]">
                    1
                  </span>
                  <span className="font-semibold text-slate-900">Utwórz katalog roboczy na serwerze</span>
                </div>
                <div className="bg-slate-900 text-slate-200 p-3 rounded font-mono text-xs overflow-x-auto">
                  mkdir -p /opt/zarzadzanie-projektami && cd /opt/zarzadzanie-projektami
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-[10px]">
                    2
                  </span>
                  <span className="font-semibold text-slate-900">Umieść pobrane pliki w katalogu</span>
                </div>
                <p className="text-slate-600">
                  Wklej pliki: <code className="font-mono bg-slate-100 px-1 rounded">docker-compose.yml</code>, <code className="font-mono bg-slate-100 px-1 rounded">init.sql</code>, <code className="font-mono bg-slate-100 px-1 rounded">Dockerfile</code>, <code className="font-mono bg-slate-100 px-1 rounded">backup.sh</code> oraz <code className="font-mono bg-slate-100 px-1 rounded">.env.production</code>.
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-[10px]">
                    3
                  </span>
                  <span className="font-semibold text-slate-900">Uruchom usługi w tle (Docker Compose)</span>
                </div>
                <div className="bg-slate-900 text-slate-200 p-3 rounded font-mono text-xs overflow-x-auto">
                  docker compose up -d
                </div>
                <p className="text-slate-500 text-[11px]">
                  PostgreSQL zostanie automatycznie zainicjalizowany ze schematem tabel z pliku init.sql.
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-[10px]">
                    4
                  </span>
                  <span className="font-semibold text-slate-900">Wykonywanie automatycznych kopii zapasowych (Backup)</span>
                </div>
                <p className="text-slate-600">
                  Możesz utworzyć zadanie w cronie, aby codziennie o 2:00 w nocy wykonywać zrzut bazy:
                </p>
                <div className="bg-slate-900 text-slate-200 p-3 rounded font-mono text-xs overflow-x-auto">
                  docker exec -t zarzadzanie_db pg_dump -U zarzadzanie zarzadzanie_db | gzip &gt; /opt/zarzadzanie-projektami/backups/backup_$(date +\%Y\%m\%d).sql.gz
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content: PostgreSQL Architecture */}
        {activeTab === 'postgres' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-4 text-xs text-slate-800">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <h4 className="text-sm font-bold text-slate-900 mb-2">Relacyjny model danych PostgreSQL 16</h4>
              <p className="text-slate-600 leading-relaxed mb-4">
                Schemat został zoptymalizowany pod kątem szybkiego generowania wykresów Gantta, terminarzy oraz obsługi transakcyjnej dla wielu użytkowników równocześnie (row-level locking).
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-white p-3 rounded border border-slate-200">
                  <span className="font-mono font-bold text-sky-700 block mb-1">TABLE projects</span>
                  <p className="text-slate-500 text-[11px]">
                    Klucze projektów, statusy, priorytety, budżety i terminy bazowe.
                  </p>
                </div>

                <div className="bg-white p-3 rounded border border-slate-200">
                  <span className="font-mono font-bold text-sky-700 block mb-1">TABLE tasks (Work Packages)</span>
                  <p className="text-slate-500 text-[11px]">
                    Zadania, kamienie milowe, błędy z indeksami <code className="font-mono text-slate-800">idx_tasks_dates</code> dla błyskawicznego terminarza.
                  </p>
                </div>

                <div className="bg-white p-3 rounded border border-slate-200">
                  <span className="font-mono font-bold text-sky-700 block mb-1">TABLE task_dependencies</span>
                  <p className="text-slate-500 text-[11px]">
                    Relacje Gantta typu Finish-to-Start zapobiegające cyklom.
                  </p>
                </div>

                <div className="bg-white p-3 rounded border border-slate-200">
                  <span className="font-mono font-bold text-sky-700 block mb-1">TABLE activity_logs</span>
                  <p className="text-slate-500 text-[11px]">
                    Dziennik audytowy rejestrujący każdą edycję, zmianę statusu i komentarz członków zespołu.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content: Persistence FAQ & Docker Updates */}
        {activeTab === 'persistence' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-5 text-xs text-slate-700 leading-relaxed bg-slate-50/50">
            {/* Big Answer Banner */}
            <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-5 flex items-start gap-4 shadow-xs">
              <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 font-bold text-lg shadow-sm">
                ✓
              </div>
              <div>
                <h4 className="text-base font-bold text-emerald-900 mb-1">
                  Czy po aktualizacji kontenerów Docker dane w bazie PostgreSQL pozostaną?
                </h4>
                <p className="text-emerald-800 text-sm font-semibold mb-2">
                  TAK — dane są w 100% bezpieczne i zachowywane na dysku serwera.
                </p>
                <p className="text-emerald-800 text-xs leading-relaxed">
                  Docker oddziela bezstanową logikę aplikacji od danych bazy za pomocą dedykowanego wolumenu <code className="bg-emerald-100 px-1.5 py-0.5 rounded font-mono text-emerald-950 font-bold">postgres_data</code>. Nawet po całkowitym usunięciu kontenerów i pobraniu nowej wersji obrazu, Twoje projekty, zadania i historia pozostają nienaruszone.
                </p>
              </div>
            </div>

            {/* How Docker Volumes Work */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <h5 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Database className="w-4 h-4 text-sky-600" />
                <span>Dlaczego dane nie znikają? (Mechanizm Docker Named Volume)</span>
              </h5>
              <p className="text-slate-600">
                W pliku <code className="font-mono text-slate-800 bg-slate-100 px-1 py-0.5 rounded">docker-compose.yml</code> usługa bazy danych korzysta z konfiguracji:
              </p>
              <div className="bg-slate-900 text-slate-100 font-mono text-[11px] p-3 rounded-lg overflow-x-auto">
                <span className="text-purple-400">services</span>:<br />
                &nbsp;&nbsp;<span className="text-purple-400">db</span>:<br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-sky-300">image</span>: postgres:16-alpine<br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-sky-300">volumes</span>:<br />
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- <span className="text-amber-300">postgres_data</span>:/var/lib/postgresql/data<br />
                <br />
                <span className="text-purple-400">volumes</span>:<br />
                &nbsp;&nbsp;<span className="text-amber-300">postgres_data</span>: <span className="text-slate-400"># Wolumen trwały zarządzany przez system hosta</span>
              </div>
              <p className="text-slate-600 text-[11px]">
                Fizyczne pliki bazy danych znajdują się w katalogu systemowym Docker hosta (np. <code className="font-mono text-slate-800">/var/lib/docker/volumes/zarzadzanie_postgres_data/_data</code>) i nie podlegają skasowaniu przy restarcie lub podmianie kontenerów.
              </p>
            </div>

            {/* Standard Safe Update Procedure */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <h5 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-emerald-600" />
                <span>Standardowa, bezpieczna procedura aktualizacji aplikacji:</span>
              </h5>
              <div className="bg-slate-900 text-slate-100 font-mono text-xs p-3.5 rounded-lg space-y-2">
                <div className="text-slate-400"># 1. Przejdź do katalogu projektu na serwerze:</div>
                <div className="text-sky-300">cd /opt/zarzadzanie-projektami</div>
                <div className="text-slate-400 mt-2"># 2. Pobierz najnowsze wersje obrazów kontenerów:</div>
                <div className="text-sky-300">docker compose pull</div>
                <div className="text-slate-400 mt-2"># 3. Uruchom zaktualizowane kontenery (dane bazy zostają nienaruszone):</div>
                <div className="text-emerald-400 font-bold">docker compose up -d</div>
              </div>
            </div>

            {/* Crucial Warning */}
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-900 leading-relaxed">
                <span className="font-bold block text-sm">Jedyna komenda niszcząca (Czego NIGDY nie wpisywać):</span>
                Nigdy nie używaj komendy <code className="bg-rose-100 px-1 py-0.5 rounded font-bold font-mono text-rose-950">docker compose down -v</code>. Flaga <code className="font-bold">-v</code> (lub <code className="font-bold">--volumes</code>) instruuje Dockera, aby usunął fizyczne wolumeny danych. Do zwykłego zatrzymania używaj zawsze samego <code className="font-mono bg-white px-1 py-0.5 rounded border border-rose-300 font-bold">docker compose down</code>.
              </div>
            </div>

            {/* Quick pre-update backup command */}
            <div className="p-4 bg-slate-100 border border-slate-200 rounded-lg">
              <span className="font-bold text-slate-800 block mb-1">
                Zalecana dobra praktyka: Kopia zapasowa przed aktualizacją
              </span>
              <p className="text-[11px] text-slate-600 mb-2">
                Przed dużą aktualizacją możesz wykonać 1-komendowy zrzut bazy PostgreSQL do pliku:
              </p>
              <div className="bg-slate-900 text-slate-200 font-mono text-[11px] p-2.5 rounded">
                docker exec -t zarzadzanie_db pg_dump -U zarzadzanie zarzadzanie_db &gt; backup_przed_upgradem_$(date +%Y%m%d).sql
              </div>
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>Wszystkie skrypty są w 100% gotowe do instalacji na środowiskach On-Premises.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded transition-colors font-medium"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
