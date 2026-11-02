import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
const THEMES: Theme[] = ['system', 'dark', 'light'];

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem('composelens-theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    const preference = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system'
        ? preference.matches ? 'dark' : 'light'
        : theme;
    };
    apply();
    preference.addEventListener('change', apply);
    try { localStorage.setItem('composelens-theme', theme); } catch { /* Storage is optional. */ }
    return () => preference.removeEventListener('change', apply);
  }, [theme]);

  return { theme, cycleTheme: () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]) };
}
