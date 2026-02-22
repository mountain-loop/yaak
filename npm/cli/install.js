const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const https = require("node:https");
const {
  BINARY_DISTRIBUTION_VERSION,
  BINARY_NAME,
  PLATFORM_SPECIFIC_PACKAGE_NAME
} = require("./common");

const fallbackBinaryPath = path.join(__dirname, BINARY_NAME);

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => resolve(Buffer.concat(chunks)));
        } else if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          makeRequest(response.headers.location).then(resolve, reject);
        } else {
          reject(
            new Error(
              `npm responded with status code ${response.statusCode} when downloading package ${url}`
            )
          );
        }
      })
      .on("error", (error) => reject(error));
  });
}

function extractFileFromTarball(tarballBuffer, filepath) {
  let offset = 0;
  while (offset < tarballBuffer.length) {
    const header = tarballBuffer.subarray(offset, offset + 512);
    offset += 512;

    const fileName = header.toString("utf-8", 0, 100).replace(/\0.*/g, "");
    const fileSize = parseInt(header.toString("utf-8", 124, 136).replace(/\0.*/g, ""), 8);

    if (fileName === filepath) {
      return tarballBuffer.subarray(offset, offset + fileSize);
    }

    offset = (offset + fileSize + 511) & ~511;
  }

  return null;
}

async function downloadBinaryFromNpm() {
  if (!PLATFORM_SPECIFIC_PACKAGE_NAME) {
    throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
  }

  const packageNameWithoutScope = PLATFORM_SPECIFIC_PACKAGE_NAME.split("/")[1];
  const tarballUrl = `https://registry.npmjs.org/${PLATFORM_SPECIFIC_PACKAGE_NAME}/-/${packageNameWithoutScope}-${BINARY_DISTRIBUTION_VERSION}.tgz`;
  const tarballDownloadBuffer = await makeRequest(tarballUrl);
  const tarballBuffer = zlib.unzipSync(tarballDownloadBuffer);

  const binary = extractFileFromTarball(tarballBuffer, `package/bin/${BINARY_NAME}`);
  if (!binary) {
    throw new Error(`Could not find package/bin/${BINARY_NAME} in tarball`);
  }

  fs.writeFileSync(fallbackBinaryPath, binary);
  fs.chmodSync(fallbackBinaryPath, "755");
}

function isPlatformSpecificPackageInstalled() {
  try {
    if (!PLATFORM_SPECIFIC_PACKAGE_NAME) {
      return false;
    }
    require.resolve(`${PLATFORM_SPECIFIC_PACKAGE_NAME}/bin/${BINARY_NAME}`);
    return true;
  } catch (_) {
    return false;
  }
}

if (!isPlatformSpecificPackageInstalled()) {
  console.log("Platform package missing. Downloading Yaak CLI binary from npm...");
  downloadBinaryFromNpm().catch((err) => {
    console.error("Failed to install Yaak CLI binary:", err);
    process.exitCode = 1;
  });
} else {
  console.log("Platform package present. Using bundled Yaak CLI binary.");
}
