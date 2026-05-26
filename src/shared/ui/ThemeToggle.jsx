import { Sun, Moon } from 'lucide-react';
import useTheme from '../hooks/useTheme';

const ThemeToggle = ({ className = '' }) => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      onClick={toggleTheme}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className="theme-toggle-track">
        <span className={`theme-toggle-thumb ${isDark ? 'dark' : 'light'}`}>
          {isDark ? <Moon size={14} /> : <Sun size={14} />}
        </span>
      </span>
    </button>
  );
};

export default ThemeToggle;
