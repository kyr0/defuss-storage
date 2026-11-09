// Release packaging (no publication): runs `make verify` into output/verify.log,
// packs the registry tarball into release/ with `bun pm pack`, writes
// SHA256SUMS over every shipped file, and builds a uniquely named
// complete-codebase ZIP that it then checks for archive integrity and per-file
// digests after extraction.
//
// Why a script: the evidence must come from this exact run, so the log, the
// tarball, the checksums and the archive are produced together and checked
// together. Needs the `zip`/`unzip` CLIs (macOS, Linux). VERIFIED: (release
// runs 2026-11-08) `unzip -tq` and the digest check passed for all 66 files.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
// Never shipped: dependencies, runtime state, local settings, caches and earlier ZIPs.
const EXCLUDED_DIRS = new Set(['node_modules', 'tmp', 'var', '.claude', '.git', '__pycache__', 'coverage', '.cache']);
const EXCLUDED_FILES = new Set(['.DS_Store', '.env', 'SHA256SUMS']);
// output/ is scratch; only this run's evidence files are shipped.
const EVIDENCE = ['verify.log', 'pack.json', 'package-results.json', 'browser-results.json',
  'browser-results-chromium.json', 'browser-results-firefox.json', 'browser-results-webkit.json'].map(f => `output/${f}`);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const log = message => console.log(`${new Date().toISOString()} INFO ${message}`);

/** Repository files to ship, as sorted POSIX-relative paths. */
async function shippedFiles(dir = root, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name) || rel === 'output') continue;
      out.push(...await shippedFiles(path.join(dir, entry.name), rel));
    } else if (entry.isFile() && !EXCLUDED_FILES.has(entry.name) && !(rel.startsWith('release/') && rel.endsWith('.zip'))) out.push(rel);
  }
  return out.sort();
}

log('running make verify');
const verify = spawnSync('make', ['verify'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
await writeFile(path.join(root, 'output/verify.log'), `${new Date().toISOString()} make verify exit=${verify.status}\n${verify.stdout}${verify.stderr}`);
if (verify.status !== 0) { console.error(verify.stdout.slice(-4000), verify.stderr.slice(-4000)); throw new Error('make verify failed; see output/verify.log'); }

log('packing tarball');
const tarball = execFileSync('bun', ['pm', 'pack', '--destination', 'release', '--ignore-scripts', '--quiet'], { cwd: root, encoding: 'utf8' }).trim();
const tarballBytes = await readFile(tarball);
await writeFile(path.join(root, 'output/pack.json'), JSON.stringify({ file: path.relative(root, tarball), bytes: tarballBytes.length, sha256: sha256(tarballBytes) }, null, 2) + '\n');

const files = [...await shippedFiles(), ...EVIDENCE].sort();
const sums = [];
for (const file of files) sums.push(`${sha256(await readFile(path.join(root, file)))}  ${file}`);
const manifest = sums.join('\n') + '\n';
await writeFile(path.join(root, 'SHA256SUMS'), manifest);

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const zipName = `defuss-storage-${version}-codebase-${stamp}-${sha256(manifest).slice(0, 12)}.zip`;
const zipPath = path.join(root, 'release', zipName);
log(`writing release/${zipName} (${files.length + 1} files)`);
execFileSync('zip', ['-X', '-q', zipPath, '-@'], { cwd: root, input: [...files, 'SHA256SUMS'].join('\n') + '\n' });

// Integrity: the archive's own CRCs, then every extracted file against SHA256SUMS.
execFileSync('unzip', ['-tq', zipPath]);
const check = await mkdtemp(path.join(tmpdir(), 'defuss-storage-release-'));
try {
  execFileSync('unzip', ['-q', zipPath, '-d', check]);
  const listed = (await readFile(path.join(check, 'SHA256SUMS'), 'utf8')).trim().split('\n').map(line => line.split('  '));
  for (const [digest, file] of listed) {
    if (sha256(await readFile(path.join(check, file))) !== digest) throw new Error(`digest mismatch in ZIP: ${file}`);
  }
  log(`verified ${listed.length} file digests and archive integrity`);
} finally { await rm(check, { recursive: true, force: true }); }
console.log(`release/${zipName}`);
