const decompress = require('decompress');
const Downloader = require('nodejs-file-downloader');
const path = require('node:path');
const { rmSync, mkdirSync, cpSync, existsSync, statSync, chmodSync } = require('node:fs');
const { execSync } = require('node:child_process');

const VERSION = '28.3';

// `${process.platform}_${process.arch}`
const MAC_ARM = 'darwin_arm64';
const MAC_X64 = 'darwin_x64';
const LNX_ARM = 'linux_arm64';
const LNX_X64 = 'linux_x64';
const WIN_X64 = 'win32_x64';

const URL_MAP = {
  [MAC_ARM]: `https://github.com/protocolbuffers/protobuf/releases/download/v${VERSION}/protoc-${VERSION}-osx-aarch_64.zip`,
  [MAC_X64]: `https://github.com/protocolbuffers/protobuf/releases/download/v${VERSION}/protoc-${VERSION}-osx-x86_64.zip`,
  [LNX_ARM]: `https://github.com/protocolbuffers/protobuf/releases/download/v${VERSION}/protoc-${VERSION}-linux-aarch_64.zip`,
  [LNX_X64]: `https://github.com/protocolbuffers/protobuf/releases/download/v${VERSION}/protoc-${VERSION}-linux-x86_64.zip`,
  [WIN_X64]: `https://github.com/protocolbuffers/protobuf/releases/download/v${VERSION}/protoc-${VERSION}-win64.zip`,
};

const SRC_BIN_MAP = {
  [MAC_ARM]: 'bin/protoc',
  [MAC_X64]: 'bin/protoc',
  [LNX_ARM]: 'bin/protoc',
  [LNX_X64]: 'bin/protoc',
  [WIN_X64]: 'bin/protoc.exe',
};

const DST_BIN_MAP = {
  [MAC_ARM]: 'yaakprotoc-aarch64-apple-darwin',
  [MAC_X64]: 'yaakprotoc-x86_64-apple-darwin',
  [LNX_ARM]: 'yaakprotoc-aarch64-unknown-linux-gnu',
  [LNX_X64]: 'yaakprotoc-x86_64-unknown-linux-gnu',
  [WIN_X64]: 'yaakprotoc-x86_64-pc-windows-msvc.exe',
};

const dstDir = path.join(__dirname, `..`, 'src-tauri', 'vendored', 'protoc');
const key = `${process.platform}_${process.env.YAAK_TARGET_ARCH ?? process.arch}`;
console.log(`Vendoring protoc ${VERSION} for ${key}`);

const url = URL_MAP[key];
const tmpDir = path.join(__dirname, 'tmp-protoc');
const binSrc = path.join(tmpDir, SRC_BIN_MAP[key]);
const binDst = path.join(dstDir, DST_BIN_MAP[key]);

if (existsSync(binDst) && tryExecSync(`${binDst} --version`).trim().includes(VERSION)) {
  console.log('Protoc already vendored');
  return;
}

rmSync(tmpDir, { recursive: true, force: true });
rmSync(dstDir, { recursive: true, force: true });
mkdirSync(dstDir, { recursive: true });

(async function () {
  // Download GitHub release artifact
  const { filePath } = await new Downloader({ url, directory: tmpDir }).download();

  // Decompress to the same directory
  await decompress(filePath, tmpDir, {});

  // Copy binary
  cpSync(binSrc, binDst);

  // Copy other files
  const includeSrc = path.join(tmpDir, 'include');
  const includeDst = path.join(dstDir, 'include');
  cpSync(includeSrc, includeDst, { recursive: true });
  rmSync(tmpDir, { recursive: true, force: true });

  // Make binary writable, so we can sign it during release
  const stat = statSync(binDst);
  const newMode = stat.mode | 0o200;
  chmodSync(binDst, newMode);

  console.log('Downloaded protoc to', binDst);
})().catch((err) => console.log('Script failed:', err));

function tryExecSync(cmd) {
  try {
    return execSync(cmd).toString('utf-8');
  } catch (_) {
    return '';
  }
}
