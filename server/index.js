require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const {
  normalizeRefId,
  isValidRefId,
  parseLynkPayload,
  verifyLynkSignature,
  upsertTransaction,
  getTransactionByRef
} = require('./lynk');
const { extractInvoiceData, ALLOWED_MIME_TYPES } = require('./invoiceAi');
const mailer = require('./mailer');
const devices = require('./devices');

const app = express();
const PORT = process.env.PORT || 5000;
const refLogTag = (refId) => crypto.createHash('sha256').update(String(refId || '')).digest('hex').slice(0, 12);
const HISTORY_TTL_MS = 5 * 60 * 1000;
const allowedClientOrigins = (process.env.CLIENT_ORIGINS
  || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const isPrivateLanDevOrigin = (origin) => {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.port !== '3000') return false;
    const octets = url.hostname.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }
    return octets[0] === 10
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
  } catch (_) {
    return false;
  }
};

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? false
    : (origin, callback) => callback(
      null,
      !origin || allowedClientOrigins.includes(origin) || isPrivateLanDevOrigin(origin)
    ),
  credentials: true
}));
// 15MB menampung invoice base64 (file maksimal 8MB -> ~10.7MB base64).
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_session_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 86400000 }
}));

// Database setup
const dbPath = process.env.DB_PATH || './database/app.db';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // TTS requests table (for rate limiting and history)
  db.run(`
    CREATE TABLE IF NOT EXISTS tts_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      voice_model TEXT NOT NULL,
      tone TEXT NOT NULL,
      language TEXT NOT NULL,
      audio_url TEXT,
      expires_at INTEGER,
      downloaded_at INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);

  db.run('ALTER TABLE tts_requests ADD COLUMN expires_at INTEGER', (err) => {
    if (err && !err.message.includes('duplicate column name')) console.error(err.message);
  });
  db.run('ALTER TABLE tts_requests ADD COLUMN downloaded_at INTEGER', (err) => {
    if (err && !err.message.includes('duplicate column name')) console.error(err.message);
  });
  db.run(
    `UPDATE tts_requests
     SET expires_at = CAST(strftime('%s', created_at) AS INTEGER) * 1000 + ?
     WHERE expires_at IS NULL`,
    [HISTORY_TTL_MS]
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS voiceover_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      target TEXT NOT NULL,
      tone TEXT NOT NULL,
      version_a TEXT NOT NULL,
      version_b TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);

  // REF ID Lynk.id yang sudah dipakai untuk mendaftar (1 REF = 1 akun).
  // SQLite tidak mengizinkan ALTER TABLE ADD COLUMN ... UNIQUE, jadi
  // keunikan ditegakkan lewat unique index terpisah (NULL tetap diizinkan).
  db.run('ALTER TABLE users ADD COLUMN lynk_ref_id TEXT', (err) => {
    if (err && !err.message.includes('duplicate column name')) console.error(err.message);
  });
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_lynk_ref_id ON users(lynk_ref_id)', (err) => {
    if (err) console.error(err.message);
  });
  db.run('ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1', (err) => {
    if (err && !err.message.includes('duplicate column name')) console.error(err.message);
  });

  // Transaksi Lynk.id yang diterima lewat webhook (bukti pembayaran).
  db.run(`
    CREATE TABLE IF NOT EXISTS lynk_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_id TEXT UNIQUE NOT NULL,
      message_id TEXT,
      email TEXT,
      customer_name TEXT,
      product_title TEXT,
      amount INTEGER,
      status TEXT,
      is_paid INTEGER DEFAULT 0,
      raw_payload TEXT,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Device aktif per akun (maksimal MAX_DEVICES, default 2).
  db.run(`
    CREATE TABLE IF NOT EXISTS user_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      fingerprint TEXT,
      user_agent TEXT,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, device_id),
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);
});
// Direktori penyimpanan file audio hasil generate (di-serve sebagai static file)
const AUDIO_DIR = process.env.AUDIO_DIR || path.join(__dirname, '..', 'public', 'audio');
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

const removeAudioFile = (audioUrl) => {
  if (!audioUrl || !audioUrl.startsWith('/audio/')) return;
  fs.rm(path.join(AUDIO_DIR, path.basename(audioUrl)), { force: true }, () => {});
};

const cleanupExpiredHistory = () => {
  const now = Date.now();
  db.all('SELECT audio_url FROM tts_requests WHERE expires_at <= ?', [now], (err, rows) => {
    if (err) {
      console.error('Audio history cleanup error:', err.message);
      return;
    }
    rows.forEach((row) => removeAudioFile(row.audio_url));
    db.run('DELETE FROM tts_requests WHERE expires_at <= ?', [now], (deleteErr) => {
      if (deleteErr) console.error('Audio history cleanup error:', deleteErr.message);
    });
  });
  db.run('DELETE FROM voiceover_history WHERE expires_at <= ?', [now], (err) => {
    if (err) console.error('Voiceover history cleanup error:', err.message);
  });
};

const cleanupTimer = setInterval(cleanupExpiredHistory, 10 * 1000);
cleanupTimer.unref();
const initialCleanup = setTimeout(cleanupExpiredHistory, 2000);
initialCleanup.unref();

app.use('/audio', (req, res, next) => {
  const audioUrl = `/audio/${path.basename(req.path)}`;
  db.get('SELECT expires_at FROM tts_requests WHERE audio_url = ?', [audioUrl], (err, row) => {
    if (err) return res.status(500).json({ message: 'Gagal memeriksa masa berlaku audio.' });
    if (!row || row.expires_at <= Date.now()) {
      return res.status(404).json({ message: 'Audio sudah kedaluwarsa atau tidak ditemukan.' });
    }
    next();
  });
});
app.use('/audio', express.static(AUDIO_DIR));

// Konfigurasi Gemini TTS
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_TTS_MODELS = [
  {
    id: 'gemini-3.8-flash-lite-tts',
    name: 'Gemini 3.8 Flash-Lite TTS',
    description: 'Throughput tinggi, latensi rendah, dan lebih hemat.',
    api: 'interactions'
  },
  {
    id: 'gemini-3.8-flash-tts',
    name: 'Gemini 3.8 Flash TTS',
    description: 'Kualitas suara dan ekspresi maksimal.',
    api: 'interactions'
  },
  {
    id: 'gemini-3.1-flash-tts-preview',
    name: 'Gemini 3.1 Flash TTS Preview',
    description: 'Legacy preview; ketersediaan dan kuota dapat berbeda.',
    api: 'generateContent'
  },
  {
    id: 'gemini-2.5-flash-preview-tts',
    name: 'Gemini 2.5 Flash TTS',
    description: 'Versi lama yang cepat; akses API dapat dibatasi.',
    api: 'generateContent'
  },
  {
    id: 'gemini-2.5-pro-preview-tts',
    name: 'Gemini 2.5 Pro TTS',
    description: 'Versi lama untuk narasi studio; akses API dapat dibatasi.',
    api: 'generateContent'
  }
];
const DEFAULT_GEMINI_TTS_MODELS = GEMINI_TTS_MODELS.map((model) => model.id);
const configuredGeminiTtsModels = (process.env.GEMINI_TTS_MODELS || DEFAULT_GEMINI_TTS_MODELS.join(','))
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);
const GEMINI_TTS_MODEL_ORDER = [...new Set(configuredGeminiTtsModels)]
  .map((modelId) => GEMINI_TTS_MODELS.find((model) => model.id === modelId))
  .filter(Boolean);
if (!GEMINI_TTS_MODEL_ORDER.length) {
  GEMINI_TTS_MODEL_ORDER.push(...GEMINI_TTS_MODELS);
}
const RETRYABLE_TTS_STATUSES = new Set([403, 404, 429, 500, 502, 503, 504]);
const XKIRO_VOICEOVER_MODELS = (process.env.XKIRO_VOICEOVER_MODELS ||
  'qwen/qwen3.7-flash:free,qwen/qwen3.8-omni-flash:free')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);
const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// JWT middleware + pengecekan device (maksimal MAX_DEVICES per akun).
const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_jwt_secret');
    req.user = decoded;

    const headerDeviceId = req.headers['x-device-id'];
    const headerFingerprint = req.headers['x-device-fp'];

    // Token lama (sebelum fitur device) wajib login ulang.
    if (!decoded.deviceId) {
      return res.status(401).json({
        message: 'Sesi lama tidak berlaku. Silakan login ulang.',
        code: 'DEVICE_REQUIRED'
      });
    }
    // Token tidak boleh dipindahkan ke device lain: device_id di header wajib
    // sama dengan yang diikat di JWT.
    if (!headerDeviceId || headerDeviceId !== decoded.deviceId) {
      return res.status(401).json({
        message: 'Akses ditolak: sesi tidak cocok dengan device ini.',
        code: 'DEVICE_MISMATCH'
      });
    }

    devices.assertDevice(
      db,
      {
        userId: decoded.id,
        deviceId: headerDeviceId,
        fingerprint: typeof headerFingerprint === 'string' ? headerFingerprint : null
      },
      (err, result) => {
        if (err) {
          return res.status(500).json({ message: 'Database error' });
        }
        if (!result.ok) {
          if (result.code === 'DEVICE_LIMIT') {
            return res.status(401).json({
              message: `Akun ini sudah terpakai di ${devices.MAX_DEVICES} device. Logout di salah satu device lain terlebih dahulu.`,
              code: 'DEVICE_LIMIT'
            });
          }
          return res.status(401).json({
            message: 'Device tidak dikenal. Silakan login ulang.',
            code: 'DEVICE_REQUIRED'
          });
        }
        next();
      }
    );
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// Routes

// Registrasi TIDAK TERBUKA untuk umum. Akun hanya dibuat lewat verifikasi
// invoice pembelian Lynk.id (lihat POST /api/register/invoice).
app.post('/api/register', (req, res) => {
  res.status(403).json({
    message: 'Registrasi hanya bisa melalui halaman aktivasi pembelian. Beli dulu di Lynk.id, lalu upload invoice di halaman registrasi.',
    code: 'REGISTRATION_BY_INVOICE_ONLY'
  });
});

// Login (username ATAU email) + registrasi device dengan batas MAX_DEVICES.
app.post('/api/login', (req, res) => {
  try {
    const { username, password, deviceId, fingerprint } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Please enter all fields' });
    }
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 100) {
      return res.status(400).json({
        message: 'Device tidak dikenal. Buka aplikasi dari browser yang sama.',
        code: 'DEVICE_REQUIRED'
      });
    }

    const query = 'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1';
    db.get(query, [username.trim(), username.trim().toLowerCase()], async (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }
      if (!user) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }

      const ip =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'] || null;
      const safeFingerprint =
        typeof fingerprint === 'string' && fingerprint.length <= 128 ? fingerprint : null;

      devices.registerDevice(
        db,
        {
          userId: user.id,
          deviceId,
          fingerprint: safeFingerprint,
          userAgent,
          ip
        },
        (deviceErr, deviceResult) => {
          if (deviceErr) {
            return res.status(500).json({ message: 'Database error' });
          }
          if (!deviceResult.ok) {
            return res.status(403).json({
              message: `Akun ini sudah terpakai di ${deviceResult.maxDevices} device berbeda. Batas maksimal adalah ${deviceResult.maxDevices} device — logout dulu di salah satu device lain sebelum login di sini.`,
              code: 'DEVICE_LIMIT',
              maxDevices: deviceResult.maxDevices
            });
          }

          const token = jwt.sign(
            {
              id: user.id,
              username: user.username,
              deviceId,
              fingerprint: safeFingerprint
            },
            process.env.JWT_SECRET || 'fallback_jwt_secret',
            { expiresIn: '7d' }
          );

          res.json({
            token,
            user: { id: user.id, username: user.username, email: user.email }
          });
        }
      );
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== Webhook Lynk.id =====
// Daftarkan URL ini di dashboard Lynk.id: Settings > Integrations > Webhooks
//   https://<domain-kamu>/api/webhook/lynk
// Lynk.id mengirim header "X-Signature" = SHA256(amount + ref_id + message_id + merchant_key).
app.post('/api/webhook/lynk', (req, res) => {
  try {
    const payload = req.body;
    const signatureHeader = req.headers['x-signature']
      ? 'x-signature'
      : req.headers['x-lynk-signature'] ? 'x-lynk-signature' : 'missing';
    console.log(`[webhook:lynk] ${new Date().toISOString()} request diterima signatureHeader=${signatureHeader}`);

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ success: false, message: 'Payload kosong atau tidak valid.' });
    }

    const merchantKey = process.env.LYNK_MERCHANT_KEY || '';
    const signature = req.headers['x-signature'] || req.headers['x-lynk-signature'];

    const parsed = parseLynkPayload(payload);
    const refTag = refLogTag(parsed.refId);
    console.log(
      `[webhook:lynk] parsed: refTag=${refTag} refIdLength=${parsed.refId.length} amount=${parsed.amount} statusRaw=${parsed.statusRaw} isPaid=${parsed.isPaid} messageIdCount=${parsed.messageIdCandidates.length}`
    );

    if (!merchantKey) {
      return res.status(500).json({
        success: false,
        code: 'WEBHOOK_NOT_CONFIGURED',
        message: 'LYNK_MERCHANT_KEY belum diisi di file .env.'
      });
    }

    const verify = verifyLynkSignature({ payload, signature, merchantKey, parsed });
    console.log('[webhook:lynk] verifyLynkSignature result:', JSON.stringify({
      ok: verify.ok,
      reason: verify.reason,
      signaturePresent: Boolean(signature),
      merchantKeyConfigured: Boolean(merchantKey),
      refTag,
      refIdLength: parsed.refId.length,
      amount: parsed.amount,
      statusRaw: parsed.statusRaw
    }));
    if (!verify.ok) {
      console.warn(`Webhook Lynk.id ditolak (${verify.reason}).`);
      return res.status(401).json({ success: false, message: 'Signature tidak valid.' });
    }

    if (!isValidRefId(parsed.refId)) {
      console.warn(`[webhook:lynk] REF ID tidak valid refTag=${refTag} refIdLength=${parsed.refId.length}`);
      return res.status(422).json({
        success: false,
        message: 'REF ID 32 karakter tidak ditemukan di payload.'
      });
    }

    console.log(`[webhook:lynk] sebelum upsertTransaction: refTag=${refTag} amount=${parsed.amount} status=${parsed.statusRaw}`);
    upsertTransaction(
      db,
      { ...parsed, rawPayload: payload },
      (err) => {
        if (err) {
          console.error('[webhook:lynk] upsertTransaction gagal:', err.message);
          console.error('Webhook Lynk.id gagal menyimpan transaksi:', err.message);
          return res.status(500).json({ success: false, message: 'Gagal menyimpan transaksi.' });
        }
        console.log(`[webhook:lynk] setelah upsertTransaction: berhasil menyimpan refTag=${refTag}`);
        console.log(
          `Webhook Lynk.id diterima: refTag=${refTag} paid=${parsed.isPaid} status=${parsed.statusRaw || 'missing'} product=${parsed.productTitle || '-'}`
        );
        res.json({ success: true, refId: parsed.refId, isPaid: parsed.isPaid });
      }
    );
  } catch (err) {
    console.error('Webhook Lynk.id error:', err.message);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// ===== Registrasi lewat verifikasi invoice =====

// Batasi percobaan analisis invoice per IP (analisis memakai kuota AI).
const invoiceAttempts = new Map();
const INVOICE_RATE_LIMIT = Number(process.env.REGISTER_RATE_LIMIT || 10);
const INVOICE_RATE_WINDOW_MS = 60 * 60 * 1000;
const checkInvoiceRateLimit = (key) => {
  const now = Date.now();
  const entry = invoiceAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    invoiceAttempts.set(key, { count: 1, resetAt: now + INVOICE_RATE_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= INVOICE_RATE_LIMIT;
};

// Username diambil dari email pembeli, dilepas jika bentrok.
const generateUsernameFromEmail = (email, callback) => {
  const base = String(email)
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '');
  const root = base.length >= 3 ? base : `user${base}`;

  const tryInsert = (candidate, attempt) => {
    db.get('SELECT id FROM users WHERE username = ?', [candidate], (err, row) => {
      if (err) return callback(err);
      if (!row) return callback(null, candidate);
      if (attempt > 50) return callback(new Error('Username tidak tersedia.'));
      tryInsert(`${root}${attempt + 1}`, attempt + 1);
    });
  };
  tryInsert(root, 1);
};

// Password acak 12 karakter (huruf + angka) untuk akun hasil aktivasi.
const generateRandomPassword = () => {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let password = '';
  for (let i = 0; i < 12; i += 1) {
    password += charset[bytes[i] % charset.length];
  }
  return password;
};

// POST /api/register/invoice
// Body: { email?, invoice: { filename, type, data(base64) } }
app.post('/api/register/invoice', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  if (!checkInvoiceRateLimit(ip)) {
    return res.status(429).json({
      message: 'Terlalu banyak percobaan. Coba lagi dalam satu jam.',
      code: 'RATE_LIMITED'
    });
  }

  try {
    const { email, invoice } = req.body || {};

    if (!invoice || !invoice.data || !invoice.type) {
      return res.status(400).json({
        message: 'Upload file invoice (PDF atau gambar) terlebih dahulu.',
        code: 'INVOICE_REQUIRED'
      });
    }
    if (!ALLOWED_MIME_TYPES.has(invoice.type)) {
      return res.status(400).json({
        message: 'Format file harus PDF, PNG, JPG, JPEG, WEBP, atau GIF.',
        code: 'INVALID_FILE_TYPE'
      });
    }

    const base64Data = String(invoice.data);
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64Data)) {
      return res.status(400).json({ message: 'File invoice rusak.', code: 'INVALID_FILE' });
    }
    const approxBytes = Math.floor(base64Data.length * 0.75);
    if (approxBytes > 8 * 1024 * 1024) {
      return res.status(400).json({
        message: 'Ukuran file maksimal 8MB.',
        code: 'FILE_TOO_LARGE'
      });
    }

    // --- Analisis invoice dengan AI (Gemini Vision) ---
    let extracted;
    try {
      extracted = await extractInvoiceData({ base64Data, mimeType: invoice.type });
    } catch (aiErr) {
      if (String(aiErr.code || '').startsWith('TOKENHARBOR_')) {
        console.error('TokenHarbor invoice analysis failed:', aiErr.message);
      }
      const status =
        aiErr.code === 'INVALID_FILE_TYPE' ? 400
        : aiErr.status === 429 ? 429
        : 502;
      return res.status(status).json({
        message: aiErr.message || 'Gagal menganalisis invoice.',
        code: aiErr.code || 'AI_ANALYSIS_FAILED'
      });
    }

    if (!extracted.isInvoice) {
      return res.status(422).json({
        message: 'File ini bukan invoice pembelian Lynk.id. Upload invoice yang dikirim ke email kamu.',
        code: 'NOT_AN_INVOICE'
      });
    }
    if (!extracted.refId) {
      return res.status(422).json({
        message: 'REF ID (32 karakter huruf dan angka) tidak ditemukan di invoice. Pastikan upload invoice asli dari Lynk.id.',
        code: 'REF_NOT_FOUND'
      });
    }

    // --- Cek transaksi dari webhook Lynk.id ---
    const refTag = refLogTag(extracted.refId);
    console.log(`[register:invoice] ${new Date().toISOString()} query getTransactionByRef refTag=${refTag} refIdLength=${String(extracted.refId).length}`);
    const transaction = await new Promise((resolve, reject) => {
      getTransactionByRef(db, extracted.refId, (err, row) =>
        err ? reject(err) : resolve(row)
      );
    });
    if (transaction) {
      console.log(
        `[register:invoice] ${new Date().toISOString()} transaksi ditemukan:`,
        JSON.stringify({
          refTag,
          amount: transaction.amount,
          status: transaction.status,
          is_paid: transaction.is_paid,
          received_at: transaction.received_at
        })
      );
    } else {
      console.warn(`[register:invoice] ${new Date().toISOString()} transaksi TIDAK ditemukan untuk refTag=${refTag}`);
    }

    if (!transaction) {
      return res.status(404).json({
        message: 'Pembayaran dengan REF ID ini belum diterima. Pastikan pembayaran selesai di Lynk.id lalu coba lagi beberapa saat.',
        code: 'REF_NOT_REGISTERED'
      });
    }
    if (!transaction.is_paid) {
      return res.status(402).json({
        message: 'Pembayaran belum dikonfirmasi oleh Lynk.id.',
        code: 'NOT_PAID'
      });
    }

    const expectedProduct = String(
      process.env.LYNK_PRODUCT_NAME || 'Text to Speech with Natural Expression'
    ).trim().toLowerCase();
    const purchasedProduct = String(transaction.product_title || '').trim().toLowerCase();
    if (!purchasedProduct || purchasedProduct !== expectedProduct) {
      return res.status(403).json({
        message: 'Transaksi ini bukan untuk produk Text to Speech yang didukung.',
        code: 'PRODUCT_MISMATCH'
      });
    }

    const purchaseEmail = transaction.email
      ? String(transaction.email).toLowerCase()
      : null;
    if (!purchaseEmail) {
      return res.status(422).json({
        message: 'Email pembelian tidak ditemukan di data transaksi. Hubungi admin.',
        code: 'EMAIL_MISSING'
      });
    }

    const providedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (providedEmail && providedEmail !== purchaseEmail) {
      return res.status(409).json({
        message: `Email tidak cocok dengan email pembelian (${purchaseEmail}).`,
        code: 'EMAIL_MISMATCH',
        purchaseEmail
      });
    }

    // REF ID hanya boleh dipakai satu kali; email juga unik.
    const usedBy = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, email FROM users WHERE lynk_ref_id = ? OR email = ?',
        [extracted.refId, purchaseEmail],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });
    if (usedBy) {
      const sameEmail = String(usedBy.email).toLowerCase() === purchaseEmail;
      return res.status(409).json({
        message: sameEmail
          ? 'Email ini sudah memiliki akun. Silakan login.'
          : 'REF ID ini sudah pernah dipakai untuk membuat akun.',
        code: sameEmail ? 'EMAIL_ALREADY_REGISTERED' : 'REF_ALREADY_USED'
      });
    }

    // --- Buat akun: email pembeli + password acak ---
    const username = await new Promise((resolve, reject) => {
      generateUsernameFromEmail(purchaseEmail, (err, name) =>
        err ? reject(err) : resolve(name)
      );
    });
    const plainPassword = generateRandomPassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const userId = await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (username, email, password, lynk_ref_id) VALUES (?, ?, ?, ?)',
        [username, purchaseEmail, hashedPassword, extracted.refId],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    }).catch((insertErr) => {
      if (String(insertErr.message || '').includes('UNIQUE')) {
        const conflict = new Error('REF ID atau email sudah terdaftar.');
        conflict.code = 'ALREADY_REGISTERED';
        throw conflict;
      }
      throw insertErr;
    });

    // --- Kirim username & password ke email pembeli ---
    const loginUrl = process.env.APP_URL || `http://localhost:${PORT}`;
    let emailSent = false;
    let devCredentials = null;

    try {
      await mailer.sendCredentialsEmail({
        to: purchaseEmail,
        username,
        password: plainPassword,
        loginUrl
      });
      emailSent = true;
    } catch (mailErr) {
      if (mailErr.code === 'SMTP_NOT_CONFIGURED' && process.env.NODE_ENV !== 'production') {
        // Mode pengembangan: SMTP belum diisi -> akun tetap dibuat, kredensial
        // dikembalikan di respons supaya tetap bisa diuji.
        console.warn('SMTP belum dikonfigurasi; kredensial dikirim via respons (dev only).');
        devCredentials = { username, password: plainPassword };
      } else {
        // Produksi: gagal kirim email = gagal registrasi; hapus akun agar bisa dicoba ulang.
        await new Promise((resolve) =>
          db.run('DELETE FROM users WHERE id = ?', [userId], () => resolve())
        );
        console.error('Gagal mengirim email kredensial:', mailErr.message);
        return res.status(502).json({
          message: 'Gagal mengirim email kredensial. Akun belum dibuat — coba lagi nanti.',
          code: 'EMAIL_FAILED'
        });
      }
    }

    res.status(201).json({
      success: true,
      message: `Akun berhasil dibuat! Username dan password dikirim ke ${purchaseEmail}.`,
      email: purchaseEmail,
      username,
      emailSent,
      refId: extracted.refId,
      ...(devCredentials
        ? {
            credentials: devCredentials,
            devWarning: 'SMTP belum dikonfigurasi — kredensial hanya ditampilkan di sini (non-production).'
          }
        : {})
    });
  } catch (err) {
    if (err.code === 'ALREADY_REGISTERED') {
      return res.status(409).json({ message: err.message, code: 'ALREADY_REGISTERED' });
    }
    console.error('Registrasi invoice error:', err);
    res.status(500).json({ message: 'Terjadi kesalahan server. Coba lagi.', code: 'SERVER_ERROR' });
  }
});

// ===== Device (maksimal MAX_DEVICES per akun) =====
app.get('/api/devices', authenticateJWT, (req, res) => {
  devices.listDevices(db, req.user.id, (err, rows) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json({
      maxDevices: devices.MAX_DEVICES,
      deviceCount: (rows || []).length,
      devices: rows || []
    });
  });
});

// Lepaskan device saat ini (dipanggil saat logout agar slot tidak terbuang).
app.delete('/api/devices/current', authenticateJWT, (req, res) => {
  devices.releaseDevice(db, req.user.id, req.user.deviceId, (err) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json({ success: true, message: 'Device dilepas dari akun.' });
  });
});

// Get user profile
app.get('/api/profile', authenticateJWT, (req, res) => {
  const query = 'SELECT id, username, email, created_at FROM users WHERE id = ?';
  db.get(query, [req.user.id], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Database error' });
    }
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user });
  });
});

// Get TTS history
app.get('/api/history', authenticateJWT, (req, res) => {
  cleanupExpiredHistory();
  const now = Date.now();
  db.all(
    `SELECT id, text, voice_model, tone, language, audio_url, created_at, expires_at, downloaded_at
     FROM tts_requests
     WHERE user_id = ? AND expires_at > ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.user.id, now],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      db.all(
        `SELECT id, target, tone, version_a, version_b, created_at, expires_at
         FROM voiceover_history
         WHERE user_id = ? AND expires_at > ?
         ORDER BY created_at DESC
         LIMIT 50`,
        [req.user.id, now],
        (voiceoverErr, voiceovers) => {
          if (voiceoverErr) return res.status(500).json({ message: 'Database error' });
          res.json({ history: rows, voiceovers });
        }
      );
    }
  );
});

app.post('/api/history/:id/downloaded', authenticateJWT, (req, res) => {
  db.run(
    'UPDATE tts_requests SET downloaded_at = ? WHERE id = ? AND user_id = ? AND expires_at > ?',
    [Date.now(), req.params.id, req.user.id, Date.now()],
    function (err) {
      if (err) return res.status(500).json({ message: 'Gagal memperbarui status unduhan.' });
      if (!this.changes) return res.status(404).json({ message: 'Riwayat audio sudah kedaluwarsa.' });
      res.json({ success: true });
    }
  );
});

app.delete('/api/voiceover-history/:id', authenticateJWT, (req, res) => {
  db.run(
    'DELETE FROM voiceover_history WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ message: 'Gagal menghapus riwayat voice over.' });
      if (!this.changes) return res.status(404).json({ message: 'Riwayat tidak ditemukan.' });
      res.json({ success: true });
    }
  );
});

// Hapus satu item riwayat (beserta file audionya)
app.delete('/api/history/:id', authenticateJWT, (req, res) => {
  const historyId = req.params.id;

  db.get(
    'SELECT id, audio_url FROM tts_requests WHERE id = ? AND user_id = ?',
    [historyId, req.user.id],
    (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }
      if (!row) {
        return res.status(404).json({ message: 'Riwayat tidak ditemukan' });
      }

      // Hapus file audio dari disk (abaikan kalau sudah tidak ada)
      if (row.audio_url && row.audio_url.startsWith('/audio/')) {
        const filePath = path.join(AUDIO_DIR, path.basename(row.audio_url));
        fs.rm(filePath, { force: true }, () => {});
      }

      db.run('DELETE FROM tts_requests WHERE id = ?', [historyId], (deleteErr) => {
        if (deleteErr) {
          return res.status(500).json({ message: 'Gagal menghapus riwayat' });
        }
        res.json({ success: true, message: 'Riwayat berhasil dihapus' });
      });
    }
  );
});

// Statistik ringkas untuk halaman profil
app.get('/api/profile/stats', authenticateJWT, (req, res) => {
  db.get(
    `SELECT
       COUNT(*) AS total,
       COUNT(DISTINCT voice_model) AS total_voices,
       COUNT(DISTINCT tone) AS total_tones
     FROM tts_requests WHERE user_id = ?`,
    [req.user.id],
    (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }
      res.json({
        stats: {
          total: row?.total || 0,
          totalVoices: row?.total_voices || 0,
          totalTones: row?.total_tones || 0
        }
      });
    }
  );
});

// Katalog model suara — basis data dari repo gemini-live-tts
// (hashimmalikdev/gemini-live-tts, MIT): 30 preset voice Gemini Live.
// Engine app ini tetap REST generateContent (stabil, bisa simpan WAV + riwayat).
// Referensi: https://ai.google.dev/gemini-api/docs/speech-generation#voices
const GEMINI_LIVE_VOICES = require('./gemini-live-voices');
const voiceModels = GEMINI_LIVE_VOICES;
// Voice lain tetap tersimpan di katalog; tambahkan ID di sini untuk menampilkannya kembali.
const activeVoiceIds = new Set([
  'zephyr', 'leda', 'achernar', 'kore', 'aoede', 'autonoe', 'despina',
  'erinome', 'fenrir', 'orus', 'alnilam', 'charon', 'algieba', 'algenib'
]);
const activeVoiceModels = voiceModels.filter((voice) => activeVoiceIds.has(voice.id));

// Variasi nada bicara. `stylePrompt` ditulis dalam bahasa Inggris karena
// instruksi gaya berbahasa Inggris memberi hasil paling stabil pada Gemini TTS,
// sementara teks yang dibacakan tetap memakai bahasa aslinya (Indonesia).
const tones = [
  { id: 'professional', name: 'Profesional', description: 'Rapi, formal, dan berwibawa', stylePrompt: 'in a polished, professional tone' },
  { id: 'enthusiastic', name: 'Antusias', description: 'Penuh energi dan semangat', stylePrompt: 'with energetic, enthusiastic delivery' },
  { id: 'convincing', name: 'Meyakinkan', description: 'Tegas dengan penekanan yang kuat', stylePrompt: 'in a persuasive, convincing tone' },
  { id: 'casual', name: 'Santai', description: 'Rileks seperti sedang mengobrol', stylePrompt: 'in a relaxed, conversational tone' },
  { id: 'educational', name: 'Edukatif', description: 'Jelas dan mudah dipahami', stylePrompt: 'in a clear, educational tone' },
  { id: 'humorous', name: 'Humor', description: 'Ringan dan menghibur', stylePrompt: 'in a light, humorous tone' },
  { id: 'inspiring', name: 'Inspiratif', description: 'Memotivasi dan membangkitkan semangat', stylePrompt: 'in an inspiring, uplifting tone' },
  { id: 'serious', name: 'Serius', description: 'Fokus dan penuh kesungguhan', stylePrompt: 'in a serious, focused tone' },
  { id: 'dramatic', name: 'Dramatis', description: 'Emosional dan intens', stylePrompt: 'in a dramatic, emotionally expressive tone' },
  { id: 'friendly', name: 'Ramah', description: 'Hangat dan bersahabat', stylePrompt: 'in a warm, friendly tone' },
  { id: 'empathetic', name: 'Empatik', description: 'Penuh pengertian dan kepedulian', stylePrompt: 'in a compassionate, empathetic tone' },
  { id: 'romantic', name: 'Romantis', description: 'Lembut dan penuh kasih', stylePrompt: 'in a tender, romantic tone' },
  { id: 'whispering', name: 'Berbisik', description: 'Lirih dan intim', stylePrompt: 'in a soft whisper' },
  { id: 'sad', name: 'Sedih', description: 'Sendu dan menyentuh', stylePrompt: 'in a sorrowful, subdued tone' },
  { id: 'mysterious', name: 'Misterius', description: 'Penuh rahasia dan rasa penasaran', stylePrompt: 'in a mysterious, suspenseful tone' },
  { id: 'confident', name: 'Percaya Diri', description: 'Mantap, jelas, dan optimistis', stylePrompt: 'in a confident, assured tone' },
  { id: 'playful', name: 'Playful', description: 'Ceria, luwes, dan ekspresif', stylePrompt: 'in a playful, lively tone' },
  { id: 'joking', name: 'Bercanda Gurau', description: 'Ceria, jenaka, dengan tawa ringan yang natural', stylePrompt: 'in a joking, playful tone, with natural chuckles and light laughter while speaking; keep the laughter warm and do not laugh over every word' },
];
// Get voice models
app.get('/api/voices/models', authenticateJWT, (req, res) => {
  res.json({ voiceModels: activeVoiceModels });
});

// Get tones
app.get('/api/voices/tones', authenticateJWT, (req, res) => {
  res.json({ tones });
});

// Generate a voiceover script with the configured Xkiro models in fallback order.
app.post('/api/voiceover/generate', authenticateJWT, async (req, res) => {
  const {
    target, audienceGender, audienceAge, audienceActivity,
    duration, description, tone, expressionTags
  } = req.body;

  if (!target || !String(target).trim()) {
    return res.status(400).json({ message: 'Target voice over wajib diisi.' });
  }
  if (!['15', '30', '60', '90'].includes(String(duration))) {
    return res.status(400).json({ message: 'Pilih durasi voice over yang tersedia.' });
  }
  if (!tones.some((item) => item.id === tone)) {
    return res.status(400).json({ message: 'Pilih nada bicara yang tersedia.' });
  }
  if (!process.env.XKIRO_API_KEY) {
    return res.status(500).json({
      message: 'XKIRO_API_KEY belum diisi di file .env.'
    });
  }

  const selectedTone = tones.find((item) => item.id === tone);
  const durationSeconds = Number(duration);
  const prompt = [
    'Buat naskah voice over berbahasa Indonesia berdasarkan brief berikut.',
    'Keluarkan hanya naskah siap dibacakan, tanpa judul, catatan, atau penjelasan.',
    `Target: ${String(target).trim()}`,
    `Audiens: gender ${audienceGender || 'umum'}, usia ${audienceAge || 'umum'}, aktivitas/pekerjaan ${audienceActivity || 'umum'}`,
    `Durasi: sekitar ${durationSeconds} detik (gunakan jumlah kata yang wajar untuk durasi tersebut).`,
    `Nada bicara: ${selectedTone.name}. ${selectedTone.description}.`,
    `Deskripsi tambahan: ${String(description || '').trim() || 'Tidak ada.'}`,
    expressionTags
      ? 'Tambahkan penanda ekspresi singkat dalam tanda kurung siku pada setiap jeda antarkalimat dan perubahan penyampaian yang penting, misalnya [fast, excitedly] atau [slow]. Jangan membacakan penandanya.'
      : 'Jangan gunakan penanda ekspresi atau instruksi dalam tanda kurung siku.'
  ].join('\n');

  const variants = [
    {
      label: 'Versi A',
      direction: 'Tulis versi A dengan pembuka berupa hook langsung ke manfaat utama, gaya jelas dan persuasif.'
    },
    {
      label: 'Versi B',
      direction: 'Tulis versi B yang berbeda nyata dari versi A: gunakan sudut pandang dan pembuka alternatif, dengan alur lebih naratif dan emosional. Jangan sekadar memparafrasekan.'
    }
  ];

  try {
    const generatedVersions = await Promise.all(variants.map(async (variant) => ({
      ...variant,
      ...(await generateVoiceoverWithXkiro(`${prompt}\n\n${variant.direction}`))
    })));
    const expiresAt = Date.now() + HISTORY_TTL_MS;
    db.run(
      `INSERT INTO voiceover_history (user_id, target, tone, version_a, version_b, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, String(target).trim(), selectedTone.name,
        generatedVersions[0].script, generatedVersions[1].script, expiresAt],
      function (err) {
        if (err) return res.status(500).json({ message: 'Gagal menyimpan riwayat voice over.' });
        res.json({
          id: this.lastID,
          versions: generatedVersions.map(({ label, script, model }) => ({ label, script, model })),
          expiresAt
        });
      }
    );
  } catch (err) {
    const status = err.status === 429 ? 429 : 502;
    res.status(status).json({ message: err.message });
  }
});

async function generateVoiceoverWithXkiro(prompt) {
  let lastError = 'Tidak ada model Xkiro yang berhasil membuat naskah.';
  let lastStatus = 502;
  for (const model of XKIRO_VOICEOVER_MODELS) {
    try {
      const response = await fetch('https://api.xkiro.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.XKIRO_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8,
          max_tokens: 1200
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastStatus = response.status;
        lastError = data.error?.message || data.message || `Xkiro API error (${response.status}).`;
        console.warn(`Xkiro model ${model} gagal (${response.status}); mencoba fallback.`);
        continue;
      }
      const responseContent = data.choices?.[0]?.message?.content;
      const script = (typeof responseContent === 'string'
        ? responseContent
        : Array.isArray(responseContent)
          ? responseContent.map((part) => part.text || '').join('')
          : '').trim();
      if (script) return { script, model: data.model || model };
      lastError = 'Xkiro tidak mengembalikan naskah.';
    } catch {
      lastError = 'Tidak dapat terhubung ke Xkiro. Coba lagi sebentar.';
      console.warn(`Xkiro model ${model} tidak dapat dijangkau; mencoba fallback.`);
    }
  }
  const error = new Error(lastError);
  error.status = lastStatus;
  throw error;
}

// Generate speech dengan Gemini TTS
app.post('/api/tts/generate', authenticateJWT, async (req, res) => {
  const userId = req.user.id;
  try {
    const { text, voiceModel, tone, language, expressionTags } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Teks tidak boleh kosong.' });
    }

    if (text.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Teks terlalu panjang. Maksimal 5000 karakter per sekali generate.'
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        message:
          'GEMINI_API_KEY belum diisi. Buat file .env lalu isi API key dari https://aistudio.google.com/apikey'
      });
    }

    const selectedVoice = voiceModels.find((v) => v.id === voiceModel) || voiceModels[0];
    const selectedTone = tones.find((t) => t.id === tone) || tones[0];
    const langCode = language || selectedVoice.language;

    const { buffer, mimeType, extension } = await generateSpeechWithFallback(
      text.trim(),
      selectedVoice,
      selectedTone,
      expressionTags
    );

    // Simpan file audio supaya bisa diputar ulang dari riwayat
    const fileName = `tts-${userId}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(AUDIO_DIR, fileName), buffer);
    const audioUrl = `/audio/${fileName}`;

    // Catat ke riwayat
    const expiresAt = Date.now() + HISTORY_TTL_MS;
    db.run(
      `INSERT INTO tts_requests (user_id, text, voice_model, tone, language, audio_url, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, text, selectedVoice.id, selectedTone.id, langCode, audioUrl, expiresAt],
      function (err) {
        if (err) {
          removeAudioFile(audioUrl);
          return res.status(500).json({ success: false, message: 'Gagal menyimpan riwayat audio.' });
        }
        res.json({
          success: true,
          id: this.lastID,
          audioUrl,
          mimeType,
          voiceModel: selectedVoice.id,
          voiceName: selectedVoice.voiceName,
          tone: selectedTone.id,
          language: langCode,
          expiresAt,
          message: 'Suara berhasil dibuat.'
        });
      }
    );
  } catch (err) {
    console.error('TTS Error:', err.message);
      const message = err.status === 429
        ? 'Kuota Gemini API sedang penuh untuk semua model yang dikonfigurasi. Coba lagi nanti atau cek tier proyek.'
        : err.message || 'Gagal membuat suara.';
      res.status(err.status === 429 ? 429 : 502).json({ success: false, message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const CLIENT_BUILD_DIR = path.join(__dirname, '..', 'client', 'build');
app.use(express.static(CLIENT_BUILD_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(CLIENT_BUILD_DIR, 'index.html'));
});

// ===== Gemini TTS =====

// Wrap raw PCM responses for compatibility if a non-WAV TTS model is configured.
function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // panjang blok fmt
  header.writeUInt16LE(1, 20); // format 1 = PCM tanpa kompresi
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

async function generateSpeechWithFallback(text, voiceModel, tone, expressionTags = false) {
  let lastError;
  for (let index = 0; index < GEMINI_TTS_MODEL_ORDER.length; index += 1) {
    const model = GEMINI_TTS_MODEL_ORDER[index];
    try {
      return await generateSpeechWithGemini(text, voiceModel, tone, expressionTags, model.id);
    } catch (error) {
      lastError = error;
      const hasFallback = index < GEMINI_TTS_MODEL_ORDER.length - 1;
      if (!hasFallback || !RETRYABLE_TTS_STATUSES.has(error.status)) break;
      console.warn(`Gemini TTS model ${model.id} returned ${error.status}; trying the next configured model.`);
    }
  }
  throw lastError || new Error('Tidak ada model Gemini TTS yang dikonfigurasi.');
}

async function generateSpeechWithGemini(text, voiceModel, tone, expressionTags = false, ttsModel) {
  const model = GEMINI_TTS_MODELS.find((item) => item.id === ttsModel);
  if (!model) throw new Error('Model TTS tidak dikenal.');
  if (model.api === 'generateContent') {
    return generateSpeechWithLegacyGemini(text, voiceModel, tone, expressionTags, model.id);
  }

  const baseStyle = [
    tone?.stylePrompt?.replace(/^in\s+/i, ''),
    voiceModel?.persona
  ].filter(Boolean).join(', ');
  const content = [];
  const expressionPattern = expressionTags ? /\[([^\]]+)\]/g : null;
  let cursor = 0;
  let currentStyle = baseStyle;
  let expressionMatch;

  const addTranscript = (transcript) => {
    if (!transcript) return;
    const block = { type: 'text', text: transcript };
    if (currentStyle) {
      block.annotations = [{ type: 'speech_metadata', style: currentStyle }];
    }
    content.push(block);
  };

  if (expressionPattern) {
    while ((expressionMatch = expressionPattern.exec(text)) !== null) {
      addTranscript(text.slice(cursor, expressionMatch.index));
      currentStyle = [baseStyle, expressionMatch[1].trim()].filter(Boolean).join(', ');
      cursor = expressionPattern.lastIndex;
    }
  }
  addTranscript(text.slice(cursor));

  const response = await fetch(GEMINI_INTERACTIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      model: model.id,
      store: false,
      input: [{ type: 'user_input', content }],
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: [{ voice: voiceModel.voiceName }]
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = errorText;
    try {
      detail = JSON.parse(errorText)?.error?.message || errorText;
    } catch (_) {
      // Keep the raw response when the API does not return JSON.
    }

    const error = new Error(response.status === 429
      ? 'Kuota Gemini API sedang penuh (rate limit).'
      : `Gemini API error (${response.status}): ${detail}`);
    error.status = response.status;
    throw error;
  }

  const interaction = await response.json();
  const audioPart = interaction.output_audio || interaction.steps
    ?.flatMap((step) => step.content || [])
    .find((part) => part.type === 'audio' && part.data);

  if (!audioPart?.data) {
    throw new Error('Gemini tidak mengembalikan audio. Coba lagi atau ubah teksnya.');
  }

  const rawBuffer = Buffer.from(audioPart.data, 'base64');
  const mimeType = audioPart.mime_type || 'audio/wav';

  return normalizeGeminiAudio(rawBuffer, mimeType);
}

async function generateSpeechWithLegacyGemini(text, voiceModel, tone, expressionTags, model) {
  const style = [tone?.stylePrompt, voiceModel?.persona].filter(Boolean).join(', ');
  const prompt = [
    `Read the following text aloud in Indonesian (Bahasa Indonesia)${style ? ` ${style}` : ''}.`,
    expressionTags
      ? 'Text inside square brackets is a delivery direction for the following speech; apply it, but do not speak the bracketed text.'
      : '',
    'Read naturally and verbatim. Do not add, remove, translate, or explain any words.',
    '',
    text
  ].filter((line, index) => line || index === 3).join('\n');

  const response = await fetch(`${GEMINI_API_BASE_URL}/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceModel.voiceName } }
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = errorText;
    try {
      detail = JSON.parse(errorText)?.error?.message || errorText;
    } catch (_) {
      // Keep the raw response when the API does not return JSON.
    }
    const error = new Error(response.status === 429
      ? 'Kuota Gemini API sedang penuh (rate limit).'
      : `Gemini API error (${response.status}): ${detail}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const audioPart = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);
  if (!audioPart?.inlineData?.data) {
    throw new Error('Gemini tidak mengembalikan audio. Coba model atau teks lain.');
  }

  const rawBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
  return normalizeGeminiAudio(rawBuffer, audioPart.inlineData.mimeType || 'audio/L16;rate=24000');
}

function normalizeGeminiAudio(rawBuffer, mimeType) {
  // Gemini 3.8 TTS returns a WAV file; older models may return raw PCM.
  if (mimeType.includes('wav')) {
    return { buffer: rawBuffer, mimeType: 'audio/wav', extension: 'wav' };
  }

  // Fallback untuk respons PCM; ambil sample rate dari mimeType (mis. rate=24000).
  const rateMatch = /rate=(\d+)/.exec(mimeType);
  const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

  return {
    buffer: pcmToWav(rawBuffer, sampleRate),
    mimeType: 'audio/wav',
    extension: 'wav'
  };
}

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  console.log(`Model Gemini TTS fallback order: ${GEMINI_TTS_MODEL_ORDER.map((model) => model.id).join(' -> ')}`);
  console.log(`Model naskah Voice Over Xkiro: ${XKIRO_VOICEOVER_MODELS.join(' -> ')}`);
  console.log(process.env.XKIRO_API_KEY ? 'XKIRO_API_KEY: terdeteksi' : 'XKIRO_API_KEY: BELUM DIISI');
  console.log(
    process.env.GEMINI_API_KEY
      ? 'GEMINI_API_KEY: terdeteksi'
      : 'GEMINI_API_KEY: BELUM DIISI (isi file .env dulu!)'
  );
});

server.on('error', async (error) => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/health`, {
        signal: AbortSignal.timeout(1500)
      });
      const health = await response.json();
      if (response.ok && health.status === 'ok') {
        console.log(`Backend sudah berjalan di port ${PORT}; menggunakan instance yang ada.`);
        db.close(() => process.exit(0));
        return;
      }
    } catch {
      console.error(`Port ${PORT} sedang digunakan oleh layanan lain.`);
    }
  }

  console.error(`Backend gagal dijalankan: ${error.message}`);
  db.close(() => process.exit(1));
});

module.exports = { app, server, db };