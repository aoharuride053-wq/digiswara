// Manajemen device: membatasi tiap akun agar hanya bisa diakses di
// maksimal MAX_DEVICES device berbeda untuk menekan akun sharing.
//
// Cara kerja:
// - Client mengirim "x-device-id" (UUID tersimpan di localStorage) dan
//   "x-device-fp" (fingerprint stabil dari properti browser) di setiap request.
// - Saat login, device didaftarkan. Jika device baru datang dan jumlah device
//   aktif sudah MAX_DEVICES, login DITOLAK.
// - Saat request auth, device wajib cocok dengan yang terdaftar (binding di JWT).
// - Device yang tidak aktif lebih dari DEVICE_STALE_DAYS dibersihkan otomatis
//   agar slot tidak tertahan oleh device lama yang sudah tidak dipakai.
// - Logout membebaskan slot device saat ini.

const MAX_DEVICES = Number(process.env.MAX_DEVICES || 2);
const DEVICE_STALE_DAYS = Number(process.env.DEVICE_STALE_DAYS || 30);

const DEVICE_LIMIT_CODE = 'DEVICE_LIMIT';

// Hapus device yang tidak terlihat lebih dari DEVICE_STALE_DAYS.
const cleanupStaleDevices = (db, callback = () => {}) => {
  db.run(
    `DELETE FROM user_devices
     WHERE last_seen_at < datetime('now', '-' || ? || ' days')`,
    [DEVICE_STALE_DAYS],
    (err) => {
      if (err) console.error('Cleanup device error:', err.message);
      callback(err);
    }
  );
};

// Daftarkan / perbarui device saat login. callback(err, result)
// result = { ok: true } atau { ok: false, code: 'DEVICE_LIMIT', deviceCount }
const registerDevice = (db, { userId, deviceId, fingerprint, userAgent, ip }, callback) => {
  cleanupStaleDevices(db, () => {
    db.all(
      `SELECT id, device_id, fingerprint FROM user_devices
       WHERE user_id = ? ORDER BY last_seen_at DESC, id DESC`,
      [userId],
      (err, rows) => {
        if (err) return callback(err);

        const orderedRows = rows || [];
        const activeRows = orderedRows.slice(0, MAX_DEVICES);
        const excessRows = orderedRows.slice(MAX_DEVICES);
        const registerWithinLimit = () => {
          // Device dikenali kalau device_id ATAU fingerprint cocok.
          const matched = activeRows.find(
            (row) =>
              (deviceId && row.device_id === deviceId) ||
              (fingerprint && row.fingerprint === fingerprint)
          );

          if (matched) {
            db.run(
              `UPDATE user_devices
                 SET device_id = ?, fingerprint = ?, user_agent = ?, ip = ?,
                     last_seen_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [deviceId, fingerprint, userAgent || null, ip || null, matched.id],
              (updateErr) =>
                callback(updateErr, updateErr ? undefined : { ok: true, known: true })
            );
            return;
          }

          if (activeRows.length >= MAX_DEVICES) {
            return callback(null, {
              ok: false,
              code: DEVICE_LIMIT_CODE,
              deviceCount: activeRows.length,
              maxDevices: MAX_DEVICES
            });
          }

          db.run(
            `INSERT INTO user_devices (user_id, device_id, fingerprint, user_agent, ip)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, deviceId, fingerprint || null, userAgent || null, ip || null],
            (insertErr) =>
              callback(insertErr, insertErr ? undefined : { ok: true, known: false })
          );
        };

        if (!excessRows.length) return registerWithinLimit();
        const placeholders = excessRows.map(() => '?').join(', ');
        db.run(
          `DELETE FROM user_devices WHERE user_id = ? AND id IN (${placeholders})`,
          [userId, ...excessRows.map((row) => row.id)],
          (deleteErr) => deleteErr ? callback(deleteErr) : registerWithinLimit()
        );
      }
    );
  });
};

// Cek apakah device pada request ini terdaftar untuk user.
// callback(err, { ok } | { ok:false, code, ... })
const assertDevice = (db, { userId, deviceId, fingerprint }, callback) => {
  if (!deviceId) {
    return callback(null, { ok: false, code: 'DEVICE_REQUIRED' });
  }
  db.all(
    `SELECT id, device_id FROM user_devices
     WHERE user_id = ? ORDER BY last_seen_at DESC, id DESC`,
    [userId],
    (err, rows) => {
      if (err) return callback(err);
      const row = (rows || [])
        .slice(0, MAX_DEVICES)
        .find((activeDevice) => activeDevice.device_id === deviceId);
      if (row) {
        // Perbarui last_seen & fingerprint (fingerprint bisa berubah karena
        // update browser; device_id tetap identitas utama saat ini).
        db.run(
          `UPDATE user_devices
             SET last_seen_at = CURRENT_TIMESTAMP,
                 fingerprint = COALESCE(?, fingerprint)
           WHERE id = ?`,
          [fingerprint || null, row.id],
          () => callback(null, { ok: true })
        );
        return;
      }
      callback(null, { ok: false, code: DEVICE_LIMIT_CODE });
    }
  );
};

// Lihat daftar device aktif milik user.
const listDevices = (db, userId, callback) => {
  db.all(
    `SELECT id, device_id, user_agent, ip, created_at, last_seen_at
     FROM user_devices WHERE user_id = ? ORDER BY last_seen_at DESC, id DESC LIMIT ?`,
    [userId, MAX_DEVICES],
    callback
  );
};

// Lepas device saat ini (dipanggil saat logout agar slot tidak terbuang).
const releaseDevice = (db, userId, deviceId, callback = () => {}) => {
  db.run(
    'DELETE FROM user_devices WHERE user_id = ? AND device_id = ?',
    [userId, deviceId],
    callback
  );
};

module.exports = {
  MAX_DEVICES,
  DEVICE_STALE_DAYS,
  DEVICE_LIMIT_CODE,
  cleanupStaleDevices,
  registerDevice,
  assertDevice,
  listDevices,
  releaseDevice
};
