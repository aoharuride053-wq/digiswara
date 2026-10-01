import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { EnvelopeIcon, SpeakerWaveIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../../lib/api';

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await api.post('/api/password/forgot', { email: email.trim() });
      setSent(true);
      toast.success('Permintaan reset diproses.');
      return response;
    } catch (error) {
      toast.error(error.response?.data?.message || 'Permintaan belum dapat diproses.');
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
          <h1 className="text-2xl font-bold text-slate-900">Lupa password</h1>
          {sent ? (
            <p className="mt-3 text-sm leading-relaxed text-slate-600" role="status">
              Jika email terdaftar, tautan untuk mengganti password akan dikirim. Periksa inbox dan folder Spam.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-slate-500">
                Masukkan email akun. Kami akan mengirim tautan verifikasi untuk membuat password baru.
              </p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                  Email akun
                  <span className="relative mt-1.5 block">
                    <EnvelopeIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="nama@email.com"
                      className="w-full rounded-xl border border-slate-300 py-2.5 pl-11 pr-4 text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    />
                  </span>
                </label>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-primary-600 py-3 font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Mengirim...' : 'Kirim tautan verifikasi'}
                </button>
              </form>
            </>
          )}
          <Link to="/login" className="mt-6 block text-center text-sm font-medium text-primary-600 hover:text-primary-700">
            Kembali ke login
          </Link>
        </section>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;