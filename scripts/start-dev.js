// Menyalakan backend + frontend sekaligus sebagai proses background (detached)
// dan menulis log ke dev-server.log / dev-client.log.
//
//   node scripts/start-dev.js
//   node scripts/start-dev.js --stop   (menghentikan proses yang sebelumnya dinyalakan)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const PID_FILE = path.join(ROOT, '.dev-pids.json');

const args = process.argv.slice(2);
if (args.includes('--stop')) {
  try {
    const pids = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    for (const pid of Object.values(pids)) {
      try { process.kill(pid); console.log(`stop pid ${pid}`); } catch {}
    }
  } catch (e) { console.log('tidak ada PID tersimpan'); }
  try { fs.unlinkSync(PID_FILE); } catch {}
  process.exit(0);
}

const serverLog = fs.openSync(path.join(ROOT, 'dev-server.log'), 'a');
const clientLog = fs.openSync(path.join(ROOT, 'dev-client.log'), 'a');

const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT, detached: true, stdio: ['ignore', serverLog, serverLog],
  env: { ...process.env, PORT: process.env.PORT || '5000' }
});
server.unref();

const client = spawn(/^win/.test(process.platform) ? 'npm.cmd' : 'npm', ['start'], {
  cwd: CLIENT, detached: true, stdio: ['ignore', clientLog, clientLog],
  env: { ...process.env, BROWSER: 'none', PORT: '3000' }, shell: true
});
client.unref();

fs.writeFileSync(PID_FILE, JSON.stringify({ server: server.pid, client: client.pid }));
console.log(`backend pid=${server.pid} (http://localhost:5000)`);
console.log(`frontend pid=${client.pid} (http://localhost:3000)`);
console.log('log: dev-server.log & dev-client.log');
