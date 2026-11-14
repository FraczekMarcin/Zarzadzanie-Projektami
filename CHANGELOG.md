# Changelog - Zarządzanie Projektami

Wszystkie istotne zmiany w projekcie są dokumentowane w tym pliku.
Format oparty na [Keep a Changelog](https://keepachangelog.com/pl/1.0.0/), wersjonowanie zgodne z [Semantic Versioning](https://semver.org/lang/pl/).

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
