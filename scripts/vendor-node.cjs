const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Downloader = require("nodejs-file-downloader");
const { extractArchive } = require("./extract-archive.cjs");
const { rmSync, cpSync, mkdirSync, existsSync } = require("node:fs");
const { execSync } = require("node:child_process");

const nodeVersionFile = path.join(__dirname, "..", "packages", "plugin-runtime", ".node-version");
const NODE_VERSION = `v${fs.readFileSync(nodeVersionFile, "utf8").trim().replace(/^v/, "")}`;

// `${process.platform}_${process.arch}`
const MAC_ARM = "darwin_arm64";
const MAC_X64 = "darwin_x64";
const LNX_ARM = "linux_arm64";
const LNX_X64 = "linux_x64";
const WIN_X64 = "win32_x64";
const WIN_ARM = "win32_arm64";

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
  [MAC_ARM]: "yaaknode",
  [MAC_X64]: "yaaknode",
  [LNX_ARM]: "yaaknode",
  [LNX_X64]: "yaaknode",
  [WIN_X64]: "yaaknode.exe",
  [WIN_ARM]: "yaaknode.exe",
};

const SHA256_MAP = {
  [MAC_ARM]: "aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a",
  [MAC_X64]: "d5e336d588c45be0c37dbd52cc29895593009ca4997a77a1fd02815131ed0e52",
  [LNX_ARM]: "95c264150aceb7f3437a29fd6984924f5f8d1511ea3cbd6c508b83f6c555dae2",
  [LNX_X64]: "361718c444e49af2ca5a110c83ba6a8901143f23ab285ebbef0341f391f482a9",
  [WIN_X64]: "ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2",
  [WIN_ARM]: "f47968c213105077f64c6510f007632c0ca2574802a0b5067c327c49abe1c468",
};

const key = `${process.platform}_${process.env.YAAK_TARGET_ARCH ?? process.arch}`;

const destDir = path.join(__dirname, `..`, "crates-tauri", "yaak-app-client", "vendored", "node");
const binDest = path.join(destDir, DST_BIN_MAP[key]);
console.log(`Vendoring NodeJS ${NODE_VERSION} for ${key}`);

if (existsSync(binDest) && tryExecSync(`${binDest} --version`).trim() === NODE_VERSION) {
  console.log("NodeJS already vendored");
  return;
}

rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });

const url = URL_MAP[key];
const tmpDir = path.join(__dirname, "tmp-node");
rmSync(tmpDir, { recursive: true, force: true });

(async function () {
  // Download GitHub release artifact
  console.log("Downloading NodeJS at", url);
  const { filePath } = await new Downloader({
    url,
    directory: tmpDir,
    timeout: 1000 * 60 * 2,
  }).download();

  // Verify SHA256
  const expectedHash = SHA256_MAP[key];
  const fileBuffer = fs.readFileSync(filePath);
  const actualHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(
      `SHA256 mismatch for ${path.basename(filePath)}\n  expected: ${expectedHash}\n  actual:   ${actualHash}`,
    );
  }
  console.log("SHA256 verified:", actualHash);

  // Decompress to the same directory
  await extractArchive(filePath, tmpDir);

  // Copy binary
  const binSrc = path.join(tmpDir, SRC_BIN_MAP[key]);
  cpSync(binSrc, binDest);
  rmSync(tmpDir, { recursive: true, force: true });

  console.log("Downloaded NodeJS to", binDest);
})().catch((err) => {
  console.log("Script failed:", err);
  process.exit(1);
});

function tryExecSync(cmd) {
  try {
    return execSync(cmd, { stdio: "pipe" }).toString("utf-8");
  } catch {
    return "";
  }
}
