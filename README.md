# 🏗️ Zarządzanie Projektami (Pracownia Projektowa / Budownictwo)

[![Wersja](https://img.shields.io/badge/Wersja-2026--10--27%20v%200.3.1-emerald.svg)](https://github.com/FraczekMarcin/Zarzadzanie-Projektami)
[![Docker](https://img.shields.io/badge/Docker-PostgreSQL%2016-blue.svg)](https://www.docker.com/)
[![Licencja](https://img.shields.io/badge/Licencja-MIT-green.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-FraczekMarcin%2FZarzadzanie--Projektami-purple.svg)](https://github.com/FraczekMarcin/Zarzadzanie-Projektami)

Nowoczesny, kompleksowy system zarządzania projektami architektonicznymi, inżynieryjnymi i wykonawczymi. Zbudowany z myślą o pracowniach projektowych, biurach konstrukcyjnych i generalnych wykonawcach.

---

## ⚡ Szybka instalacja (Linux VPS / NAS / Serwer dedykowany)

Wszystkie pliki instalacyjne znajdują się w dedykowanym katalogu **`Instalacja/`**. Skrypt automatycznie sprawdza i instaluje silnik Docker, generuje bezpieczne hasła bazy PostgreSQL, tworzy katalog `/opt/zarzadzanie-projektami`, konfiguruje trwałe wolumeny oraz uruchamia automatyczny harmonogram kopii zapasowych (Cron codziennie o 02:00).

### Wariant 1: Klonowanie Git (100% niezawodne na każdym serwerze)
```bash
git clone https://github.com/FraczekMarcin/Zarzadzanie-Projektami.git
cd Zarzadzanie-Projektami/Instalacja
sudo bash install.sh
```

### Wariant 2: Bezpośrednie pobranie cURL (surowy plik raw z katalogu Instalacja)
```bash
curl -fsSL https://raw.githubusercontent.com/FraczekMarcin/Zarzadzanie-Projektami/main/Instalacja/install.sh | sudo bash
```
*(lub link alternatywny)*:
```bash
curl -fsSL https://github.com/FraczekMarcin/Zarzadzanie-Projektami/raw/main/Instalacja/install.sh | sudo bash
```

> ⚠️ **Ważna uwaga:** Nie używaj adresu z `/blob/` (np. `.../blob/main/install.sh`), ponieważ GitHub pod tym adresem zwraca stronę HTML z interfejsem graficznym, a nie plik wykonywalny, co powoduje błąd `curl: (22) The requested URL returned error: 404`. Prawidłowy adres to `raw.githubusercontent.com/.../Instalacja/install.sh`.

Aplikacja natychmiast uruchomi się w kontenerach Docker i będzie dostępna pod adresem:
👉 **http://adres-twojego-serwera:3000** (lub `http://localhost:3000`)

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
   - **Zadanie Linux Cron na serwerze:** automatyczny zrzut PostgreSQL do `/opt/zarzadzanie-projektami/backups/*.sql.gz` codziennie o 02:00.
   - **Eksport do Google Drive & SFTP:** bezpieczna archiwizacja w chmurze lub na zewnętrznym serwerze backupowym.

---

## 🛡️ Trwałość danych przy aktualizacjach Docker

> **Pytanie: Czy po aktualizacji kontenerów Docker dane projektów pozostaną?**  
> **Odpowiedź: TAK, w 100%!**

Baza danych PostgreSQL zapisywana jest w niezależnym wolumenie Docker:
```yaml
volumes:
  zarzadzanie_postgres_data:
    driver: local
```
Fizyczne pliki bazy danych znajdują się w trwałym katalogu hosta (`/var/lib/docker/volumes/zarzadzanie_postgres_data/_data`). Podczas aktualizacji Docker podmienia jedynie warstwę kodu aplikacji, a wolumen bazy danych pozostaje **nienaruszony**.

### Bezpieczna procedura aktualizacji do najnowszej wersji:
```bash
cd /opt/zarzadzanie-projektami

# 1. Kopia bezpieczeństwa przed aktualizacją (zalecane)
sudo bash backup.sh

# 2. Pobranie najnowszych zmian z repozytorium GitHub
git pull origin main

# 3. Przeładowanie kontenerów (dane bazy zostają zachowane!)
docker compose up -d --build
```

⚠️ **Ważne ostrzeżenie:** Nigdy nie uruchamiaj polecenia `docker compose down -v` (flaga `-v` usuwa wolumeny). Do standardowego zatrzymania używaj zawsze samego `docker compose down`.

---

## 📂 Struktura katalogu `/opt/zarzadzanie-projektami`

```text
/opt/zarzadzanie-projektami/
├── backups/                   # Zarchiwizowane zrzuty bazy danych (*.sql.gz)
├── .env                       # Unikalne hasła PostgreSQL i klucze sesji (chmod 600)
├── backup.sh                  # Skrypt automatycznej kopii zapasowej z retencją 14 dni
├── docker-compose.yml         # Konfiguracja usług: app + PostgreSQL 16 + pgAdmin
├── Dockerfile                 # Wieloetapowy build aplikacji produkcyjnej (Alpine Linux)
├── init.sql                   # Schemat relacyjny bazy danych (tabele, relacje, indeksy)
├── install.sh                 # Samodzielny instalator 1-poleceniem
└── README.md                  # Dokumentacja techniczna i wdrożeniowa
```

---

## ⏰ Konfiguracja zadania Cron (Auto-Backup)

Instalator automatycznie tworzy wpis w pliku `/etc/cron.d/zarzadzanie-projektami-backup`:
```cron
# Codzienny zrzut bazy PostgreSQL o 02:00 w nocy z kompresją gzip i 14-dniową retencją
0 2 * * * root /opt/zarzadzanie-projektami/backup.sh >/dev/null 2>&1
```

Ręczne wykonanie kopii bazy w dowolnym momencie:
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
