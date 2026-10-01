import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  ClockIcon,
  UserCircleIcon,
  ArrowRightOnRectangleIcon,
  Bars3Icon,
  XMarkIcon,
  SpeakerWaveIcon
} from '@heroicons/react/24/outline';

const navigation = [
  { name: 'Buat Suara', href: '/generate', icon: SpeakerWaveIcon },
  { name: 'Riwayat', href: '/history', icon: ClockIcon },
  { name: 'Profil', href: '/profile', icon: UserCircleIcon }
];

const Layout = ({ children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const NavLinks = ({ onNavigate }) => (
    <nav className="flex-1 space-y-1">
      {navigation.map((item) => {
        const isActive = location.pathname === item.href;
        return (
          <Link
            key={item.href}
            to={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-primary-600 text-white shadow-card'
                : 'text-slate-600 hover:bg-primary-50 hover:text-primary-700'
            }`}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            <span>{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6">
        <Link to="/generate" className="mb-8 flex items-center gap-2 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-secondary-500">
            <SpeakerWaveIcon className="h-5 w-5 text-white" />
          </span>
          <span className="text-lg font-bold gradient-text">TTS Gemini</span>
        </Link>

        <NavLinks />

        <div className="mt-6 border-t border-slate-200 pt-4">
          <div className="mb-3 px-2">
            <p className="truncate text-sm font-semibold text-slate-700">{user?.username}</p>
            <p className="truncate text-xs text-slate-400">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Sidebar mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative flex h-full w-64 flex-col bg-white px-4 py-6 shadow-premium">
            <div className="mb-8 flex items-center justify-between px-2">
              <span className="text-lg font-bold gradient-text">TTS Gemini</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Tutup menu"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <NavLinks onNavigate={() => setSidebarOpen(false)} />
            <button
              onClick={handleLogout}
              className="mt-6 flex w-full items-center gap-3 rounded-xl border-t border-slate-200 px-3 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <ArrowRightOnRectangleIcon className="w-5 h-5" />
              <span>Keluar</span>
            </button>
          </aside>
        </div>
      )}

      {/* Konten utama */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Buka menu"
          >
            <Bars3Icon className="h-6 w-6" />
          </button>
          <span className="font-bold gradient-text">TTS Gemini</span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
};

export default Layout;