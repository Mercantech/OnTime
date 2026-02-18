#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function readCommitMessage(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function detectBumpType(msg) {
  const m = String(msg || '');
  if (/#(no[-_ ]?version|skip[-_ ]?version|noversion|skipver)\b/i.test(m)) return 'none';
  if (/#major\b/i.test(m)) return 'major';
  if (/#minor\b/i.test(m)) return 'minor';
  if (/#patch\b/i.test(m)) return 'patch';
  // default: patch
  return 'patch';
}

function run(cmd, cwd) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
}

function main() {
  const msgFile = process.argv[2];
  if (!msgFile) return;

  const repoRoot = path.resolve(__dirname, '..', '..');
  const pkgRel = path.join('backend', 'package.json');
  const pkgPath = path.join(repoRoot, pkgRel);
  if (!fs.existsSync(pkgPath)) return;

  const msg = readCommitMessage(msgFile);
  const bumpType = detectBumpType(msg);
  if (bumpType === 'none') return;

  // Bump backend/package.json version
  run(`node "${path.join('backend', 'scripts', 'bump-semver.js')}" ${bumpType}`, repoRoot);

  // Stage it for the commit
  run(`git add "${pkgRel}"`, repoRoot);
}

function runHook(msgFile) {
  process.argv[2] = msgFile;
  return main();
}

module.exports = { runHook };

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e?.message || e);
    process.exit(1);
  }
}

