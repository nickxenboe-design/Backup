import React, { useState } from 'react';
import { PriceTagIcon, XIcon } from './icons';

export type ErrorModalType =
  | 'connection'
  | 'timeout'
  | 'validation'
  | 'action_required'
  | 'unavailable'
  | 'auth'
  | 'server'
  | 'not_found'
  | 'unknown';

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  body?: React.ReactNode;
  details?: string;
  variant?: 'error' | 'info';
  errorType?: ErrorModalType;
  showTechnicalDetailsToggle?: boolean;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  closeLabel?: string;
  hideCloseButton?: boolean;
  hideCloseIcon?: boolean;
}

const ErrorModal: React.FC<ErrorModalProps> = ({
  isOpen,
  onClose,
  title,
  message,
  body,
  details,
  variant,
  errorType,
  showTechnicalDetailsToggle,
  primaryActionLabel,
  onPrimaryAction,
  maxWidth,
  closeLabel,
  hideCloseButton,
  hideCloseIcon,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  if (!isOpen) return null;

  const resolvedVariant: 'error' | 'info' = variant || 'error';

  const resolvedErrorType: ErrorModalType | undefined =
    resolvedVariant === 'info' ? undefined : (errorType || 'unknown');

  const badge = (() => {
    if (!resolvedErrorType) return null;
    const spec: Record<ErrorModalType, { label: string; className: string }> = {
      connection: { label: 'Connection', className: 'bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800/50' },
      timeout: { label: 'Taking too long', className: 'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800/50' },
      validation: { label: 'Check details', className: 'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800/50' },
      action_required: { label: 'Action needed', className: 'bg-purple-50 text-purple-900 border border-purple-200 dark:bg-purple-900/30 dark:text-purple-200 dark:border-purple-800/50' },
      unavailable: { label: 'Unavailable', className: 'bg-gray-50 text-gray-800 border border-gray-200 dark:bg-gray-900/40 dark:text-gray-200 dark:border-gray-700' },
      auth: { label: 'Sign in', className: 'bg-purple-50 text-purple-900 border border-purple-200 dark:bg-purple-900/30 dark:text-purple-200 dark:border-purple-800/50' },
      server: { label: 'Service issue', className: 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800/50' },
      not_found: { label: 'Not found', className: 'bg-gray-50 text-gray-800 border border-gray-200 dark:bg-gray-900/40 dark:text-gray-200 dark:border-gray-700' },
      unknown: { label: 'Error', className: 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800/50' },
    };
    return spec[resolvedErrorType] || spec.unknown;
  })();

  const iconCircleClassName =
    resolvedVariant === 'info'
      ? 'h-6 w-6 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center'
      : 'h-6 w-6 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center';

  const titleClassName =
    resolvedVariant === 'info'
      ? 'text-base font-bold text-[#652D8E] dark:text-purple-300'
      : 'text-base font-bold text-red-700 dark:text-red-300';

  const LeadingIcon = resolvedVariant === 'info' ? PriceTagIcon : XIcon;

  const panelBorderClassName =
    resolvedVariant === 'info'
      ? 'border border-purple-200 dark:border-purple-800/40'
      : 'border border-gray-200 dark:border-gray-700';

  const panelTopAccentClassName = resolvedVariant === 'info' ? 'border-t-4 border-t-[#652D8E]' : '';

  const sizeClass = ({
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
  } as const)[maxWidth || 'xl'];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-2 sm:p-3" role="dialog" aria-modal="true" aria-labelledby="error-modal-title">
      <div className={`relative bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl shadow-xl w-full ${sizeClass} max-h-[90vh] overflow-y-auto animate-fade-in-down ${panelBorderClassName} ${panelTopAccentClassName}`}>
        <div className="p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0 mt-0.5 mr-2.5">
              <div className={iconCircleClassName}>
                <LeadingIcon
                  className={
                    resolvedVariant === 'info'
                      ? 'h-4 w-4 text-[#652D8E] dark:text-purple-300'
                      : 'h-4 w-4 text-red-600 dark:text-red-400'
                  }
                />
              </div>
            </div>
            <div className="flex-1">
              {badge && (
                <div className="mb-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>
              )}
              <h2 id="error-modal-title" className={titleClassName}>{title}</h2>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{message}</p>
              {body && <div className="mt-3">{body}</div>}
              {details && showTechnicalDetailsToggle && (
                <div className="mt-3">
                  <button type="button" onClick={() => setShowDetails((v) => !v)} className="text-xs font-semibold text-[#652D8E] hover:underline dark:text-purple-300">
                    {showDetails ? 'Hide technical details' : 'Show technical details'}
                  </button>
                  {showDetails && (
                    <pre className="mt-2 text-[11px] bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 p-2 rounded-md overflow-auto whitespace-pre-wrap border border-gray-200 dark:border-gray-700" aria-live="polite">
                      {details}
                    </pre>
                  )}
                </div>
              )}
            </div>
            {!hideCloseIcon && (
              <button type="button" onClick={onClose} aria-label="Close" className="ml-3 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
                <XIcon className="h-4 w-4 text-gray-500" />
              </button>
            )}
          </div>
        </div>

        <div className="p-4 pt-0 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-3 gap-2">
          {!hideCloseButton && (
            <button type="button" onClick={onClose} className="w-full sm:w-auto text-[#652D8E] border border-[#652D8E] font-semibold py-2 px-4 rounded-md text-xs hover:bg-[#652D8E]/10 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#652D8E] dark:text-purple-300 dark:border-purple-300 dark:hover:bg-purple-300/10 dark:focus:ring-offset-gray-800">
              {closeLabel || 'Close'}
            </button>
          )}
          {primaryActionLabel && onPrimaryAction && (
            <button type="button" onClick={onPrimaryAction} className="w-full sm:w-auto bg-[#652D8E] dark:bg-purple-600 text-white font-semibold py-2 px-4 rounded-md text-xs hover:opacity-90 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#652D8E] dark:focus:ring-offset-gray-800 shadow-md">
              {primaryActionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ErrorModal;
