// Modul bantuan untuk integrasi webhook Lynk.id.
//
// Referensi payload (dari dokumentasi integrasi pihak ketiga Lynk.id):
//   {
//     "data": {
//       "message_data": {
//         "ref_id": "REF32KARAKTERHURUFDANANGKA00",   // ada juga yang "refId"
//         "customer": { "name": "...", "email": "...", "phone": "..." },
//         "items": [{ "title": "...", "qty": 1, "price": 99000 }],
//         "totals": { "total_price": 99000, "grand_total": 99000 },
//         "created_at": "2026-01-01 10:00:00"
//       }
//     }
//   }
//
// Signature: header "X-Signature" = SHA256(amount + ref_id + message_id + merchant_key).
// Karena penamaan field bisa berubah antar versi, parser di sini sengaja toleran:
// mencari kandidat di banyak jalur payload lalu mencoba kombinasi signature.

const crypto = require('crypto');

// REF ID dari Lynk.id berupa 32 karakter huruf dan angka tanpa spasi.
const REF_ID_LENGTH = 32;
const REF_ID_PATTERN = /^[A-Za-z0-9]{32}$/;

// Hilangkan semua karakter selain huruf dan angka (mis. spasi/strip saat pencetakan invoice).
const normalizeRefId = (value) => String(value || '').replace(/[^A-Za-z0-9]/g, '');

const isValidRefId = (value) => REF_ID_PATTERN.test(String(value || ''));

// Cari seluruh kandidat REF ID dari sebuah teks: semua run karakter alfanumerik
// yang dinormalisasi tepat 32 karakter.
const extractRefIdCandidates = (text) => {
  const candidates = [];
  const matches = String(text || '').match(/[A-Za-z0-9][A-Za-z0-9\s\-_]{10,}/g) || [];
  matches.forEach((chunk) => {
    const normalized = normalizeRefId(chunk);
    if (normalized.length === REF_ID_LENGTH && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  });
  return candidates;
};

const dig = (obj, pathParts) => {
  let current = obj;
  for (const part of pathParts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
};

// Ambil nilai pertama yang terdefinisi dari daftar jalur (array of path).
const firstDefined = (obj, paths) => {
  for (const pathParts of paths) {
    const value = dig(obj, pathParts);
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
};

// Cari nilai berdasarkan nama key apa pun di seluruh pohon objek (kasus pertama).
const findByKey = (obj, keyPattern, depth = 0) => {
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  for (const [key, value] of Object.entries(obj)) {
    if (keyPattern.test(key) && value != null && typeof value !== 'object') return value;
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = findByKey(value, keyPattern, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

const collectByKey = (obj, keyPattern, out = [], depth = 0) => {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  for (const [key, value] of Object.entries(obj)) {
    if (keyPattern.test(key) && value != null && typeof value !== 'object') out.push(value);
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') collectByKey(value, keyPattern, out, depth + 1);
  }
  return out;
};


const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const extractEmail = (value) => {
  const match = EMAIL_PATTERN.exec(String(value || ''));
  return match ? match[0].toLowerCase() : null;
};

// Status sukses harus eksplisit; status yang tidak dikenal gagal-tertutup.
const FAILED_STATUS_PATTERN = /(refund|cancel|expired|failed|reject|pending|chargeback)/i;
const PAID_STATUS_PATTERN = /^(paid|success|successful|succeeded|completed|complete|settled|order\.paid|transaction\.paid|payment\.paid|payment\.received|payment\.success|payment\.succeeded)$/i;

const parseStatus = (payload) => {
  const raw = firstDefined(payload, [
    ['data', 'payment_status'],
    ['data', 'message_data', 'payment_status'],
    ['data', 'status'],
    ['data', 'transaction_status'],
    ['data', 'message_data', 'status'],
    ['payment_status'],
    ['message_data', 'payment_status'],
    ['transaction_status'],
    ['status'],
    ['event']
  ]);
  if (raw === undefined) return { raw: null, isPaid: false };
  const value = String(raw).toLowerCase();
  if (FAILED_STATUS_PATTERN.test(value)) return { raw: String(raw), isPaid: false };
  return { raw: String(raw), isPaid: PAID_STATUS_PATTERN.test(value) };
};

// Terima payload mentah webhook Lynk.id lalu ekstrak field yang dibutuhkan.
const parseLynkPayload = (payload) => {
  // --- REF ID ---
  let refId = firstDefined(payload, [
    ['data', 'message_data', 'ref_id'],
    ['data', 'message_data', 'refId'],
    ['message_data', 'ref_id'],
    ['message_data', 'refId'],
    ['data', 'ref_id'],
    ['data', 'refId'],
    ['ref_id'],
    ['refId']
  ]);
  if (refId === undefined) refId = findByKey(payload, /^ref[_]?id$/i);
  const refIdFinal = normalizeRefId(refId);

  // --- Email pembeli ---
  let email = firstDefined(payload, [
    ['data', 'message_data', 'customer', 'email'],
    ['data', 'message_data', 'buyer', 'email'],
    ['message_data', 'customer', 'email'],
    ['data', 'customer', 'email'],
    ['customer', 'email'],
    ['data', 'email'],
    ['email']
  ]);
  email = extractEmail(email) || extractEmail(findByKey(payload, /e?mail/i)) || null;

  // --- Nama pembeli ---
  const name = firstDefined(payload, [
    ['data', 'message_data', 'customer', 'name'],
    ['message_data', 'customer', 'name'],
    ['data', 'customer', 'name'],
    ['customer', 'name'],
    ['data', 'name'],
    ['name']
  ]) || findByKey(payload, /^(name|customer_name)$/i) || null;

  // --- Produk ---
  const items = dig(payload, ['data', 'message_data', 'items']) || dig(payload, ['message_data', 'items']) || [];
  const productFound = firstDefined(payload, [
    ['data', 'message_data', 'product_title'],
    ['data', 'message_data', 'product', 'title'],
    ['message_data', 'product_title'],
    ['data', 'product_title'],
    ['product_title'],
    ['product', 'name'],
    ['title']
  ]);
  const productTitle = productFound !== undefined
    ? productFound
    : (Array.isArray(items) && items.length ? items[0].title : null);

  // --- Total pembayaran ---
  const amountFound = firstDefined(payload, [
    ['data', 'message_data', 'totals', 'grand_total'],
    ['data', 'message_data', 'totals', 'total_price'],
    ['message_data', 'totals', 'grand_total'],
    ['data', 'grand_total'],
    ['grand_total'],
    ['data', 'amount'],
    ['amount'],
    ['data', 'total'],
    ['total']
  ]);
  const amountFallback = findByKey(payload, /^grand[_]?total$/i);
  const amountValue = amountFound !== undefined ? amountFound : amountFallback;

  // --- message_id (dipakai perhitungan signature) ---
  const messageIdCandidates = collectByKey(payload, /^(message_?id)$/i);
  const extraMessageId = firstDefined(payload, [
    ['data', 'message_id'],
    ['message_id'],
    ['data', 'id']
  ]);
  if (extraMessageId != null) messageIdCandidates.push(extraMessageId);
  const uniqueMessageIds = messageIdCandidates
    .filter((value, index, arr) => value != null && arr.indexOf(value) === index)
    .map(String);

  const status = parseStatus(payload);

  return {
    refId: refIdFinal,
    refIdValid: isValidRefId(refIdFinal),
    email,
    name: name ? String(name) : null,
    productTitle: productTitle ? String(productTitle) : null,
    amount: amountValue != null && amountValue !== '' ? Number(amountValue) : null,
    statusRaw: status.raw,
    isPaid: status.isPaid,
    messageIdCandidates: uniqueMessageIds
  };
};

// Semua kombinasi string yang mungkin dipakai Lynk.id saat menghitung signature.
const buildSignatureCandidates = ({ amount, refId, messageIdCandidates }) => {
  const amountCandidates = [];
  if (amount != null && !Number.isNaN(Number(amount))) {
    const num = Number(amount);
    amountCandidates.push(String(num));
    amountCandidates.push(num.toFixed(0));
    amountCandidates.push(num.toFixed(2));
  }
  const refCandidates = refId ? [String(refId)] : [];
  const messageCandidates = messageIdCandidates && messageIdCandidates.length
    ? messageIdCandidates.map(String)
    : [''];

  const combos = [];
  amountCandidates.forEach((amt) => {
    refCandidates.forEach((ref) => {
      messageCandidates.forEach((msg) => {
        combos.push(amt + ref + msg);
      });
    });
  });
  return combos;
};

const sha256Hex = (input) => crypto.createHash('sha256').update(input, 'utf8').digest('hex');

const safeEqualHex = (a, b) => {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

// Verifikasi header X-Signature terhadap Merchant Key dari dashboard Lynk.id.
const verifyLynkSignature = ({ payload, signature, merchantKey, parsed }) => {
  const tag = '[lynk:verify]';
  console.log(`${tag} signaturePresent=${Boolean(signature)} merchantKeyConfigured=${Boolean(merchantKey)}`);

  if (!signature) {
    console.warn(`${tag} result: signature_missing`);
    return { ok: false, reason: 'signature_missing' };
  }
  if (!merchantKey) {
    console.warn(`${tag} result: merchant_key_missing`);
    return { ok: false, reason: 'merchant_key_missing' };
  }

  const info = parsed || parseLynkPayload(payload);
  console.log(
    `${tag} parsed payload metadata:`,
    JSON.stringify({
      amount: info.amount,
      refIdLength: String(info.refId || '').length,
      messageIdCount: info.messageIdCandidates.length
    })
  );

  const combos = buildSignatureCandidates({
    amount: info.amount,
    refId: info.refId,
    messageIdCandidates: info.messageIdCandidates
  });

  console.log(`${tag} signature candidate count=${combos.length}`);

  if (!combos.length) {
    console.warn(`${tag} result: no_candidate (amount=${info.amount}, refId=${info.refId ? 'present' : 'missing'})`);
    return { ok: false, reason: 'no_candidate' };
  }

  const normalizedSignature = String(signature).trim().toLowerCase();

  for (let i = 0; i < combos.length; i += 1) {
    const combo = combos[i];
    const expected = sha256Hex(combo + merchantKey);
    const matched = safeEqualHex(expected, normalizedSignature);
    if (matched) {
      console.log(`${tag} result: ok (matched candidate #${i})`);
      return { ok: true, reason: 'ok' };
    }
  }
  console.warn(`${tag} result: signature_mismatch (tidak ada dari ${combos.length} kandidat yang cocok)`);
  return { ok: false, reason: 'signature_mismatch' };
};

// Simpan / perbarui transaksi dari webhook.
const upsertTransaction = (db, tx, callback) => {
  db.run(
    `INSERT INTO lynk_transactions
       (ref_id, message_id, email, customer_name, product_title, amount, status, is_paid, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ref_id) DO UPDATE SET
       message_id = excluded.message_id,
       email = excluded.email,
       customer_name = excluded.customer_name,
       product_title = excluded.product_title,
       amount = excluded.amount,
       status = excluded.status,
       is_paid = excluded.is_paid,
       raw_payload = excluded.raw_payload,
       received_at = CURRENT_TIMESTAMP`,
    [
      tx.refId,
      tx.messageIdCandidates[0] || null,
      tx.email,
      tx.name,
      tx.productTitle,
      tx.amount,
      tx.statusRaw,
      tx.isPaid ? 1 : 0,
      JSON.stringify(tx.rawPayload)
    ],
    callback
  );
};

const getTransactionByRef = (db, refId, callback) => {
  db.get('SELECT * FROM lynk_transactions WHERE ref_id = ?', [refId], callback);
};

module.exports = {
  REF_ID_LENGTH,
  REF_ID_PATTERN,
  normalizeRefId,
  isValidRefId,
  extractRefIdCandidates,
  extractEmail,
  parseLynkPayload,
  verifyLynkSignature,
  buildSignatureCandidates,
  sha256Hex,
  upsertTransaction,
  getTransactionByRef
};

