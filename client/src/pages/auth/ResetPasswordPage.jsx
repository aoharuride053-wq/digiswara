import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyIcon, SpeakerWaveIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../../lib/api';

const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Konfirmasi password baru tidak sama.');
      return;
    }
    if (password.length < 8 || password.length > 128) {
      setError('Password harus terdiri dari 8 sampai 128 karakter.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/api/password/reset', { token, password });
      setComplete(true);
      toast.success('Password berhasil diganti.');
    } catch (requestError) {
      const message = requestError.response?.data?.message || 'Tautan tidak dapat digunakan. Minta tautan reset baru.';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center gap-2">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-500 shadow-lg">
              <SpeakerWaveIcon className="h-6 w-6 text-white" />
            </span>
            <span className="text-2xl font-bold gradient-text">Digiswara</span>
          </Link>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-premium">
          {complete ? (
            <>
              <h1 className="text-2xl font-bold text-slate-900">Password diperbarui</h1>
              <p className="mt-2 text-sm text-slate-500">Silakan masuk menggunakan password baru.</p>
              <Link to="/login" className="mt-6 block w-full rounded-xl bg-primary-600 py-3 text-center font-semibold text-white transition hover:bg-primary-700">
                Kembali ke login
              </Link>
            </>
          ) : (
            <>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
                <KeyIcon className="h-6 w-6 text-primary-600" />
                Password baru
              </h1>
              {!token ? (
                <p className="mt-3 text-sm text-red-700">Token verifikasi tidak ditemukan. Minta tautan reset yang baru.</p>
              ) : (
                <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                  <label className="block text-sm font-medium text-slate-700">
                    Password baru
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Ulangi password baru
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      required
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    />
                  </label>
                  {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-xl bg-primary-600 py-3 font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? 'Menyimpan...' : 'Simpan password baru'}
                  </button>
                </form>
              )}
              <Link to="/forgot-password" className="mt-6 block text-center text-sm font-medium text-primary-600 hover:text-primary-700">
                Minta tautan reset baru
              </Link>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default ResetPasswordPage;