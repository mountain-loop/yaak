const { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const version = process.env.YAAK_CLI_VERSION?.replace(/^v/, "");
if (!version) {
  console.error("YAAK_CLI_VERSION is not set");
  process.exit(1);
}

const packages = [
  "cli",
  "cli-darwin-arm64",
  "cli-darwin-x64",
  "cli-linux-arm64",
  "cli-linux-x64",
  "cli-win32-arm64",
  "cli-win32-x64"
];

const binaries = [
  {
    src: join(__dirname, "dist", "cli-darwin-arm64", "yaak"),
    dest: join(__dirname, "cli-darwin-arm64", "bin", "yaak")
  },
  {
    src: join(__dirname, "dist", "cli-darwin-x64", "yaak"),
    dest: join(__dirname, "cli-darwin-x64", "bin", "yaak")
  },
  {
    src: join(__dirname, "dist", "cli-linux-arm64", "yaak"),
    dest: join(__dirname, "cli-linux-arm64", "bin", "yaak")
  },
  {
    src: join(__dirname, "dist", "cli-linux-x64", "yaak"),
    dest: join(__dirname, "cli-linux-x64", "bin", "yaak")
  },
  {
    src: join(__dirname, "dist", "cli-win32-arm64", "yaak.exe"),
    dest: join(__dirname, "cli-win32-arm64", "bin", "yaak.exe")
  },
  {
    src: join(__dirname, "dist", "cli-win32-x64", "yaak.exe"),
    dest: join(__dirname, "cli-win32-x64", "bin", "yaak.exe")
  }
];

for (const { src, dest } of binaries) {
  if (!existsSync(src)) {
    console.error(`Missing binary artifact: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, dest);
  if (!dest.endsWith(".exe")) {
    chmodSync(dest, 0o755);
  }
}

for (const pkg of packages) {
  const filepath = join(__dirname, pkg, "package.json");
  const json = JSON.parse(readFileSync(filepath, "utf-8"));
  json.version = version;

  if (json.name === "@yaakapp/cli") {
    json.optionalDependencies = {
      "@yaakapp/cli-darwin-x64": version,
      "@yaakapp/cli-darwin-arm64": version,
      "@yaakapp/cli-linux-arm64": version,
      "@yaakapp/cli-linux-x64": version,
      "@yaakapp/cli-win32-x64": version,
      "@yaakapp/cli-win32-arm64": version
    };
  }

  writeFileSync(filepath, `${JSON.stringify(json, null, 2)}\n`);
}

console.log(`Prepared @yaakapp/cli npm packages for ${version}`);
