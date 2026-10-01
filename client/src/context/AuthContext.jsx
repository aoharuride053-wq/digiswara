import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { getDeviceHeaders } from '../lib/device';
import { API_BASE_URL } from '../lib/api';

const AuthContext = createContext();

const BASE_URL = API_BASE_URL;

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    try {
      const deviceHeaders = await getDeviceHeaders();
      const response = await axios.post(`${BASE_URL}/api/login`, {
        username,
        password,
        deviceId: deviceHeaders['x-device-id'],
        fingerprint: deviceHeaders['x-device-fp']
      });

      const { token: newToken, user: userData } = response.data;
      
      localStorage.setItem('token', newToken);
      localStorage.setItem('user', JSON.stringify(userData));
      axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
      
      setToken(newToken);
      setUser(userData);
      toast.success('Login berhasil!');
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Login gagal';
      toast.error(message);
      return { success: false, error: message, code: error.response?.data?.code };
    }
  };

  // Registrasi lewat upload invoice pembelian Lynk.id.
  // Server menganalisis invoice dengan AI, mencocokkan REF ID dengan webhook
  // Lynk.id, lalu membuat akun (email pembeli + password acak) dan mengirim
  // kredensialnya lewat email.
  const registerWithInvoice = async ({ email, invoiceFile }) => {
    try {
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Gagal membaca file.'));
        reader.readAsDataURL(invoiceFile);
      });

      const response = await axios.post(`${BASE_URL}/api/register/invoice`, {
        email: email || undefined,
        invoice: {
          filename: invoiceFile.name,
          type: invoiceFile.type,
          data: base64Data
        }
      }, { timeout: 300000 });

      return { success: true, data: response.data };
    } catch (error) {
      const payload = error.response?.data;
      const timedOut = ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code);
      const unreachable = Boolean(error.request && !error.response && !timedOut);
      return {
        success: false,
        error: payload?.message || (timedOut
          ? 'Analisis invoice terlalu lama. Coba unggah lagi.'
          : unreachable
            ? 'Backend tidak merespons. Pastikan server aplikasi masih berjalan.'
            : error.message || 'Gagal memproses invoice. Coba lagi.'),
        code: payload?.code || (timedOut ? 'REQUEST_TIMEOUT' : unreachable ? 'BACKEND_UNREACHABLE' : undefined)
      };
    }
  };

  const logout = async () => {
    // Lepas device ini dari akun agar slot device tidak terbuang percuma.
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const deviceHeaders = await getDeviceHeaders();
        await axios.delete(`${BASE_URL}/api/devices/current`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'x-device-id': deviceHeaders['x-device-id'],
            'x-device-fp': deviceHeaders['x-device-fp']
          }
        });
      }
    } catch (_) {
      // Gagal melepas device tidak menghalangi logout lokal.
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
    setToken(null);
    setUser(null);
    toast('Logout berhasil', { icon: '👋' });
  };

  const isAuthenticated = !!user && !!token;

  const value = {
    user,
    token,
    loading,
    login,
    registerWithInvoice,
    logout,
    isAuthenticated
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;