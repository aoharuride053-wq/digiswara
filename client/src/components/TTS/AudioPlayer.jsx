import React, { useEffect, useRef, useState } from 'react';
import { PlayIcon, PauseIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, '0')}`;
};

const AudioPlayer = ({
  src,
  meta = [],
  fileName = 'suara-gemini.wav',
  onDownloadError,
  onDownloadComplete
}) => {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Reset pemutar setiap kali sumber audio berganti
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  };

  const handleSeek = (event) => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = Number(event.target.value);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error('Gagal mengunduh file audio');

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
      onDownloadComplete?.();
    } catch (err) {
      if (onDownloadError) onDownloadError(err);
    }
  };

  const progressPercent = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.target.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.target.duration)}
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={togglePlay}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
          aria-label={isPlaying ? 'Jeda audio' : 'Putar audio'}
        >
          {isPlaying ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
        </button>

        <div className="min-w-0 flex-1">
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.01"
            value={currentTime}
            onChange={handleSeek}
            aria-label="Geser posisi audio"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full"
            style={{
              background: `linear-gradient(to right, #0284c7 ${progressPercent}%, #e2e8f0 ${progressPercent}%)`
            }}
          />
          <div className="mt-1.5 flex justify-between text-xs text-slate-400">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDownload}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-primary-300 hover:text-primary-600"
          aria-label="Unduh audio"
        >
          <ArrowDownTrayIcon className="h-5 w-5" />
        </button>
      </div>

      {meta.length > 0 && (
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 pt-4">
          {meta.map((item) => (
            <div key={item.label}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {item.label}
              </dt>
              <dd className="text-sm font-semibold text-slate-700">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
};

export default AudioPlayer;
