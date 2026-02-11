const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const decompress = require('decompress');
const Downloader = require('nodejs-file-downloader');
const { rmSync, cpSync, mkdirSync, existsSync } = require('node:fs');
const { execSync } = require('node:child_process');

const NODE_VERSION = 'v24.11.1';

// `${process.platform}_${process.arch}`
const MAC_ARM = 'darwin_arm64';
const MAC_X64 = 'darwin_x64';
const LNX_ARM = 'linux_arm64';
const LNX_X64 = 'linux_x64';
const WIN_X64 = 'win32_x64';
const WIN_ARM = 'win32_arm64';

const URL_MAP = {
  [MAC_ARM]: `https://nodejs.org/download/release/${NODE_VERSION}/node-${NODE_VERSION}-darwin-arm64.tar.gz`,
  [MAC_X64]: `https://nodejs.org/download/release/${NODE_VERSION}/node-${NODE_VERSION}-darwin-x64.tar.gz`,
  [LNX_ARM]: `https://nodejs.org/download/release/${NODE_VERSION}/node-${NODE_VERSION}-linux-arm64.tar.gz`,
  [LNX_X64]: `https://nodejs.org/download/release/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz`,
  [WIN_X64]: `https://nodejs.org/download/release/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`,
  [WIN_ARM]: `https://nodejs.org/download/release/${NODE_VERSION}/node-${NODE_VERSION}-win-arm64.zip`,
};

const SRC_BIN_MAP = {
  [MAC_ARM]: `node-${NODE_VERSION}-darwin-arm64/bin/node`,
  [MAC_X64]: `node-${NODE_VERSION}-darwin-x64/bin/node`,
  [LNX_ARM]: `node-${NODE_VERSION}-linux-arm64/bin/node`,
  [LNX_X64]: `node-${NODE_VERSION}-linux-x64/bin/node`,
  [WIN_X64]: `node-${NODE_VERSION}-win-x64/node.exe`,
  [WIN_ARM]: `node-${NODE_VERSION}-win-arm64/node.exe`,
};

const DST_BIN_MAP = {
  [MAC_ARM]: 'yaaknode',
  [MAC_X64]: 'yaaknode',
  [LNX_ARM]: 'yaaknode',
  [LNX_X64]: 'yaaknode',
  [WIN_X64]: 'yaaknode.exe',
  [WIN_ARM]: 'yaaknode.exe',
};

const SHA256_MAP = {
  [MAC_ARM]: 'b05aa3a66efe680023f930bd5af3fdbbd542794da5644ca2ad711d68cbd4dc35',
  [MAC_X64]: '096081b6d6fcdd3f5ba0f5f1d44a47e83037ad2e78eada26671c252fe64dd111',
  [LNX_ARM]: '0dc93ec5c798b0d347f068db6d205d03dea9a71765e6a53922b682b91265d71f',
  [LNX_X64]: '58a5ff5cc8f2200e458bea22e329d5c1994aa1b111d499ca46ec2411d58239ca',
  [WIN_X64]: '5355ae6d7c49eddcfde7d34ac3486820600a831bf81dc3bdca5c8db6a9bb0e76',
  [WIN_ARM]: 'ce9ee4e547ebdff355beb48e309b166c24df6be0291c9eaf103ce15f3de9e5b4',
};

const key = `${process.platform}_${process.env.YAAK_TARGET_ARCH ?? process.arch}`;

const destDir = path.join(__dirname, `..`, 'crates-tauri', 'yaak-app', 'vendored', 'node');
const binDest = path.join(destDir, DST_BIN_MAP[key]);
console.log(`Vendoring NodeJS ${NODE_VERSION} for ${key}`);

if (existsSync(binDest) && tryExecSync(`${binDest} --version`).trim() === NODE_VERSION) {
  console.log('NodeJS already vendored');
  return;
}

rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });

const url = URL_MAP[key];
const tmpDir = path.join(__dirname, 'tmp-node');
rmSync(tmpDir, { recursive: true, force: true });

(async function () {
  // Download GitHub release artifact
  console.log('Downloading NodeJS at', url);
  const { filePath } = await new Downloader({
    url,
    directory: tmpDir,
    timeout: 1000 * 60 * 2,
  }).download();

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
  const binSrc = path.join(tmpDir, SRC_BIN_MAP[key]);
  cpSync(binSrc, binDest);
  rmSync(tmpDir, { recursive: true, force: true });

  console.log('Downloaded NodeJS to', binDest);
})().catch((err) => {
  console.log('Script failed:', err);
  process.exit(1);
});

function tryExecSync(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString('utf-8');
  } catch (_) {
    return '';
  }
}
