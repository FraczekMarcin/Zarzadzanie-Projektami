# Changelog - Zarządzanie Projektami

Wszystkie istotne zmiany w projekcie są dokumentowane w tym pliku.
Format oparty na [Keep a Changelog](https://keepachangelog.com/pl/1.0.0/), wersjonowanie zgodne z [Semantic Versioning](https://semver.org/lang/pl/).

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
