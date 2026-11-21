# 🏗️ Zarządzanie Projektami (Pracownia Projektowa / Budownictwo)

[![CI](https://github.com/FraczekMarcin/Zarzadzanie-Projektami/actions/workflows/ci.yml/badge.svg)](https://github.com/FraczekMarcin/Zarzadzanie-Projektami/actions/workflows/ci.yml)
[![Wersja](https://img.shields.io/badge/Wersja-plik%20VERSION-emerald.svg)](VERSION)
[![Docker](https://img.shields.io/badge/Docker-App%20Data%20Volume-blue.svg)](https://www.docker.com/)
[![Licencja](https://img.shields.io/badge/Licencja-MIT-green.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-FraczekMarcin%2FZarzadzanie--Projektami-purple.svg)](https://github.com/FraczekMarcin/Zarzadzanie-Projektami)

Nowoczesny, kompleksowy system zarządzania projektami architektonicznymi, inżynieryjnymi i wykonawczymi. Zbudowany z myślą o pracowniach projektowych, biurach konstrukcyjnych i generalnych wykonawcach.

---

## ⚡ Szybka instalacja (Linux VPS / NAS / Serwer dedykowany)

Wszystkie pliki wdrożeniowe znajdują się bezpośrednio w katalogu głównym repozytorium. Skrypt automatycznie sprawdza i instaluje silnik Docker, przygotowuje katalog `/opt/zarzadzanie-projektami`, konfiguruje trwały wolumen danych (`zarzadzanie_app_data`), atomowy zapis stanu `app_state.json` oraz uruchamia automatyczny harmonogram kopii zapasowych (Cron codziennie o 02:00).

### Pierwsza instalacja na serwerze:
```bash
sudo bash install.sh
```

*(lub przy instalacji na świeżym serwerze od zera)*:
```bash
git clone https://github.com/FraczekMarcin/Zarzadzanie-Projektami.git /opt/zarzadzanie-projektami
cd /opt/zarzadzanie-projektami
sudo bash install.sh
```

Aplikacja natychmiast uruchomi się w kontenerach Docker i będzie dostępna pod adresem:
👉 **http://adres-twojego-serwera:3000** (lub `http://localhost:3000`)

---

## 🔒 Opcjonalny HTTPS dla sieci lokalnej (Caddy Reverse Proxy)

System umożliwia bezpieczne uruchomienie po HTTPS z automatycznym certyfikatem TLS generowanym przez Caddy, bez zmiany domyślnego działania po HTTP.

### 1. Ustawienie nazwy hosta lub adresu IP (APP_HOST)
W pliku `.env` w katalogu `/opt/zarzadzanie-projektami` ustaw nazwę hosta lub adres IP serwera, pod którym pracownicy łączą się w sieci lokalnej:
```bash
APP_HOST=192.168.1.100
# lub np. APP_HOST=serwer.local albo APP_HOST=projekty.twojafirma.pl
```

### 2. Uruchomienie aplikacji z obsługą HTTPS (łączenie plików `COMPOSE_FILE`)
Docker Compose odczytuje zmienną `COMPOSE_FILE` z pliku `.env` (pliki oddzielone dwukropkiem `:`) i automatycznie łączy konfiguracje bez konieczności podawania flag `-f`:

- **Tylko HTTP (port 3000, bez Caddy):**
  ```env
  COMPOSE_FILE=docker-compose.yml
  ```
  *(lub brak zmiennej `COMPOSE_FILE` w `.env`)*
- **HTTPS w sieci lokalnej (Caddy Reverse Proxy, wymaga ustawienia `APP_HOST`):**
  ```env
  COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml
  ```
- **HTTPS + jednokierunkowa synchronizacja z Kalendarzem Google:**
  ```env
  COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml:docker-compose.google.yml
  ```

> ⚠️ **Ważne ostrzeżenie dotyczące HTTPS i Caddy:** Ustawienie zmiennej `COMPOSE_FILE` w pliku `.env` **bez** `docker-compose.https.yml` (np. samo `COMPOSE_FILE=docker-compose.yml:docker-compose.google.yml`) **wyłącza kontener Caddy oraz obsługę HTTPS**! Jeśli używasz HTTPS i jednocześnie włączasz integrację z Kalendarzem Google, w `COMPOSE_FILE` muszą znaleźć się wszystkie trzy pliki.

Po ustawieniu `APP_HOST` i `COMPOSE_FILE` w `.env` (instalator `install.sh` robi to automatycznie) uruchom:
```bash
docker compose up -d --build
```
> **Uwaga dotycząca wersji:** Plik `docker-compose.https.yml` korzysta z dyrektywy `ports: !reset []`, która wymaga Docker Compose w wersji **>= 2.24**.
>
> W trybie HTTPS Caddy nasłuchuje na standardowych portach **443** (HTTPS) i **80** (automatyczne przekierowanie do HTTPS). Bezpośredni port aplikacji `3000` jest zresetowany i niedostępny z zewnątrz, a aplikacja działa w trybie `TRUST_PROXY=1`, wymuszając bezpieczne ciasteczka sesyjne (`Secure`, `__Host-zp_session`).

### 3. Eksport certyfikatu głównego Caddy (Local Root CA)
Aby przeglądarki na stanowiskach pracy ufały połączeniu HTTPS bez ostrzeżenia o certyfikacie wystawionym przez lokalne CA, wyeksportuj certyfikat główny Caddy:
```bash
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt
```

### 4. Instalacja certyfikatu na stanowiskach pracy
Przekaż pobrany plik `caddy-root.crt` na komputery w pracowni i zainstaluj go jako zaufany główny urząd certyfikacji:
- **Windows:** Kliknij dwukrotnie plik `caddy-root.crt` ➔ *Zainstaluj certyfikat* ➔ wybierz *Komputer lokalny* ➔ *Umieść wszystkie certyfikaty w następującym magazynie* ➔ wskaż **Zaufane główne urzędy certyfikacji** ➔ *Zakończ*.
- **macOS:** Otwórz plik w aplikacji *Dostęp do pęku kluczy* (*Keychain Access*) w pęku *System*, kliknij certyfikat dwukrotnie, rozwiń sekcję *Zaufanie* i ustaw *Zawsze ufaj* dla protokołu SSL.
- **Linux:** Skopiuj plik: `sudo cp caddy-root.crt /usr/local/share/ca-certificates/` i wykonaj `sudo update-ca-certificates`.
- **Mozilla Firefox (opcjonalnie):** Przejdź do *Ustawienia* ➔ *Prywatność i bezpieczeństwo* ➔ *Certyfikaty* ➔ *Wyświetl certyfikaty* ➔ zakładka *Organy certyfikacji* ➔ *Importuj...* ➔ wybierz plik `caddy-root.crt` i zaznacz opcję zaufania.

Po instalacji certyfikatu adres `https://<APP_HOST>` otwiera się z pełnym szyfrowaniem TLS bez żadnych ostrzeżeń.

### 5. Wyłączenie HTTPS (powrót do trybu HTTP)
Aby wyłączyć tryb HTTPS i powrócić do standardowego działania po HTTP na porcie 3000:
1. Usuń linię `COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml` z pliku `.env` (lub zakomentuj ją znakiem `#`).
2. Wykonaj zatrzymanie i ponowne uruchomienie:
```bash
docker compose down
docker compose up -d --build
```

### 6. Diagnostyka
Jeśli po uruchomieniu trybu HTTPS adres `https://<APP_HOST>` nie odpowiada lub zgłasza błąd TLS, sprawdź logi serwera Caddy oraz handshake TLS:
```bash
docker compose logs caddy --tail 40
openssl s_client -connect <APP_HOST>:443 -servername <APP_HOST>
```

- **Połączenia po adresie IP (`default_sni`):** Klienci TLS (np. `curl` lub przeglądarki) łączący się bezpośrednio po adresie IP zazwyczaj nie wysyłają rozszerzenia SNI. Dyrektywa `default_sni {$APP_HOST}` w pliku `Caddyfile` wskazuje serwerowi Caddy domyślny host i certyfikat do użycia w takich połączeniach.
- **Zalecenie dla sieci lokalnej:** W razie problemów z obsługą TLS dla surowego adresu IP użyj lokalnej nazwy hosta (np. `APP_HOST=projekty.lan` skonfigurowanej w lokalnym DNS routera lub w `/etc/hosts` na stanowiskach pracy) zamiast adresu IP.
- **Ostrzeżenie dotyczące `git stash`:** Lokalnych zmian w pliku `Caddyfile` nie odkładaj przez `git stash`, ponieważ przywróci to plik do wersji z repozytorium.

---

## 🚀 Główne moduły i możliwości

1. **Interaktywny Harmonogram Gantta dla Budownictwa:**
   - Wizualizacja osi czasu z podziałem na dni, tygodnie i miesiące.
   - Pakiety robocze (WBS), kamienie milowe, zadania projektowe i uzgodnienia.
   - Automatyczne rozwiązywanie blokad i kaskadowe przeliczanie terminów (*Finish-to-Start*).
   - Oznaczenie zablokowanych terminów (szrafura ukośna 45° bez przekreślania treści).

2. **Terminy Urzędowe & Ostrzeżenia Formalno-Prawne:**
   - Dedykowany status terminu urzędowego (PnB, ZUD, WZ, Środowiskowe, Ochrona Zabytków).
   - Inteligentne, pulsujące ostrzeżenie aktywowane na **3 dni robocze** przed upływem terminu (z pominięciem sobót, niedziel i polskich świąt ustawowych).

3. **Szablony Projektów Budowlanych (Katalog Administratora):**
   - Gotowe szablony: *Budynek Użyteczności Publicznej (PZT, PAB, PT, PW)*, *Osiedle Mieszkaniowe*, *Hala Przemysłowa / Magazynowa*, *Przebudowa i Termomodernizacja*.
   - Generator nowych szablonów z istniejących projektów pracowni lub od podstaw.
   - Automatyczny schemat numeracji projektów przypisanych do firm: **RRRR-X_L** (np. `2026-1_A`, `2026-2_B`, oraz starszy **ROK-NR**) z walidacją dostępności i możliwością ręcznej edycji.

4. **Dwukierunkowa Integracja z Kalendarzem Google (RFC 5545):**
   - Kanał subskrypcji iCal (`/api/calendar/all.ics` oraz `/api/calendar/user/:id.ics`).
   - Bezpośredni eksport plików `.ics` oraz automatyczne odświeżanie zadań w smartfonie i programach Outlook / Google Calendar.

5. **Tablica Kanban & Terminarz Miesięczny:**
   - Pełna synchronizacja stanów zadań (Do zrobienia, W toku, Do weryfikacji, Zablokowane).
   - **Wyróżnik "Ukończone":** zakończone zadania są automatycznie filtrowane z aktywnego widoku roboczego i przenoszone do dedykowanego wyróżnika z możliwością łatwego przywrócenia.

6. **Finanse, Zamawiający & Kosztorys Projektu:**
   - **Dane Zamawiającego (Inwestora):** NIP, osoba kontaktowa, telefon, e-mail, adres inwestycji.
   - **Ramy czasowe i terminy:** data rozpoczęcia, zakończenia, kalkulacja dni roboczych/kalendarzowych.
   - **Wyceny z listą pozycji:** rejestr składowych oferty dla Inwestora (stawki VAT, netto, brutto, statusy).
   - **Koszty projektu i zadań:** przyporządkowanie wydatków branżowych:
     - 🗺️ Mapa do celów projektowych (MDCP, geodezja)
     - 🧪 Badania geotechniczne i geologia gruntu
     - 📋 Uzgodnienia formalne (ZUD, PPOŻ, Sanepid, Wody Polskie, Konserwator)
     - 🏗️ Podwykonawcy branżowi (Konstrukcja, HVAC, Elektryka, Drogi)
     - 🏛️ Opłaty urzędowe i skarbowe
   - **Kalkulator rentowności:** automatyczne wyliczanie zysku netto pracowni i procentowej marży.

7. **Ciemny motyw & Personalizacja:**
   - Możliwość wyboru motywu: Jasny, Ciemny (Dark Mode) lub automatyczny zgodny z systemem operacyjnym.

8. **Uwierzytelnianie, 2FA & Zaufane Urządzenia:**
   - Wymóg podania hasła przy logowaniu, weryfikacja dwuskładnikowa 2FA (TOTP + kody zapasowe) oraz opcjonalne **Zaufane urządzenia („Ufaj temu urządzeniu”)** z rotowanym tokenem `HttpOnly` i wykrywaniem kradzieży tokena.
   - Pełna możliwość zarządzania zespołem, sesjami oraz usuwania niepotrzebnych lub pokazowych użytkowników i tematów demo.

9. **Centrum Ustawień (Symbol zębatki ⚙️), Monitoring Dysku & Archiwizacja:**
   - Zintegrowane menu ustawień z podglądem wdrożenia Docker, konfiguracją SMTP, zmianą hasła, sprawdzaniem aktualizacji i zalecanym sprzątaniem po aktualizacji (`docker image prune` / `docker builder prune`).
   - **Monitorowanie miejsca na dysku:** podgląd zajętości katalogu danych w *Ustawienia → Dostęp i sesje*, alerty e-mail administratora, banner ostrzegawczy przy niskim poziomie miejsca i obsługa błędu `ENOSPC` kodem `507`.
   - **Inteligentny symbol archiwizacji:**
     - 🟢 **Zielony** – gdy automatyczne kopie zapasowe są aktywne i prawidłowo skonfigurowane.
     - 🔴 **Czerwony mrugający** – natychmiastowe ostrzeżenie, gdy archiwizacja nie jest skonfigurowana.

10. **Powiadomienia E-mail, Podsumowanie Tygodniowe & Ikona Aplikacji (PWA):**
   - Dzienne przypomnienia e-mail o zbliżających się i zaległych terminach oraz **Cotygodniowe podsumowanie dla kierowników projektów** konfigurowane w *Ustawienia → Powiadomienia*.
   - Dedykowana ikona SVG/PNG pracowni projektowej (`favicon.svg`) z obsługą motywu jasnego i ciemnego oraz manifest aplikacji (`manifest.webmanifest`).

11. **Centrum Archiwizacji & Automatyczne Kopie Zapasowe (Auto-Backup):**
   - **Harmonogram automatyczny:** wbudowany automat wykonujący cykliczne migawki stanu (co 15 min, 1 godz., 6 godz. lub codziennie).
   - **Rotacja i retencja:** bezpieczne przechowywanie określonej liczby ostatnich kopii (np. 10 ostatnich) i usuwanie najstarszych.
   - **Jedno-klikowe przywracanie:** natychmiastowe odtworzenie całego stanu projektów z wybranej migawki.
   - **Zadanie Linux Cron na serwerze:** automatyczna kopia stanu aplikacji do `/opt/zarzadzanie-projektami/backups/app_state_*.json.gz` codziennie o 02:00.
   - **Wskaźnik stanu kopii w aplikacji:** wskaźnik "Kopia: Aktywna" w prawym górnym rogu jest zielony, gdy serwer posiada kopię zapasową nie starszą niż 36 godzin.
   - **Eksport do Google Drive & SFTP:** bezpieczna archiwizacja w chmurze lub na zewnętrznym serwerze backupowym.

---

## 🛡️ Trwałość danych przy aktualizacjach Docker

> **Pytanie: Czy po aktualizacji kontenerów Docker dane projektów pozostaną?**  
> **Odpowiedź: TAK, w 100%!**

Stan bazy projektów zapisywany jest atomowo w pliku `app_state.json` w dedykowanym, trwałym wolumenie Docker:
```yaml
volumes:
  zarzadzanie_app_data:
    driver: local
```
Katalog danych `/app/data` jest montowany bezpośrednio w kontenerze `zarzadzanie_app`. Podczas aktualizacji Docker wymienia jedynie obraz kodu aplikacji, a wolumen `zarzadzanie_app_data` z plikiem bazy `app_state.json` pozostaje **nienaruszony**.

### Sprawdzenie CI przed wdrożeniem:

Przed wykonaniem aktualizacji na serwerze produkcyjnym sprawdź, czy ostatni commit na gałęzi `main` ma **zielony status potoku CI na GitHubie** (sprawdź odznakę CI u góry tego dokumentu lub przejdź do [GitHub Actions](https://github.com/FraczekMarcin/Zarzadzanie-Projektami/actions/workflows/ci.yml)). Potok GitHub Actions automatycznie kompiluje kod, wykonuje testy jednostkowe, audyt bezpieczeństwa oraz test dymny obrazu Docker (w tym sprawdzenie statusu 200 i `{"status":"ok"}` na `/api/health` oraz ochronę kodu serwera przed wyciekiem), dzięki czemu masz pewność, że nie wdrożysz uszkodzonego obrazu.

### Bezpieczna procedura aktualizacji do najnowszej wersji:

Pojedyncze, bezpieczne polecenie aktualizacji z automatyczną kopią zapasową (działa identycznie w trybie HTTP i HTTPS, ponieważ przy włączonym HTTPS zmienna `COMPOSE_FILE` jest zdefiniowana w pliku `.env`):
```bash
cd /opt/zarzadzanie-projektami && /bin/bash backup.sh && git pull origin main && docker compose up -d --build
```

⚠️ **Ważne ostrzeżenie:** Nigdy nie uruchamiaj polecenia `docker compose down -v` (flaga `-v` usuwa wolumeny). Do standardowego zatrzymania używaj zawsze samego `docker compose down`.

### Sprzątanie po udanej aktualizacji:

Po potwierdzeniu, że zaktualizowana aplikacja działa poprawnie, warto usunąć nieużywane starsze obrazy Dockera oraz stary cache budowania (wolumen z danymi `zarzadzanie_app_data` pozostaje nienaruszony):
```bash
docker image prune -f
# Opcjonalnie — usuwa cache budowania starszy niż 72 godziny:
docker builder prune -f --filter until=72h
```

---

## 🔄 Przywracanie stanu z kopii zapasowej krok po kroku

W razie potrzeby odtworzenia stanu pracowni z archiwalnej kopii:

1. **Sprawdź dostępne kopie zapasowe:**
   ```bash
   ls -lh /opt/zarzadzanie-projektami/backups/
   ```
   Kopie zapisywane są w formacie `app_state_YYYY-MM-DD_HHMMSS.json.gz`.

2. **Rozpakuj wybraną kopię do pliku tymczasowego:**
   ```bash
   gzip -dc /opt/zarzadzanie-projektami/backups/app_state_2026-11-02_020000.json.gz > /tmp/restore_state.json
   ```

3. **Zweryfikuj integralność pliku JSON (upewnij się, że plik nie jest uszkodzony):**
   ```bash
   jq empty /tmp/restore_state.json
   ```
   *(Brak błędów oznacza, że plik JSON jest w 100% poprawny)*.

4. **Wgraj plik stanu do działającego kontenera aplikacji:**
   ```bash
   docker cp /tmp/restore_state.json zarzadzanie_app:/app/data/app_state.json
   ```

5. **Zrestartuj kontener aplikacji, aby wczytać odtworzony stan:**
   ```bash
   cd /opt/zarzadzanie-projektami
   docker compose restart app
   ```

6. **Usuń rozpakowany plik tymczasowy:**
   ```bash
   rm -f /tmp/restore_state.json
   ```

---

## 🔒 Szyfrowanie kopii

Skrypt `backup.sh` obsługuje opcjonalne szyfrowanie archiwów kopii zapasowych algorytmem **AES-256-CBC (PBKDF2, 600 000 iteracji, salt)** za pomocą zmiennej środowiskowej `BACKUP_PASSPHRASE_FILE` wskazującej plik z hasłem (uprawnienia `600`, np. `/opt/zarzadzanie-projektami/backup.key`):

```bash
BACKUP_PASSPHRASE_FILE=/opt/zarzadzanie-projektami/backup.key /opt/zarzadzanie-projektami/backup.sh
```

- Po poprawnym spakowaniu i weryfikacji `gzip` tworzony jest zaszyfrowany plik `app_state_<data>.json.gz.enc` (uprawnienia `600`), a niezaszyfrowane archiwum `.json.gz` jest automatycznie usuwane.
- Rotacja kopii (`MIN_KEEP`, `RETENTION_DAYS`) obsługuje równolegle oba formaty (`.json.gz` oraz `.json.gz.enc`).
- Ręczne odszyfrowanie kopii przed przywracaniem:
  ```bash
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:/opt/zarzadzanie-projektami/backup.key \
    -in /opt/zarzadzanie-projektami/backups/app_state_2026-11-13_020000.json.gz.enc \
    | gunzip > /tmp/restore_state.json
  ```

> ⚠️ **ZASADA BEZPIECZEŃSTWA:** **Hasło do kopii (`backup.key`) oraz `APP_SECRET` z pliku `.env` zapisz poza serwerem** (w bezpiecznym menedżerze haseł, np. Bitwarden, 1Password, KeePass). Ani `.env`, ani `backup.key` nigdy nie są dołączane do kopii zapasowych ani repozytorium. Bez hasła do kopii nie odszyfrujesz pliku `.enc`, a bez `APP_SECRET` nie odtworzysz sekretów 2FA użytkowników.

---

## 🌐 Kopia poza serwerem

Aby zabezpieczyć dane przed awarią dysku lub całego serwera, `backup.sh` może automatycznie kopiować nową kopię (lokalnie zachowując jej oryginał i wykonując rotację) do dodatkowej lokalizacji:

- **Lokalny udział / zamontowany NAS (`BACKUP_COPY_DIR`):**
  ```bash
  BACKUP_COPY_DIR=/mnt/nas/zp-backups /opt/zarzadzanie-projektami/backup.sh
  ```
- **Zdalny serwer przez SSH (`BACKUP_REMOTE`, tryb nieinteraktywny `BatchMode=yes` z uwierzytelnianiem kluczem SSH):**
  ```bash
  BACKUP_REMOTE=backup@nas.firma.local:/srv/backups/zp/ /opt/zarzadzanie-projektami/backup.sh
  ```

W razie błędu kopiowania poza serwerem kopia lokalna **nie jest usuwana** — skrypt wypisuje ostrzeżenie i zwraca kod wyjścia **`2`**.

---

## 🧪 Test przywracania

Skrypt `restore-test.sh` automatycznie weryfikuje, czy kopia zapasowa rzeczywiście uruchamia aplikację i poprawnie odszyfrowuje sekrety 2FA:

1. Pobiera najnowszą kopię z `BACKUP_DIR` (lub plik wskazany w argumencie: `/bin/bash /opt/zarzadzanie-projektami/restore-test.sh /ścieżka/do/kopii`).
2. Jeśli kopia ma rozszerzenie `.enc`, odszyfrowuje ją z użyciem `BACKUP_PASSPHRASE_FILE`.
3. Rozpakowuje archiwum, sprawdza poprawność JSON (`jq` lub `node`), wgrywa `app_state.json` do tymczasowego wolumenu Dockera i uruchamia izolowany kontener bez publikowania portów (z `APP_SECRET` z `.env`).
4. Sprawdza endpoint `/api/health`, brak błędów odszyfrowania sekretów oraz odczytuje z logów liczbę zadań i użytkowników, a następnie zawsze usuwa tymczasowy kontener i wolumen.

Ręczne uruchomienie testu:
```bash
# Kopia niezaszyfrowana:
/opt/zarzadzanie-projektami/restore-test.sh

# Kopia zaszyfrowana:
BACKUP_PASSPHRASE_FILE=/opt/zarzadzanie-projektami/backup.key /opt/zarzadzanie-projektami/restore-test.sh
```

Zaleca się uruchamianie `restore-test.sh` automatycznie **raz w miesiącu z crona** (np. w `/etc/cron.d/zarzadzanie-projektami-restore-test`, 1. dnia każdego miesiąca o 04:00):
```cron
# Comiesięczny test przywracania kopii zapasowej (1. dnia miesiąca o 04:00)
0 4 1 * * root BACKUP_PASSPHRASE_FILE=/opt/zarzadzanie-projektami/backup.key /opt/zarzadzanie-projektami/restore-test.sh >> /var/log/zp-restore-test.log 2>&1
```
*(Jeśli szyfrowanie kopii nie jest używane, pomiń zmienną `BACKUP_PASSPHRASE_FILE=...` w powyższym wpisie.)*

---

## 🔐 APP_SECRET – zapisz poza serwerem

System szyfruje sekrety uwierzytelniania dwuskładnikowego (2FA) oraz kody zapasowe w pliku `app_state.json` za pomocą klucza `APP_SECRET` (algorytmem AES-256-GCM / HMAC-SHA256).

> ⚠️ **KRYTYCZNA UWAGA DOTYCZĄCA BEZPIECZEŃSTWA:**  
> Bez dokładnego klucza `APP_SECRET` z pliku `.env` serwer nie będzie w stanie odszyfrować sekretów 2FA, a użytkownicy z włączonym 2FA nie będą mogli się zalogować! Ze względów bezpieczeństwa plik `.env` **nie trafia do automatycznych kopii zapasowych** `backup.sh`.  
> **Natychmiast po instalacji skopiuj wartość `APP_SECRET` z pliku `.env` i zapisz ją w bezpiecznym menedżerze haseł (np. Bitwarden, 1Password, KeePass).**

### Procedura przywracania stanu na nowym serwerze (Disaster Recovery):
1. **Odtwórz najpierw plik `.env`:** utwórz `/opt/zarzadzanie-projektami/.env` z **tą samą wartością `APP_SECRET`**, która była używana na poprzednim serwerze przed awarią:
   ```bash
   APP_SECRET=twoj_oryginalny_klucz_z_menedzera_hasel
   ```
2. **Skopiuj kopię `app_state.json`** do katalogu danych wolumenu.
3. **Uruchom aplikację:** kontener pomyślnie odszyfruje wszystkie dane użytkowników i przywróci dostęp do 2FA.
4. **Awaryjne przywracanie przy utracie klucza (`RESET_2FA_ON_START=true`):**  
   Jeśli stary `APP_SECRET` został bezpowrotnie utracony, serwer produkcyjny celowo odmówi startu z czytelnym komunikatem o niezgodności klucza. Aby odzyskać dostęp do systemu:
   - Dodaj do `.env` zmienną: `RESET_2FA_ON_START=true`
   - Zrestartuj kontener: `docker compose up -d`
   - Serwer wyczyści konfigurację 2FA dla kont z nieczytelnymi sekretami (użytkownicy zalogują się samym hasłem i będą mogli ponownie włączyć 2FA).
   - Po pomyślnym uruchomieniu usuń flagę `RESET_2FA_ON_START` z pliku `.env`.

---

## ⏱️ Zarządzanie sesjami i wygasanie po bezczynności

System chroni aktywne sesje użytkowników z wykorzystaniem podwójnego limitu czasowego:
- **Wygasanie po bezczynności (`SESSION_IDLE_MINUTES`):** Domyślnie **120 minut** (2 godziny). Każde uwierzytelnione żądanie odświeża znacznik `lastSeenAt` (zoptymalizowane z ograniczeniem częstotliwości zapisu na dysk). Jeśli użytkownik nie wykazuje aktywności dłużej niż ustalony czas, sesja zostaje automatycznie zakończona, a kolejne żądanie zwróci kod `401 Unauthorized`.
- **Maksymalny bezwzględny czas sesji (`SESSION_MAX_HOURS`):** Domyślnie **12 godzin**. Po tym czasie sesja bezwzględnie wygasa i wymaga ponownego zalogowania.

Użytkownicy mogą w zakładce *Ustawienia ➔ Konta Użytkowników & Bezpieczeństwo* przeglądać listę swoich aktywnych sesji (rodzaj urządzenia, adres IP, data utworzenia i ostatniej aktywności) oraz zdalnie wylogować poszczególne urządzenia lub wszystkie inne sesje naraz. Administratorzy mają ponadto możliwość natychmiastowego zakończenia wszystkich sesji wybranego pracownika.

---

## 💾 Magazyn danych

Domyślnie (`STORAGE=json`) stan aplikacji jest przechowywany w pliku JSON (`app_state.json` w katalogu `DATA_DIR`) z atomowym zapisem (`fsync` + `rename`) oraz szyfrowaniem sekretów 2FA. Takie rozwiązanie w zupełności wystarcza do sprawnej pracy dla pracowni obsługujących do kilku tysięcy zadań.

Warstwa utrwalania danych korzysta z abstrakcji `StateStore` (`src/utils/stateStore.ts`), dzięki czemu architektura umożliwia łatwe dodanie w przyszłości innego magazynu danych (np. bazy SQL) poprzez nową implementację tego interfejsu i wybór zmienną środowiskową `STORAGE`.

---

## 📅 Jednokierunkowa synchronizacja z Kalendarzem Google (Service Account)

Aplikacja obsługuje opcjonalną, automatyczną i **jednokierunkową** synchronizację zadań (z projektów niezarchiwizowanych i z pominięciem zadań anulowanych lub bez dat) do wspólnego Kalendarza Google przez konto usługi Google (RS256 JWT + REST API v3, bez zewnętrznych zależności). Gdy zmienne nie są ustawione, funkcja pozostaje wyłączona, a kontener uruchamia się normalnie.

> ⚠️ **Ważne zastrzeżenie (synchronizacja jednokierunkowa):**  
> Synchronizacja działa wyłącznie w kierunku **aplikacja ➔ Kalendarz Google**. Ręczne zmiany dokonane bezpośrednio w Kalendarzu Google na wydarzeniach zarządzanych przez aplikację (`zpManaged=true`) **zostaną nadpisane** podczas kolejnego przebiegu synchronizacji. Wydarzenia utworzone w tym samym kalendarzu poza aplikacją nie są modyfikowane ani usuwane.

### Konfiguracja krok po kroku

1. **Projekt i API w Google Cloud:** w Google Cloud Console utwórz (lub wybierz) projekt i włącz interfejs **Google Calendar API**.
2. **Konto usługi i klucz JSON:** przejdź do *IAM & Admin ➔ Service Accounts*, utwórz konto usługi (np. `zp-calendar-sync`), wygeneruj klucz typu **JSON** i zapisz go bezpiecznie na serwerze:
   ```bash
   mkdir -p /opt/zarzadzanie-projektami/secrets
   chmod 700 /opt/zarzadzanie-projektami/secrets
   # skopiuj pobrany plik jako /opt/zarzadzanie-projektami/secrets/google_sa.json
   chmod 600 /opt/zarzadzanie-projektami/secrets/google_sa.json
   ```
3. **Udostępnienie kalendarza kontu usługi:** w Kalendarzu Google otwórz ustawienia wybranego wspólnego kalendarza (*Ustawienia i udostępnianie*), udostępnij go adresowi e-mail konta usługi (`client_email` z pliku JSON) z uprawnieniem **Wprowadzanie zmian w wydarzeniach** (*Make changes to events*) i skopiuj wartość **Identyfikator kalendarza** (*Calendar ID*).
4. **Konfiguracja `.env` oraz nadpisania Compose:** dopisz do `/opt/zarzadzanie-projektami/.env` (jeśli używasz trybu HTTPS z Caddy, zachowaj w `COMPOSE_FILE` również `docker-compose.https.yml`):
   ```env
   GOOGLE_SERVICE_ACCOUNT_FILE=/run/secrets/google_sa.json
   GOOGLE_CALENDAR_ID=twoj_identyfikator_kalendarza@group.calendar.google.com
   # Wariant HTTPS + Kalendarz Google:
   COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml:docker-compose.google.yml
   # (lub w trybie HTTP bez Caddy: COMPOSE_FILE=docker-compose.yml:docker-compose.google.yml)
   ```
5. **Uruchomienie:** zrestartuj kontener poleceniem `docker compose up -d`. Administrator może sprawdzić status i ręcznie wyzwolić synchronizację w *Ustawienia ➔ Google Calendar ➔ Synchronizacja z Kalendarzem Google* (lub poprzez `GET /api/google-sync/status` i `POST /api/google-sync/run`).

---

## 📂 Struktura katalogu `/opt/zarzadzanie-projektami`

```text
/opt/zarzadzanie-projektami/
├── backups/                   # Zarchiwizowane zrzuty stanu bazy (app_state_*.json.gz / .enc)
├── .env                       # Klucze sesji i konfiguracja środowiska (chmod 600)
├── backup.key                 # Opcjonalny klucz szyfrowania kopii zapasowych (chmod 600, poza repozytorium)
├── backup.sh                  # Skrypt automatycznej kopii zapasowej z walidacją, szyfrowaniem i retencją
├── restore-test.sh            # Skrypt izolowanego testu przywracania kopii zapasowej w Dockerze
├── docker-compose.yml         # Konfiguracja usługi app i trwałego wolumenu zarzadzanie_app_data
├── Dockerfile                 # Wieloetapowy build aplikacji produkcyjnej (Alpine Linux)
├── install.sh                 # Samodzielny instalator 1-poleceniem
└── README.md                  # Dokumentacja techniczna i wdrożeniowa
```

---

## ⏰ Konfiguracja zadania Cron (Auto-Backup)

Instalator automatycznie tworzy wpis w pliku `/etc/cron.d/zarzadzanie-projektami-backup`:
```cron
# Codzienna kopia zapasowa pliku app_state.json o 02:00 w nocy (kompresja gzip, walidacja, retencja min. 7 kopii)
0 2 * * * root /bin/bash /opt/zarzadzanie-projektami/backup.sh >> /var/log/zarzadzanie-backup.log 2>&1
```

Ręczne wykonanie kopii stanu w dowolnym momencie:
```bash
sudo /bin/bash /opt/zarzadzanie-projektami/backup.sh
```

---

## ⚙️ Konfiguracja zmiennych środowiskowych

Wszystkie poniższe zmienne można skonfigurować w pliku `.env` (wzór wdrożeniowy dla Dockera znajduje się w `docker.env.example`; minimalny plik `.env.example` przypomina, że w trybie deweloperskim żadne zmienne nie są wymagane).

| Zmienna | Wartość domyślna | Status | Opis |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | `development` (`production` w Dockerze) | Opcjonalna | Tryb pracy serwera (`development` lub `production`). W trybie produkcyjnym wymusza poprawny `APP_SECRET` i serwuje statyczny build z `dist/public`. |
| `PORT` | `3000` | Opcjonalna | Port TCP, na którym nasłuchuje serwer Express. |
| `HOST` | `::` (z fallbackiem na `0.0.0.0`) | Opcjonalna | Adres sieciowy nasłuchiwania serwera Express (nadpisuje domyślny dual-stack). |
| `DATA_DIR` | `./data` (dev) / `/app/data` (prod) | Opcjonalna | Katalog trwałych plików danych (`app_state.json`, `sessions.json`, `security_log.jsonl`). |
| `STORAGE` | `json` | Opcjonalna | Wybór warstwy utrwalania stanu (`json`). |
| `BACKUP_DIR` | `./backups` / `/opt/zarzadzanie-projektami/backups` | Opcjonalna | Dodatkowy katalog przeszukiwany przez `GET /api/backup/status` w celu wyznaczania statusu kopii w interfejsie. |
| `BACKUP_MAX_AGE_HOURS` | `36` | Opcjonalna | Maksymalny dopuszczalny wiek najnowszej kopii zapasowej (w godzinach) przed oznaczeniem kopii jako nieaktualnej i wysłaniem alertu. |
| `BACKUP_ALERT_EMAILS` | `""` | Opcjonalna | Lista adresów e-mail (rozdzielona przecinkami) do wysyłki alertów o braku świeżej kopii zapasowej i niskim wolnym miejscu na dysku; gdy pusta, używa adresów aktywnych administratorów (wymaga SMTP). |
| `DISK_ALERT_PERCENT` | `10` | Opcjonalna | Próg procentowy wolnego miejsca na dysku (`DATA_DIR`), poniżej którego wysyłane jest powiadomienie e-mail do administratorów. |
| `DISK_ALERT_MIN_MB` | `500` | Opcjonalna | Minimalna ilość wolnego miejsca na dysku w MB, poniżej której wysyłane jest powiadomienie e-mail do administratorów. |
| `APP_SECRET` | losowy klucz w `<DATA_DIR>/.dev_app_secret` (dev); brak w prod | **Wymagana w prod** | Klucz szyfrowania sekretów 2FA i haseł SMTP (AES-256-GCM) oraz hashowania kodów zapasowych (co najmniej 64 znaki hex / 32 bajty entropii). |
| `APP_VERSION` | zawartość pliku `VERSION` | Opcjonalna | Ręczne nadpisanie wersji zgłaszanej przez `/api/health` i `/api/system-info`. |
| `LOG_LEVEL` | `info` | Opcjonalna | Poziom logowania serwera (`debug`, `info`, `warn`, `error`). |
| `LOG_FORMAT` | `text` | Opcjonalna | Format wpisów logu (`text` z prefiksem czasu ISO i poziomu lub `json` – jedna linia JSON na wpis). |
| `TRUST_PROXY` | `false` (`1` w `docker-compose.https.yml`) | Opcjonalna | Zaufanie nagłówkom proxy (`X-Forwarded-Proto`, `X-Forwarded-For`); akceptuje `true`, `false`, liczbę przeskoków lub adres IP. |
| `PUBLIC_BASE_URL` | `""` | Opcjonalna | Publiczny adres bazowy HTTPS używany przy generowaniu linków subskrypcji iCal / Kalendarza Google. |
| `ALLOW_SELF_REGISTRATION` | `true` | Opcjonalna | Czy zezwalać na samodzielne składanie wniosków rejestracyjnych na ekranie logowania (`true`/`false`). Nadpisuje ustawienie w UI. |
| `SETUP_TOKEN` | `""` | Opcjonalna | Jeśli ustawiony, wymaga podania tego samego tokenu przy rejestracji pierwszego administratora (`POST /api/auth/setup-admin`). |
| `RESET_2FA_ON_START` | `false` | Opcjonalna | Awaryjny reset niemożliwych do odszyfrowania sekretów 2FA podczas startu serwera (`true`/`1`). |
| `SESSION_IDLE_MINUTES` | `120` | Opcjonalna | Limit bezczynności sesji użytkownika w minutach (5–1440). Nadpisuje ustawienie w UI. |
| `SESSION_MAX_HOURS` | `12` | Opcjonalna | Maksymalny bezwzględny czas ważności sesji użytkownika w godzinach (1–168). Nadpisuje ustawienie w UI. |
| `TRUSTED_DEVICES_ENABLED` | `true` | Opcjonalna | Włącza opcję „Ufaj temu urządzeniu” przy logowaniu (`true`/`false`). Nadpisuje ustawienie w UI. |
| `TRUSTED_DEVICE_DAYS` | `30` | Opcjonalna | Czas ważności zaufania urządzenia w dniach (1–90). Nadpisuje ustawienie w UI. |
| `TRASH_RETENTION_DAYS` | `30` | Opcjonalna | Liczba dni przechowywania usuniętych zadań i projektów w koszu (1–365). Nadpisuje ustawienie w UI. |
| `SMTP_HOST` | `""` | Opcjonalna | Adres serwera SMTP; jego ustawienie włącza resetowanie hasła przez e-mail i alerty kopii. Nadpisuje ustawienie w UI. |
| `SMTP_PORT` | `587` | Opcjonalna | Port serwera SMTP (`465` domyślnie używa TLS/SMTPS). Nadpisuje ustawienie w UI. |
| `SMTP_ENCRYPTION` | `starttls` (`tls` dla portu `465`) | Opcjonalna | Tryb szyfrowania SMTP (`none`, `starttls`, `tls`). Nadpisuje ustawienie w UI. |
| `SMTP_USER` | `""` | Opcjonalna | Nazwa użytkownika SMTP do uwierzytelniania. Nadpisuje ustawienie w UI. |
| `SMTP_PASS` | `""` | Opcjonalna | Hasło do konta SMTP. Nadpisuje ustawienie w UI. |
| `SMTP_FROM` | `"Zarządzanie Projektami" <noreply@pracownia.pl>` | Opcjonalna | Adres nadawcy w wysyłanych wiadomościach (nazwa + e-mail). Nadpisuje ustawienia w UI. |
| `SMTP_ALLOW_SELF_SIGNED` | `false` | Opcjonalna | Zezwolenie na samopodpisane certyfikaty TLS serwera SMTP (`true`/`false`). Nadpisuje ustawienie w UI. |
| `REMINDERS_ENABLED` | `false` | Opcjonalna | Włącza dzienne przypomnienia e-mail o terminach zadań (`true`/`false`). Nadpisuje ustawienie w UI. |
| `REMINDER_TIMEZONE` | `Europe/Warsaw` | Opcjonalna | Strefa czasowa IANA używana przez harmonogram dziennych przypomnień i podsumowania tygodniowego. Nadpisuje ustawienie w UI. |
| `REMINDER_SEND_HOUR` | `8` | Opcjonalna | Godzina wysyłki przypomnień (0–23) w wybranej strefie czasowej. Nadpisuje ustawienie w UI. |
| `WEEKLY_SUMMARY_ENABLED` | `false` | Opcjonalna | Włącza cotygodniowe podsumowanie e-mail dla kierowników projektów (`true`/`false`). Nadpisuje ustawienie w UI. |
| `WEEKLY_SUMMARY_DAY` | `1` | Opcjonalna | Dzień tygodnia wysyłki podsumowania tygodniowego (`1` = poniedziałek … `7` = niedziela). Nadpisuje ustawienie w UI. |
| `WEEKLY_SUMMARY_TIME` | `08:00` | Opcjonalna | Godzina wysyłki podsumowania tygodniowego w formacie `HH:MM` (`00:00–23:59`). Nadpisuje ustawienie w UI. |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | `""` | Opcjonalna | Ścieżka do pliku klucza JSON konta usługi Google wewnątrz kontenera (np. `/run/secrets/google_sa.json`). |
| `GOOGLE_CALENDAR_ID` | `""` | Opcjonalna | Identyfikator wspólnego Kalendarza Google do jednokierunkowej synchronizacji zadań. |
| `COMPOSE_FILE` | `docker-compose.yml` (gdy nieustawiona) | Opcjonalna (Docker) | Lista plików Docker Compose rozdzielona znakiem `:`. Pominięcie `docker-compose.https.yml` wyłącza Caddy i HTTPS. |
| `APP_HOST` | `""` | Wymagana dla HTTPS | Nazwa hosta lub adres IP serwera używany przez Caddy w `Caddyfile`. |
| `APP_BIND` / `APP_PORT` | `0.0.0.0` / `3000` | Opcjonalna (Docker) | Adres i port hosta mapowane w trybie HTTP (`docker-compose.yml`). |

---

## 🛠️ Ustawienia administratora

Administrator może zarządzać wybranymi parametrami serwera bezpośrednio z poziomu interfejsu aplikacji (**Ustawienia → Poczta (SMTP)**, **Ustawienia → Powiadomienia** oraz **Ustawienia → Dostęp i sesje**), bez konieczności restartowania kontenera. Zapis zmian wymaga podania aktualnego hasła administratora, dane są utrwalane w `app_state.json` (hasło SMTP jest szyfrowane kluczem `APP_SECRET` przy użyciu AES-256-GCM), a obowiązuje zasada pierwszeństwa: **zmienna środowiskowa (`.env`) > wartość zapisana w interfejsie > wartość domyślna**. Pola sterowane zmienną środowiskową są w interfejsie oznaczone jako zablokowane i nie można ich nadpisać przez UI (`409`).

W trybie deweloperskim (`NODE_ENV !== 'production'`) aplikacja uruchamia się bez pliku `.env`, stosując bezpieczne wartości domyślne (`DATA_DIR=./data`, `TRUST_PROXY=false` oraz automatycznie wygenerowany klucz `<DATA_DIR>/.dev_app_secret`). Szablon zmiennych dla wdrożeń produkcyjnych znajduje się w pliku `docker.env.example` (zamiast rozbudowanego `.env.example`).

| Kategoria / parametr | Konfiguracja w UI | Konfiguracja w `.env` | Dlaczego w UI / dlaczego wyłącznie w `.env` |
| :--- | :--- | :--- | :--- |
| Poczta SMTP (`host`, `port`, szyfrowanie, login, hasło, nadawca, `allowSelfSigned`) | Tak (`Poczta (SMTP)`) | Tak (`SMTP_*`, ma pierwszeństwo) | Wygodna konfiguracja i testowanie wysyłki w panelu bez edycji plików na serwerze; hasło szyfrowane `APP_SECRET`. |
| Przypomnienia e-mail (`enabled`, `sendHour`, `timezone`, `daysBefore`, `notifyOverdue`, `appBaseUrl`) | Tak (`Powiadomienia`) | Częściowo (`REMINDERS_ENABLED`, `REMINDER_TIMEZONE`, `REMINDER_SEND_HOUR`, mają pierwszeństwo) | Dzienne zbiorcze przypomnienia o zbliżających się i zaległych terminach (1 wiadomość/osobę dziennie); wyłączalne przez użytkownika w jego koncie. |
| Podsumowanie tygodniowe (`enabled`, `dayOfWeek`, `time`, `windowDays`, `includeAdmins`, `maxItemsPerProject`) | Tak (`Powiadomienia`) | Częściowo (`WEEKLY_SUMMARY_ENABLED`, `WEEKLY_SUMMARY_DAY`, `WEEKLY_SUMMARY_TIME`, mają pierwszeństwo) | Cotygodniowy przegląd zaległych i kończących się zadań per projekt dla kierowników projektów (i opcjonalnie administratorów), dzielący strefę `timezone` i `appBaseUrl`. |
| Samodzielna rejestracja użytkowników | Tak (`Dostęp i sesje`) | Tak (`ALLOW_SELF_REGISTRATION`, ma pierwszeństwo) | Możliwość szybkiego otwierania lub zamykania rejestracji w trakcie działania systemu bez restartu. |
| Limity sesji (`idleMinutes`, `maxHours`) | Tak (`Dostęp i sesje`) | Tak (`SESSION_IDLE_MINUTES`, `SESSION_MAX_HOURS`, mają pierwszeństwo) | Natychmiastowa zmiana polityki wygasania sesji bez przerywania aktywnej pracy zespołu. |
| Zaufane urządzenia (`trustedDevices`) | Tak (`Dostęp i sesje`) | Częściowo (`TRUSTED_DEVICES_ENABLED`, `TRUSTED_DEVICE_DAYS`, mają pierwszeństwo) | Umożliwia ciche odnowienie sesji na zaufanym komputerze (`allowForAdmins` konfigurowalne wyłącznie w UI). |
| Przechowywanie w koszu (`trash.retentionDays`) | Tak (`Dostęp i sesje`) | Tak (`TRASH_RETENTION_DAYS`, ma pierwszeństwo) | Określa liczbę dni (1–365), przez które usunięte zadania i projekty można przywrócić z kosza. |
| Katalog danych (`DATA_DIR`) | Tylko odczyt | Tak (wyłącznie `.env`) | Serwer musi znać lokalizację plików bazy danych przed uruchomieniem i wczytaniem `app_state.json`. |
| Klucz szyfrowania (`APP_SECRET`) | Tylko status (bez wartości) | Tak (wyłącznie `.env` w prod) | Kryptograficzne oddzielenie klucza od bazy danych: wykradzenie samego pliku `app_state.json` nie pozwala odszyfrować sekretów 2FA ani hasła SMTP. |
| Zaufane proxy (`TRUST_PROXY`) | Tylko odczyt (+ ostrzeżenie przy proxy/HTTPS) | Tak (wyłącznie `.env`) | Ustawienie warstwy sieciowej Express i zaufania nagłówkom proxy musi być ustalone przy starcie procesu. |
| Port i tryb (`PORT`, `NODE_ENV`) | Tylko odczyt | Tak (wyłącznie `.env`) | Parametry uruchomienia procesu Node.js oraz mapowania portów kontenera. |

---

## 🗑️ Kosz

Usunięcie zadania (`DELETE /api/tasks/:id`) lub projektu (`DELETE /api/projects/:id`) przenosi element do kosza (`appState.trash`) zamiast natychmiastowego trwałego usunięcia:

- **Kompletność migawki i zależności:** wraz z zadaniem w koszu zapisywane są powiązane komentarze oraz relacje zależności (`parentId`, `blockingTaskIds`, `dependencies`) obowiązujące w momencie usunięcia; projekt trafia do kosza razem ze wszystkimi swoimi zadaniami i komentarzami.
- **Okres przechowywania i limity:** domyślnie elementy pozostają w koszu przez **30 dni** (zakres `1–365` dni, ustawiany zmienną `TRASH_RETENTION_DAYS` lub w *Ustawienia → Dostęp i sesje*), przy limicie maksymalnie **2000** najnowszych wpisów. Wygasłe wpisy są automatycznie usuwane przy starcie serwera i cyklicznie co 6 godzin.
- **Przywracanie i cofanie:** zaraz po usunięciu zadania wyświetlany jest 8-sekundowy toast **Przeniesiono do kosza** z przyciskiem **Cofnij**. Widok **Kosz** w głównej nawigacji umożliwia przeglądanie usuniętych pozycji, przywracanie (`POST /api/trash/:id/restore`), trwałe usuwanie pojedynczych pozycji (`admin`, `project_manager`) oraz opróżnianie całego kosza z potwierdzeniem (`admin`). Zadanie należące do projektu umieszczonego w koszu można przywrócić dopiero po przywróceniu tego projektu.
- **Izolacja stanu:** zawartość `trash` nie jest zwracana w `GET /api/state` ani w odpowiedziach konfliktu `409`, lecz jest zachowywana podczas importu stanu (`POST /api/state`).

---

## 📬 Przypomnienia e-mail

System udostępnia harmonogram dziennych przypomnień e-mail o zbliżających się i zaległych terminach zadań (wymaga skonfigurowanego serwera SMTP w **Ustawienia → Poczta (SMTP)**):

- **Jedna wiadomość zbiorcza dziennie na osobę:** cykliczne zadanie sprawdzane przy starcie serwera i co 10 minut generuje raz dziennie o wybranej godzinie jedną wiadomość HTML dla każdego aktywnego, zatwierdzonego użytkownika z poprawnym adresem e-mail, obejmującą wyłącznie zadania przypisane do niego z projektów niezarchiwizowanych (bez zadań ukończonych/anulowanych).
- **Zakres terminów i bezpieczeństwo treści:** administrator konfiguruje w **Ustawienia → Powiadomienia** włączenie funkcji (`REMINDERS_ENABLED`, domyślnie `false`), godzinę wysyłki (`REMINDER_SEND_HOUR`, `0–23`, domyślnie `8`), strefę czasową IANA (`REMINDER_TIMEZONE`, domyślnie `Europe/Warsaw`), progi wyprzedzenia (`daysBefore` ze zbioru `[0, 1, 2, 3, 7]`, domyślnie `[1, 0]`), zaległe zadania (raz dziennie do **3 dni** po terminie, `notifyOverdue`) oraz bazowy URL w linkach (`appBaseUrl`, domyślnie z `PUBLIC_BASE_URL` lub `https://<APP_HOST>` w trybie HTTPS). Wiadomości nigdy nie zawierają opisów zadań ani danych finansowych, a wszystkie pola są zabezpieczone przed wstrzyknięciem HTML.
- **Podgląd, ręczne uruchomienie i rezygnacja użytkownika:** w panelu **Powiadomienia** dostępny jest status harmonogramu, wysyłka testowego podglądu do samego administratora (limit **3/godz.**) oraz ręczne uruchomienie wysyłki (`run-now`, z opcją wymuszenia ponownej wysyłki tego samego dnia). Każdy zalogowany użytkownik może w oknie swojego konta wyłączyć osobiste dzienne przypomnienia (`PATCH /api/auth/preferences`).

---

## 📊 Podsumowanie tygodniowe

System udostępnia cotygodniowe podsumowanie e-mail dla kierowników projektów (oraz opcjonalnie administratorów), korzystające ze skonfigurowanego serwera SMTP oraz ustawień strefy czasowej IANA (`REMINDER_TIMEZONE`) i bazowego URL (`appBaseUrl`):

- **Harmonogram i nadrabianie okna 24h:** wysyłka realizowana jest raz w tygodniu (`RRR-Www` wg ISO 8601) w wybranym dniu tygodnia (`dayOfWeek` `1–7`, domyślnie poniedziałek) o wskazanej godzinie (`time` `HH:MM`, domyślnie `08:00`) w wybranej strefie czasowej z obsługą zmian czasu DST. W przypadku restartu serwera w ciągu **24 godzin** od zaplanowanego terminu zaległe podsumowanie zostanie automatycznie nadrobione (z deduplikacją na poziomie tygodnia i pojedynczych odbiorców).
- **Zakres projektów i bezpieczeństwo treści:** każda wiadomość obejmuje wszystkie niezarchiwizowane projekty z liczbą zadań otwartych, zaległych (posortowanych od największego opóźnienia wraz z osobą przypisaną) oraz kończących się w oknie `7` lub `14` dni (limit `maxItemsPerProject` `5–50`, domyślnie `15`), bez opisów zadań i bez danych finansowych. Projekty bez zaległych i kończących się zadań trafiają do zwięzłej linii **„Bez uwag: …”**, a raport całkowicie pusty nie jest wysyłany.
- **Konfiguracja i sterowanie:** sekcja **Podsumowanie tygodniowe** w zakładce **Ustawienia → Powiadomienia** prezentuje datę i godzinę najbliższej wysyłki, status ostatniego przebiegu, wysyłkę podglądu wyłącznie do zalogowanego administratora (`POST /api/admin/weekly-summary/preview`, limit **3/godz.**) oraz ręczne uruchomienie (`POST /api/admin/weekly-summary/run-now`, opcjonalnie z flagą `force`). Kierownicy projektów i administratorzy mogą dodatkowo indywidualnie wyłączyć odbiór podsumowania w oknie konta (`PATCH /api/auth/preferences`).

---

## 📱 Zaufane urządzenia („Ufaj temu urządzeniu”)

Opcjonalna funkcja pozwalająca użytkownikowi (domyślnie odznaczona w formularzu logowania, maksymalnie **10** urządzeń na osobę) automatycznie odnowić wygasłą sesję na tym samym komputerze za pomocą `POST /api/auth/device-login`:

- **Osobny token w ciasteczku `HttpOnly` i skrót SHA-256:** przy logowaniu (zawsze po ewentualnej weryfikacji 2FA) serwer generuje losowy, 32-bajtowy token urządzenia zapisywany w ciasteczku `HttpOnly`, `SameSite=Lax` (`zp_device` dla HTTP lub `__Host-zp_device` z flagą `Secure` dla HTTPS). W pliku `app_state.json` zapisywany jest wyłącznie skrót **SHA-256** tokena.
- **Rotacja tokena, okno 60 s i detekcja kradzieży:** każde udane użycie `POST /api/auth/device-login` rotuje token na nowy i przedłuża ważność urządzenia. Poprzedni token jest honorowany jeszcze przez **60 sekund** na wypadek równoległych kart przeglądarki; ponowne użycie przeterminowanego starego tokena po tym oknie oznacza podejrzenie kradzieży i natychmiast unieważnia **wszystkie zaufane urządzenia oraz wszystkie aktywne sesje** użytkownika (`device_token_reuse`).
- **Zakres ochrony i operacje wrażliwe:** zaufane urządzenie omija wyłącznie ponowne logowanie po wygaśnięciu sesji (po ręcznym wylogowaniu wyłączone aż do kolejnego logowania). Zmiana hasła, konfiguracja 2FA oraz zapis ustawień administratora nadal zawsze wymagają podania aktualnego hasła; dodatkowo zmiana hasła, reset 2FA czy unieważnienie wszystkich sesji przez administratora cofają wszystkie zaufane urządzenia użytkownika (a wyłączenie funkcji w **Ustawienia → Dostęp i sesje** cofa wszystkie urządzenia globalnie).

---

## 💰 Finanse projektu

Okno finansów projektu (`ProjectFinancialsModal`) zapewnia spójną księgowość na poziomie **0,01 zł** (arytmetyka całkowitoliczbowa w groszach w `src/utils/money.ts` i `src/utils/finance.ts`):

- **Precyzja kwot i brak narzucanych domyślnych wartości:** pola kwot akceptują separator dziesiętny `,` lub `.` z walidacją do dwóch miejsc po przecinku (ilości w wycenach do trzech miejsc po przecinku), formatowaniem po opuszczeniu pola i wyrównaniem do prawej; pola nowej wyceny, kosztu i transzy startują puste bez proponowanych kwot.
- **Edycja pozycji i przenoszenie wycen do kosztów:** każda pozycja wyceny, kosztu i transzy obsługuje edycję w wierszu oraz usuwanie z potwierdzeniem. Zaakceptowaną wycenę kosztową można jednym kliknięciem przenieść do kosztów projektu (`linkedCostId`), co automatycznie zapobiega podwójnemu liczeniu tej samej kwoty w sumie kosztów i bilansie.
- **Uprawnienia i właściciel projektu (`ownerId`):** podgląd i edycja danych finansowych oraz zamawiającego są egzekwowane po stronie serwera i w interfejsie (`canViewFinance` / `canEditFinance`): administrator ma pełny dostęp, kierownik projektu edytuje finanse własnych projektów (dla cudzych widzi tryb tylko do odczytu), a pozostali użytkownicy widzą finanse wyłącznie jako właściciele projektu w trybie tylko do odczytu.
- **Transze płatności i terminy płatności:** harmonogram płatności (nazwa transzy, kwota netto/brutto, termin płatności, status opłacenia) wylicza kwotę zapłaconą, pozostałą do zapłaty, ostrzega przy przekroczeniu wartości projektu oraz wyróżnia przeterminowane płatności.
- **Zmienne systemowe na serwerze:** stawki VAT, baza zamawiających (filtrowana serwerowo dla ról bez uprawnień finansowych), typy zadań oraz próg ostrzeżeń o terminach są zapisywane w `app_state.json` (`PUT /api/admin/variables`) i synchronizowane między stanowiskami.

---

## 🏢 Firmy i numeracja projektów

System obsługuje podział projektów na firmy prowadzące w pracowni oraz spójną numerację **`RRRR-X_L`**:

- **Rejestr firm po stronie serwera:** administrator zarządza firmami w **Ustawienia → Firmy** (`/api/companies`, maksymalnie **26** firm z unikalną wielką literą `A–Z`, nazwą, opcjonalnym NIP-em, adresem i flagą aktywności). Nazwa i litera firmy są widoczne dla wszystkich zalogowanych użytkowników, natomiast NIP i adres wyłącznie dla ról `admin` i `project_manager`. Firmy posiadającej przypisane projekty nie można usunąć (`409`) ani zmienić jej litery — zamiast tego można ją dezaktywować (`isActive = false`).
- **Numeracja projektów `RRRR-X_L`:** podczas tworzenia projektu wybierana jest aktywna firma prowadząca, a serwer synchronicznie nadaje kolejny numer w formacie `RRRR-X_L` (np. `2026-1_A`, `2026-12_B`), uwzględniając projekty aktywne, zarchiwizowane oraz przeniesione do kosza. Administrator może wybrać w **Ustawienia → Firmy** tryb numeracji wspólnej dla roku (`year`, domyślnie) lub osobnej dla każdej litery firmy (`company`) oraz ustawić firmę domyślną; `admin` i `project_manager` mogą również wpisać własny numer z walidacją kolizji.

---

## 📈 Ekonomia

Zakładka **Ekonomia** w głównej nawigacji (`?view=economy`, ładowana leniwie) agreguje sytuację finansową projektów z podziałem na firmy:

- **Kontrola dostępu:** pozycja menu jest widoczna dla `admin`, `project_manager` oraz właścicieli projektów mających prawo `canViewFinance` do co najmniej jednego projektu; zestawienie obejmuje wyłącznie projekty dostępne finansowo dla zalogowanego użytkownika.
- **Filtry, firmy i przełącznik netto/brutto:** zakładki firm (`Wszystkie`, aktywne firmy `L - Nazwa`, `Bez firmy`), filtry roku, statusu projektu i archiwum, wyszukiwanie po numerze i nazwie oraz przełącznik kwot **Netto / Brutto** zapamiętywany w `localStorage` pod kluczem `oph_pref_economy_amounts`.
- **Zestawienie, szczegóły i harmonogram płatności:** sortowalna tabela z bilansem, oczekiwanymi wpływami i wydatkami oraz najbliższym terminem płatności (wraz z wierszem sum i eksportem CSV). Kliknięcie wiersza otwiera panel szczegółów finansowych projektu oraz umożliwia zaplanowanie terminu płatności jako zadania w harmonogramie Gantta.

---

## 📋 Widok projektów

Zakładka **Projekty** obsługuje dwa tryby prezentacji wybierane przełącznikiem **Kafelki / Lista** obok filtrów:

- **Zapamiętywanie preferencji:** domyślnie aktywny jest widok **Kafelki**, a wybrany tryb jest zapisywany w `localStorage` pod kluczem `oph_pref_projects_view` (`'tiles'` lub `'list'`) i zachowywany także po wylogowaniu.
- **Widok listy (`Lista`):** sortowalna tabela (`Numer`, `Nazwa`, `Firma`, `Zamawiający` widoczny wyłącznie dla uprawnionych, `Status`, `Priorytet`, `Termin`, `Postęp`, `Zadania` otwarte i zaległe, `Właściciel`, `Akcje` ze wspólnym komponentem uprawnień), obsługiwana z klawiatury i przewijana poziomo poniżej szerokości `640 px`.

---

## 📋 Logi i diagnostyka kontenerów Docker

Usługi kontenerowe posiadają włączoną rotację logów (`driver: json-file`, `max-size: 10m`, `max-file: 3`), co zabezpiecza serwer przed wyczerpaniem miejsca na dysku. Serwer aplikacji loguje zdarzenia ustrukturyzowanym loggerem (`src/server/logger.ts`) z prefiksem czasu ISO i poziomu (lub jedną linią JSON przy `LOG_FORMAT=json`), bez zapisywania adresów e-mail, imion i nazwisk użytkowników oraz bez nagłówków lub ciasteczek.

Podgląd logów na żywo na serwerze produkcyjnym:
```bash
docker compose logs --tail 100 -f
```

---

## 💽 Zajętość dysku

System monitoruje wolne miejsce w katalogu danych `DATA_DIR` (2 minuty po starcie i cyklicznie co 6 godzin):
- **Ostrzeżenia w panelu administratora:** wskaźnik stanu dysku i czasu pracy serwera jest widoczny w **Ustawienia → Dostęp i sesje** (`GET /api/admin/system`), a przy poziomie poniżej **15%** (`warn`) lub poniżej **5% / 200 MB** (`critical`) na górnym pasku pojawia się czerwona plakietka **Mało miejsca na dysku serwera**.
- **Alerty e-mail i dziennik bezpieczeństwa:** gdy wolne miejsce spadnie poniżej `DISK_ALERT_PERCENT` (domyślnie `10%`) lub `DISK_ALERT_MIN_MB` (domyślnie `500 MB`), serwer zapisuje zdarzenie `disk_low` i (gdy skonfigurowano SMTP) wysyła powiadomienie e-mail do adresatów z `BACKUP_ALERT_EMAILS` lub aktywnych administratorów (maksymalnie raz na 24 godziny) oraz pojedyncze powiadomienie o powrocie do normy (`disk_recovered`).
- **Ochrona przed przepełnieniem zapisu:** w przypadku błędu braku miejsca (`ENOSPC`) podczas zapisu pliku `app_state.json`, serwer zwraca kod HTTP `507` z czytelnym komunikatem dla użytkownika i rejestruje zdarzenie `disk_write_failed` (nie częściej niż raz na 10 minut), nie przerywając działania aplikacji.

Polecenia diagnostyczne i bezpieczne zwalnianie miejsca na serwerze Linux:
```bash
# Sprawdzenie wolnego miejsca w systemie plików:
df -h /

# Podsumowanie zajętości obrazów, kontenerów, wolumenów i cache Dockera:
docker system df

# Rozmiar katalogu Dockera na hoście:
du -sh /var/lib/docker

# Bezpieczne usunięcie nieużywanych obrazów i cache budowania starszego niż 72h (nie usuwa wolumenu z danymi!):
docker image prune -f
docker builder prune -f --filter until=72h
```

---

## 🛠️ Wdrożenie deweloperskie (Lokalne)

Wymagania: Node.js 24 LTS (`>=24`), npm.

```bash
# 1. Sklonuj repozytorium
git clone https://github.com/FraczekMarcin/Zarzadzanie-Projektami.git
cd Zarzadzanie-Projektami

# 2. Zainstaluj zależności
npm install

# 3. Uruchom serwer developerski
npm run dev
```

---

## 🧪 Testy end-to-end (Playwright)

Testy przeglądarkowe weryfikują pełny interfejs użytkownika uruchomiony na zbudowanym serwerze produkcyjnym (`dist/server.js`) w izolowanym katalogu tymczasowym:

```bash
# 1. Zbuduj aplikację (frontend + backend)
npm run build

# 2. Zainstaluj przeglądarkę Chromium z zależnościami systemowymi (jednorazowo)
npm run e2e:install

# 3. Uruchom testy end-to-end
npm run test:e2e
```

W przypadku niepowodzenia testów raport HTML jest zapisywany w katalogu `playwright-report/`, a ślady wykonania (`trace`) w `test-results/`.

---

## ♿ Testy dostępności

Automatyczny audyt dostępności (`e2e/a11y.spec.ts`) korzysta z `@axe-core/playwright` (`wcag2a`, `wcag2aa`) i skanuje dla zalogowanego administratora wszystkie główne widoki oraz okna dialogowe (ekran logowania, listę zadań, Tablicę Kanban, Harmonogram Gantta, przegląd projektów w widoku kafelków i listy, okno finansów projektu, widok **Ekonomia** wraz ze szczegółami, Kosz, szczegóły zadania, okno zadania, wszystkie 12 zakładek Ustawień w tym **Firmy**, sekcje dysku i podsumowania tygodniowego, zakładkę Zaufane urządzenia w oknie konta oraz okno synchronizacji kalendarza) w trybie **jasnym** i **ciemnym**.

```bash
# Uruchomienie wyłącznie audytu dostępności (wymaga uprzedniego npm run build)
A11Y_STRICT=false npx playwright test e2e/a11y.spec.ts

# Tryb ścisły (test kończy się błędem przy naruszeniach o wpływie serious lub critical)
A11Y_STRICT=true npx playwright test e2e/a11y.spec.ts
```

- **`A11Y_STRICT`** (domyślnie `false` w CI w bieżącym wydaniu): gdy ma wartość `'true'`, testy kończą się błędem dla każdego naruszenia o wpływie `serious` lub `critical`; przy każdej innej wartości naruszenia są jedynie wypisywane w logach i zapisywane w raporcie.
- **Raport JSON (`test-results/a11y-report.json`):** w potoku CI pełna lista naruszeń per widok i motyw jest publikowana jako artefakt `a11y-report` (czas przechowywania: `14` dni).

---

## 👥 Zespół i Wsparcie

* **Autor & Opiekun:** Marcin Frączek
* **E-mail:** `fraczek.marcin@gmail.com`
* **Repozytorium GitHub:** [https://github.com/FraczekMarcin/Zarzadzanie-Projektami](https://github.com/FraczekMarcin/Zarzadzanie-Projektami)
* **Zastosowanie:** Pracownie Architektoniczne, Biura Konstrukcyjne, Nadzory Inwestorskie, Firmy Wykonawcze.
