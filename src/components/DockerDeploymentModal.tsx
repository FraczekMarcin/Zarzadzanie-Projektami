import React, { useState } from 'react';
import { DOCKER_FILES, DockerConfigFile } from '../data/dockerConfig';
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
  ExternalLink
} from 'lucide-react';

interface DockerDeploymentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DockerDeploymentModal: React.FC<DockerDeploymentModalProps> = ({ isOpen, onClose }) => {
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'guide' | 'postgres' | 'persistence'>('files');

  if (!isOpen) return null;

  const currentFile = DOCKER_FILES[selectedFileIndex];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Modal Top Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-100 rounded-lg text-sky-700">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Wdrożenie Self-Hosted: Docker & Baza PostgreSQL
              </h3>
              <p className="text-xs text-slate-500">
                Lokalna instalacja na własnym serwerze (Linux, Synology NAS, Windows Docker Desktop).
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
        <div className="px-6 border-b border-slate-200 bg-white flex items-center gap-4 text-xs font-medium">
          <button
            onClick={() => setActiveTab('files')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
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
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'guide'
                ? 'border-sky-600 text-sky-700 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Instrukcja instalacji krok po kroku</span>
          </button>

          <button
            onClick={() => setActiveTab('postgres')}
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
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
            className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'persistence'
                ? 'border-emerald-600 text-emerald-800 font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Trwałość danych (Aktualizacje)</span>
          </button>
        </div>

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
                  mkdir -p /opt/openproject-hub && cd /opt/openproject-hub
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
                  Wklej pliki: <code className="font-mono bg-slate-100 px-1 rounded">docker-compose.yml</code>, <code className="font-mono bg-slate-100 px-1 rounded">init.sql</code>, <code className="font-mono bg-slate-100 px-1 rounded">Dockerfile</code> oraz <code className="font-mono bg-slate-100 px-1 rounded">.env.production</code>.
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
                  docker exec -t openproject_hub_db pg_dump -U openproject openproject_db &gt; backup_$(date +\%Y\%m\%d).sql
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
                docker exec -t openproject-db pg_dump -U openproject openproject_db &gt; backup_przed_upgradem_$(date +%Y%m%d).sql
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
