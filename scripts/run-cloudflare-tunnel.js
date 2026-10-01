require('dotenv').config();

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const token = process.env.CLOUDFLARED_TUNNEL_TOKEN;
const hostname = (process.env.CLOUDFLARED_TUNNEL_HOSTNAME || '').trim().toLowerCase();

if (!token) {
  console.error('CLOUDFLARED_TUNNEL_TOKEN belum diisi di .env.');
  process.exit(1);
}

let parsedHostname;
try {
  const parsed = new URL(`https://${hostname}`);
  if (parsed.hostname !== hostname || parsed.pathname !== '/') throw new Error('invalid hostname');
  parsedHostname = parsed.hostname;
} catch (_) {
  console.error('Isi CLOUDFLARED_TUNNEL_HOSTNAME dengan hostname Cloudflare, tanpa https:// atau path.');
  process.exit(1);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-cloudflared-'));
const tokenFile = path.join(tempDir, 'tunnel-token');
fs.writeFileSync(tokenFile, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });

const windowsInstallPath = path.join(
  process.env.ProgramFilesX86 || 'C:\\Program Files (x86)',
  'cloudflared',
  'cloudflared.exe'
);
const hasWindowsInstall = process.platform === 'win32'
  && fs.existsSync(windowsInstallPath)
  && fs.statSync(windowsInstallPath).size > 0;
const cloudflared = process.env.CLOUDFLARED_PATH
  || (hasWindowsInstall ? windowsInstallPath : process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
const tunnel = spawn(cloudflared, ['tunnel', 'run', '--token-file', tokenFile], {
  stdio: 'inherit',
  windowsHide: true
});

let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {
    // Best-effort cleanup for the temporary token file.
  }
};

console.log(`Expected webhook URL: https://${parsedHostname}/api/webhook/lynk`);
console.log('Waiting for the Cloudflare tunnel to connect...');

tunnel.once('error', (error) => {
  cleanup();
  if (error.code === 'ENOENT') {
    console.error('cloudflared tidak ditemukan. Install Cloudflare Tunnel atau set CLOUDFLARED_PATH.');
  } else {
    console.error(`Gagal menjalankan cloudflared: ${error.message}`);
  }
  process.exitCode = 1;
});

tunnel.once('exit', (code, signal) => {
  cleanup();
  if (signal) console.log(`cloudflared berhenti (${signal}).`);
  else if (code) console.error(`cloudflared berhenti dengan kode ${code}.`);
  process.exitCode = code || 0;
});

process.once('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    tunnel.kill(signal);
  });
}