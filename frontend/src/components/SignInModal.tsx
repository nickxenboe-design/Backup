import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

type Props = { isOpen: boolean; onClose: () => void; maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' };

export default function SignInModal({ isOpen, onClose, maxWidth }: Props) {
  const { signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setEmail('');
      setPassword('');
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
      await signIn(email, password);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const onForgot = async () => {
    if (!email) {
      setError('Enter your email to reset password');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await resetPassword(email);
      setError('Password reset email sent');
    } catch (e: any) {
      setError(e?.message || 'Could not send reset email');
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-3" role="dialog" aria-modal="true" aria-labelledby="signin-modal-title">
      <div className={`w-full ${sizeClass} rounded-lg sm:rounded-xl bg-white dark:bg-gray-900 p-4 sm:p-5 shadow-xl max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700`}>
        <h2 id="signin-modal-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">Sign in</h2>
        <form className="mt-3 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">Email</label>
            <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" placeholder="you@example.com" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">Password</label>
            <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" placeholder="••••••••" required />
          </div>
          {error && <div className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>}
          <div className="flex items-center justify-between">
            <button type="button" onClick={onForgot} className="text-xs font-medium text-[#652D8E] hover:underline dark:text-purple-300">Forgot password?</button>
          </div>
          <div className="mt-2 flex gap-2.5">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 rounded-lg bg-[#652D8E] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60 dark:bg-purple-600">{submitting ? 'Signing in...' : 'Sign in'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
