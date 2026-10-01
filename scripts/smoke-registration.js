// Uji end-to-end alur registrasi berbasis invoice Lynk.id + batas 2 device.
//
// Langkah yang diuji (server harus sudah berjalan):
//   1. POST /api/webhook/lynk  -> transaksi tersimpan (dengan signature bila merchant key ada)
//   2. POST /api/register/invoice dengan PDF invoice tiruan
//        -> AI (Gemini) membaca REF ID 32 karakter, akun dibuat, kredensial dikembalikan
//   3. REF/email sama mereset password dan mengirim kredensial ulang
//      REF sama dengan email berbeda tetap ditolak
//   4. Login 3 device berbeda -> device 1-2 OK, device 3 DITOLAK (batas 2 device)
//   5. Request dengan device header yang tidak sesuai token -> DITOLAK
//   6. POST /api/register lama -> DITOLAK
//   7. Pembersihan data uji
//
// Cara pakai:
//   node scripts/smoke-registration.js
//
// Catatan: endpoint analisis invoice punya rate limit per IP
// (REGISTER_RATE_LIMIT, default 10/jam). Beri jeda bila mengulang berkali-kali.

const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const mongoStore = require('../server/mongoStore');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5000';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database', 'app.db');
const MERCHANT_KEY = process.env.LYNK_MERCHANT_KEY || '';
const results = [];

const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? `  -> ${detail}` : ''}`);
};

const sha256Hex = (input) => crypto.createHash('sha256').update(input, 'utf8').digest('hex');

// PDF invoice minimal yang tetap valid: header + xref dengan offset tepat.
function buildInvoicePdf({ email, refId, product, total }) {
  const lines = [
    ['Lynk.id - Invoice Pembelian', 16],
    ['--------------------------------', 11],
    [`Email: ${email}`, 11],
    [`Produk: ${product}`, 11],
    [`Total: Rp ${total}`, 11],
    [`REF ID: ${refId}`, 13],
    ['Status: LUNAS', 11]
  ];
  let y = 780;
  const content = lines
    .map(([text, size]) => {
      const block = `BT /F1 ${size} Tf 50 ${y} Td (${text}) Tj ET`;
      y -= 30;
      return block;
    })
    .join('\n');

  const objects = {
    1: '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    2: '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    3: '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    4: '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    5: `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`
  };

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i <= 5; i += 1) {
    offsets[i] = pdf.length;
    pdf += objects[i];
  }
  const xrefOffset = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const postJson = (route, body, headers = {}) =>
  fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    db.run(sql, params, function (err) {
      db.close();
      err ? reject(err) : resolve(this);
    });
  });

async function main() {
  console.log(`\n=== Smoke registrasi Lynk.id terhadap ${BASE} ===\n`);

  // Pastikan server hidup
  try {
    const health = await (await fetch(`${BASE}/api/health`)).json();
    if (health.status !== 'ok') throw new Error('not ok');
  } catch (err) {
    console.log(`Server tidak bisa dihubungi (${err.message}). Jalankan: npm run server`);
    process.exit(1);
  }

  if (!MERCHANT_KEY) {
    console.error('Isi LYNK_MERCHANT_KEY di .env sebelum menjalankan tes registrasi webhook.');
    process.exit(1);
  }

  const suffix = Date.now().toString(36);
  const testEmail = `regtest-${suffix}@example.com`;
  // REF ID: tepat 32 karakter huruf & angka.
  const refId = crypto.randomBytes(16).toString('hex').slice(0, 32).toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(32, '0').slice(0, 32);
  const messageId = `MSG-${suffix}`;
  const amount = 99000;
  const payload = {
    data: {
      message_data: {
        ref_id: refId,
        message_id: messageId,
        payment_status: 'paid',
        customer: { name: 'Reg Test', email: testEmail, phone: '6281234567890' },
        items: [{ title: 'Text to Speech with Natural Expression', qty: 1, price: amount }],
        totals: { total_price: amount, grand_total: amount },
        created_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
      }
    }
  };

  // ===== 1. Webhook Lynk.id =====
  const webhookHeaders = { 'Content-Type': 'application/json' };
  if (MERCHANT_KEY) {
    const signature = sha256Hex(`${amount}${refId}${messageId}${MERCHANT_KEY}`);
    webhookHeaders['X-Signature'] = signature;
  }
  const webhookRes = await postJson('/api/webhook/lynk', payload, webhookHeaders);
  const webhookBody = await webhookRes.json().catch(() => ({}));
  check(
    'POST /api/webhook/lynk menerima transaksi',
    webhookRes.ok && webhookBody.success === true,
    webhookBody.message || `ref=${refId}${MERCHANT_KEY ? ' (signed)' : ' (tanpa merchant key)'}`
  );

  // Signature salah selalu ditolak jika Merchant Key dikonfigurasi.
  if (MERCHANT_KEY) {
    const badRes = await postJson('/api/webhook/lynk', payload, {
      'X-Signature': 'deadbeefdeadbeef'
    });
    check(
      'Webhook signature salah DITOLAK',
      badRes.status === 401,
      `status ${badRes.status}`
    );
  }

  // ===== 2. Registrasi lewat upload invoice (AI membaca REF ID) =====
  const pdf = buildInvoicePdf({
    email: testEmail,
    refId,
    product: 'Text to Speech with Natural Expression',
    total: String(amount)
  });
  const regRes = await postJson('/api/register/invoice', {
    email: testEmail,
    invoice: {
      filename: `invoice-${suffix}.pdf`,
      type: 'application/pdf',
      data: pdf.toString('base64')
    }
  });
  const regBody = await regRes.json().catch(() => ({}));

  const createdEmail = regBody.email;
  let createdPassword = regBody.credentials?.password;
  const createdUsername = regBody.username;
  check(
    'POST /api/register/invoice membuat akun dari invoice',
    regRes.status === 201 && regBody.success === true && Boolean(createdUsername),
    regBody.message || `status ${regRes.status}`
  );
  check(
    'Akun memakai email pembeli dari webhook',
    createdEmail === testEmail,
    String(createdEmail)
  );

  if (!createdPassword && !regBody.emailSent) {
    check('Kredensial tersedia untuk uji login', false, 'password tidak dikembalikan');
  }

  // ===== 3. Recovery akun dengan REF dan email pembelian yang sama =====
  // Catatan: panggilan AI bisa gagal sesaat (503/429). Bila begitu, ulangi sekali.
  const registerAgain = async (requestEmail = testEmail) => {
    const res = await postJson('/api/register/invoice', {
      email: requestEmail,
      invoice: {
        filename: `invoice-ulang-${suffix}.pdf`,
        type: 'application/pdf',
        data: pdf.toString('base64')
      }
    });
    return { res, body: await res.json().catch(() => ({})) };
  };

  let reuse = await registerAgain();
  if (reuse.body.code === 'GEMINI_ERROR' || reuse.body.code === 'AI_ANALYSIS_FAILED') {
    console.log('     (Gemini sedang sibuk — mengulang sekali lagi)');
    await new Promise((resolve) => setTimeout(resolve, 4000));
    reuse = await registerAgain();
  }
  if (reuse.body.credentials?.password) createdPassword = reuse.body.credentials.password;
  check(
    'REF/email sama memulihkan akun dan mengirim ulang kredensial',
    reuse.res.status === 200 && reuse.body.success === true && reuse.body.recovered === true,
    reuse.body.code || `status ${reuse.res.status}`
  );
  check(
    'Recovery mempertahankan username akun',
    reuse.body.username === createdUsername,
    String(reuse.body.username)
  );

  const wrongEmailReuse = await registerAgain(`other-${suffix}@example.com`);
  check(
    'REF sama dengan email berbeda DITOLAK',
    wrongEmailReuse.res.status === 409 && wrongEmailReuse.body.code === 'EMAIL_MISMATCH',
    wrongEmailReuse.body.code || `status ${wrongEmailReuse.res.status}`
  );

  // ===== 4. Batas 2 device per akun =====
  if (createdUsername && createdPassword) {
    const loginWithDevice = async (deviceId) => {
      const res = await postJson('/api/login', {
        username: createdUsername,
        password: createdPassword,
        deviceId,
        fingerprint: `fp-${deviceId}`
      });
      const body = await res.json().catch(() => ({}));
      return { res, body };
    };

    const device1 = await loginWithDevice(`e2e-dev-1-${suffix}`);
    check('Login device 1 diterima', device1.res.ok && Boolean(device1.body.token),
      device1.body.message || '');

    const device2 = await loginWithDevice(`e2e-dev-2-${suffix}`);
    check('Login device 2 diterima', device2.res.ok && Boolean(device2.body.token),
      device2.body.message || '');

    const device3 = await loginWithDevice(`e2e-dev-3-${suffix}`);
    check(
      'Login device 3 DITOLAK (batas 2 device)',
      device3.res.status === 403 && device3.body.code === 'DEVICE_LIMIT',
      device3.body.message || `status ${device3.res.status}`
    );

    // ===== 5. Token tidak bisa dipakai di device lain =====
    const token = device1.body.token;
    if (token) {
      const stolen = await fetch(`${BASE}/api/profile`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-device-id': `e2e-dev-2-${suffix}`,
          'x-device-fp': `fp-e2e-dev-2-${suffix}`
        }
      });
      check(
        'Token device 1 di device 2 DITOLAK (binding device)',
        stolen.status === 401,
        `status ${stolen.status}`
      );

      const correct = await fetch(`${BASE}/api/profile`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-device-id': `e2e-dev-1-${suffix}`,
          'x-device-fp': `fp-e2e-dev-1-${suffix}`
        }
      });
      check('Akses dengan device yang benar diterima', correct.ok, `status ${correct.status}`);

      // Daftar device akun
      const devList = await fetch(`${BASE}/api/devices`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-device-id': `e2e-dev-1-${suffix}`,
          'x-device-fp': `fp-e2e-dev-1-${suffix}`
        }
      });
      const devListBody = await devList.json().catch(() => ({}));
      check(
        'GET /api/devices melaporkan 2 device',
        devList.ok && devListBody.deviceCount === 2 && devListBody.maxDevices === 2,
        `${devListBody.deviceCount}/${devListBody.maxDevices}`
      );
    }
  } else {
    console.log('[SKIP] Uji limit device (password tidak tersedia — SMTP mengirim email).');
  }

  // ===== 6. Registrasi lama tetap ditolak =====
  const oldReg = await postJson('/api/register', {
    username: `e2e-old-${suffix}`,
    email: `e2e-old-${suffix}@example.com`,
    password: 'rahasia123'
  });
  check('POST /api/register lama DITOLAK', oldReg.status === 403, `status ${oldReg.status}`);

  // ===== 7. Pembersihan data uji =====
  try {
    if (String(process.env.DATABASE_BACKEND || 'sqlite').toLowerCase() === 'mongodb') {
      await mongoStore.connect(process.env.MONGODB_URI, process.env.MONGODB_DATABASE || 'digiswara');
      const testUser = await mongoStore.findUserByEmail(testEmail);
      if (testUser) {
        await dbRun('DELETE FROM user_devices WHERE user_id = ?', [testUser.id]);
        await mongoStore.deleteUser(testUser.id);
      }
      await mongoStore.transactions.deleteOne({ ref_id: refId });
      await mongoStore.close();
    } else {
      await dbRun('DELETE FROM user_devices WHERE user_id IN (SELECT id FROM users WHERE email = ?)', [testEmail]);
      await dbRun('DELETE FROM users WHERE email = ?', [testEmail]);
      await dbRun('DELETE FROM lynk_transactions WHERE ref_id = ?', [refId]);
    }
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
  console.error('Smoke registrasi error:', err.message);
  process.exit(1);
});

