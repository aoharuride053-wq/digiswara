import React from 'react';

const TonePicker = ({ tones, value, onChange, disabled }) => {
  if (!tones.length) {
    return <p className="text-sm text-slate-400">Memuat pilihan nada bicara...</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tones.map((tone) => {
        const selected = value === tone.id;
        return (
          <button
            key={tone.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(tone.id)}
            title={tone.description}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              selected
                ? 'border-primary-600 bg-primary-600 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 hover:border-primary-300 hover:text-primary-700'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {tone.name}
          </button>
        );
      })}
    </div>
  );
};

export default TonePicker;
