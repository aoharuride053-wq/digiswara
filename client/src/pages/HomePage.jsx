import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PURCHASE_URL } from '../lib/links';
import {
  SpeakerWaveIcon,
  MicrophoneIcon,
  MusicalNoteIcon,
  ClockIcon,
  DocumentTextIcon,
  ShieldCheckIcon
} from '@heroicons/react/24/outline';

const features = [
  {
    icon: MicrophoneIcon,
    title: 'Teks ke Suara',
    description:
      'Ubah naskah menjadi audio berbahasa Indonesia dengan karakter dan penyampaian yang ekspresif.'
  },
  {
    icon: MusicalNoteIcon,
    title: 'Karakter & Nada',
    description:
      'Pilih suara dan gaya bicara yang sesuai untuk promosi, narasi, tutorial, atau konten digital.'
  },
  {
    icon: DocumentTextIcon,
    title: 'Studio Voice Over',
    description:
      'Kembangkan brief menjadi alternatif naskah voice over yang siap disunting dan diproduksi.'
  },
  {
    icon: ClockIcon,
    title: 'Audio & Riwayat',
    description:
      'Putar dan unduh hasil audio, lalu akses riwayat generate selama masa penyimpanannya.'
  },
  {
    icon: ShieldCheckIcon,
    title: 'Akses Pembeli',
    description:
      'Aktivasi memakai invoice Lynk.id. Setiap akun dibatasi hingga tiga perangkat terdaftar.'
  }
];

const HomePage = () => {
  const { isAuthenticated, user } = useAuth();

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
      {/* Header */}
      <header className="mb-14 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-500 shadow-lg">
            <SpeakerWaveIcon className="h-6 w-6 text-white" />
          </span>
          <span className="text-xl font-bold gradient-text">Digiswara</span>
        </div>

        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <Link
              to="/generate"
              className="rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700"
            >
              Buka Dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:text-primary-700"
              >
                Masuk
              </Link>
              <a
                href={PURCHASE_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700"
              >
                Beli di Lynk.id
              </a>
            </>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-white px-4 py-1.5 text-xs font-semibold text-primary-700">
          <SpeakerWaveIcon className="h-4 w-4" />
          Digiswara
        </span>

        <h1 className="mt-6 font-display text-4xl font-extrabold leading-tight text-slate-900 sm:text-5xl">
          Teks Indonesia jadi <span className="gradient-text">audio ekspresif</span>
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
          Buat audio text-to-speech dan naskah voice over untuk promosi, narasi, tutorial,
          serta kebutuhan konten digital.
        </p>

        {isAuthenticated && user?.username && (
          <p className="mt-4 text-sm text-slate-500">
            Selamat datang kembali, <span className="font-semibold">{user.username}</span>!
          </p>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {isAuthenticated ? (
            <>
              <Link
                to="/generate"
                className="rounded-xl bg-primary-600 px-7 py-3.5 font-semibold text-white shadow-card transition hover:bg-primary-700"
              >
                Buat Suara Sekarang
              </Link>
              <Link
                to="/history"
                className="rounded-xl border border-slate-300 bg-white px-7 py-3.5 font-semibold text-slate-700 transition hover:border-primary-300 hover:text-primary-700"
              >
                Lihat Riwayat
              </Link>
            </>
          ) : (
            <>
              <a
                href={PURCHASE_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-primary-600 px-7 py-3.5 font-semibold text-white shadow-card transition hover:bg-primary-700"
              >
                Beli Akses di Lynk.id
              </a>
              <Link
                to="/register"
                className="rounded-xl border border-slate-300 bg-white px-7 py-3.5 font-semibold text-slate-700 transition hover:border-primary-300 hover:text-primary-700"
              >
                Sudah membeli? Aktivasi akun
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="mt-16 border-y border-slate-200 py-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Akses pembeli</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Cara mendapatkan akun</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Beli akses Digiswara di Lynk.id, lalu aktifkan akun menggunakan invoice pembelian.
            </p>
            <a
              href={PURCHASE_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700"
            >
              Beli akses di Lynk.id
            </a>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2">
            <li className="border-l-2 border-primary-500 pl-4">
              <span className="text-xs font-semibold text-primary-700">01</span>
              <p className="mt-1 text-sm font-semibold text-slate-800">Selesaikan pembelian</p>
              <p className="mt-1 text-sm text-slate-500">Beli produk melalui halaman Lynk.id dan selesaikan pembayaran.</p>
            </li>
            <li className="border-l-2 border-primary-500 pl-4">
              <span className="text-xs font-semibold text-primary-700">02</span>
              <p className="mt-1 text-sm font-semibold text-slate-800">Unduh invoice dari email</p>
              <p className="mt-1 text-sm text-slate-500">Periksa inbox atau Spam, lalu unduh invoice yang dikirim Lynk.id.</p>
            </li>
            <li className="border-l-2 border-primary-500 pl-4">
              <span className="text-xs font-semibold text-primary-700">03</span>
              <p className="mt-1 text-sm font-semibold text-slate-800">Daftar dan unggah invoice</p>
              <p className="mt-1 text-sm text-slate-500">Gunakan email pembelian yang sama dan unggah invoice di halaman pendaftaran.</p>
            </li>
            <li className="border-l-2 border-primary-500 pl-4">
              <span className="text-xs font-semibold text-primary-700">04</span>
              <p className="mt-1 text-sm font-semibold text-slate-800">Terima akses melalui email</p>
              <p className="mt-1 text-sm text-slate-500">Setelah pembayaran diverifikasi, username dan password dikirim ke email pembeli.</p>
            </li>
          </ol>
        </div>
      </section>

      {/* Fitur */}
      <section className="mt-20 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {features.map((feature) => (
          <article
            key={feature.title}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
              <feature.icon className="h-6 w-6" />
            </span>
            <h2 className="mt-4 font-semibold text-slate-800">{feature.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{feature.description}</p>
          </article>
        ))}
      </section>

      <footer className="mt-20 border-t border-slate-200 pt-8 text-center text-xs text-slate-400">
        Beli akses di Lynk.id terlebih dahulu. Setelah itu, aktivasi menggunakan invoice pembelian.
      </footer>
    </div>
  );
};

export default HomePage;
