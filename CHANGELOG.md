# Changelog - Zarządzanie Projektami

Wszystkie istotne zmiany w projekcie są dokumentowane w tym pliku.
Format oparty na [Keep a Changelog](https://keepachangelog.com/pl/1.0.0/), wersjonowanie zgodne z [Semantic Versioning](https://semver.org/lang/pl/).

## [0.9.6] - 2026-11-15

### Zmieniono
- **Podział największych komponentów bez zmiany zachowania (`src/components/SettingsModal.tsx`, `src/components/settings/*`, `src/App.tsx`, `src/hooks/*`)**: wydzielono 8 zakładek z `SettingsModal.tsx` do osobnych komponentów ładowanych leniwie przez `React.lazy` i `Suspense` w `src/components/settings/` (`ThemeTab`, `VariablesTab`, `UsersTab`, `SecurityTab`, `CalendarTab`, `UpdateTab`, `DockerTab`, `BackupTab`) oraz wydzielono logikę synchronizacji z serwerem, operacji na zadaniach i sesji uwierzytelniania z `App.tsx` do hooków `useServerSync`, `useTaskActions` i `useAuthSession` w `src/hooks/`.

## [0.9.5] - 2026-11-15

### Zmieniono
- **Aktualizacja środowiska uruchomieniowego do Node.js 24 LTS (`Dockerfile`, `package.json`, `.github/workflows/ci.yml`, `README.md`)**: przełączono obrazy `Dockerfile` na `node:24-slim` (etap `builder`) oraz `node:24-alpine` (etap `runner`), ustawiono `engines.node` na `>=24` w `package.json`, zaktualizowano `node-version` do `24` w zadaniach `test-and-build` i `e2e` w `.github/workflows/ci.yml` oraz zaktualizowano wymagania w `README.md` do Node.js 24 LTS (`>=24`).

## [0.9.4] - 2026-11-15

### Dodano
- **Wspólny moduł statusu i monitorowania kopii zapasowych (`src/server/backupStatus.ts`, `src/server/backupWatch.ts`)**: wyodrębniono logikę `GET /api/backup/status` do `computeBackupStatus` i dodano cykliczną usługę `backupWatch` uruchamianą w `createApp` (2 min po starcie i co 6 h), monitorującą próg `BACKUP_MAX_AGE_HOURS` (domyślnie `36` h).
- **Alerty e-mail i zdarzenia bezpieczeństwa kopii zapasowych (`src/server/config.ts`, `src/utils/securityLog.ts`, `src/components/SettingsModal.tsx`)**: dodano obsługę zmiennych `BACKUP_MAX_AGE_HOURS` i `BACKUP_ALERT_EMAILS` (z domyślnym wyborem aktywnych administratorów posiadających adres e-mail), ograniczenie alertów do maks. 1 na 24 h, jednorazowe powiadomienie o powrocie kopii do normy (`kopia znów aktualna`) oraz zdarzenia `backup_stale` i `backup_recovered` zapisujące wyłącznie wiek kopii w godzinach (`ageHours`, bez ścieżek systemowych), z obsługą pracy bez SMTP.
- **Testy alertów kopii zapasowych (`src/__tests__/backupWatch.test.ts`)**: dodano testy jednostkowe z fałszywymi timerami i atrapą wysyłki e-mail sprawdzające próg wieku kopii, dobór odbiorców, tłumienie powtórek w oknie 24 h, pojedyncze powiadomienie o powrocie do normy, tryb bez SMTP oraz brak ścieżek systemowych w dzienniku zdarzeń.

### Zmieniono
- **Nagłówek statusu kopii dla administratora (`src/App.tsx`, `src/server/routes/system.ts`, `src/server/app.ts`)**: przełączono `GET /api/backup/status` na wspólny moduł `computeBackupStatus`, podpięto cykl życia `backupWatch` do `createApp`/`close()` oraz zaktualizowano czerwony wskaźnik w nagłówku dla administratora, wyświetlając komunikat `Brak świeżej kopii zapasowej (ostatnia: X h temu)` (lub `brak`).
- **Dokumentacja konfiguracji (`README.md`, `.env.example`)**: opisano zmienne środowiskowe `BACKUP_MAX_AGE_HOURS` i `BACKUP_ALERT_EMAILS`.

## [0.9.3] - 2026-11-15

### Dodano
- **Ustrukturyzowany logger serwera (`src/server/logger.ts`)**: dodano bez-zależnościowy logger z poziomami `debug`/`info`/`warn`/`error`, konfiguracją `LOG_LEVEL` (domyślnie `info`), prefiksem czasu ISO i poziomu oraz opcjonalnym formatem `LOG_FORMAT=json` (jedna linia JSON na wpis) przez `process.stdout.write` / `process.stderr.write`.
- **Testy loggera, prywatności logów i dokumentacji konfiguracji (`src/__tests__/logger.test.ts`, `src/__tests__/envDocs.test.ts`)**: dodano testy filtrowania poziomów i formatu JSON, weryfikację braku adresów e-mail oraz imion/nazwisk w logach startowych oraz automatyczny test skanujący zmienne `process.env.*` w kodzie serwera pod kątem obecności w `README.md` i `.env.example` oraz braku bezpośrednich wywołań `console.*` w kodzie serwera.

### Zmieniono
- **Zastąpienie `console.*` i usunięcie PII z logów serwera (`server.ts`, `src/server/*`, `src/utils/stateStore.ts`)**: zastąpiono wszystkie wywołania `console.log`/`warn`/`error` w kodzie serwera wywołaniami `logger` o tym samym znaczeniu oraz usunięto adresy e-mail i imiona/nazwiska użytkowników z logów startowych i uwierzytelniania (pozostawiając `userId`).
- **Dokumentacja zmiennych środowiskowych i `COMPOSE_FILE` (`README.md`, `.env.example`)**: uzupełniono pełną tabelę zmiennych środowiskowych serwera w `README.md`, skomentowane zmienne opcjonalne w `.env.example` oraz przykłady łączenia plików `COMPOSE_FILE` (HTTP, HTTPS, HTTPS + Kalendarz Google) wraz z ostrzeżeniem, że pominięcie `docker-compose.https.yml` wyłącza Caddy i HTTPS.

### Usunięto
- **Nieużywany kod (`src/utils/authSecurity.ts`)**: usunięto nieużywaną funkcję `generate2FASecret`.

## [0.9.2] - 2026-11-15

### Dodano
- **Testy end-to-end w przeglądarce (`playwright.config.ts`, `e2e/app.spec.ts`, `e2e/global-teardown.ts`, `.github/workflows/ci.yml`)**: dodano pakiet `@playwright/test`, konfigurację Chromium z izolowanym katalogiem tymczasowym, sześć scenariuszy E2E (kreator administratora i logowanie, projekt/zadanie/Kanban/przeładowanie, zakładki Ustawień i blokada przycisku 1-Click dla `localhost`, czyszczenie `localStorage` przy wylogowaniu, włączenie 2FA i logowanie TOTP oraz synchronizacja dwóch kontekstów przez SSE w 3 s) oraz zadanie CI `e2e` z zapisem raportu i trace przy błędach.
- **Wykluczenie testów E2E z Vitest (`vitest.config.ts`)**: dodano konfigurację Vitest wykluczającą katalog `e2e/**`.

### Naprawiono
- **Synchronizacja wybranego projektu i obsługa kodów zapasowych 2FA (`src/App.tsx`, `src/components/LoginGate.tsx`, `src/components/TaskModal.tsx`, `src/components/SettingsModal.tsx`, `src/components/TwoFactorManager.tsx`, `src/server/routes/auth.ts`)**: zaktualizowano `selectedProjectId` i `projectId` zadań po zapisie projektu na serwerze, zwiększono `maxLength` pola kodu 2FA przy logowaniu z 10 do 16 (pełne kody `XXXXX-XXXXX`), usunięto duplikat atrybutu `id` tytułu w oknie zadania, podpięto otwieranie modalu subskrypcji iCal w Ustawieniach, dodano etykietę dostępności klucza 2FA oraz wyciszono zbędne żądania `401`/`404` przed zalogowaniem.

## [0.9.1] - 2026-11-14

### Dodano
- **Jednokierunkowa synchronizacja z Kalendarzem Google przez konto usługi (`src/utils/googleCalendar.ts`, `src/server/googleSync.ts`)**: dodano klienta Google Calendar API v3 opartego o wbudowany moduł `crypto` (podpis JWT RS256) i `fetch` z buforowaniem tokena, limitem 5 żądań/s, paginacją, ponawianiem po błędach `429`/`5xx`, wyliczaniem różnic (`diffEvents`, `buildEventPayload`) oraz znakowaniem zarządzanych wydarzeń flagą `zpManaged=true`, uruchamianego 30 s po starcie, z opóźnieniem 60 s po zmianie stanu i w cyklu uzgadniania co 15 min (z blokadą równoległych przebiegów).
- **Endpointy, dziennik bezpieczeństwa i panel administratora (`src/server/routes/...`, `src/server/app.ts`, `src/utils/securityLog.ts`, `src/components/SettingsModal.tsx`)**: dodano trasy administratora `GET /api/google-sync/status` i `POST /api/google-sync/run` (`202 Accepted`), typy zdarzeń `google_sync_started`, `google_sync_completed` i `google_sync_failed` oraz sekcję *Synchronizacja z Kalendarzem Google* z ręcznym wyzwalaniem i instrukcją konfiguracji.
- **Konfiguracja Docker i dokumentacja (`docker-compose.google.yml`, `.env.example`, `.gitignore`, `.dockerignore`, `README.md`)**: dodano opcjonalne nadpisanie Compose montujące `./secrets/google_sa.json` (bez przerywania domyślnego startu kontenera), wykluczenia katalogu `secrets/` oraz instrukcję konfiguracji i zastrzeżenie o nadpisywaniu ręcznych edycji wydarzeń `zpManaged=true`.
- **Testy jednostkowe i integracyjne (`src/__tests__/googleCalendar.test.ts`, `src/__tests__/api.integration.test.ts`)**: dodano testy podpisu RS256, `buildEventPayload`, `diffEvents`, paginacji i ponowień po `429`, ochrony przed wyciekiem sekretów, blokady równoległości oraz pojedynczych operacji `patch`/`delete` przy zmianie i usuwaniu zadania.

## [0.9.0] - 2026-11-14

### Dodano
- **Strumień zdarzeń SSE (`src/server/routes/events.ts`, `src/server/state.ts`, `src/server/sessions.ts`)**: dodano uwierzytelniony endpoint `GET /api/events` (`text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`) wysyłający zdarzenie `revision` przy połączeniu i po każdej zmianie rewizji stanu oraz komentarz `: keep-alive` co 25 s, z limitem 5 jednoczesnych strumieni na użytkownika (`429`) i automatycznym zamykaniem po wygaśnięciu lub unieważnieniu sesji bez odświeżania `lastSeenAt`.
- **Testy integracyjne SSE (`src/__tests__/api.integration.test.ts`)**: dodano weryfikację odrzucania żądań bez sesji (`401`), dostarczania zdarzeń `revision` do wielu klientów poniżej 1 s, limitu 5 połączeń (`429`) oraz zamykania strumieni po wylogowaniu i wygaśnięciu sesji.

### Zmieniono
- **Synchronizacja stanu w przeglądarce (`src/App.tsx`)**: zastąpiono stałe odpytywanie `GET /api/state/revision` co 15 s strumieniem `EventSource('/api/events')` z automatycznym przejściem na rezerwowe odpytywanie co 15 s po 3 błędach połączenia, powrotem do SSE po udanym połączeniu oraz zamykaniem strumienia przy wylogowaniu i odpowiedzi `401`.
- **Konfiguracja serwera i proxy (`src/server/security.ts`, `src/server/app.ts`, `src/server/routes/auth.ts`, `src/server/routes/users.ts`, `Caddyfile`)**: wyłączono buforującą kompresję dla `/api/events`, powiązano unieważnianie sesji ze zamykaniem strumieni SSE oraz dodano `flush_interval -1` w bloku `reverse_proxy` pliku `Caddyfile`.

## [0.8.2] - 2026-11-14

### Dodano
- **Wspólne etykiety i odmiana dni (`src/utils/labels.ts`)**: wydzielono `PRIORITY_LABELS`, `STATUS_LABELS` oraz funkcję `formatDurationDays` współdzielone między frontendem a backendem.
- **Metadane i linki w zdarzeniach iCal (`src/utils/icsBuilder.ts`, `src/server/config.ts`)**: dodano obsługę zmiennej `PUBLIC_BASE_URL` (zwracanej także przez `/api/calendar/token` i `/api/calendar/token/generate`), pola `LAST-MODIFIED`, `CATEGORIES`, `URL`, `SEQUENCE`, status `STATUS:CANCELLED` dla anulowanych zadań oraz nazwę projektu w `DESCRIPTION`.
- **Wykrywanie adresów lokalnych (`src/utils/calendar.ts`)**: dodano funkcję `isPrivateOrLocalUrl` wykrywającą protokół `http://`, sieci prywatne RFC 1918, `localhost`, nazwy bez kropki oraz domeny `.local`/`.lan`/`.home`.

### Zmieniono
- **Feed iCalendar i buforowanie HTTP (`src/server/routes/calendar.ts`, `src/utils/icsBuilder.ts`)**: zastąpiono surowe kody w `DESCRIPTION` polskimi etykietami i odmianą czasu trwania, zapewniono deterministyczny wynik `buildIcs` oraz dodano nagłówki `ETag`, `Last-Modified` i `Cache-Control: private, max-age=0, must-revalidate` z obsługą `If-None-Match` i `If-Modified-Since` (`304 Not Modified`).
- **Okno synchronizacji z kalendarzami (`src/components/GoogleCalendarSyncModal.tsx`)**: usunięto nieprawdziwe zapewnienia o odświeżaniu co 15 minut w Google Calendar i strumieniu na żywo, zablokowano przycisk 1-Click dla adresów lokalnych/HTTP z komunikatem ostrzegawczym oraz dodano instrukcje subskrypcji dla Apple Calendar, Outlooka i Thunderbirda, importu `.ics` w Kalendarzu Google i instalowania lokalnego certyfikatu głównego.

## [0.8.1] - 2026-11-14

### Naprawiono
- **Uprawnienia plików danych serwera (`umask 0o077` i tryb `0o600`)**: ustawiono `process.umask(0o077)` na początku startu serwera (`server.ts`, `src/server/app.ts`), wymuszono tryb `0o600` przy zapisie i rotacji `app_state.json`, `sessions.json`, `security_log.jsonl` oraz plików tymczasowych, a także dodano zawężanie szerszych uprawnień istniejących plików przy starcie (`src/server/state.ts`) i testy w `src/__tests__/filePermissions.test.ts`.
- **Spójność wersji w pliku blokady i testach**: zsynchronizowano pole `version` w `package-lock.json` do `0.8.1` oraz rozszerzono `src/__tests__/versionConsistency.test.ts` o walidację `package-lock.json`.

### Zmieniono
- **Budowanie Docker bez skryptów instalacyjnych (`Dockerfile`)**: dodano flagę `--ignore-scripts` przy wywołaniach `npm ci` w etapie `builder` oraz `npm ci --omit=dev` w etapie `runner`.
- **Utwardzenie potoku CI (`.github/workflows/ci.yml`)**: dodano limit czasu `timeout-minutes: 15` oraz krok `npm audit signatures` po `npm ci`.
- **Grupowanie aktualizacji Dependabot (`.github/dependabot.yml`)**: skonfigurowano `open-pull-requests-limit: 5`, grupę `minor-and-patch` dla `npm` oraz oddzielny wpis dla `github-actions`.

Wersje 0.6.0 i 0.7.0 zostały wydane bez osobnych wpisów; ich zawartość opisuje wpis 0.8.0.

## [0.8.0] - 2026-11-13

### Dodano
- **Zarządzanie sesjami i wygasanie po bezczynności**: obsługa zmiennych `SESSION_IDLE_MINUTES` (domyślnie 120 min) i `SESSION_MAX_HOURS` (domyślnie 12 h), śledzenie `lastSeenAt`, `userAgent` oraz `ip`, podgląd i zdalne unieważnianie aktywnych sesji w API oraz panelu Ustawień.
- **Dziennik zdarzeń bezpieczeństwa (`src/utils/securityLog.ts`)**: zapis w formacie JSONL (`security_log.jsonl`) z rotacją plików co 5 MB (3 archiwa), rejestracja zdarzeń uwierzytelniania, 2FA, zmian haseł, operacji na kontach i sesjach oraz podgląd przez Administratora (`GET /api/security/events`).
- **Szyfrowane kopie zapasowe i test przywracania**: opcjonalne szyfrowanie AES-256-CBC w `backup.sh` (`BACKUP_PASSPHRASE_FILE`), kopia poza serwer (`BACKUP_COPY_DIR` / `BACKUP_REMOTE`), obsługa obu rozszerzeń w rotacji oraz izolowany skrypt weryfikacji kopii `restore-test.sh`.
- **Modularyzacja serwera i testy integracyjne (`src/server/`)**: wydzielenie `createApp(options)` oraz podział logiki `server.ts` na wyspecjalizowane moduły (`config`, `state`, `sessions`, `security`, `routes/*`, `static`, `app`) wraz z zestawem testów integracyjnych API (`src/__tests__/api.integration.test.ts`).
- **Spójna polityka haseł (`src/utils/passwordPolicy.ts`)**: walidacja długości 12–128 znaków, odrzucanie najczęstszych haseł, sekwencji, powtórzeń i danych użytkownika zarówno po stronie serwera, jak i w formularzach klienta (`PasswordRequirementsChecklist`).
- **Poprawki dostępności (WCAG AA)**: własny hook pułapki fokusu `useFocusTrap`, atrybuty `role="dialog"`, `aria-modal`, `aria-labelledby`, obsługa klawiatury i skrótów `Esc`, etykiety formularzy i przycisków ikonowych, zamiana `alert()` na komunikaty `role="alert"`/`role="status"`, poprawa kontrastu oraz `:focus-visible` i `prefers-reduced-motion`.
- **Abstrakcja magazynu danych (`src/utils/stateStore.ts`)**: interfejs `StateStore` z implementacjami `JsonFileStateStore` (atomowy zapis `fsync` + `rename`, migracja sekretów) i `MemoryStateStore` oraz wyborem przez zmienną `STORAGE`.
- **Jedno źródło prawdy dla wersji**: odczyt wersji wyłącznie z pliku `VERSION` (`vite.config.ts` → `__APP_VERSION__` dla frontendu oraz `getLocalInstalledVersion()` dla backendu).

### Naprawiono
- **Obsługa SNI przy połączeniach HTTPS po adresie IP (`Caddyfile`)**: dodano globalną dyrektywę `default_sni {$APP_HOST}`, dzięki której Caddy dopasowuje właściwy certyfikat TLS także wtedy, gdy klient łączący się po adresie IP nie wysyła nagłówka SNI.
- **Healthcheck kontenera Caddy (`docker-compose.https.yml`)**: zmieniono sondę na żądanie HTTP `GET` pod adresem `127.0.0.1:2019/config/` z interwałem `10s`, zapewniając stabilny stan `healthy` w ok. 30 s od uruchomienia.
- **Obsługa zapytań `HEAD /` w trybie produkcyjnym (`src/server/static.ts`)**: dopuszczono metodę `HEAD` w fallbacku SPA (zwraca `200` i `Content-Type: text/html`), pozostawiając odrzucanie metod mutujących (np. `POST /`) oraz `404` dla nieznanych tras `/api/*`.
- **Polecenia aktualizacji bez `./backup.sh` i `git stash`**: zastąpiono wywołanie `./backup.sh` jawnym `/bin/bash backup.sh` w `README.md`, `install.sh`, `src/data/dockerConfig.ts`, `src/components/GitHubUpdateModal.tsx` oraz modalach wdrożenia/kopii, a także usunięto `git stash` z kreatora aktualizacji.
- **Konfiguracja crona kopii zapasowych i uprawnień gita w `install.sh`**: ustandaryzowano wpis `/etc/cron.d/zarzadzanie-projektami-backup` do formatu z `/bin/bash`, pełną ścieżką i logowaniem do `/var/log/zarzadzanie-backup.log`, dodano automatyczną migrację istniejących wpisów bez `/bin/bash` oraz ustawienie `git config core.fileMode false` w katalogu repozytorium.
- **Weryfikacja gotowości HTTPS po instalacji (`install.sh`)**: dodano oczekiwanie do 30 s na odpowiedź `200` z `https://${APP_HOST}/api/health` oraz wypisywanie ostrzeżenia z poleceniami diagnostycznymi (`docker compose logs caddy --tail 40`, `openssl s_client`) bez przerywania instalacji.
- **Dokumentacja diagnostyki HTTPS (`README.md`)**: dodano podsekcję `Diagnostyka` z poleceniami weryfikacji Caddy i TLS, opisem roli `default_sni` dla adresów IP, zaleceniem użycia nazwy hosta (np. `projekty.lan`) oraz ostrzeżeniem przed użyciem `git stash` na lokalnie zmienionym pliku `Caddyfile`.

## [0.5.0] - 2026-11-06

### Dodano
- **Uporządkowanie wdrożenia i CI (Single Source of Truth)**: Usunięcie redundancji katalogu `Instalacja/` – pliki wdrożeniowe (`install.sh`, `backup.sh`, `Dockerfile`, `docker-compose.yml`) znajdują się wyłącznie w katalogu głównym repozytorium.
- **Bezpieczna aktualizacja 1-poleceniem**: `cd /opt/zarzadzanie-projektami && ./backup.sh && git pull origin main && docker compose up -d --build` bez ryzyka konfliktów z lokalnymi modyfikacjami gita.
- **Utwardzenie kontenera produkcyjnego**: Dodanie `read_only: true` z `tmpfs: [/tmp]`, `security_opt: [no-new-privileges:true]`, `cap_drop: [ALL]`, `mem_limit: 512m`, `pids_limit: 200` oraz montowanie katalogu kopii zapasowych tylko do odczytu (`./backups:/app/backups:ro`) z obsługą `BACKUP_DIR: /app/backups`.
- **Zmienna powiązania adresu IP**: Parametr `${APP_BIND:-0.0.0.0}` dla portu aplikacji.
- **Automatyzacja CI i bezpieczeństwa**: Dodanie `permissions: contents: read`, kroku `npm audit --omit=dev --audit-level=high` oraz weryfikacji budowania obrazu Docker (`docker build .`) w GitHub Actions; konfiguracja cotygodniowego skanowania zależności npm i Docker w `.github/dependabot.yml`.

### Zmieniono
- Zunifikowano obrazy bazowe w `Dockerfile` do `node:22-alpine` dla obu etapów (builder i runner).
- Uproszczono `install.sh`: usunięto destrukcyjne operacje `docker prune`, eliminując nadpisywanie plików śledzonych przez git; dodano automatyczne przejście do katalogu repozytorium lub bezpieczne klonowanie do `/opt/zarzadzanie-projektami`.
- Zoptymalizowano `src/data/dockerConfig.ts` oraz modale `DockerDeploymentModal` i `SettingsModal` – wyeliminowano osadzone w pamięci kopie plików konfiguracyjnych na rzecz bezpośrednich komend instalacji i aktualizacji.

## [0.4.0] - 2026-11-02

### Dodano
- **RFC 5545 iCalendar Feeds z tokenem kryptograficznym**: Dostęp do prywatnego feedu kalendarza (`/api/calendar/:token/all.ics` oraz `/api/calendar/:token/user/:userId.ics`) zabezpieczony losowym tokenem przechowywanym w bazie jako hash SHA-256. Stare adresy bez tokenu zwracają status 404.
- **Generator iCal (`src/utils/icsBuilder.ts`)**: Walidacja dat (pomijanie zadań bez poprawnej daty, korygowanie odwróconych zakresów `dueDate < startDate`, `DTEND = dueDate + 1 dzień`), obsługa statusu `STATUS:CONFIRMED` dla VEVENT oraz prefiksu `✓ ` dla ukończonych zadań.
- **Lokalne fonty (@fontsource)**: Zbuntowano lokalnie czcionki `@fontsource/plus-jakarta-sans` oraz `@fontsource/jetbrains-mono`, całkowicie usuwając zewnętrzne żądania do Google Fonts.
- **Pamięć podręczna sprawdzania aktualizacji**: Endpoint `/api/system/check-update` buforuje odpowiedź GitHub przez 6 godzin; wyeliminowano bezpośrednie zapytania klienta do `api.github.com`.
- **Dynamiczny status kopii zapasowych**: Integracja z `/api/backup/status` i usunięcie statycznych danych demo.
- **Konfiguracja CI i Docker**: Przeniesienie narzędzi budowania do `devDependencies`, odchudzenie obrazu produkcyjnego runtime do `< 80 MB`, dodanie workflow GitHub Actions (lint, test, build).

### Zmieniono
- Zoptymalizowano `package.json` – skrypt `start` wskazuje na `node dist/server.js`, a w runnerze Dockera instalowane są wyłącznie zależności produkcyjne (`npm ci --omit=dev`).
- Zaktualizowano placeholdery w formularzu zadań (`TaskModal`) na przykłady branżowe (architektura i budownictwo).
- Zaostrzono reguły Content-Security-Policy (CSP) w `server.ts`.

## [0.3.5] - 2026-10-30

### Bezpieczeństwo
- **Bezpieczne 2FA / TOTP po stronie serwera**: Implementacja HMAC-SHA1 (`node:crypto`), tolerancja czasowa ±1 (30s), ochrona przed powtórzeniem kodu (licznik kroków), generowanie 8 jednorazowych kodów zapasowych przechowywanych jako skróty.
- **Lokalny kod QR**: Generowanie kodów QR bezpośrednio w przeglądarce przy użyciu biblioteki `qrcode`, bez zapytań do zewnętrznych API.
- **Bezpieczny reset hasła**: Losowy 6-cyfrowy kod ważny 10 minut z ograniczeniem do 5 prób, wysyłka e-mail przez SMTP (`nodemailer`) z jednolitą odpowiedzią API uniemożliwiającą enumerację kont.
- **Ochrona haseł**: Haszowanie algorytmem `scrypt` z solą kryptograficzną, blokada po 5 nieudanych próbach logowania.

## [0.3.0] - 2026-10-27

### Dodano
- **Wielodostęp i współbieżność**: Wprowadzenie numerycznego pola `revision` oraz nagłówków `If-Match` zapobiegających nadpisywaniu zmian przez równoległych użytkowników (odpowiedź 409 Conflict z aktualnym stanem).
- **Zasobowe endpointy REST**: `POST/PATCH/DELETE` dla `/api/tasks`, `/api/projects`, `/api/comments` z weryfikacją uprawnień na podstawie roli i członkostwa w projekcie.
- **Lekkie odpytywanie rewizji**: Endpoint `GET /api/state/revision` do wykrywania zmian w tle bez utraty stanu otwartych formularzy.

## [0.2.1] - 2026-10-25

### Dodano
- Katalog `Instalacja` z automatycznym instalatorem `install.sh` i konfiguracją Docker Compose.
- Automatyczne tworzenie kopii zapasowych w katalogu `DATA_DIR/backups`.
