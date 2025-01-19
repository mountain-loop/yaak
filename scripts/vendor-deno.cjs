const path = require('node:path');
const decompress = require('decompress');
const Downloader = require('nodejs-file-downloader');
const { rmSync, cpSync, mkdirSync, existsSync } = require('node:fs');
const { execSync } = require('node:child_process');

const VERSION = 'v2.1.6';

// `${process.platform}_${process.arch}`
const MAC_ARM = 'darwin_arm64';
const MAC_X64 = 'darwin_x64';
const LNX_X64 = 'linux_x64';
const WIN_X64 = 'win32_x64';

const URL_MAP = {
  [MAC_ARM]: `https://github.com/denoland/deno/releases/download/${VERSION}/deno-aarch64-apple-darwin.zip`,
  [MAC_X64]: `https://github.com/denoland/deno/releases/download/${VERSION}/deno-x86_64-apple-darwin.zip`,
  [LNX_X64]: `https://github.com/denoland/deno/releases/download/${VERSION}/deno-x86_64-unknown-linux-gnu.zip`,
  [WIN_X64]: `https://github.com/denoland/deno/releases/download/${VERSION}/deno-x86_64-pc-windows-msvc.zip`,
};

const SRC_BIN_MAP = {
  [MAC_ARM]: `deno`,
  [MAC_X64]: `deno`,
  [LNX_X64]: `deno`,
  [WIN_X64]: `deno.exe`,
};

const DST_BIN_MAP = {
  darwin_arm64: 'yaakdeno-aarch64-apple-darwin',
  darwin_x64: 'yaakdeno-x86_64-apple-darwin',
  linux_x64: 'yaakdeno-x86_64-unknown-linux-gnu',
  win32_x64: 'yaakdeno-x86_64-pc-windows-msvc.exe',
};

const key = `${process.platform}_${process.env.YAAK_TARGET_ARCH ?? process.arch}`;

const destDir = path.join(__dirname, `..`, 'src-tauri', 'vendored', 'deno');
const binDest = path.join(destDir, DST_BIN_MAP[key]);
console.log(`Vendoring NodeJS ${VERSION} for ${key}`);

if (existsSync(binDest) && tryExecSync(`${binDest} --version`).trim() === VERSION) {
  console.log('NodeJS already vendored');
  return;
}

rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });

const url = URL_MAP[key];
const tmpDir = path.join(__dirname, 'tmp-deno');
rmSync(tmpDir, { recursive: true, force: true });

(async function () {
  // Download GitHub release artifact
  console.log('Downloading Deno at', url);
  const { filePath } = await new Downloader({
    url,
    directory: tmpDir,
    timeout: 1000 * 60 * 2,
  }).download();

  // Decompress to the same directory
  await decompress(filePath, tmpDir, {});

  // Copy binary
  const binSrc = path.join(tmpDir, SRC_BIN_MAP[key]);
  cpSync(binSrc, binDest);
  rmSync(tmpDir, { recursive: true, force: true });

  console.log('Downloaded Deno to', binDest);
})().catch((err) => {
  console.log('Script failed:', err);
  process.exit(1);
});

function tryExecSync(cmd) {
  try {
    return execSync(cmd).toString('utf-8');
  } catch (_) {
    return '';
  }
}
