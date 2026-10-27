export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'oph_theme_mode';

export function getThemePreference(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
  } catch {}
  return 'system';
}

export function isSystemDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(mode: ThemeMode): boolean {
  if (typeof document === 'undefined') return false;
  const isDark = mode === 'dark' || (mode === 'system' && isSystemDark());
  const root = document.documentElement;
  
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  return isDark;
}

export function setThemePreference(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {}
  applyTheme(mode);
}

export function initThemeListener(onThemeChange?: (isDark: boolean) => void): () => void {
  const currentMode = getThemePreference();
  applyTheme(currentMode);

  if (typeof window === 'undefined') return () => {};

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => {
    if (getThemePreference() === 'system') {
      const isDark = applyTheme('system');
      onThemeChange?.(isDark);
    }
  };

  mediaQuery.addEventListener('change', handleChange);
  return () => mediaQuery.removeEventListener('change', handleChange);
}
