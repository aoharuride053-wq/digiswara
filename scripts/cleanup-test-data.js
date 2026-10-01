// Membersihkan data sisa dari smoke test (user uji, transaksi Lynk, device).
//   node scripts/cleanup-test-data.js

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database', 'app.db');

const run = (db, sql) =>
  new Promise((resolve, reject) => {
    db.run(sql, function (err) {
      err ? reject(err) : resolve(this.changes);
    });
  });

const main = async () => {
  const db = new sqlite3.Database(DB_PATH);

  const deviceRows = await run(
    db,
    `DELETE FROM user_devices
     WHERE user_id IN (
       SELECT id FROM users
       WHERE email LIKE 'regtest-%@example.com'
          OR username LIKE 'devtest_%'
          OR username LIKE 'smoketest_%'
     )`
  );

  const users = await run(
    db,
    `DELETE FROM users
     WHERE email LIKE 'regtest-%@example.com'
        OR username LIKE 'devtest_%'
        OR username LIKE 'smoketest_%'`
  );

  const transactions = await run(db, 'DELETE FROM lynk_transactions');

  db.close();
  console.log(`Data uji dibersihkan: ${users} user, ${deviceRows} device, ${transactions} transaksi.`);
};

main().catch((err) => {
  console.error('Gagal membersihkan:', err.message);
  process.exit(1);
});
