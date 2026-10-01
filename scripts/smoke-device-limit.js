// Uji cepat batas 2 device tanpa jalur AI:
//   1. Buat user uji langsung di SQLite
//   2. Login dari 3 device berbeda -> device 1-2 OK, device 3 DITOLAK
//   3. Token device 1 dipakai di device 2 -> DITOLAK (binding device)
//   4. Logout (lepas device) -> login ulang di device 3 harus berhasil
//   5. Cek daftar device, lalu bersihkan data uji
//
// Cara pakai (server harus berjalan):
//   node scripts/smoke-device-limit.js

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5000';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database', 'app.db');
const results = [];

const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? `  -> ${detail}` : ''}`);
};

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    db.run(sql, params, function (err) {
      db.close();
      err ? reject(err) : resolve();
    });
  });

const login = (username, password, deviceId) =>
  fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, deviceId, fingerprint: `fp-${deviceId}` })
  });

async function main() {
  console.log(`\n=== Smoke batas 2 device terhadap ${BASE} ===\n`);

  try {
    const health = await (await fetch(`${BASE}/api/health`)).json();
    if (health.status !== 'ok') throw new Error('not ok');
  } catch (err) {
    console.log(`Server tidak bisa dihubungi (${err.message}). Jalankan: npm run server`);
    process.exit(1);
  }

  const suffix = Date.now().toString(36);
  const username = `devtest_${suffix}`;
  const email = `devtest_${suffix}@example.com`;
  const password = 'rahasia123';
  const hash = await bcrypt.hash(password, 10);
  await dbRun('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, hash]);

  // Device 1-2 harus berhasil
  const tokens = {};
  for (let i = 1; i <= 2; i += 1) {
    const deviceId = `dl-dev-${i}-${suffix}`;
    const res = await login(username, password, deviceId);
    const body = await res.json().catch(() => ({}));
    tokens[i] = body.token;
    check(`Login device ${i} diterima`, res.ok && Boolean(body.token), body.message || '');
  }

  // Device 3 harus ditolak
  const res3 = await login(username, password, `dl-dev-3-${suffix}`);
  const body3 = await res3.json().catch(() => ({}));
  check(
    'Login device 3 DITOLAK (batas 2 device)',
    res3.status === 403 && body3.code === 'DEVICE_LIMIT',
    body3.message || `status ${res3.status}`
  );

  // Device 1 yang sama boleh login lagi (tidak menambah slot)
  const res1Again = await login(username, password, `dl-dev-1-${suffix}`);
  check('Login ulang di device 1 tetap boleh', res1Again.ok, `status ${res1Again.status}`);

  // Token device 1 tidak boleh dipakai di device 2
  if (tokens[1]) {
    const stolen = await fetch(`${BASE}/api/profile`, {
      headers: {
        Authorization: `Bearer ${tokens[1]}`,
        'x-device-id': `dl-dev-2-${suffix}`,
        'x-device-fp': `fp-dl-dev-2-${suffix}`
      }
    });
    check(
      'Token device 1 dipakai di device 2 DITOLAK',
      stolen.status === 401,
      `status ${stolen.status}`
    );

    // Device yang sesuai tetap bisa akses
    const allowed = await fetch(`${BASE}/api/profile`, {
      headers: {
        Authorization: `Bearer ${tokens[1]}`,
        'x-device-id': `dl-dev-1-${suffix}`,
        'x-device-fp': `fp-dl-dev-1-${suffix}`
      }
    });
    check('Akses pada device yang sesuai diterima', allowed.ok, `status ${allowed.status}`);

    // Daftar device
    const list = await fetch(`${BASE}/api/devices`, {
      headers: {
        Authorization: `Bearer ${tokens[1]}`,
        'x-device-id': `dl-dev-1-${suffix}`,
        'x-device-fp': `fp-dl-dev-1-${suffix}`
      }
    });
    const listBody = await list.json().catch(() => ({}));
    check(
      'GET /api/devices = 2 device / maks 2',
      list.ok && listBody.deviceCount === 2 && listBody.maxDevices === 2,
      `${listBody.deviceCount}/${listBody.maxDevices}`
    );

    // Logout melepas device -> slot 3 menjadi tersedia
    const logout = await fetch(`${BASE}/api/devices/current`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${tokens[1]}`,
        'x-device-id': `dl-dev-1-${suffix}`,
        'x-device-fp': `fp-dl-dev-1-${suffix}`
      }
    });
    check('DELETE /api/devices/current melepas device', logout.ok, `status ${logout.status}`);

    const res3After = await login(username, password, `dl-dev-3-${suffix}`);
    check(
      'Setelah device 1 logout, login di device 3 berhasil',
      res3After.ok,
      `status ${res3After.status}`
    );
  }

  // Bersihkan data uji
  try {
    await dbRun(
      'DELETE FROM user_devices WHERE user_id IN (SELECT id FROM users WHERE username = ?)',
      [username]
    );
    await dbRun('DELETE FROM users WHERE username = ?', [username]);
    console.log('[CLEAN] Data uji dihapus dari database.');
  } catch (err) {
    console.warn('[CLEAN] Gagal membersihkan data uji:', err.message);
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n=== Ringkasan: ${results.length - failed.length}/${results.length} lulus ===`);
  if (failed.length) {
    console.log('Gagal:');
    failed.forEach((item) => console.log(`  - ${item.name}`));
  }
  console.log('');
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke device limit error:', err.message);
  process.exit(1);
});
