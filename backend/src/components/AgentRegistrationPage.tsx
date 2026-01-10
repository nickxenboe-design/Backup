import React, { useState } from 'react';

const API_BASE: string = (import.meta as any).env?.VITE_API_BASE_URL || '';

const AgentRegistrationPage: React.FC = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!firstName || !lastName || !email || !idNumber || !phone || !address || !password) {
      setError('All fields are required.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          idNumber,
          phone,
          address,
          password,
        }),
      });

      if (!res.ok) {
        let msg = 'Failed to register agent';
        try {
          const data = await res.json();
          if (data?.message) msg = data.message;
        } catch {}
        throw new Error(msg);
      }

      setSuccess('Agent registered successfully.');
      setFirstName('');
      setLastName('');
      setEmail('');
      setIdNumber('');
      setPhone('');
      setAddress('');
      setPassword('');

      // Redirect to agent login after successful registration
      if (typeof window !== 'undefined') {
        window.location.assign('/agent/login');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to register agent');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg border border-gray-200 p-6 dark:bg-gray-800 dark:border-gray-700">
        <div className="mb-4 text-center">
          <div className="text-xs font-semibold tracking-wide text-purple-600 uppercase dark:text-purple-300">
            Agent Portal
          </div>
          <h1 className="mt-1 text-lg font-bold text-gray-900 dark:text-gray-50">
            Register a new agent
          </h1>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
            Capture agent details to add them to the system.
          </p>
        </div>

        <div className="space-y-2 mb-4">
          <button
            type="button"
            onClick={() => {
              window.location.href = '/api/v1/auth/google/start';
            }}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
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

        <form className="space-y-3" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                First name
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                Last name
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              placeholder="agent@example.com"
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
              placeholder="Minimum 8 characters"
              required
              minLength={8}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                ID number
              </label>
              <input
                type="text"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                Phone number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                placeholder="+27 00 000 0000"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
              Address
            </label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#652D8E] focus:ring-[#652D8E] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              rows={3}
              required
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              {success}
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <a
              href="/agent/login"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Back to login
            </a>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-[#652D8E] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60 dark:bg-purple-600"
            >
              {submitting ? 'Registering...' : 'Register agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AgentRegistrationPage;
