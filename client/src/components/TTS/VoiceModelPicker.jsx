import React, { useRef, useState } from 'react';
import { CheckIcon } from '@heroicons/react/24/solid';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

const pitchBadge = (pitch) => {
  if (pitch === 'Higher') return 'Nada Tinggi';
  if (pitch === 'Lower') return 'Nada Rendah';
  if (pitch === 'Lower Middle') return 'Nada Menengah-Rendah';
  return 'Nada Menengah';
};

const VoiceModelPicker = ({ models, value, onChange, disabled }) => {
  const carouselRef = useRef(null);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(true);

  if (!models.length) {
    return <p className="text-sm text-slate-400">Memuat daftar model suara...</p>;
  }

  return (
    <div className="min-w-0 max-w-full space-y-2">
      <div className="flex justify-end gap-2">
        <button
          type="button"
          aria-label="Geser karakter ke kiri"
          title="Karakter sebelumnya"
          disabled={!canScrollBack}
          onClick={() => carouselRef.current?.scrollBy({ left: -280, behavior: 'smooth' })}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-primary-300 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Geser karakter ke kanan"
          title="Karakter berikutnya"
          disabled={!canScrollForward}
          onClick={() => carouselRef.current?.scrollBy({ left: 280, behavior: 'smooth' })}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-primary-300 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={carouselRef}
        onScroll={(event) => {
          const { scrollLeft, scrollWidth, clientWidth } = event.currentTarget;
          setCanScrollBack(scrollLeft > 0);
          setCanScrollForward(scrollLeft + clientWidth < scrollWidth - 1);
        }}
        className="min-w-0 max-w-full snap-x snap-mandatory flex touch-pan-x gap-3 overflow-x-auto overscroll-x-contain pb-3"
      >
        {models.map((model) => {
          const selected = value === model.id;
          return (
            <button
              key={model.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(model.id)}
              className={`relative w-64 shrink-0 snap-start rounded-xl border p-4 text-left transition ${
                selected
                  ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200'
                  : 'border-slate-200 bg-white hover:border-primary-300 hover:bg-slate-50'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {selected && (
                <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary-600">
                  <CheckIcon className="h-3 w-3 text-white" />
                </span>
              )}
              <p className="pr-6 text-sm font-semibold text-slate-800">{model.name}</p>
              <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                {model.gender === 'female' ? 'Perempuan' : model.gender === 'male' ? 'Laki-laki' : 'Netral'}
              </span>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{model.description}</p>
              {model.bestFor && (
                <p className="mt-1 text-xs italic text-slate-400">{model.bestFor}</p>
              )}
              <p className="mt-2 text-[11px] font-semibold uppercase text-primary-600">
                {pitchBadge(model.pitch)} &middot; {model.style || model.voiceName}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default VoiceModelPicker;
