// Memvalidasi sintaks semua file di client/src memakai Babel parser.
// Jauh lebih cepat daripada build webpack, tapi tetap menangkap
// error JSX, kurung tidak seimbang, dan sintaks JavaScript yang salah.
//
//   node scripts/check-syntax.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const SRC = path.join(CLIENT, 'src');

let parser;
try {
  const mod = require(path.join(CLIENT, 'node_modules', '@babel', 'parser'));
  parser = mod.parse ? mod : mod.default;
} catch (err) {
  console.error('Tidak bisa memuat @babel/parser:', err.message);
  process.exit(1);
}

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
};

const files = walk(SRC);
const errors = [];

for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  try {
    parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx'],
      errorRecovery: false
    });
  } catch (err) {
    errors.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}: ${err.message}`);
  }
}

console.log(`[syntax] ${files.length} file diperiksa (${files.length - errors.length} OK).`);

if (errors.length) {
  console.log(`\n[syntax] DITEMUKAN ${errors.length} ERROR:`);
  errors.forEach((item) => console.log(`  - ${item}`));
  process.exit(1);
}

console.log('[syntax] OK: semua file valid.\n');
