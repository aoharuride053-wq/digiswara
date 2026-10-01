// Menjalankan server sebagai child process, menunggu siap, lalu menjalankan
// smoke test. Berguna untuk memastikan aplikasi benar-benar hidup.
//
//   node scripts/verify.js

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || '5000';
const BASE = `http://localhost:${PORT}`;

const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverLog = '';
server.stdout.on('data', (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  serverLog += chunk.toString();
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServer = async (timeoutMs = 20000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch (_) {
      // server belum siap, coba lagi
    }
    await sleep(500);
  }
  return false;
};

const runSmokeTest = () =>
  new Promise((resolve) => {
    const smoke = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smoke-test.js')], {
      cwd: ROOT,
      stdio: 'inherit'
    });
    smoke.on('exit', (code) => resolve(code ?? 1));
  });

(async () => {
  console.log('\n[verify] Menunggu server siap di ' + BASE + ' ...');
  const ready = await waitForServer();

  console.log('\n===== LOG SERVER =====');
  console.log(serverLog.trim() || '(server tidak menghasilkan output apa pun)');
  console.log('======================\n');

  let exitCode = 1;

  if (!ready) {
    console.log('[verify] GAGAL: server tidak merespons /api/health.');
  } else {
    console.log('[verify] Server siap. Menjalankan smoke test...\n');
    exitCode = await runSmokeTest();
  }

  server.kill();
  await sleep(300);
  process.exit(exitCode);
})();
