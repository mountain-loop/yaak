#!/usr/bin/env node

const path = require("path");
const childProcess = require("child_process");
const { BINARY_NAME, PLATFORM_SPECIFIC_PACKAGE_NAME } = require("../common");

function getBinaryPath() {
  try {
    if (!PLATFORM_SPECIFIC_PACKAGE_NAME) {
      throw new Error("unsupported platform");
    }
    return require.resolve(`${PLATFORM_SPECIFIC_PACKAGE_NAME}/bin/${BINARY_NAME}`);
  } catch (_) {
    return path.join(__dirname, "..", BINARY_NAME);
  }
}

const result = childProcess.spawnSync(getBinaryPath(), process.argv.slice(2), {
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
