import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { resolveAudioUrl } from '../lib/api';
import VoiceModelPicker from '../components/TTS/VoiceModelPicker';
import TonePicker from '../components/TTS/TonePicker';
import AudioPlayer from '../components/TTS/AudioPlayer';
import {
  SparklesIcon,
  TrashIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
  DocumentTextIcon,
  SpeakerWaveIcon
} from '@heroicons/react/24/outline';

const MAX_CHARS = 5000;

const sampleTexts = [
  {
    label: 'Promo Jualan',
    text:
      'Halo Kak! Terima kasih sudah mampir ke toko kami. Hari ini ada promo spesial, ' +
      'diskon sampai lima puluh persen untuk produk pilihan. Stok terbatas, ' +
      'jadi jangan sampai kehabisan ya!'
  },
  {
    label: 'Narasi Cerita',
    text:
      'Di sebuah desa kecil di tepi hutan, hiduplah seorang anak yang selalu percaya ' +
      'bahwa setiap kesulitan pasti membawa pelajaran. Setiap pagi ia berjalan kaki ' +
      'ke sekolah dengan semangat yang tidak pernah pudar.'
  },
  {
    label: 'Pengumuman',
    text:
      'Perhatian seluruh karyawan. Rapat koordinasi bulanan akan dilaksanakan hari ' +
      'Jumat pukul sembilan pagi di ruang rapat utama. Kehadiran seluruh divisi ' +
      'sangat diharapkan.'
  }
];

const GeneratePage = () => {
  const [text, setText] = useState('');
  const [voiceModel, setVoiceModel] = useState('');
  const [tone, setTone] = useState('');

  const [voiceModels, setVoiceModels] = useState([]);
  const [tones, setTones] = useState([]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState('tts');
  const [voiceoverForm, setVoiceoverForm] = useState({
    target: '',
    audienceGender: 'Semua gender',
    audienceAge: '18-24 tahun',
    audienceActivity: '',
    duration: '30',
    description: '',
    tone: 'professional',
    expressionTags: true
  });
  const [isGeneratingVoiceover, setIsGeneratingVoiceover] = useState(false);
  const [voiceoverResults, setVoiceoverResults] = useState([]);
  const [voiceoverExpiresAt, setVoiceoverExpiresAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  const loadOptions = useCallback(async () => {
    try {
      const [voicesRes, tonesRes] = await Promise.all([
        api.get('/api/voices/models'),
        api.get('/api/voices/tones')
      ]);

      const models = voicesRes.data.voiceModels || [];
      const toneList = tonesRes.data.tones || [];
      setVoiceModels(models);
      setTones(toneList);
      if (models.length) setVoiceModel((prev) => prev || models[0].id);
      if (toneList.length) setTone((prev) => prev || toneList[0].id);
    } catch (err) {
      const message = err.response?.status === 401
        ? 'Sesi login tidak valid. Silakan logout lalu login kembali.'
        : err.response?.data?.message || (err.request
          ? 'Tidak dapat terhubung ke server backend. Pastikan server sudah menyala.'
          : 'Gagal memuat daftar suara.');
      toast.error(message, { duration: 6000 });
    }
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  const handleGenerate = async () => {
    const cleanText = text.trim();

    if (!cleanText) {
      toast.error('Teks masih kosong. Isi dulu ya.');
      return;
    }
    if (!tone) {
      toast.error('Pilih nada bicara terlebih dahulu.');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await api.post('/api/tts/generate', {
        text: cleanText,
        voiceModel,
        tone,
        expressionTags: /\[[^\]]+\]/.test(cleanText),
        language: 'id-ID'
      });
      const data = response.data;
      const selectedVoice = voiceModels.find((item) => item.id === data.voiceModel);
      const selectedTone = tones.find((item) => item.id === data.tone);
      setResult({
        audioUrl: resolveAudioUrl(data.audioUrl),
        voiceName: selectedVoice?.name || data.voiceName,
        toneId: data.tone,
        toneName: selectedTone?.name || data.tone,
        historyId: data.id,
        expiresAt: data.expiresAt,
        createdAt: new Date().toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit'
        })
      });
      toast.success('Suara berhasil dibuat.');
    } catch (err) {
      const message =
        err.response?.data?.message || 'Gagal membuat suara. Coba lagi sebentar lagi.';
      toast.error(message, { duration: 8000 });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClear = () => {
    setText('');
    setResult(null);
  };

  const handlePasteSample = (sample) => {
    setText(sample.text);
  };

  const updateVoiceoverForm = (field, value) => {
    setVoiceoverForm((current) => ({ ...current, [field]: value }));
  };

  const handleGenerateVoiceover = async () => {
    if (!voiceoverForm.target.trim()) {
      toast.error('Isi target voice over terlebih dahulu.');
      return;
    }

    setIsGeneratingVoiceover(true);
    try {
      const response = await api.post('/api/voiceover/generate', voiceoverForm);
      setVoiceoverResults(response.data.versions || []);
      setVoiceoverExpiresAt(response.data.expiresAt);
      toast.success('Dua versi naskah voice over berhasil dibuat.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal membuat naskah voice over.', {
        duration: 8000
      });
    } finally {
      setIsGeneratingVoiceover(false);
    }
  };

  const handleCopyVoiceover = async (script) => {
    try {
      await navigator.clipboard.writeText(script);
      toast.success('Naskah disalin.');
    } catch (err) {
      toast.error('Tidak dapat menyalin naskah dari browser ini.');
    }
  };

  const handleUseVoiceover = (script) => {
    setText(script);
    setActiveTab('tts');
  };

  const remaining = MAX_CHARS - text.length;
  const isOverLimit = remaining < 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Buat Suara</h1>
          <p className="mt-1 text-sm text-slate-500">
            Buat audio dari teks atau susun naskah voice over dengan brief khusus.
          </p>
        </div>
        <button
          type="button"
          onClick={loadOptions}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-primary-300 hover:text-primary-700"
        >
          <ArrowPathIcon className="h-4 w-4" />
          Muat ulang daftar suara
        </button>
      </div>

      <div role="tablist" aria-label="Mode pembuatan suara" className="flex gap-1 border-b border-slate-200">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'tts'}
          onClick={() => setActiveTab('tts')}
          className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
            activeTab === 'tts'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <SpeakerWaveIcon className="h-4 w-4" />
          Teks ke Suara
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'voiceover'}
          onClick={() => setActiveTab('voiceover')}
          className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
            activeTab === 'voiceover'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <DocumentTextIcon className="h-4 w-4" />
          Studio Voice Over
        </button>
      </div>

      {activeTab === 'tts' ? (
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {/* Input teks */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Teks</h2>
              <span
                className={`text-xs font-medium ${
                  isOverLimit ? 'text-red-500' : 'text-slate-400'
                }`}
              >
                {text.length} / {MAX_CHARS}
              </span>
            </div>

            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              placeholder="Tulis atau tempel teks yang ingin diubah menjadi suara..."
              className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder-slate-400 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-400">Contoh cepat:</span>
              {sampleTexts.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  onClick={() => handlePasteSample(sample)}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-primary-300 hover:text-primary-700"
                >
                  <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                  {sample.label}
                </button>
              ))}
            </div>
          </section>
          {/* Pilihan nada bicara */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="mb-3 font-semibold text-slate-800">Nada Bicara</h2>
            <TonePicker
              tones={tones}
              value={tone}
              onChange={setTone}
              disabled={isGenerating}
            />
          </section>

          {/* Pilihan model suara */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-slate-800">Karakter Suara</h2>
              <span className="text-xs text-slate-400">{voiceModels.length} pilihan</span>
            </div>
            <VoiceModelPicker
              models={voiceModels}
              value={voiceModel}
              onChange={setVoiceModel}
              disabled={isGenerating}
            />
          </section>

        </div>

        {/* Panel hasil */}
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="mb-3 font-semibold text-slate-800">Hasil Suara</h2>

            {isGenerating && (
              <div className="flex flex-col items-center gap-3 py-10">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
                <p className="text-sm text-slate-500">Gemini sedang menyiapkan suaranya...</p>
              </div>
            )}

            {!isGenerating && result && (
              <AudioPlayer
                src={result.audioUrl}
                fileName={`suara-${result.voiceName || 'gemini'}-${result.toneId}.wav`}
                meta={[
                  { label: 'Karakter', value: result.voiceName },
                  { label: 'Nada', value: result.toneName },
                  { label: 'Dibuat', value: result.createdAt }
                ]}
                onDownloadComplete={() => api.post(`/api/history/${result.historyId}/downloaded`)}
                onDownloadError={() => toast.error('Gagal mengunduh audio.')}
              />
            )}

            {!isGenerating && !result && (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center">
                <SparklesIcon className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm text-slate-400">Hasil suara akan muncul di sini setelah kamu klik Generate.</p>
              </div>
            )}
            {result && (
              <p className="mt-4 text-xs text-amber-700">
                Audio dan riwayat dihapus dari server dalam maksimal 15 menit.
                {result.expiresAt && ` Tersisa ${Math.max(0, Math.ceil((result.expiresAt - now) / 60000))} menit.`}
              </p>
            )}
          </section>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || isOverLimit || !text.trim()}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 py-3.5 font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Sedang membuat suara...
                </>
              ) : (
                <>
                  <SparklesIcon className="h-5 w-5" />
                  Generate Suara
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleClear}
              disabled={isGenerating || (!text && !result)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3.5 font-medium text-slate-600 transition hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <TrashIcon className="h-5 w-5" />
              Bersihkan
            </button>
          </div>

          {isOverLimit && (
            <p className="text-sm font-medium text-red-500">
              Teks melebihi batas {MAX_CHARS} karakter. Kurangi {Math.abs(remaining)} karakter lagi.
            </p>
          )}

          <section className="rounded-2xl border border-primary-100 bg-primary-50/60 p-5">
            <h2 className="mb-2 font-semibold text-slate-800">Tips supaya hasilnya bagus</h2>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>&bull; Gunakan tanda baca yang wajar, karena itu menentukan jeda bicara.</li>
              <li>&bull; Tulis angka sebagai kata bila ingin dibaca jelas, misalnya &quot;lima puluh&quot;.</li>
              <li>&bull; Maksimal {MAX_CHARS} karakter per sekali generate.</li>
              <li>&bull; Kuota gratis Gemini punya batas per menit. Bila muncul error 429, tunggu sebentar.</li>
            </ul>
          </section>
        </div>
      </div>
      ) : (
        <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <section className="min-w-0 space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-900">Brief voice over</h2>
              <p className="mt-1 text-sm text-slate-500">Jelaskan kebutuhanmu, lalu AI akan menyusun naskah siap dibacakan.</p>
            </div>

            <label className="block text-sm font-medium text-slate-700">
              Target
              <input
                value={voiceoverForm.target}
                onChange={(event) => updateVoiceoverForm('target', event.target.value)}
                placeholder="Contoh: jualan produk skincare"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-normal text-slate-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
              />
            </label>

            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Market / Audiens</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-slate-500">
                  Gender target
                  <select
                    value={voiceoverForm.audienceGender}
                    onChange={(event) => updateVoiceoverForm('audienceGender', event.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-primary-500"
                  >
                    {['Semua gender', 'Perempuan', 'Laki-laki'].map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-500">
                  Rentang umur
                  <select
                    value={voiceoverForm.audienceAge}
                    onChange={(event) => updateVoiceoverForm('audienceAge', event.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-primary-500"
                  >
                    {['Semua usia', '13-17 tahun', '18-24 tahun', '25-34 tahun', '35-44 tahun', '45-54 tahun', '55+ tahun'].map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-500 sm:col-span-2">
                  Pekerjaan / aktivitas penggunaan
                  <input
                    value={voiceoverForm.audienceActivity}
                    onChange={(event) => updateVoiceoverForm('audienceActivity', event.target.value)}
                    placeholder="Contoh: pekerja kantoran yang sering bepergian"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-slate-800 outline-none focus:border-primary-500"
                  />
                </label>
              </div>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">Durasi voice over</legend>
              <div className="grid grid-cols-4 gap-2">
                {[['15', '15 detik'], ['30', '30 detik'], ['60', '1 menit'], ['90', '1,5 menit']].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={voiceoverForm.duration === value}
                    onClick={() => updateVoiceoverForm('duration', value)}
                    className={`rounded-lg border px-2 py-2.5 text-xs font-semibold transition sm:text-sm ${
                      voiceoverForm.duration === value
                        ? 'border-primary-600 bg-primary-50 text-primary-700'
                        : 'border-slate-200 text-slate-600 hover:border-primary-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="block text-sm font-medium text-slate-700">
              Deskripsi lebih lanjut
              <textarea
                value={voiceoverForm.description}
                onChange={(event) => updateVoiceoverForm('description', event.target.value)}
                rows={3}
                placeholder="Poin penting, ajakan, gaya bahasa, atau detail yang harus disampaikan..."
                className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3.5 py-2.5 font-normal text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
              />
            </label>

            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Nada bicara</h3>
              <TonePicker
                tones={tones}
                value={voiceoverForm.tone}
                onChange={(value) => updateVoiceoverForm('tone', value)}
                disabled={isGeneratingVoiceover}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-3.5 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Penanda ekspresi</p>
                <p className="mt-0.5 text-xs text-slate-500">Sisipkan arahan seperti [fast, excitedly] pada jeda.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={voiceoverForm.expressionTags}
                aria-label="Gunakan penanda ekspresi"
                onClick={() => updateVoiceoverForm('expressionTags', !voiceoverForm.expressionTags)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0 align-middle transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${voiceoverForm.expressionTags ? 'bg-primary-600' : 'bg-slate-300'}`}
              >
                <span className={`pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200 ${voiceoverForm.expressionTags ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>

            <button
              type="button"
              onClick={handleGenerateVoiceover}
              disabled={isGeneratingVoiceover || !voiceoverForm.target.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 py-3 font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGeneratingVoiceover ? (
                <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Menyusun naskah...</>
              ) : (
                <><SparklesIcon className="h-5 w-5" />Generate Voice Over</>
              )}
            </button>
          </section>

          <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-slate-900">Hasil naskah</h2>
            </div>
            {isGeneratingVoiceover ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <span className="h-8 w-8 animate-spin rounded-full border-4 border-primary-100 border-t-primary-600" />
                <p className="text-sm text-slate-500">AI sedang menyusun naskah...</p>
              </div>
            ) : voiceoverResults.length ? (
              <>
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  Kedua versi riwayat naskah otomatis dihapus dalam 15 menit. Salin atau gunakan naskah sebelum kedaluwarsa.
                  {voiceoverExpiresAt && ` Tersisa ${Math.max(0, Math.ceil((voiceoverExpiresAt - now) / 60000))} menit.`}
                </p>
                <div className="mt-4 grid gap-4 2xl:grid-cols-2">
                  {voiceoverResults.map((version, index) => (
                    <article key={version.label} className="min-w-0 rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-800">{version.label || `Versi ${index + 1}`}</h3>
                        <button
                          type="button"
                          onClick={() => handleCopyVoiceover(version.script)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-primary-300 hover:text-primary-700"
                        >
                          <ClipboardDocumentIcon className="h-4 w-4" />Salin
                        </button>
                      </div>
                      <textarea
                        aria-label={`Naskah voice over ${version.label || index + 1}`}
                        value={version.script}
                        onChange={(event) => setVoiceoverResults((current) => current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, script: event.target.value } : item
                        ))}
                        rows={12}
                        className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-800 outline-none focus:border-primary-400"
                      />
                      <button
                        type="button"
                        onClick={() => handleUseVoiceover(version.script)}
                        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2.5 text-sm font-semibold text-primary-700 transition hover:bg-primary-100"
                      >
                        <SpeakerWaveIcon className="h-4 w-4" />Gunakan versi ini di TTS
                      </button>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-slate-200 px-4 py-16 text-center">
                <DocumentTextIcon className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm text-slate-500">Naskah yang dibuat akan tampil di sini.</p>
              </div>
            )}
          </section>
        </div>
      )}


    </div>
  );
};

export default GeneratePage;
