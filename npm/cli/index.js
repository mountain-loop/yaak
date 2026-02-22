const path = require("path");
const childProcess = require("child_process");
const { PLATFORM_SPECIFIC_PACKAGE_NAME, BINARY_NAME } = require("./common");

function getBinaryPath() {
  try {
    if (!PLATFORM_SPECIFIC_PACKAGE_NAME) {
      throw new Error("unsupported platform");
    }
    return require.resolve(`${PLATFORM_SPECIFIC_PACKAGE_NAME}/bin/${BINARY_NAME}`);
  } catch (_) {
    return path.join(__dirname, BINARY_NAME);
  }
}

module.exports.runBinary = function runBinary(...args) {
  childProcess.execFileSync(getBinaryPath(), args, {
    stdio: "inherit"
  });
};
