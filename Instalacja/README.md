# 📦 Katalog Instalacja - Zarządzanie Projektami

**Wersja:** `2026-10-25 v 0.2.1`  
**Repozytorium:** [https://github.com/FraczekMarcin/Zarzadzanie-Projektami](https://github.com/FraczekMarcin/Zarzadzanie-Projektami)

Katalog zawiera wszystkie niezbędne pliki wdrożeniowe dla środowiska Docker i PostgreSQL 16.

---

## ⚡ Instalacja 1-poleceniem (Terminal Linux)

### Wariant A (Zalecany - z surowego pliku raw):
```bash
curl -fsSL https://raw.githubusercontent.com/FraczekMarcin/Zarzadzanie-Projektami/main/Instalacja/install.sh | sudo bash
```
*(lub przez github.com/raw)*:
```bash
curl -fsSL https://github.com/FraczekMarcin/Zarzadzanie-Projektami/raw/main/Instalacja/install.sh | sudo bash
```

⚠️ **Uwaga:** Nie używaj adresu `.../blob/main/...` w poleceniu curl, ponieważ GitHub pod adresem `/blob/` zwraca stronę HTML, a nie surowy skrypt!

### Wariant B (Git Clone - 100% niezawodny):
```bash
git clone https://github.com/FraczekMarcin/Zarzadzanie-Projektami.git
cd Zarzadzanie-Projektami/Instalacja
sudo bash install.sh
```

---

## 📂 Zawartość katalogu `Instalacja`:
* `install.sh` - Automatyczny skrypt instalacyjny (instaluje Docker, generuje klucze, startuje bazę)
* `docker-compose.yml` - Orkiestracja kontenerów (app + PostgreSQL 16 + pgAdmin 4 + wolumen `zarzadzanie_postgres_data`)
* `Dockerfile` - Multi-stage build obrazu aplikacji produkcyjnej
* `init.sql` - Schemat relacyjny bazy danych (projekty, etapy, zadania, użytkownicy)
* `backup.sh` - Skrypt automatycznej kopii zapasowej (gzip + 14-dniowa retencja)
* `.env.production` - Wzorzec zmiennych środowiskowych
