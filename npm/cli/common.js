const BINARY_DISTRIBUTION_PACKAGES = {
  darwin_arm64: "@yaakapp/cli-darwin-arm64",
  darwin_x64: "@yaakapp/cli-darwin-x64",
  linux_arm64: "@yaakapp/cli-linux-arm64",
  linux_x64: "@yaakapp/cli-linux-x64",
  win32_x64: "@yaakapp/cli-win32-x64",
  win32_arm64: "@yaakapp/cli-win32-arm64"
};

const BINARY_DISTRIBUTION_VERSION = require("./package.json").version;
const BINARY_NAME = process.platform === "win32" ? "yaakcli.exe" : "yaakcli";
const PLATFORM_SPECIFIC_PACKAGE_NAME =
  BINARY_DISTRIBUTION_PACKAGES[`${process.platform}_${process.arch}`];

module.exports = {
  BINARY_DISTRIBUTION_PACKAGES,
  BINARY_DISTRIBUTION_VERSION,
  BINARY_NAME,
  PLATFORM_SPECIFIC_PACKAGE_NAME
};
