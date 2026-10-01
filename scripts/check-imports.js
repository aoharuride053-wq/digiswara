// Memeriksa seluruh import di client/src supaya error seperti "module not found",
// path salah, atau nama icon yang tidak ada bisa ketahuan lebih cepat
// daripada menunggu build produksi selesai.
//
//   node scripts/check-imports.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const SRC = path.join(CLIENT, 'src');
const EXTS = ['', '.js', '.jsx', '.json'];

const problems = [];
let checkedImports = 0;

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
};

const resolveLocal = (fromFile, spec) => {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of EXTS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  for (const ext of EXTS.slice(1)) {
    const candidate = path.join(base, `index${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const collectExports = (file) => {
  const code = fs.readFileSync(file, 'utf8');
  const names = new Set();
  let match;

  const declRe = /export\s+(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/g;
  while ((match = declRe.exec(code))) names.add(match[1]);

  const listRe = /export\s*\{([^}]+)\}/g;
  while ((match = listRe.exec(code))) {
    match[1].split(',').forEach((part) => {
      const item = part.trim();
      if (!item) return;
      const asMatch = /^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/.exec(item);
      names.add(asMatch ? asMatch[2] : item);
    });
  }

  return { names, hasDefault: /export\s+default\s/.test(code) };
};

const importRe = /import\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g;
const bareImportRe = /import\s+['"]([^'"]+)['"]/g;

for (const file of walk(SRC)) {
  const code = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  let match;

  const handle = (clause, spec) => {
    checkedImports += 1;

    if (spec.startsWith('.') || spec.startsWith('/')) {
      const target = resolveLocal(file, spec);
      if (!target) {
        problems.push(`${rel}: file tujuan tidak ditemukan untuk "${spec}"`);
        return;
      }

      const clauseClean = clause.replace(/^type\s+/, '');
      const namedMatch = /\{([^}]*)\}/.exec(clauseClean);
      const hasDefaultImport = /^[A-Za-z0-9_$]+\s*(?:,|$)/.test(clauseClean.trim());

      if (namedMatch || hasDefaultImport) {
        const { names, hasDefault } = collectExports(target);
        if (hasDefaultImport && !hasDefault) {
          problems.push(
            `${rel}: import default dari "${spec}" tapi ${path
              .relative(ROOT, target)
              .replace(/\\/g, '/')} tidak punya export default`
          );
        }
        if (namedMatch) {
          namedMatch[1]
            .split(',')
            .map((s) => s.trim().replace(/^type\s+/, ''))
            .filter(Boolean)
            .forEach((name) => {
              const clean = name.split(/\s+as\s+/)[0].trim();
              if (clean && !names.has(clean)) {
                problems.push(`${rel}: "${clean}" tidak di-export oleh "${spec}"`);
              }
            });
        }
      }
      return;
    }

    // Paket eksternal: pastikan benar-benar terpasang
    const parts = spec.split('/');
    const pkgName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const pkgDir = path.join(CLIENT, 'node_modules', pkgName);
    if (!fs.existsSync(pkgDir)) {
      problems.push(`${rel}: paket "${pkgName}" belum terpasang di client/node_modules`);
    }
  };

  while ((match = importRe.exec(code))) handle(match[1], match[2]);
  while ((match = bareImportRe.exec(code))) handle('', match[1]);
}

// Verifikasi langsung nama-nama icon heroicons yang dipakai
const heroiconsUsed = new Set();
for (const file of walk(SRC)) {
  const code = fs.readFileSync(file, 'utf8');
  const re = /import\s*\{([^}]+)\}\s*from\s*['"]@heroicons\/react\/24\/(outline|solid)['"]/g;
  let match;
  while ((match = re.exec(code))) {
    match[1].split(',').forEach((name) => {
      const clean = name.trim().split(/\s+as\s+/)[0].trim();
      if (clean) heroiconsUsed.add(`${match[2]}:${clean}`);
    });
  }
}

try {
  const outline = require(path.join(CLIENT, 'node_modules', '@heroicons', 'react', '24', 'outline'));
  const solid = require(path.join(CLIENT, 'node_modules', '@heroicons', 'react', '24', 'solid'));
  const sets = { outline, solid };
  for (const entry of heroiconsUsed) {
    const [kind, name] = entry.split(':');
    if (!sets[kind] || !(name in sets[kind])) {
      problems.push(`@heroicons/react/24/${kind}: icon "${name}" tidak ada di paket`);
    }
  }
  console.log(`[icon] ${heroiconsUsed.size} icon heroicons diverifikasi.`);
} catch (err) {
  problems.push(`Gagal memuat paket @heroicons/react: ${err.message}`);
}

console.log(`[import] ${checkedImports} import diperiksa di client/src.`);

if (problems.length) {
  console.log(`\n[import] DITEMUKAN ${problems.length} MASALAH:`);
  problems.forEach((item) => console.log(`  - ${item}`));
  process.exit(1);
}

console.log('[import] OK: semua import dan nama icon valid.\n');
