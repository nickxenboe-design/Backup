import React from 'react';
import { LoadingStep } from '@/types';
import { SpinnerIcon, CircleOutlineIcon, CheckCircleIcon } from './icons';

interface LoadingModalProps {
  isOpen: boolean;
  progress: number;
  steps: LoadingStep[];
  title?: string;
  subtitle?: string;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
}

const getStepIcon = (status: LoadingStep['status']) => {
  switch (status) {
    case 'complete':
      return <CheckCircleIcon className="h-6 w-6 text-green-500" />;
    case 'active':
      return <SpinnerIcon className="h-6 w-6 text-[#652D8E] dark:text-purple-400 animate-spin" />;
    case 'pending':
    default:
      return <CircleOutlineIcon className="h-6 w-6 text-gray-300 dark:text-gray-600" />;
  }
};

const LoadingModal: React.FC<LoadingModalProps> = ({ isOpen, progress, steps, title, subtitle, maxWidth }) => {
  if (!isOpen) return null;

  const sizeClass = ({
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
  } as const)[maxWidth || 'md'];

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loading-modal-title"
    >
      <div className={`bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl shadow-xl w-full ${sizeClass} max-h-[90vh] overflow-y-auto animate-fade-in-down border border-gray-200 dark:border-gray-700 p-4 sm:p-5`}>
        <h2 id="loading-modal-title" className="text-base font-bold text-center text-[#652D8E] dark:text-purple-300">
          {title || 'Searching for your trip...'}
        </h2>
        <p className="text-center text-gray-500 dark:text-gray-400 mt-1 text-xs">
          {subtitle || 'This will just take a moment.'}
        </p>

        <div className="mt-4">
          <div className="relative h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-purple-400 to-[#652D8E] dark:from-purple-600 dark:to-purple-400 rounded-full transition-all duration-500 ease-out" 
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <div className="text-right text-xs font-semibold text-[#652D8E] dark:text-purple-300 mt-1">
            {Math.round(progress)}%
          </div>
        </div>

        <ul className="mt-4 space-y-2.5 text-xs">
          {steps.map((step, index) => (
            <li key={index} className="flex items-center gap-4 transition-opacity duration-300">
              <div className="flex-shrink-0">
                {getStepIcon(step.status)}
              </div>
              <span className={`font-semibold ${
                step.status === 'complete' 
                  ? 'text-gray-800 dark:text-gray-200' 
                  : step.status === 'active' 
                  ? 'text-[#652D8E] dark:text-purple-300' 
                  : 'text-gray-400 dark:text-gray-500'
              }`}>
                {step.title}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default LoadingModal;