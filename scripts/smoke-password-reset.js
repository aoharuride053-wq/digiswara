const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();

const root = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digiswara-password-reset-'));
const dbPath = path.join(tempDir, 'app.db');
const port = 20000 + crypto.randomInt(20000);
const email = 'password-reset-smoke@example.invalid';
const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
  cwd: root,
  env: {
    ...process.env,
    DATABASE_BACKEND: 'sqlite',
    DB_PATH: dbPath,
    NODE_ENV: 'test',
    PORT: String(port),
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    RESEND_API_KEY: ''
  },
  stdio: 'ignore'
});

const stopChild = () => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) return resolve();
  const timeout = setTimeout(resolve, 3000);
  child.once('exit', () => {
    clearTimeout(timeout);
    resolve();
  });
  child.kill();
});

const runSql = (sql, values = []) => new Promise((resolve, reject) => {
  const db = new sqlite3.Database(dbPath);
  db.run(sql, values, function (error) {
    db.close();
    if (error) return reject(error);
    resolve(this);
  });
});

const postJson = (route, body, headers = {}) => fetch(`http://127.0.0.1:${port}${route}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body)
});

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(500)
      });
      if (response.ok) return;
    } catch (_) {
      // The server may still be initializing its SQLite schema.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server tidak siap untuk smoke test.');
}

async function main() {
  await waitForServer();
  const oldPassword = 'OldPassword123';
  const resetPassword = 'ResetPassword123';
  const profilePassword = 'ProfilePassword123';
  const passwordHash = await bcrypt.hash(oldPassword, 10);
  const insertUser = await runSql(
    'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
    ['passwordresetsmoke', email, passwordHash]
  );
  const resetToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  await runSql(
    'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    [tokenHash, insertUser.lastID, Date.now() + 30 * 60 * 1000]
  );

  const resetResponse = await postJson('/api/password/reset', {
    token: resetToken,
    password: resetPassword
  });
  assert.equal(resetResponse.status, 200, 'token yang berlaku harus mengganti password');

  const reusedTokenResponse = await postJson('/api/password/reset', {
    token: resetToken,
    password: 'AnotherPassword123'
  });
  assert.equal(reusedTokenResponse.status, 400, 'token reset hanya dapat digunakan sekali');

  const deviceId = `password-reset-smoke-${process.pid}`;
  const loginResponse = await postJson('/api/login', {
    username: 'passwordresetsmoke',
    password: resetPassword,
    deviceId,
    fingerprint: 'password-reset-smoke-fingerprint'
  });
  assert.equal(loginResponse.status, 200, 'password hasil reset harus dapat digunakan untuk login');
  const { token } = await loginResponse.json();
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'x-device-id': deviceId,
    'x-device-fp': 'password-reset-smoke-fingerprint'
  };

  const profileResponse = await postJson('/api/profile/password', {
    currentPassword: resetPassword,
    newPassword: profilePassword
  }, authHeaders);
  assert.equal(profileResponse.status, 200, 'perubahan password profil harus berhasil');

  const profilePasswordLogin = await postJson('/api/login', {
    username: 'passwordresetsmoke',
    password: profilePassword,
    deviceId,
    fingerprint: 'password-reset-smoke-fingerprint'
  });
  assert.equal(profilePasswordLogin.status, 200, 'password profil terbaru harus dapat digunakan');

  const unknownEmail = await postJson('/api/password/forgot', { email: 'missing@example.invalid' });
  assert.equal(unknownEmail.status, 200, 'permintaan email tidak terdaftar tetap memberi respons generik');
  assert.equal((await unknownEmail.json()).success, true);

  console.log('[PASS] Reset token sekali pakai, login password baru, ubah password profil, dan respons lupa password generik.');
}

main()
  .catch((error) => {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopChild();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });