# 📦 Katalog Instalacja - Zarządzanie Projektami

**Wersja:** `2026-11-02 v0.4.0`  
**Repozytorium:** [https://github.com/FraczekMarcin/Zarzadzanie-Projektami](https://github.com/FraczekMarcin/Zarzadzanie-Projektami)

Katalog zawiera wszystkie niezbędne pliki wdrożeniowe dla środowiska Docker z trwałym wolumenem danych.

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
* `install.sh` - Automatyczny skrypt instalacyjny (instaluje Docker, generuje klucze, startuje kontener aplikacji)
* `docker-compose.yml` - Orkiestracja kontenera `app` z trwałym wolumenem `zarzadzanie_app_data`
* `Dockerfile` - Multi-stage build obrazu aplikacji produkcyjnej (Alpine Linux)
* `backup.sh` - Skrypt automatycznej kopii zapasowej pliku `app_state.json` (gzip + walidacja + retencja min. 7 kopii)
* `.env.production` - Wzorzec zmiennych środowiskowych
