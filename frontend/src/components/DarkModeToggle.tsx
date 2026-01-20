import React from 'react';
import { SunIcon, MoonIcon } from './icons';

interface DarkModeToggleProps {
  theme: 'light' | 'dark';
  onToggle: () => void;
}

const DarkModeToggle: React.FC<DarkModeToggleProps> = ({ theme, onToggle }) => {
  return (
    <button
      onClick={onToggle}
      className="p-2 rounded-full text-[#652D8E] bg-gray-200/80 dark:bg-gray-700/80 dark:text-purple-300 hover:bg-gray-300/80 dark:hover:bg-gray-600/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-950 transition-all duration-300"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      title="Toggle theme"
    >
      <div className="relative w-6 h-6 overflow-hidden">
          <SunIcon
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-6 transition-all duration-300 transform ${
                  theme === 'light' ? 'rotate-0 opacity-100 scale-100' : '-rotate-90 opacity-0 scale-50'
              }`}
          />
          <MoonIcon
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-6 transition-all duration-300 transform ${
                  theme === 'dark' ? 'rotate-0 opacity-100 scale-100' : 'rotate-90 opacity-0 scale-50'
              }`}
          />
      </div>
    </button>
  );
};

export default DarkModeToggle;
