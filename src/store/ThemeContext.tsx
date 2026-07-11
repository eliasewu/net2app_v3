import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.setProperty('--bg', '#0f172a');
      root.style.setProperty('--card', '#1e293b');
      root.style.setProperty('--text', '#e2e8f0');
    } else {
      root.classList.remove('dark');
      root.style.setProperty('--bg', '#f8fafc');
      root.style.setProperty('--card', '#ffffff');
      root.style.setProperty('--text', '#1e293b');
    }
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');
  const isDark = theme === 'dark';

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => { const c = useContext(ThemeContext); if (!c) throw new Error('useTheme required'); return c; };
