import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { formatDateOnly } from '../lib/format';
import {
  UserCircleIcon,
  ArrowRightOnRectangleIcon,
  ClockIcon,
  MicrophoneIcon,
  MusicalNoteIcon
} from '@heroicons/react/24/outline';

const StatCard = ({ icon: Icon, label, value }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
      <Icon className="h-5 w-5" />
    </span>
    <p className="mt-3 text-2xl font-bold text-slate-900">{value}</p>
    <p className="text-sm text-slate-500">{label}</p>
  </div>
);

const ProfilePage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const [profileRes, statsRes] = await Promise.all([
        api.get('/api/profile'),
        api.get('/api/profile/stats')
      ]);
      setProfile(profileRes.data.user || null);
      setStats(statsRes.data.stats || null);
    } catch (err) {
      toast.error('Gagal memuat data profil.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Profil</h1>
        <p className="mt-1 text-sm text-slate-500">Informasi akun dan ringkasan aktivitasmu.</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
        <div className="flex flex-wrap items-center gap-5">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-500 text-white">
            <UserCircleIcon className="h-9 w-9" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold text-slate-900">
              {profile?.username || user?.username || '-'}
            </h2>
            <p className="truncate text-sm text-slate-500">{profile?.email || user?.email || '-'}</p>
            {profile?.created_at && (
              <p className="mt-1 text-xs text-slate-400">
                Bergabung sejak {formatDateOnly(profile.created_at)}
              </p>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-slate-800">Ringkasan Aktivitas</h2>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center">
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              icon={ClockIcon}
              label="Total suara dibuat"
              value={stats?.total ?? 0}
            />
            <StatCard
              icon={MicrophoneIcon}
              label="Karakter suara dipakai"
              value={stats?.totalVoices ?? 0}
            />
            <StatCard
              icon={MusicalNoteIcon}
              label="Nada bicara dipakai"
              value={stats?.totalTones ?? 0}
            />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
        <h2 className="mb-4 font-semibold text-slate-800">Sesi</h2>
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-5 py-2.5 font-medium text-red-600 transition hover:bg-red-50"
        >
          <ArrowRightOnRectangleIcon className="h-5 w-5" />
          Keluar dari akun
        </button>
      </section>
    </div>
  );
};

export default ProfilePage;
