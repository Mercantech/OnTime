const fs = require('fs');
const path = require('path');

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function writeFile(p, content) {
  fs.writeFileSync(p, content, { encoding: 'utf8' });
}

function main() {
  const args = new Set(process.argv.slice(2));
  const uninstall = args.has('--uninstall');

  const repoRoot = path.resolve(__dirname, '..', '..');
  const hooksDir = path.join(repoRoot, '.git', 'hooks');
  if (!exists(hooksDir)) {
    console.error('Kunne ikke finde .git/hooks – kør scriptet fra et git-repo.');
    process.exit(1);
  }

  const hookPath = path.join(hooksDir, 'commit-msg');
  const backupPath = hookPath + '.bak';

  if (uninstall) {
    if (exists(hookPath)) fs.unlinkSync(hookPath);
    if (exists(backupPath)) fs.renameSync(backupPath, hookPath);
    console.log('Git hook fjernet.');
    return;
  }

  if (exists(hookPath) && !exists(backupPath)) {
    fs.copyFileSync(hookPath, backupPath);
  }

  const hookContent = `#!/usr/bin/env node
require('./../../backend/scripts/commit-msg-version.js').runHook(process.argv[2]);
`;

  writeFile(hookPath, hookContent);
  console.log('Git hook installeret:', hookPath);
  console.log('Brug #minor eller #major i commit message for bump. Standard er patch.');
}

if (require.main === module) {
  main();
}

