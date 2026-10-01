// Identitas device untuk batas maksimal device per akun.
//
// - deviceId : UUID acak yang disimpan di localStorage (identitas utama).
// - fingerprint : hash dari properti browser yang stabil (layar, timezone,
//   bahasa, dsb). Berguna mengenali "browser yang sama" walau localStorage
//   dibersihkan, sehingga user sah tidak kehilangan slot device.

const DEVICE_ID_KEY = 'device_id';

const getDeviceId = () => {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch (_) {
    // localStorage bisa diblokir (private mode) — fallback stabil per sesi.
    return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

// Hash sederhana (djb2) sebagai fallback ketika crypto.subtle tidak tersedia
// (crypto.subtle hanya ada di https atau localhost).
const fallbackHash = (text) => {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
};

const buildFingerprintSource = () => {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const screenInfo = (typeof window !== 'undefined' && window.screen) || {};
  const parts = [
    nav.userAgent || '',
    nav.language || '',
    nav.platform || '',
    (nav.hardwareConcurrency || '').toString(),
    (nav.deviceMemory || '').toString(),
    (nav.maxTouchPoints || '').toString(),
    `${screenInfo.width || ''}x${screenInfo.height || ''}`,
    (screenInfo.colorDepth || '').toString(),
    (typeof Intl !== 'undefined' && Intl.DateTimeFormat
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || ''
      : ''),
    (typeof window !== 'undefined' && window.devicePixelRatio
      ? window.devicePixelRatio
      : '')
  ];
  return parts.join('||');
};

let cachedFingerprint = null;

const getFingerprint = async () => {
  if (cachedFingerprint) return cachedFingerprint;
  const source = buildFingerprintSource();
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      const data = new TextEncoder().encode(source);
      const digest = await crypto.subtle.digest('SHA-256', data);
      cachedFingerprint = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    } else {
      cachedFingerprint = `fp-${fallbackHash(source)}`;
    }
  } catch (_) {
    cachedFingerprint = `fp-${fallbackHash(source)}`;
  }
  return cachedFingerprint;
};

// Header yang wajib ikut di setiap request API (dipakai server untuk
// membatasi device & mengikat token ke device ini).
const getDeviceHeaders = async () => ({
  'x-device-id': getDeviceId(),
  'x-device-fp': await getFingerprint()
});

export { getDeviceId, getFingerprint, getDeviceHeaders };
