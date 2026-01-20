import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const AgentLoginPage: React.FC = () => {
  const { signIn, resetPassword, user } = useAuth();
  const [pendingApproval, setPendingApproval] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const registered = params.get('registered') === '1';
      if (!registered) return;

      const duplicated = params.get('duplicated') === '1';
      const passwordSet = params.get('passwordSet') === '1';
      const pending = params.get('pendingApproval') === '1';

      if (pending) setPendingApproval(true);

      if (duplicated) {
        if (passwordSet) {
          setInfo('Account already exists. Password has been set. Please sign in.');
        } else {
          setInfo('Account already exists. Please sign in. If you forgot your password, use “Forgot password?” to reset it.');
        }
      } else {
        setInfo('Registration received. Please sign in. Your account may require admin approval before you can use the Agent Dashboard.');
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!user || (user as any).role !== 'agent') return;

    try {
      const params = new URLSearchParams(window.location.search);
      const next = params.get('next') || '/agent-dashboard';
      window.location.replace(next);
    } catch {
      window.location.replace('/agent-dashboard');
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      await signIn(email, password, { remember: rememberMe });
      // Fetch latest profile to check activation status
      let activeFlag: boolean | undefined;
      try {
        const profileRes = await fetch('/api/v1/auth/agent/me', { credentials: 'include' });
        const profile = await profileRes.json().catch(() => null);
        activeFlag = profile?.active;
      } catch {
        // ignore fetch errors; fallback to redirect
      }
      if (typeof window !== 'undefined') {
        try {
          const params = new URLSearchParams(window.location.search);
          const next = params.get('next') || '/agent-dashboard';
          // If backend marks agent as inactive, keep them here and show a message
          if (activeFlag === false) {
            setPendingApproval(true);
            return;
          }
          window.location.assign(next);
        } catch {
          window.location.assign('/agent-dashboard');
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgot = async () => {
    if (!email) {
      setError('Enter your email to reset password');
      return;
    }
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      await resetPassword(email);
      setInfo('Password reset email sent');
    } catch (e: any) {
      setError(e?.message || 'Could not send reset email');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-200 p-6 dark:bg-gray-800 dark:border-gray-700">
        <div className="mb-4 text-center">
          <div className="text-xs font-semibold tracking-wide text-purple-600 uppercase dark:text-purple-300">
            Agent Portal
          </div>
          <h1 className="mt-1 text-lg font-bold text-gray-900 dark:text-gray-50">
            Sign in to continue
          </h1>
        </div>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              placeholder="••••••••"
              required
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200 select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700"
              />
              Remember me
            </label>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}
          {!error && info && (
            <div className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              {info}
            </div>
          )}
          {pendingApproval && (
            <div className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              Your account is awaiting admin approval. Please try again after an admin activates your profile.
            </div>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleForgot}
              className="text-xs font-medium text-[#652D8E] hover:underline dark:text-purple-300"
            >
              Forgot password?
            </button>
            <a
              href="/agent/register"
              className="text-xs font-medium text-[#652D8E] hover:underline dark:text-purple-300"
            >
              Register new agent
            </a>
          </div>
          <div className="mt-2 flex">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-[#652D8E] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60 dark:bg-purple-600"
            >
              {submitting ? 'Signing in...' : 'Sign in as agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AgentLoginPage;
