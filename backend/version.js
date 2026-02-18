const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let cached = null;

/**
 * Hent versionsnummer (semantisk vX.X.X).
 *
 * Vi bruger `backend/package.json` som single source of truth, fordi den
 * auto-bumpes pr. commit via git hook.
 *
 * (Hvis working tree er dirty, tilføjes suffix `-dirty`.)
 */
function getVersion() {
  if (cached != null) return cached;
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const base = (pkg.version || '1.0.0').replace(/^v/, '');
    let dirty = '';
    try {
      const repoRoot = path.resolve(__dirname, '..');
      const status = execSync('git status --porcelain', { encoding: 'utf8', cwd: repoRoot });
      if (String(status || '').trim()) dirty = '-dirty';
    } catch (_) {}
    cached = 'v' + base + dirty;
    return cached;
  } catch (_) {
    cached = 'v1.0.0';
    return cached;
  }
}

module.exports = { getVersion };
