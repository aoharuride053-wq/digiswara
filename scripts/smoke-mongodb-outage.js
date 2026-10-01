const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const port = 20000 + crypto.randomInt(20000);
const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
  cwd: root,
  env: {
    ...process.env,
    DATABASE_BACKEND: 'mongodb',
    MONGODB_URI: 'mongodb+srv://smoke:smoke@example.invalid/?appName=smoke',
    MONGODB_DATABASE: 'smoke',
    NODE_ENV: 'production',
    PORT: String(port)
  },
  stdio: 'ignore'
});

const stopChild = () => {
  if (child.exitCode === null) child.kill();
};

async function main() {
  const deadline = Date.now() + 8000;

  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1000)
      });
      const health = await response.json();
      if (
        response.status === 200
        && health.status === 'degraded'
        && health.databaseBackend === 'mongodb'
        && health.databaseReady === false
      ) {
        const apiResponse = await fetch(`http://127.0.0.1:${port}/api/profile`);
        const apiBody = await apiResponse.json();
        if (apiResponse.status !== 503 || apiBody.code !== 'DATABASE_UNAVAILABLE') {
          throw new Error('API requests were not gated while MongoDB was unavailable.');
        }
        console.log('[PASS] Health stays available and account APIs report MongoDB as unavailable.');
        return;
      }
    } catch (_) {
      // The server may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Health endpoint did not report MongoDB as unavailable.');
}

main()
  .catch((error) => {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(stopChild);