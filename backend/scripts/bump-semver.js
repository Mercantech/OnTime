const fs = require('fs');
const path = require('path');

function parseSemver(v) {
  const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Ugyldig version: ${v}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function formatSemver({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function bump(version, type) {
  const v = { ...version };
  if (type === 'major') {
    v.major += 1;
    v.minor = 0;
    v.patch = 0;
    return v;
  }
  if (type === 'minor') {
    v.minor += 1;
    v.patch = 0;
    return v;
  }
  // patch default
  v.patch += 1;
  return v;
}

function main() {
  const typeArg = (process.argv[2] || 'patch').toLowerCase();
  const type = typeArg === 'major' || typeArg === 'minor' || typeArg === 'patch' ? typeArg : 'patch';

  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const current = parseSemver(pkg.version || '0.0.0');
  const next = bump(current, type);
  pkg.version = formatSemver(next);
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  process.stdout.write(pkg.version);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e?.message || e);
    process.exit(1);
  }
}

