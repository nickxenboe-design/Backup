import React, { useEffect } from 'react';
import { PriceTagIcon, XIcon } from './icons';

type ToastVariant = 'info' | 'warning';

interface ToastProps {
  isOpen: boolean;
  title: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({
  isOpen,
  title,
  message,
  variant = 'info',
  durationMs = 8000,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    if (!durationMs || durationMs <= 0) return;

    const id = window.setTimeout(() => {
      onClose();
    }, durationMs);

    return () => window.clearTimeout(id);
  }, [isOpen, durationMs, onClose]);

  if (!isOpen) return null;

  const containerClassName =
    variant === 'warning'
      ? 'border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-900/20 dark:text-yellow-100'
      : 'border-purple-200 bg-white text-gray-900 dark:border-purple-900/40 dark:bg-gray-900 dark:text-gray-100';

  const iconCircleClassName =
    variant === 'warning'
      ? 'h-8 w-8 rounded-full bg-yellow-100 dark:bg-yellow-900/40 flex items-center justify-center'
      : 'h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center';

  const iconClassName =
    variant === 'warning'
      ? 'h-4 w-4 text-yellow-700 dark:text-yellow-200'
      : 'h-4 w-4 text-[#652D8E] dark:text-purple-200';

  return (
    <div className="fixed top-4 right-4 z-[65] w-[calc(100vw-2rem)] max-w-sm">
      <div className={`rounded-xl border shadow-xl ${containerClassName} animate-fade-in-down`} role="status" aria-live="polite">
        <div className="p-3">
          <div className="flex items-start gap-3">
            <div className={iconCircleClassName}>
              <PriceTagIcon className={iconClassName} />
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold">{title}</div>
                  <div className="mt-0.5 text-xs text-gray-700 dark:text-gray-300">{message}</div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <XIcon className="h-4 w-4 text-gray-500 dark:text-gray-300" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Toast;
