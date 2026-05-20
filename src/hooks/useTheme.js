import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'theme';
const THEMES = ['dark', 'light'];

const getSystemTheme = () =>
  window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

const getStoredTheme = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(stored) ? stored : null;
  } catch {
    return null;
  }
};

const applyTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable */
  }
};

export const useTheme = () => {
  const [theme, setTheme] = useState(() => getStoredTheme() || getSystemTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /* Sync across tabs */
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && THEMES.includes(e.newValue)) {
        setTheme(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme, isDark: theme === 'dark' };
};

export default useTheme;
