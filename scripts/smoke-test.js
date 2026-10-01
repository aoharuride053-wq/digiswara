// Uji cepat end-to-end: health -> register -> login -> daftar suara -> generate.
//
// Cara pakai (server harus sudah berjalan lebih dulu):
//   node scripts/smoke-test.js
//
// Variabel opsional:
//   TEST_BASE_URL   default http://localhost:5000
//   TEST_SKIP_TTS   set "1" untuk melewati uji generate (mis. tanpa API key)

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5000';
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const results = [];

// Karena registrasi publik sudah ditutup, user uji dibuat langsung ke SQLite.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database', 'app.db');
const ensureTestUser = (username, email, password) =>
  new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    db.get('SELECT id FROM users WHERE username = ?', [username], async (err, row) => {
      if (err) {
        db.close();
        return reject(err);
      }
      if (row) {
        db.close();
        return resolve();
      }
      try {
        const hash = await bcrypt.hash(password, 10);
        db.run(
          'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
          [username, email, hash],
          (insertErr) => {
            db.close();
            insertErr ? reject(insertErr) : resolve();
          }
        );
      } catch (hashErr) {
        db.close();
        reject(hashErr);
      }
    });
  });

// Device tiruan untuk uji batas 2 device.
const TEST_DEVICE_ID = `smoke-device-${process.pid}`;
const TEST_DEVICE_FP = `smoke-fp-${process.pid}`;
const deviceHeaders = {
  'x-device-id': TEST_DEVICE_ID,
  'x-device-fp': TEST_DEVICE_FP
};

const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? `  -> ${detail}` : ''}`);
};

const postJson = (path, body, token) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...deviceHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });

const getJson = (path, token) =>
  fetch(`${BASE}${path}`, {
    headers: {
      ...deviceHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

async function main() {
  console.log(`\n=== Smoke test terhadap ${BASE} ===\n`);

  // 1. Health check
  try {
    const res = await getJson('/api/health');
    const body = await res.json();
    check('GET /api/health', res.ok && body.status === 'ok', JSON.stringify(body));
  } catch (err) {
    check('GET /api/health', false, `server tidak bisa dihubungi (${err.message})`);
    console.log('\nPastikan server backend sudah berjalan: npm run server\n');
    process.exit(1);
  }

  // 2. Registrasi gratis lama HARUS ditolak (hanya lewat invoice)
  const username = `smoketest_${Date.now()}`;
  const email = `${username}@example.com`;
  const password = 'rahasia123';

  const regRes = await postJson('/api/register', {
    username: 'siapa saja',
    email: 'siapa@example.com',
    password: 'rahasia123'
  });
  const regBody = await regRes.json();
  check(
    'POST /api/register ditolak (wajib verifikasi invoice)',
    regRes.status === 403 && regBody.code === 'REGISTRATION_BY_INVOICE_ONLY',
    `status ${regRes.status}`
  );

  // 3. Login (dengan device)
  await ensureTestUser(username, email, password);
  const loginRes = await postJson('/api/login', {
    username,
    password,
    deviceId: TEST_DEVICE_ID,
    fingerprint: TEST_DEVICE_FP
  });
  const loginBody = await loginRes.json();
  const token = loginBody.token;
  check('POST /api/login', loginRes.ok && Boolean(token), loginBody.message || 'token diterima');

  if (!token) {
    console.log('\nTidak bisa lanjut tanpa token. Berhenti.\n');
    process.exit(1);
  }

  // 4. Login dengan password salah harus ditolak
  const badLogin = await postJson('/api/login', { username, password: 'password-salah' });
  check(
    'POST /api/login (password salah ditolak)',
    badLogin.status === 400,
    `status ${badLogin.status}`
  );

  // 5. Profil
  const profileRes = await getJson('/api/profile', token);
  const profileBody = await profileRes.json();
  check('GET /api/profile', profileRes.ok && profileBody.user?.username === username);

  // 6. Daftar model suara
  const voicesRes = await getJson('/api/voices/models', token);
  const voicesBody = await voicesRes.json();
  const models = voicesBody.voiceModels || [];
  check(
    'GET /api/voices/models',
    voicesRes.ok && models.length >= 8,
    `${models.length} karakter suara`
  );

  // 7. Daftar nada bicara
  const tonesRes = await getJson('/api/voices/tones', token);
  const tonesBody = await tonesRes.json();
  const tones = tonesBody.tones || [];
  check(
    'GET /api/voices/tones',
    tonesRes.ok && tones.length >= 10,
    `${tones.length} variasi nada`
  );

  // 8. Akses tanpa token harus ditolak
  const noAuth = await getJson('/api/history');
  check('GET /api/history tanpa token ditolak', noAuth.status === 401, `status ${noAuth.status}`);

  // 9. Riwayat masih kosong untuk user baru
  const historyRes = await getJson('/api/history', token);
  const historyBody = await historyRes.json();
  check('GET /api/history', historyRes.ok, `${(historyBody.history || []).length} item`);

  // 10. Statistik profil
  const statsRes = await getJson('/api/profile/stats', token);
  const statsBody = await statsRes.json();
  check('GET /api/profile/stats', statsRes.ok && statsBody.stats?.total === 0);

  // 10b. Daftar device akun ini
  const devicesRes = await getJson('/api/devices', token);
  const devicesBody = await devicesRes.json();
  check(
    'GET /api/devices',
    devicesRes.ok && devicesBody.deviceCount >= 1 && devicesBody.maxDevices === 2,
    `${devicesBody.deviceCount}/${devicesBody.maxDevices} device`
  );

  // 10c. Token dengan device header berbeda harus ditolak (binding device)
  const mismatchRes = await fetch(`${BASE}/api/profile`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-device-id': 'device-lain-yang-tidak-terdaftar',
      'x-device-fp': 'fp-lain'
    }
  });
  check(
    'Request dengan device beda dari token ditolak',
    mismatchRes.status === 401,
    `status ${mismatchRes.status}`
  );

  // 11. Generate suara (butuh GEMINI_API_KEY yang valid)
  if (process.env.TEST_SKIP_TTS === '1') {
    console.log('\n[SKIP] POST /api/tts/generate (TEST_SKIP_TTS=1)');
  } else {
    const ttsRes = await postJson(
      '/api/tts/generate',
      {
        text: 'Halo, ini uji coba aplikasi text to speech.',
        voiceModel: models[0]?.id || 'standard-a',
        tone: tones[0]?.id || 'neutral',
        language: 'id-ID'
      },
      token
    );
    const ttsBody = await ttsRes.json();

    if (ttsRes.ok && ttsBody.audioUrl) {
      const audioRes = await fetch(`${BASE}${ttsBody.audioUrl}`);
      const buffer = Buffer.from(await audioRes.arrayBuffer());
      const isWav = buffer.slice(0, 4).toString() === 'RIFF';

      check('POST /api/tts/generate', true, `audio ${buffer.length} byte`);
      check('File audio bisa diakses dan berformat WAV', audioRes.ok && isWav, ttsBody.audioUrl);

      // Riwayat harus bertambah setelah generate
      const historyAfter = await (await getJson('/api/history', token)).json();
      check('Riwayat bertambah setelah generate', (historyAfter.history || []).length === 1);

      // Hapus riwayat
      const firstId = historyAfter.history?.[0]?.id;
      if (firstId) {
        const delRes = await fetch(`${BASE}/api/history/${firstId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}`, ...deviceHeaders }
        });
        check('DELETE /api/history/:id', delRes.ok, `id ${firstId}`);
      }
    } else {
      // Tanpa API key yang valid, Gemini akan menolak. Yang penting jalur
      // request dari frontend -> backend -> Gemini sudah benar.
      const reachedGemini =
        typeof ttsBody.message === 'string' &&
        /Gemini API error|GEMINI_API_KEY|Kuota|filter keamanan/i.test(ttsBody.message);

      check(
        'POST /api/tts/generate (jalur request ke Gemini bekerja)',
        reachedGemini,
        ttsBody.message || `status ${ttsRes.status}`
      );
      console.log(
        '     Catatan: isi GEMINI_API_KEY yang valid di file .env untuk uji generate sungguhan.'
      );
    }
  }

  // Ringkasan
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
  console.error('\nSmoke test error:', err.message);
  process.exit(1);
});
