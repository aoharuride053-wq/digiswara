// Pengirim email kredensial via provider SMTP transaksional.
//
// Konfigurasi di file .env:
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=465
//   SMTP_USER=noreply@gmail.com          <- Gmail khusus kirim kredensial
//   SMTP_PASS=xxxx xxxx xxxx             <- App Password Gmail (bukan password login)
//   MAIL_FROM="TTS Gemini <noreply@gmail.com>"
//
// SMTP_HOST, SMTP_USER, SMTP_PASS, dan MAIL_FROM dapat diisi dari provider
// transaksional seperti Resend, Brevo, atau Postmark.

const nodemailer = require('nodemailer');

const isSmtpConfigured = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter = null;
const getTransporter = () => {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return transporter;
};

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Email berisi username + password akun hasil registrasi dari invoice.
const sendCredentialsEmail = async ({ to, username, password, loginUrl }) => {
  if (!isSmtpConfigured()) {
    const error = new Error('SMTP belum dikonfigurasi (SMTP_HOST/SMTP_USER/SMTP_PASS).');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }

  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const appUrl = loginUrl || process.env.APP_URL || 'http://localhost:3000';
  const html = `
<!DOCTYPE html>
<html lang="id">
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr>
          <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px 28px;">
            <h1 style="margin:0;color:#ffffff;font-size:20px;">🎙️ Akun Kamu Sudah Aktif</h1>
          </td>
        </tr>
        <tr><td style="padding:24px 28px;color:#334155;font-size:14px;line-height:1.7;">
          <p style="margin-top:0;">Halo,</p>
          <p>
            Terima kasih sudah membeli di <strong>Lynk.id</strong>. Invoice kamu
            berhasil diverifikasi dan akun berikut sudah dibuat:
          </p>
          <table role="presentation" width="100%" style="margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
            <tr>
              <td style="padding:14px 18px;border-bottom:1px solid #e2e8f0;">
                <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Username</div>
                <div style="font-size:16px;font-weight:bold;color:#0f172a;">${escapeHtml(username)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 18px;">
                <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Password</div>
                <div style="font-size:16px;font-weight:bold;color:#0f172a;font-family:monospace;">${escapeHtml(password)}</div>
              </td>
            </tr>
          </table>
          <p>Simpan kedua data di atas. Login hanya bisa dilakukan di maksimal
            <strong>2 device</strong> yang berbeda untuk menjaga keamanan akun.</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="${escapeHtml(appUrl)}/login"
               style="background:#6366f1;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:bold;display:inline-block;">
              Masuk ke Aplikasi
            </a>
          </p>
          <p style="color:#94a3b8;font-size:12px;">
            Jangan bagikan email ini ke siapa pun. Kalau kamu tidak merasa
            membeli, abaikan email ini.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  const text = [
    'Akun kamu sudah aktif!',
    '',
    `Username: ${username}`,
    `Password: ${password}`,
    '',
    `Login: ${appUrl}/login`,
    'Akun hanya bisa dipakai di maksimal 2 device.'
  ].join('\n');

  return getTransporter().sendMail({
    from,
    to,
    subject: '🎉 Akun Aktif — Username & Password Kamu',
    html,
    text
  });
};

module.exports = {
  isSmtpConfigured,
  sendCredentialsEmail
};
