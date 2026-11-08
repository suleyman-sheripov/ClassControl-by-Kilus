'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const manifest = require('../bin/cloudflared-manifest.json');
const hash = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function vendor(platform = process.platform, arch = process.arch) {
  const os = { win32: 'win', darwin: 'mac', linux: 'linux' }[platform];
  if (
    !os ||
    !['x64', 'arm64'].includes(arch) ||
    (platform === 'win32' && arch !== 'x64')
  )
    throw Error('Unsupported cloudflared target: ' + platform + '/' + arch);
  const asset =
    platform === 'win32'
      ? 'cloudflared-windows-amd64.exe'
      : `cloudflared-${platform === 'darwin' ? 'darwin' : 'linux'}-${arch === 'x64' ? 'amd64' : 'arm64'}${platform === 'darwin' ? '.tgz' : ''}`;
  const digest = manifest.assets[asset];
  if (!digest) throw Error('No pinned digest for ' + asset);
  const dir = path.join(root, 'bin', os + '-' + arch);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(root,'bin/LICENSE-cloudflared.txt'),path.join(dir,'LICENSE-cloudflared.txt'));
  const name = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared',
    binary = path.join(dir, name),
    meta = path.join(dir, 'integrity.json');
  try {
    const saved = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (
      saved.version === manifest.version &&
      saved.asset === asset &&
      saved.archiveDigest === digest &&
      saved.binaryDigest === hash(binary)
    )
      return dir;
  } catch {}
  const archive = path.join(dir, asset + '.download');
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${manifest.version}/${asset}`;
  try {
    execFileSync(
      'curl',
      [
        '--fail',
        '--location',
        '--retry',
        '2',
        '--connect-timeout',
        '20',
        '--max-time',
        '180',
        '--output',
        archive,
        url
      ],
      { stdio: 'inherit' }
    );
    if (hash(archive) !== digest)
      throw Error('cloudflared SHA-256 mismatch: ' + asset);
    if (asset.endsWith('.tgz'))
      execFileSync('tar', ['-xzf', archive, '-C', dir, 'cloudflared'], {
        stdio: 'inherit'
      });
    else fs.copyFileSync(archive, binary);
    if (platform !== 'win32') fs.chmodSync(binary, 0o755);
    fs.writeFileSync(
      meta,
      JSON.stringify(
        {
          version: manifest.version,
          asset,
          archiveDigest: digest,
          binaryDigest: hash(binary)
        },
        null,
        2
      ) + '\n'
    );
    console.log(
      '[build] verified cloudflared ' + manifest.version + ' ' + os + '/' + arch
    );
    return dir;
  } finally {
    fs.rmSync(archive, { force: true });
  }
}
module.exports = { vendor, hash };
if (require.main === module)
  vendor(process.argv[2] || process.platform, process.argv[3] || process.arch);
