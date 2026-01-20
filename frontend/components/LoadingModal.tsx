import React from 'react';
import { LoadingStep } from '../types';
import { SpinnerIcon, CircleOutlineIcon, CheckCircleIcon } from './icons';

interface LoadingModalProps {
  isOpen: boolean;
  progress: number;
  steps: LoadingStep[];
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

const LoadingModal: React.FC<LoadingModalProps> = ({ isOpen, progress, steps }) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loading-modal-title"
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md animate-fade-in-down border border-gray-200 dark:border-gray-700 p-8">
        <h2 id="loading-modal-title" className="text-2xl font-bold text-center text-[#652D8E] dark:text-purple-300">
          Searching for your trip...
        </h2>
        <p className="text-center text-gray-500 dark:text-gray-400 mt-2">
          This will just take a moment.
        </p>

        <div className="mt-8">
          <div className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-purple-400 to-[#652D8E] dark:from-purple-600 dark:to-purple-400 rounded-full transition-all duration-500 ease-out" 
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <div className="text-right text-sm font-semibold text-[#652D8E] dark:text-purple-300 mt-2">
            {Math.round(progress)}%
          </div>
        </div>

        <ul className="mt-6 space-y-4">
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