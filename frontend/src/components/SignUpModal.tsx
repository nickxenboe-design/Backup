import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

type Props = { isOpen: boolean; onClose: () => void; maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' };

export default function SignUpModal({ isOpen, onClose, maxWidth }: Props) {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setEmail('');
      setPassword('');
      setFirstName('');
      setLastName('');
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signUp({ email, password, firstName, lastName });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Sign up failed');
    } finally {
      setSubmitting(false);
    }
  };

  const sizeClass = ({
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
  } as const)[maxWidth || 'md'];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="signup-modal-title">
      <div className={`w-full ${sizeClass} rounded-xl sm:rounded-2xl bg-white dark:bg-gray-900 p-6 sm:p-8 shadow-xl max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700`}>
        <h2 id="signup-modal-title" className="text-xl font-semibold text-gray-900 dark:text-gray-100">Create an account</h2>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => {
              window.location.href = '/api/v1/auth/google/start';
            }}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.2-.9 2.2-1.9 2.9l3.1 2.4c1.8-1.7 2.9-4.1 2.9-7 0-.7-.1-1.4-.2-2H12z" />
              <path fill="#34A853" d="M6.5 14.3 5.4 15.1 2.7 17c1.6 3.1 4.8 5 8.3 5 2.5 0 4.6-.8 6.1-2.3l-3.1-2.4c-.8.5-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7z" />
              <path fill="#4A90E2" d="M2.7 7c-.6 1-.9 2.1-.9 3.3s.3 2.3.9 3.3c0 .1 3.8-3.1 3.8-3.1L6.5 9 2.7 7z" />
              <path fill="#FBBC05" d="M12 4.4c1.4 0 2.6.5 3.5 1.3l2.6-2.6C16.6 1.8 14.5 1 12 1 8.5 1 5.3 2.9 3.7 6l3.8 2.9c.7-2.1 2.7-3.5 4.5-3.5z" />
            </svg>
            Continue with Google
          </button>
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-500 dark:text-gray-400">or</span>
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">First name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e)=>setFirstName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                placeholder="John"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Last name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e)=>setLastName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                placeholder="Doe"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e)=>setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              placeholder="At least 8 characters"
              required
            />
          </div>
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>}
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-[#652D8E] px-4 py-2 font-semibold text-white hover:opacity-90 disabled:opacity-60 dark:bg-purple-600"
            >
              {submitting ? 'Creating account...' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
