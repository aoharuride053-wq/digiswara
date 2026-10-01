# 🎙️ Studio Suara — Text-to-Speech dan Voice Over

Aplikasi web untuk mengubah teks menjadi suara memakai **Gemini 3.8 TTS** dan
menyusun naskah voice over memakai **Xkiro**. Tersedia 14 karakter suara
bernama Indonesia, 18 nada bicara, dua versi naskah untuk dibandingkan, login,
riwayat sementara, dan pemutar audio.

---

## ✨ Fitur

| Fitur | Keterangan |
|---|---|
| 🔐 Login | Autentikasi JWT + password di-hash dengan bcrypt |
| 🧾 Aktivasi Beli | Registrasi lewat upload invoice Lynk.id, diverifikasi AI (REF ID 32 karakter) |
| 📩 Kirim Kredensial | Username & password acak dikirim ke email pembeli via SMTP transaksional |
| 📱 Batas 2 Device | Tiap akun hanya bisa diakses di maksimal 2 device berbeda |
| 🎭 14 Karakter Suara | Nama Indonesia dengan identifikasi gender |
| 🎚️ 18 Variasi Nada | Termasuk bercanda gurau dengan tawa ringan yang natural |
| ✍️ Studio Voice Over | Generate dua naskah berdasarkan target, audiens, durasi, dan gaya |
| 🎧 Pemutar Audio | Play/pause, geser posisi, dan unduh hasil dalam format WAV |
| 🕘 Riwayat | Semua hasil tersimpan di SQLite, bisa diputar ulang & dihapus |
| 📊 Profil | Statistik jumlah suara, karakter, dan nada yang pernah dipakai |
| 📱 Responsif | Sidebar bisa dibuka-tutup di layar kecil |

Riwayat audio dan voice over berlaku maksimal **15 menit** sejak dibuat. Unduh
audio atau salin naskah sebelum kedaluwarsa; riwayat dan file di server akan
dihapus otomatis untuk membatasi penggunaan penyimpanan.

---

## 🧾 Alur Pendaftaran (Beli di Lynk.id → Upload Invoice)

Tidak ada lagi pendaftaran akun kosong. Akun **hanya** bisa dibuat dengan
membukti pembayaran yang sah di Lynk.id:

```
Beli di Lynk.id
  └─ Lynk.id mengirim webhook ke server → transaksi tersimpan (REF ID, email, total)
      └─ Pembeli buka /register dari link produk Lynk.id
          └─ Input email pembelian + upload invoice (PDF/gambar)
              └─ AI membaca REF ID (32 karakter huruf & angka)
                  └─ Dicocokkan dengan transaksi webhook (sudah bayar, belum dipakai)
                      └─ Akun dibuat (email pembeli + password acak)
                          └─ Username & password dikirim ke email pembeli
```

### 1. Siapkan webhook di Lynk.id

1. Buka dashboard Lynk.id → **Settings → Integrations → Webhooks**.
2. Masukkan URL webhook lalu **Save URL**:

   ```
   https://domain-publik-anda.com/api/webhook/lynk
   ```

3. Setelah URL tersimpan, Lynk.id menampilkan **Merchant Key**. Salin ke `.env`:

   ```env
   LYNK_MERCHANT_KEY=merchant_key_dari_dashboard_lynk
   LYNK_PRODUCT_NAME=Text to Speech with Natural Expression
   ```

Signature Lynk.id dihitung `SHA256(amount + ref_id + message_id + merchant_key)`
dan dikirim pada header `X-Signature`; server memverifikasinya dengan
perbandingan *timing-safe*. Merchant Key dan signature valid selalu diwajibkan,
termasuk saat development; webhook tanpa konfigurasi ditolak. Jangan gunakan
mode non-strict pada tunnel publik.
Transaksi juga harus memiliki status sukses eksplisit dan nama produk yang sama
dengan `LYNK_PRODUCT_NAME`; status kosong atau tidak dikenal tidak dianggap lunas.

URL harus mengarah ke backend yang bisa dijangkau publik melalui HTTPS; URL
`localhost` tidak dapat dipanggil oleh server Lynk.id. Setelah menyimpan URL,
gunakan tombol **Test URL** dan periksa riwayat webhook serta log backend.
Pastikan event yang diterima memuat REF ID, status transaksi, nama produk, email,
jumlah, dan `X-Signature`. Baru setelah event valid tersimpan, upload invoice
akan bisa dilanjutkan. Pembelian Rp0 tetap diverifikasi dari transaksi webhook,
bukan hanya dari tulisan “PAID” pada invoice.

> **Link registrasi untuk pembeli:** taruh `https://domain-anda.com/register`
> sebagai konten digital / pesan otomatis produk Lynk.id kamu. Bisa juga pakai
> `https://domain-anda.com/register?email=pembeli@email.com` supaya email
> terisi otomatis.

### 2. Siapkan provider email transaksional

Mailer memakai Resend melalui HTTPS API jika `SMTP_HOST=smtp.resend.com`, sehingga
tidak memerlukan koneksi SMTP keluar dari Railway. Provider SMTP lain tetap bisa
digunakan. Verifikasi domain pengirim di dashboard Resend terlebih dahulu; alamat
`MAIL_FROM` harus memakai domain yang sudah diverifikasi.

1. Isi di `.env`:

  ```env
  SMTP_HOST=smtp.resend.com
  RESEND_API_KEY=re_api_key_dari_resend
  MAIL_FROM=noreply@domain-terverifikasi.com
  APP_URL=https://domain-anda.com
   ```

2. Simpan `RESEND_API_KEY` sebagai secret di Railway Variables atau `.env` lokal;
  jangan commit API key ke Git.

3. Alternatif SMTP lain: Brevo dan Postmark. Buat/verify sender domain, lalu
  salin host, port, username, password/token SMTP dari dashboard provider ke
  variabel `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, dan `SMTP_PASS`.

4. Kalau email belum dikonfigurasi dan `NODE_ENV` bukan `production`, kredensial
  hanya dikembalikan di respons untuk uji lokal. Di production, akun baru dibatalkan
  jika email gagal; recovery akun yang sudah ada mengembalikan password lamanya.

### 3. Konfigurasi di `.env`

```env
# Integrasi Lynk.id
LYNK_MERCHANT_KEY=
LYNK_PRODUCT_NAME=Text to Speech with Natural Expression

# Database (lokal boleh memakai SQLite; Railway disarankan MongoDB)
DATABASE_BACKEND=sqlite
MONGODB_URI=
MONGODB_DATABASE=digiswara
DB_PATH=./database/app.db

# TokenHarbor Vision untuk gambar dan PDF scan invoice
TOKENHARBOR_API_KEY=thk_live_key_dari_tokenharbor
TOKENHARBOR_INVOICE_MODELS=mimo-v2.6-flash:free,deepseek-v4.1-flash:free,qwen3.8-flash:free

# Gmail SMTP khusus kirim username & password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
APP_URL=http://localhost:3000

# Batas device & rate limit
MAX_DEVICES=2
DEVICE_STALE_DAYS=30
REGISTER_RATE_LIMIT=10
```

Di Railway, set `DATABASE_BACKEND=mongodb`, `MONGODB_URI`, dan `MONGODB_DATABASE`
di **Service Variables**. Isi `MONGODB_URI` sebagai secret dari MongoDB Atlas dan
pastikan Network Access Atlas mengizinkan koneksi dari Railway. Jika
`DATABASE_BACKEND` tidak diset, server memilih MongoDB di production atau jika
`MONGODB_URI` tersedia; production tanpa URI akan gagal start agar webhook dan
registrasi tidak diam-diam masuk ke SQLite sementara. Pilihan eksplisit
`DATABASE_BACKEND=sqlite` tetap memakai SQLite.

Server menunggu MongoDB tersambung sebelum menerima request. Akun ada di koleksi
`users` dan transaksi/invoice yang diterima dari webhook Lynk.id ada di
`lynk_transactions` pada database `MONGODB_DATABASE` (default `digiswara`). Invoice
yang baru diunggah tidak disimpan sebagai file maupun sebagai percobaan registrasi;
ref hanya terikat ke akun setelah registrasi berhasil. Data SQLite lama berada di
file yang ditunjukkan log `SQLite history/device database path` (default
`./database/app.db`, relatif ke working directory server). Saat MongoDB aktif,
data akun dan transaksi yang masih ada di file SQLite itu disalin saat startup;
data SQLite yang sudah hilang dari container tanpa Railway Volume tidak dapat
dimigrasikan. Riwayat TTS dan daftar device tetap di SQLite, jadi pasang Railway
Volume di `/app/data` untuk mempertahankan data tersebut dan file audio.

---

## 📱 Batas Maksimal 2 Device

Setiap akun hanya bisa diakses di **2 device berbeda** untuk menekan akun
sharing di IP/device lain:

- Browser mengirim `x-device-id` (UUID di localStorage) dan `x-device-fp`
  (fingerprint properti browser) pada setiap request.
- **Login** mendaftarkan device. Device ke-3 **ditolak** dengan pesan
  "Akun ini sudah terpakai di 2 device berbeda".
- **Setiap request** diverifikasi terhadap device yang terikat di token JWT,
  jadi token yang disalin ke device lain otomatis tidak berlaku.
- **Logout** melepas device sekarang, sehingga slot langsung bisa dipakai lagi.
- Device yang tidak aktif lebih dari `DEVICE_STALE_DAYS` (default 30 hari)
  dibersihkan otomatis.

Uji cepat batas device:

```bash
npm run test:device-limit
```

> Device dikenali lewat `device_id` **dan** fingerprint browser, jadi membuka
> aplikasi di browser yang sama setelah storage dibersihkan tetap terhitung
> sebagai device yang sama (tidak memakan slot tambahan).

---

## ⚠️ Penting: Soal "Gratis"

Pilihan TTS lewat **Gemini API** memang **gratis** (token TTS berstatus
*Free of charge* di free tier), **tetapi TIDAK unlimited**.
Google tetap menerapkan batas **RPM / TPM / RPD** per menit dan per hari.

Kalau batas tercapai, server akan membalas pesan
*"Kuota Gemini API sedang penuh (rate limit)"*. Tunggu sebentar lalu coba lagi.

Lihat batas kuota akunmu di: <https://aistudio.google.com/rate-limit>

---

## 🧰 Prasyarat

- **Node.js 18+** (fitur `fetch` bawaan dipakai untuk memanggil Gemini API).
  Proyek ini diuji dengan **Node v24.14.0**.
- **Gemini API key** dari <https://aistudio.google.com/apikey> untuk membuat audio.
- **Xkiro API key** dari <https://xkiro.com/> untuk membuat naskah voice over.

> ### 🪟 Catatan khusus Windows + PowerShell
> Kalau muncul error berikut saat menjalankan `npm`:
>
> ```
> npm.ps1 cannot be loaded because running scripts is disabled on this system.
> ```
>
> itu karena *execution policy* PowerShell. Pilih salah satu solusi:
>
> **a. Pakai `npm.cmd`** (paling cepat, tanpa ubah setting sistem):
> ```powershell
> npm.cmd install
> ```
>
> **b. Izinkan script untuk user saat ini** (permanen, sekali saja):
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```
>
> **c. Pakai Command Prompt (`cmd`)** atau Git Bash, di sana tidak ada batasan ini.

---

## 🚀 Cara Menjalankan

### 1. Install dependency (backend + frontend)

```bash
npm install
cd client && npm install && cd ..
```

### 2. Isi API keys

Buka file **`.env`** di root proyek. Gemini tetap dipakai untuk TTS, TokenHarbor
untuk membaca gambar/PDF scan invoice, dan xKiro untuk Studio Voice Over. Semua
key hanya digunakan backend dan tidak dikirim ke browser.

```env
GEMINI_API_KEY=isi_api_key_gemini_di_sini
GEMINI_TTS_MODELS=gemini-3.8-flash-lite-tts,gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview,gemini-2.5-flash-preview-tts,gemini-2.5-pro-preview-tts
TOKENHARBOR_API_KEY=thk_live_key_dari_tokenharbor
TOKENHARBOR_INVOICE_MODELS=mimo-v2.6-flash:free,deepseek-v4.1-flash:free,qwen3.8-flash:free
XKIRO_API_KEY=isi_api_key_xkiro_di_sini
XKIRO_VOICEOVER_MODELS=qwen/qwen3.7-flash:free,qwen/qwen3.8-omni-flash:free
```

### 3. Jalankan aplikasi

```bash
npm run dev
```

Perintah ini menjalankan backend dan frontend sekaligus:

| Bagian | URL |
|---|---|
| Frontend (React) | <http://localhost:3000> |
| Backend (Express) | <http://localhost:5000> |

Tombol pembelian pada homepage menggunakan URL produk publik Lynk.id. Atur di
`client/.env` sebelum menjalankan frontend:

```env
REACT_APP_LYNK_PURCHASE_URL=https://lynk.id/username/produk-anda
```

Ganti dengan URL halaman produk publik (bukan URL dashboard/admin). Jika belum
diatur, tombol sementara membuka `https://lynk.id`. Restart frontend setelah
mengubah `client/.env`.

Untuk menguji webhook Lynk.id dari komputer lokal, jalankan:

```bash
npm run dev:webhook
```

Perintah tersebut juga membuka tunnel HTTPS sementara ke backend. Salin URL
`https://....loca.lt` yang tercetak ke **Settings → Integrations → Webhooks**
di Lynk.id dengan menambahkan `/api/webhook/lynk`. Biarkan terminal tetap hidup
selama pengujian. URL tunnel berubah setiap kali perintah dimulai ulang, jadi
perbarui URL webhook Lynk jika tunnel dibuat ulang. Untuk penggunaan produksi,
gunakan domain HTTPS tetap dan backend yang selalu aktif.

Untuk membuka frontend dari perangkat lain di Wi-Fi yang sama, masukkan origin
frontend LAN ke `.env`, misalnya `CLIENT_ORIGINS=http://localhost:3000,http://192.168.1.6:3000`.
Frontend otomatis mengirim request API ke hostname halaman pada port 5000.
Restart backend setelah mengubah `.env`.

Untuk URL tetap, gunakan Cloudflare Named Tunnel. Anda perlu domain milik
sendiri yang sudah ditambahkan ke Cloudflare, dan `cloudflared` terpasang di
komputer. Di Cloudflare Zero Trust → **Networking → Tunnels**, buat tunnel
remotely-managed lalu tambahkan **Published application route** dengan hostname
tetap (misalnya `tts.domainanda.com`) dan service `http://localhost:5000`.
Salin token tunnel, lalu isi `.env`:

```env
CLOUDFLARED_TUNNEL_TOKEN=token_dari_cloudflare
CLOUDFLARED_TUNNEL_HOSTNAME=tts.domainanda.com
LYNK_MERCHANT_KEY=merchant_key_dari_lynk
```

Install CLI Cloudflare Tunnel di Windows dengan PowerShell:

```powershell
winget install --id Cloudflare.cloudflared
```

Hentikan sesi dev yang lain, lalu jalankan:

```bash
npm run dev:webhook:cloudflare
```

URL webhook tetapnya adalah `https://tts.domainanda.com/api/webhook/lynk`.
Jangan tambahkan Cloudflare Access login/challenge pada hostname ini, karena
Lynk.id perlu mengirim POST langsung. Token tunnel dibaca dari `.env` dan
ditulis sementara ke direktori temp ketika proses berjalan; jangan commit atau
membagikan token tersebut. Dokumentasi resmi: [Create a Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/).

Sebelum menjalankan `npm run dev:webhook`, hentikan proses `npm run dev` yang
sudah berjalan agar port 3000 dan 5000 tidak bentrok. Setelah URL disimpan di
Lynk, salin Merchant Key ke `.env` sebagai `LYNK_MERCHANT_KEY`, lalu hentikan
dan jalankan ulang perintah dev webhook agar backend memuat key tersebut.
Tombol **Test URL** dapat mengirim ping tanpa REF ID pembelian; ping seperti itu
tidak menjadi transaksi. Verifikasi registrasi dengan transaksi uji baru setelah
Merchant Key aktif dan pastikan event-nya muncul di riwayat webhook Lynk.

### 4. Mulai pakai

1. Buka <http://localhost:3000>
2. Klik **Daftar Gratis**, buat akun
3. Di tab **Teks ke Suara**, pilih nada dan karakter, lalu generate audio.
4. Di tab **Studio Voice Over**, isi brief untuk membuat dua alternatif naskah dengan Xkiro.
5. Bandingkan naskah, salin atau gunakan salah satu di tab Teks ke Suara.

---

## 📜 Perintah Lain

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Backend + frontend sekaligus (untuk development) |
| `npm run dev:webhook` | Backend + frontend + tunnel HTTPS sementara untuk tes webhook |
| `npm run dev:webhook:cloudflare` | Backend + frontend + Cloudflare Named Tunnel dengan hostname tetap |
| `npm run server` | Hanya backend, dengan auto-reload (nodemon) |
| `npm run client` | Hanya frontend React |
| `npm run build` | Build frontend untuk production |
| `npm start` | Jalankan backend saja (mode production) |

---

## 🔌 API Endpoint

| Method | Endpoint | Perlu login | Fungsi |
|---|---|---|---|
| `POST` | `/api/webhook/lynk` | ❌ | Webhook pembelian Lynk.id (X-Signature diverifikasi) |
| `POST` | `/api/register/invoice` | ❌ | Aktivasi akun dari invoice (AI baca REF ID) |
| `POST` | `/api/register` | ❌ | Ditolak (registrasi hanya lewat invoice) |
| `POST` | `/api/login` | ❌ | Masuk, mengembalikan token JWT |
| `GET` | `/api/devices` | ✅ | Daftar device aktif (maks 3) |
| `DELETE` | `/api/devices/current` | ✅ | Lepas device ini (dipakai saat logout) |
| `GET` | `/api/profile` | ✅ | Data profil pengguna |
| `GET` | `/api/profile/stats` | ✅ | Statistik aktivitas |
| `GET` | `/api/voices/models` | ✅ | Daftar 14 karakter suara aktif |
| `GET` | `/api/voices/tones` | ✅ | Daftar 18 variasi nada |
| `POST` | `/api/tts/generate` | ✅ | Buat suara dari teks |
| `POST` | `/api/voiceover/generate` | ✅ | Buat naskah voice over via Xkiro |
| `GET` | `/api/history` | ✅ | Riwayat audio dan voice over yang belum kedaluwarsa |
| `DELETE` | `/api/history/:id` | ✅ | Hapus satu riwayat |
| `DELETE` | `/api/voiceover-history/:id` | ✅ | Hapus riwayat voice over |
| `GET` | `/api/health` | ❌ | Cek status server |

Seluruh preset voice tetap disimpan di `server/gemini-live-voices.js`. Untuk
menampilkan preset tambahan, tambahkan ID-nya ke `activeVoiceIds` di
`server/index.js`.

Contoh membuat suara:

```bash
curl -X POST http://localhost:5000/api/tts/generate \
  -H "Authorization: Bearer <TOKEN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"text":"Halo, selamat datang!","voiceModel":"standard-b","tone":"friendly"}'
```

---

## 🗂️ Struktur Proyek

```
apps-text-to-speech/
├── .env                      # Konfigurasi (API key, secret) - tidak di-commit
├── .env.example              # Template konfigurasi
├── package.json              # Dependency & script backend
├── server/
│   ├── index.js              # Express: auth, TTS Gemini, riwayat, profil
│   ├── lynk.js               # Parser payload & verifikasi signature Lynk.id
│   ├── invoiceAi.js          # Ekstraksi REF ID dari invoice (Gemini Vision)
│   ├── mailer.js             # Kirim kredensial via Gmail SMTP (nodemailer)
│   └── devices.js            # Batas maksimal 2 device per akun
├── client/                   # Aplikasi React (Create React App + Tailwind)
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── public/index.html
│   └── src/
│       ├── App.jsx           # Routing utama
│       ├── index.css         # Tailwind + style global
│       ├── context/
│       │   └── AuthContext.jsx
│       ├── lib/
│       │   ├── api.js        # Instance axios + interceptor token & device
│       │   ├── device.js     # Device ID + fingerprint (batas 2 device)
│       │   └── format.js     # Helper format tanggal
│       ├── components/
│       │   ├── Auth/         # PrivateRoute, PublicRoute
│       │   ├── Layout/       # Sidebar & kerangka halaman
│       │   └── TTS/          # VoiceModelPicker, TonePicker, AudioPlayer
│       └── pages/
│           ├── HomePage.jsx
│           ├── GeneratePage.jsx
│           ├── HistoryPage.jsx
│           ├── ProfilePage.jsx
│           └── auth/         # LoginPage, RegisterPage
├── public/audio/             # Hasil generate (dibuat otomatis)
└── database/app.db           # SQLite (dibuat otomatis)
```

---

## 🔧 Model TTS dan Batas Penggunaan

Daftar dan urutan model hanya dikonfigurasi di `GEMINI_TTS_MODELS` dalam `.env`;
model tidak ditampilkan di halaman user. Server mencoba Flash-Lite terlebih dahulu,
lalu Flash, 3.1 Preview, 2.5 Flash, dan 2.5 Pro. Jika model kena 429 atau tidak
tersedia, backend berpindah diam-diam ke model berikutnya. Akses legacy/preview
mungkin dibatasi. Failover bukan kuota tambahan: batas RPM/TPM/RPD tetap mengikuti
model dan tier proyek, dan tidak ada model Gemini yang menjamin unlimited.

## 🔧 Cara Kerja Voice Over dan TTS

- Studio Voice Over mengirim brief ke `/api/voiceover/generate`. Xkiro mencoba `qwen/qwen3.7-flash:free` terlebih dahulu, lalu beralih ke `qwen/qwen3.8-omni-flash:free` jika gagal.
- Teks ke Suara mengirim teks, `voiceModel`, dan `tone` ke `/api/tts/generate`.
- Backend mencoba model sesuai `GEMINI_TTS_MODELS`; model 3.8 memakai Interactions API, model legacy memakai GenerateContent. Saat terkena limit atau model tidak tersedia, percobaan beralih otomatis tanpa notifikasi failover di UI.
- Gemini 3.8 mengembalikan audio WAV; backend menyimpan file ke `public/audio/`, lalu mengembalikan URL dan mencatatnya ke riwayat.

---

## ❓ Troubleshooting

| Masalah | Penyebab & Solusi |
|---|---|
| `GEMINI_API_KEY belum diisi` | File `.env` belum dibuat atau API key masih placeholder. |
| `Kuota Gemini API sedang penuh` (429) | Batas kuota free tier tercapai. Tunggu 1 menit lalu coba lagi. |
| `Teks diblokir filter keamanan Gemini` | Teks dianggap sensitif. Ubah kalimatnya. |
| Hasil suara terpotong | Teks terlalu panjang. Batas 5000 karakter; pecah jadi beberapa bagian. |
| Gagal memuat daftar suara | Backend belum jalan. Pastikan terminal `npm run dev` tidak error. |
| `npm.ps1 cannot be loaded` | Execution policy PowerShell. Lihat catatan Windows di atas. |
| `Cannot find module 'bcryptjs'` | Dependency belum terinstall. Jalankan `npm install`. |

---

## 📄 Lisensi

ISC

