import axios from 'axios';
import { getDeviceHeaders } from './device';

const defaultApiOrigin = process.env.NODE_ENV === 'production'
  ? window.location.origin
  : `${window.location.protocol}//${window.location.hostname}:5000`;
export const API_BASE_URL = process.env.REACT_APP_API_URL || defaultApiOrigin;

const api = axios.create({
  baseURL: API_BASE_URL
});

// Sisipkan token JWT + identitas device otomatis ke setiap request
// (device dipakai server untuk membatasi perangkat per akun).
api.interceptors.request.use(async (config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  try {
    const deviceHeaders = await getDeviceHeaders();
    config.headers['x-device-id'] = deviceHeaders['x-device-id'];
    config.headers['x-device-fp'] = deviceHeaders['x-device-fp'];
  } catch (_) {
    // Lanjut tanpa header device; server akan menolak dengan pesan login ulang.
  }
  return config;
});

// Kalau token kedaluwarsa / tidak valid, bersihkan sesi lokal
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const code = error.response?.data?.code;
    const status = error.response?.status;
    // Sesi device tidak berlaku lagi (device beda / batas device tercapai).
    if (status === 401 && ['DEVICE_MISMATCH', 'DEVICE_LIMIT', 'DEVICE_REQUIRED'].includes(code)) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    return Promise.reject(error);
  }
);

// Path audio dari server bersifat relatif (mis. /audio/xxx.wav).
// Helper ini mengubahnya menjadi URL absolut agar bisa diputar <audio>.
export const resolveAudioUrl = (audioUrl) => {
  if (!audioUrl) return null;
  return audioUrl.startsWith('http') ? audioUrl : `${API_BASE_URL}${audioUrl}`;
};

export default api;
