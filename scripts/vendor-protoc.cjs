const crypto = require('node:crypto');
const fs = require('node:fs');
const decompress = require('decompress');
const Downloader = require('nodejs-file-downloader');
const path = require('node:path');
const { rmSync, mkdirSync, cpSync, existsSync, statSync, chmodSync } = require('node:fs');
const { execSync } = require('node:child_process');

const VERSION = '33.1';

// `${process.platform}_${process.arch}`
const MAC_ARM = 'darwin_arm64';
const MAC_X64 = 'darwin_x64';
const LNX_ARM = 'linux_arm64';
const LNX_X64 = 'linux_x64';
const WIN_X64 = 'win32_x64';
const WIN_ARM = 'win32_arm64';

const URL_MAP = {
  [MAC_ARM]: `https://github.com/protocolbuffers/protobuf/releases/download/v${VERSION}/protoc-${VERSION}-osx-aarch_64.zip`,
  [MAC_X64]: `https://github.com/protocolbuffers/protobuf/releases/download/v${VERSION}/protoc-${VERSION}-osx-x86_64.zip`,
  [LNX_ARM]: `https://github.com/protocolbuffers/protobuf/releases/download/v${VERSION}/protoc-${VERSION}-linux-aarch_64.zip`,
  [LNX_X64]: `https://github.com/protocolbuffers/protobuf/releases/download/v${VERSION}/protoc-${VERSION}-linux-x86_64.zip`,
  [WIN_X64]: `https://github.com/protocolbuffers/protobuf/releases/download/v${VERSION}/protoc-${VERSION}-win64.zip`,
  [WIN_ARM]: `https://github.com/protocolbuffers/protobuf/releases/download/v${VERSION}/protoc-${VERSION}-win64.zip`,
};

const SRC_BIN_MAP = {
  [MAC_ARM]: 'bin/protoc',
  [MAC_X64]: 'bin/protoc',
  [LNX_ARM]: 'bin/protoc',
  [LNX_X64]: 'bin/protoc',
  [WIN_X64]: 'bin/protoc.exe',
  [WIN_ARM]: 'bin/protoc.exe',
};

const DST_BIN_MAP = {
  [MAC_ARM]: 'yaakprotoc',
  [MAC_X64]: 'yaakprotoc',
  [LNX_ARM]: 'yaakprotoc',
  [LNX_X64]: 'yaakprotoc',
  [WIN_X64]: 'yaakprotoc.exe',
  [WIN_ARM]: 'yaakprotoc.exe',
};

const SHA256_MAP = {
  [MAC_ARM]: 'db7e66ff7f9080614d0f5505a6b0ac488cf89a15621b6a361672d1332ec2e14e',
  [MAC_X64]: 'e20b5f930e886da85e7402776a4959efb1ed60c57e72794bcade765e67abaa82',
  [LNX_ARM]: '6018147740548e0e0f764408c87f4cd040e6e1c1203e13aeacaf811892b604f3',
  [LNX_X64]: 'f3340e28a83d1c637d8bafdeed92b9f7db6a384c26bca880a6e5217b40a4328b',
  [WIN_X64]: 'd7a207fb6eec0e4b1b6613be3b7d11905375b6fd1147a071116eb8e9f24ac53b',
  [WIN_ARM]: 'd7a207fb6eec0e4b1b6613be3b7d11905375b6fd1147a071116eb8e9f24ac53b',
};

const dstDir = path.join(__dirname, `..`, 'crates-tauri', 'yaak-app', 'vendored', 'protoc');
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

  // Verify SHA256
  const expectedHash = SHA256_MAP[key];
  const fileBuffer = fs.readFileSync(filePath);
  const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  if (actualHash !== expectedHash) {
    throw new Error(`SHA256 mismatch for ${path.basename(filePath)}\n  expected: ${expectedHash}\n  actual:   ${actualHash}`);
  }
  console.log('SHA256 verified:', actualHash);

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
    return execSync(cmd, { stdio: 'pipe' }).toString('utf-8');
  } catch (_) {
    return '';
  }
}
