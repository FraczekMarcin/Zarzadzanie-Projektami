# 🏗️ Zarządzanie Projektami (Pracownia Projektowa / Budownictwo)

[![Wersja](https://img.shields.io/badge/Wersja-2026--11--06%20v%200.5.0-emerald.svg)](https://github.com/FraczekMarcin/Zarzadzanie-Projektami)
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

### 2. Uruchomienie aplikacji z obsługą HTTPS
Podczas instalacji skrypt `install.sh` automatycznie dopisuje do pliku `.env` linię `COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml`. Przy ręcznej konfiguracji dopisz tę linię oraz `TRUST_PROXY=1` do pliku `.env`, a następnie uruchom:
```bash
docker compose up -d --build
```
> **Uwaga dotycząca wersji:** Plik `docker-compose.https.yml` korzysta z dyrektywy `ports: !reset []`, która wymaga Docker Compose w wersji **>= 2.24**. Dzięki wpisowi `COMPOSE_FILE` w `.env` nie trzeba podawać flag `-f` – Docker Compose automatycznie łączy oba pliki konfiguracyjne.
>
> W tym trybie Caddy nasłuchuje na standardowych portach **443** (HTTPS) i **80** (automatyczne przekierowanie do HTTPS). Bezpośredni port aplikacji `3000` jest zresetowany i niedostępny z zewnątrz, a aplikacja działa w trybie `TRUST_PROXY=1`, wymuszając bezpieczne ciasteczka sesyjne (`Secure`, `__Host-zp_session`).

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
   - Automatyczny schemat numeracji projektów: **ROK-NR** (np. `2026-01`, `2026-02`) z walidacją dostępności i możliwością ręcznej edycji.

4. **Dwukierunkowa Integracja z Kalendarzem Google (RFC 5545):**
   - Kanał subskrypcji iCal (`/api/calendar/all.ics` oraz `/api/calendar/user/:id.ics`).
   - Bezpośredni eksport plików `.ics` oraz automatyczne odświeżanie zadań w smartfonie i programach Outlook / Google Calendar.

5. **Tablica Kanban & Terminarz Miesięczny:**
   - Pełna synchronizacja stanów zadań (Do zrobienia, W toku, Do weryfikacji, Zablokowane).
   - **Wyróżnik "Ukończone":** zakończone zadania są automatycznie filtrowane z aktywnego widoku roboczego i przenoszone do dedykowanego wyróżnika z możliwością łatwego przywrócenia.

6. **Finanse, Zamawiający & Kosztorys Projektu (Nowość v 0.3.1):**
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

7. **Ciemny motyw & Personalizacja (Nowość v 0.3.1):**
   - Możliwość wyboru motywu: Jasny, Ciemny (Dark Mode) lub automatyczny zgodny z systemem operacyjnym.

8. **Uwierzytelnianie & Bezpieczeństwo Zespołu (Nowość v 0.3.1):**
   - Wymóg podania hasła przy przełączaniu profilu projektanta (ochrona przed nieautoryzowanym działaniem).
   - Pełna możliwość usuwania niepotrzebnych lub pokazowych użytkowników i tematów demo.

9. **Centrum Ustawień (Symbol zębatki ⚙️) & Wskaźnik Archiwizacji:**
   - Zintegrowane menu ustawień z podglądem wdrożenia Docker, zmianą hasła i sprawdzaniem aktualizacji z GitHub.
   - **Codzienne sprawdzanie aktualizacji:** automatyczna weryfikacja 1x dziennie z repozytorium GitHub.
   - **Inteligentny symbol archiwizacji:**
     - 🟢 **Zielony** – gdy automatyczne kopie zapasowe są aktywne i prawidłowo skonfigurowane.
     - 🔴 **Czerwony mrugający** – natychmiastowe ostrzeżenie, gdy archiwizacja nie jest skonfigurowana.

10. **Centrum Archiwizacji & Automatyczne Kopie Zapasowe (Auto-Backup):**
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

### Bezpieczna procedura aktualizacji do najnowszej wersji:

Pojedyncze, bezpieczne polecenie aktualizacji z automatyczną kopią zapasową (działa identycznie w trybie HTTP i HTTPS, ponieważ przy włączonym HTTPS zmienna `COMPOSE_FILE` jest zdefiniowana w pliku `.env`):
```bash
cd /opt/zarzadzanie-projektami && ./backup.sh && git pull origin main && docker compose up -d --build
```

⚠️ **Ważne ostrzeżenie:** Nigdy nie uruchamiaj polecenia `docker compose down -v` (flaga `-v` usuwa wolumeny). Do standardowego zatrzymania używaj zawsze samego `docker compose down`.

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

## 📂 Struktura katalogu `/opt/zarzadzanie-projektami`

```text
/opt/zarzadzanie-projektami/
├── backups/                   # Zarchiwizowane zrzuty stanu bazy (app_state_*.json.gz)
├── .env                       # Klucze sesji i konfiguracja środowiska (chmod 600)
├── backup.sh                  # Skrypt automatycznej kopii zapasowej z walidacją i retencją
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
0 2 * * * root /opt/zarzadzanie-projektami/backup.sh >/dev/null 2>&1
```

Ręczne wykonanie kopii stanu w dowolnym momencie:
```bash
sudo /opt/zarzadzanie-projektami/backup.sh
```

---

## 🛠️ Wdrożenie deweloperskie (Lokalne)

Wymagania: Node.js 20+, npm lub bun.

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

## 👥 Zespół i Wsparcie

* **Autor & Opiekun:** Marcin Frączek
* **E-mail:** `fraczek.marcin@gmail.com`
* **Repozytorium GitHub:** [https://github.com/FraczekMarcin/Zarzadzanie-Projektami](https://github.com/FraczekMarcin/Zarzadzanie-Projektami)
* **Zastosowanie:** Pracownie Architektoniczne, Biura Konstrukcyjne, Nadzory Inwestorskie, Firmy Wykonawcze.
