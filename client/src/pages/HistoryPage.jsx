import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { resolveAudioUrl } from '../lib/api';
import AudioPlayer from '../components/TTS/AudioPlayer';
import { formatDateTime } from '../lib/format';
import {
  ClockIcon,
  TrashIcon,
  ArrowPathIcon,
  SpeakerWaveIcon
} from '@heroicons/react/24/outline';

const HistoryPage = () => {
  const [history, setHistory] = useState([]);
  const [voiceovers, setVoiceovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [now, setNow] = useState(Date.now());

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get('/api/history');
      setHistory(response.data.history || []);
      setVoiceovers(response.data.voiceovers || []);
    } catch (err) {
      toast.error('Gagal memuat riwayat.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  const handleDelete = async (id) => {
    setDeletingId(`audio-${id}`);
    try {
      await api.delete(`/api/history/${id}`);
      setHistory((prev) => prev.filter((item) => item.id !== id));
      if (selected?.id === id) setSelected(null);
      toast.success('Riwayat berhasil dihapus.');
    } catch (err) {
      toast.error('Gagal menghapus riwayat.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteVoiceover = async (id) => {
    setDeletingId(`voiceover-${id}`);
    try {
      await api.delete(`/api/voiceover-history/${id}`);
      setVoiceovers((previous) => previous.filter((item) => item.id !== id));
      toast.success('Riwayat voice over dihapus.');
    } catch (err) {
      toast.error('Gagal menghapus riwayat voice over.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Riwayat</h1>
          <p className="mt-1 text-sm text-slate-500">
            Audio dan naskah voice over yang baru dibuat.
          </p>
        </div>
        <button
          type="button"
          onClick={loadHistory}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-primary-300 hover:text-primary-700 disabled:opacity-50"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Segarkan
        </button>
      </div>

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
        Riwayat dan file audio disimpan maksimal 15 menit, lalu dihapus otomatis agar penyimpanan tetap ringan.
        Unduh audio atau salin naskah sebelum kedaluwarsa.
      </p>

      {selected && (
        <section className="rounded-2xl border border-primary-100 bg-white p-5 shadow-card">
          <h2 className="mb-3 font-semibold text-slate-800">Sedang diputar</h2>
          <AudioPlayer
            src={resolveAudioUrl(selected.audio_url)}
            fileName={`suara-${selected.id}.wav`}
            meta={[
              { label: 'Karakter', value: selected.voice_model },
              { label: 'Nada', value: selected.tone },
              { label: 'Dibuat', value: formatDateTime(selected.created_at) },
              { label: 'Masa berlaku', value: `${Math.max(0, Math.ceil((selected.expires_at - now) / 60000))} menit` }
            ]}
            onDownloadError={() => toast.error('Gagal mengunduh audio.')}
            onDownloadComplete={() => api.post(`/api/history/${selected.id}/downloaded`)}
          />
        </section>
      )}

      {loading && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          <p className="text-sm text-slate-500">Memuat riwayat...</p>
        </div>
      )}

      {!loading && history.length === 0 && voiceovers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <ClockIcon className="mx-auto h-10 w-10 text-slate-300" />
          <h3 className="mt-4 font-semibold text-slate-700">Belum ada riwayat</h3>
          <p className="mt-1 text-sm text-slate-400">
            Buat suara pertama kamu di halaman Buat Suara.
          </p>
        </div>
      )}

      {!loading && (history.length > 0 || voiceovers.length > 0) && (
        <div className="space-y-8">
          {history.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-semibold text-slate-800">Audio</h2>
              {history.map((item) => (
                <article
                  key={item.id}
                  className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center"
                >
                  <button
                    type="button"
                    onClick={() => setSelected(item)}
                    disabled={!item.audio_url}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 transition hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Putar audio"
                  >
                    <SpeakerWaveIcon className="h-5 w-5" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-slate-700">{item.text}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{item.voice_model}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{item.tone}</span>
                      <span>{formatDateTime(item.created_at)}</span>
                      <span className="font-medium text-amber-700">Hapus dalam {Math.max(0, Math.ceil((item.expires_at - now) / 60000))} menit</span>
                      {item.downloaded_at && <span className="font-medium text-emerald-700">Sudah diunduh</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    disabled={deletingId === `audio-${item.id}`}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-500 transition hover:border-red-200 hover:text-red-600 disabled:opacity-50"
                  >
                    <TrashIcon className="h-4 w-4" />
                    {deletingId === `audio-${item.id}` ? 'Menghapus...' : 'Hapus'}
                  </button>
                </article>
              ))}
            </section>
          )}

          {voiceovers.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-semibold text-slate-800">Voice Over</h2>
              {voiceovers.map((item) => (
                <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-800">{item.target}</h3>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                        <span>{item.tone}</span>
                        <span>{formatDateTime(item.created_at)}</span>
                        <span className="font-medium text-amber-700">Hapus dalam {Math.max(0, Math.ceil((item.expires_at - now) / 60000))} menit</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteVoiceover(item.id)}
                      disabled={deletingId === `voiceover-${item.id}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-500 transition hover:border-red-200 hover:text-red-600 disabled:opacity-50"
                    >
                      <TrashIcon className="h-4 w-4" />
                      {deletingId === `voiceover-${item.id}` ? 'Menghapus...' : 'Hapus'}
                    </button>
                  </div>
                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    {[['Versi A', item.version_a], ['Versi B', item.version_b]].map(([label, script]) => (
                      <details key={label} className="min-w-0 rounded-lg border border-slate-200 p-3">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-700">{label}</summary>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{script}</p>
                      </details>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default HistoryPage;
