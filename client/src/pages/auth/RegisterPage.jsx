import React, { useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { PURCHASE_URL } from '../../lib/links';
import toast from 'react-hot-toast';
import {
  SpeakerWaveIcon,
  EnvelopeIcon,
  DocumentArrowUpIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

const inputClass =
  'w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 placeholder-slate-400 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100';

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB, selaras dengan batas backend
const ALLOWED_TYPES = ['application/pdf'];

const ANALYSIS_STEPS = [
  'Mengunggah invoice...',
  'Menganalisis invoice dengan AI...',
  'Mengekstrak REF ID (32 karakter)...',
  'Mencocokkan pembayaran di Lynk.id...',
  'Membuat akun & mengirim email...'
];

// Pesan ramah untuk kode error dari backend.
const ERROR_MESSAGES = {
  INVOICE_REQUIRED: 'Upload file invoice PDF terlebih dahulu.',
  INVALID_FILE_TYPE: 'Format invoice harus PDF.',
  FILE_TOO_LARGE: 'Ukuran file maksimal 8MB. Kompres dulu filenya.',
  NOT_AN_INVOICE: 'File ini bukan invoice Lynk.id. Upload invoice yang dikirim ke email kamu.',
  REF_NOT_FOUND: 'REF ID 32 karakter tidak ditemukan di invoice. Pastikan upload invoice asli dari Lynk.id.',
  REF_NOT_REGISTERED: 'Pembayaran dengan REF ID ini belum diterima. Coba lagi beberapa saat setelah pembayaran.',
  NOT_PAID: 'Pembayaran belum dikonfirmasi oleh Lynk.id.',
  EMAIL_MISMATCH: 'Email tidak cocok dengan email pembelian di Lynk.id.',
  EMAIL_ALREADY_REGISTERED: 'Email ini sudah memiliki akun. Silakan login.',
  REF_ALREADY_USED: 'REF ID ini sudah pernah dipakai untuk membuat akun.',
  RATE_LIMITED: 'Terlalu banyak percobaan. Coba lagi dalam satu jam.',
  EMAIL_FAILED: 'Gagal mengirim email kredensial. Coba lagi nanti.',
  TOKENHARBOR_KEY_MISSING: 'Server belum mengatur TOKENHARBOR_API_KEY di .env.',
  TOKENHARBOR_AUTH_FAILED: 'TokenHarbor menolak autentikasi (401). Periksa TOKENHARBOR_API_KEY di environment backend, lalu restart atau redeploy.',
  TOKENHARBOR_VISION_FAILED: 'Semua model TokenHarbor gagal membaca invoice. Periksa log backend untuk detailnya.',
  PDF_RENDER_FAILED: 'PDF scan tidak dapat dirender. Coba unggah invoice sebagai gambar atau PDF lain.',
  REQUEST_TIMEOUT: 'Analisis invoice terlalu lama. Coba unggah lagi.',
  BACKEND_UNREACHABLE: 'Backend tidak merespons. Pastikan server aplikasi masih berjalan.'
};

const RegisterPage = () => {
  const { registerWithInvoice } = useAuth();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef(null);

  // Email bisa di-prefill dari link: /register?email=pembeli@gmail.com
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  const [phase, setPhase] = useState('form'); // form | loading | success
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const validateFile = (candidate) => {
    if (!candidate) return 'File tidak ditemukan.';
    if (!candidate.name.toLowerCase().endsWith('.pdf') || !ALLOWED_TYPES.includes(candidate.type)) {
      return 'Format invoice harus PDF.';
    }
    if (candidate.size > MAX_FILE_SIZE) {
      return 'Ukuran file maksimal 8MB.';
    }
    return '';
  };

  const handleFileChange = (candidate) => {
    const message = validateFile(candidate);
    if (message) {
      toast.error(message);
      return;
    }
    setFile(candidate);
    setError('');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Email pembelian wajib diisi (email yang dipakai beli di Lynk.id).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Format email tidak valid.');
      return;
    }
    const fileError = validateFile(file);
    if (fileError) {
      setError(fileError);
      return;
    }

    setPhase('loading');
    setStepIndex(0);

    // Tampilkan progres berjalan selama AI menganalisis invoice.
    const timer = setInterval(() => {
      setStepIndex((prev) => Math.min(prev + 1, ANALYSIS_STEPS.length - 1));
    }, 4000);

    const submitResult = await registerWithInvoice({
      email: email.trim(),
      invoiceFile: file
    });
    clearInterval(timer);

    if (submitResult.success) {
      setResult(submitResult.data);
      setPhase('success');
      toast.success(submitResult.data.recovered
        ? 'Kredensial baru dikirim ke email pembelian.'
        : 'Invoice terverifikasi! Akun berhasil dibuat.');
    } else {
      setPhase('form');
      const friendly = ERROR_MESSAGES[submitResult.code];
      const message = friendly || submitResult.error;
      setError(message);
      toast.error(message);
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

        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-premium">
          {/* ===== TAHAP SUKSES ===== */}
          {phase === 'success' && result && (
            <div className="text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircleIcon className="h-8 w-8 text-emerald-600" />
              </span>
              <h1 className="mt-4 text-2xl font-bold text-slate-900">
                {result.recovered ? 'Kredensial dikirim ulang' : 'Akun berhasil dibuat!'}
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Invoice dengan REF ID{' '}
                <span className="font-mono font-semibold text-slate-700">
                  {result.refId}
                </span>{' '}
                berhasil diverifikasi.
              </p>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                <p className="text-sm text-slate-600">
                  {result.recovered
                    ? 'Password akun diperbarui. Username dan password baru dikirim ke email:'
                    : 'Username dan password sudah dikirim ke email:'}
                </p>
                <p className="mt-1 break-all text-sm font-semibold text-slate-900">
                  {result.email}
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  {result.emailSent
                    ? 'Cek inbox (dan folder Spam) untuk melihat username & password kamu.'
                    : result.devWarning || 'Cek inbox (dan folder Spam) untuk melihat username & password kamu.'}
                </p>
                {result.credentials && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    <p className="font-semibold">Mode pengembangan (SMTP belum dikonfigurasi):</p>
                    <p className="mt-1 font-mono">
                      Username: {result.credentials.username}
                      <br />
                      Password: {result.credentials.password}
                    </p>
                  </div>
                )}
              </div>

              <Link
                to="/login"
                className="mt-6 inline-block w-full rounded-xl bg-primary-600 py-3 font-semibold text-white transition hover:bg-primary-700"
              >
                Sudah, ke Halaman Login
              </Link>
              <p className="mt-4 text-xs text-slate-400">
                Akun hanya bisa dipakai di maksimal 2 device berbeda.
              </p>
            </div>
          )}

          {/* ===== TAHAP LOADING ===== */}
          {phase === 'loading' && (
            <div className="py-6 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary-100">
                <span className="h-7 w-7 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
              </span>
              <h1 className="mt-4 text-xl font-bold text-slate-900">
                Memverifikasi invoice
              </h1>
              <p className="mt-1 text-sm text-slate-500">{ANALYSIS_STEPS[stepIndex]}</p>
              <div className="mx-auto mt-5 h-1.5 w-56 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-primary-600 transition-all duration-1000"
                  style={{ width: `${((stepIndex + 1) / ANALYSIS_STEPS.length) * 100}%` }}
                />
              </div>
              <p className="mt-4 text-xs text-slate-400">Jangan tutup halaman ini...</p>
            </div>
          )}

          {/* ===== TAHAP FORM ===== */}
          {phase === 'form' && (
            <>
              <h1 className="text-2xl font-bold text-slate-900">Aktivasi Akun Pembelian</h1>
              <p className="mt-1 text-sm text-slate-500">
                Beli akses Digiswara di Lynk.id, unduh invoice dari email pembelian, lalu unggah di sini untuk mendapatkan akun.
              </p>

              <a
                href={PURCHASE_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700"
              >
                Beli akses di Lynk.id
              </a>

              <ol className="mt-5 space-y-3 border-l-2 border-primary-200 pl-4 text-sm text-slate-600">
                <li><strong>1. Beli akses</strong> melalui Lynk.id dan selesaikan pembayaran.</li>
                <li><strong>2. Unduh invoice</strong> dari email yang digunakan saat membeli. Periksa folder Spam jika belum masuk.</li>
                <li><strong>3. Masukkan email pembelian</strong> yang sama dan unggah file invoice di halaman ini.</li>
                <li><strong>4. Tunggu verifikasi</strong>; username dan password akan dikirim ke email pembeli.</li>
              </ol>

              {error && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Email Pembelian (Lynk.id) *
                  </label>
                  <div className="relative">
                    <EnvelopeIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nama@gmail.com"
                      className={`${inputClass} pl-11`}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Wajib sama dengan email yang dipakai saat beli di Lynk.id.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Upload Invoice (PDF) *
                  </label>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-7 text-center transition ${
                      dragActive
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-slate-300 bg-slate-50 hover:border-primary-400 hover:bg-primary-50/50'
                    }`}
                  >
                    <DocumentArrowUpIcon className="h-9 w-9 text-primary-500" />
                    {file ? (
                      <p className="mt-2 text-sm font-medium text-slate-800">
                        {file.name}
                        <span className="block text-xs font-normal text-slate-400">
                          {(file.size / 1024).toFixed(0)} KB — klik untuk ganti
                        </span>
                      </p>
                    ) : (
                      <>
                        <p className="mt-2 text-sm font-medium text-slate-700">
                          Klik atau drag &amp; drop invoice ke sini
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          Hanya PDF — maksimal 8MB
                        </p>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleFileChange(e.target.files[0]);
                        }
                        e.target.value = '';
                      }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!file}
                  className="w-full rounded-xl bg-primary-600 py-3 font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Verifikasi &amp; Buat Akun
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-slate-500">
                Sudah punya akun?{' '}
                <Link to="/login" className="font-semibold text-primary-600 hover:text-primary-700">
                  Masuk di sini
                </Link>
              </p>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          🔒 Setiap akun maksimal bisa diakses di 2 device berbeda.
        </p>
      </div>
    </div>
  );
};

export default RegisterPage;

