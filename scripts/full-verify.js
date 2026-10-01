// Menjalankan semua validasi secara berurutan dalam SATU proses:
//   1. Cek seluruh import & nama icon (cepat)
//   2. Build produksi frontend
// Hasil ditulis bertahap ke full-verify.log supaya progres bisa dipantau
// walau prosesnya lama.
//
//   node scripts/full-verify.js

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const LOG = path.join(ROOT, 'full-verify.log');

fs.writeFileSync(LOG, '');
const log = (msg) => {
  fs.appendFileSync(LOG, `${msg}\n`);
  console.log(msg);
};

const run = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      // shell hanya diperlukan untuk npm.cmd di Windows; jangan dipakai untuk
      // path node.exe karena mengandung spasi ("C:\Program Files\...").
      shell: options.shell === true,
      env: { ...process.env, CI: 'true' }
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('exit', (code) => resolve({ code, output }));
    child.on('error', (err) => resolve({ code: -1, output: `spawn error: ${err.message}` }));
  });

(async () => {
  log('=== FULL VERIFY ===');
  log(`node ${process.version}\n`);

  // STEP 1: cek import
  log('--- STEP 1/2: cek import & icon ---');
  const imports = await run(process.execPath, [path.join(__dirname, 'check-imports.js')]);
  log(imports.output.trim() || '(tidak ada output)');
  log(`[step] check-imports exit=${imports.code}\n`);

  // STEP 2: build produksi
  log('--- STEP 2/2: build produksi frontend ---');
  log('(tahap ini bisa memakan beberapa menit, mohon tunggu)\n');
  const build = await run('npm', ['run', 'build'], { cwd: CLIENT, shell: true });
  log(build.output.trim() || '(tidak ada output)');
  log(`[step] build exit=${build.code}\n`);

  const buildIndex = path.join(CLIENT, 'build', 'index.html');
  log(`build/index.html ada: ${fs.existsSync(buildIndex)}`);

  const ok = imports.code === 0 && build.code === 0 && fs.existsSync(buildIndex);
  log(`\n=== HASIL AKHIR: ${ok ? 'SEMUA LULUS' : 'ADA YANG GAGAL'} ===`);
  process.exit(ok ? 0 : 1);
})();
