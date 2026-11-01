/**
 * Moduł weryfikacji i semantycznego porównywania wersji oprogramowania
 * Gwarantuje, że starsze wydania na GitHub nigdy nie zostaną błędnie
 * zaklasyfikowane jako "nowsza aktualizacja".
 */

export function isNewerVersion(remote: string, local: string): boolean {
  if (!remote || !local) return false;
  const cleanRemote = remote.trim();
  const cleanLocal = local.trim();
  if (cleanRemote === cleanLocal) return false;

  // 1. Porównanie daty wydania w formacie YYYY-MM-DD lub YYYY-MM.DD
  const rMatch = cleanRemote.match(/(\d{4})[-.](\d{2})[-.](\d{2})/);
  const lMatch = cleanLocal.match(/(\d{4})[-.](\d{2})[-.](\d{2})/);
  if (rMatch && lMatch) {
    const rDate = parseInt(`${rMatch[1]}${rMatch[2]}${rMatch[3]}`, 10);
    const lDate = parseInt(`${lMatch[1]}${lMatch[2]}${lMatch[3]}`, 10);
    if (rDate > lDate) return true;
    if (rDate < lDate) return false;
  }

  // 2. Porównanie wersji semantycznej vX.Y.Z
  const rSem = cleanRemote.match(/v\s*(\d+)\.(\d+)(?:\.(\d+))?/i);
  const lSem = cleanLocal.match(/v\s*(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (rSem && lSem) {
    const rMaj = parseInt(rSem[1] || '0', 10);
    const rMin = parseInt(rSem[2] || '0', 10);
    const rPat = parseInt(rSem[3] || '0', 10);

    const lMaj = parseInt(lSem[1] || '0', 10);
    const lMin = parseInt(lSem[2] || '0', 10);
    const lPat = parseInt(lSem[3] || '0', 10);

    if (rMaj !== lMaj) return rMaj > lMaj;
    if (rMin !== lMin) return rMin > lMin;
    if (rPat !== lPat) return rPat > lPat;
  }

  // Jeśli brak przewagi numerycznej/daty, to NIE jest nowsza wersja
  return false;
}
