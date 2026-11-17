const path = require("path");
const fs = require("fs");

const version = process.env.YAAK_VERSION?.replace("v", "");
if (!version) {
  throw new Error("YAAK_VERSION environment variable not set");
}

// The app to stamp, Yaak's client unless another is named: `npm run replace-version -- proxy`
const apps = {
  client: "yaak-app-client",
  proxy: "yaak-app-proxy",
};
const appName = process.argv[2] ?? "client";
const appDir = apps[appName];
if (appDir == null) {
  throw new Error(`Unknown app "${appName}", expected one of ${Object.keys(apps).join(", ")}`);
}

const tauriConfigPath = path.join(__dirname, "../crates-tauri", appDir, "tauri.conf.json");
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));

tauriConfig.version = version;

console.log("Writing version " + version + " to " + tauriConfigPath);
fs.writeFileSync(tauriConfigPath, JSON.stringify(tauriConfig, null, 2));
