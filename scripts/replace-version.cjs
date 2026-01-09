const path = require('path');
const fs = require('fs');

const version = process.env.YAAK_VERSION?.replace('v', '');
if (!version) {
  throw new Error('YAAK_VERSION environment variable not set')
}

const tauriConfigPath = path.join(__dirname, '../crates-tauri/yaak-app/tauri.conf.json');
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));

tauriConfig.version = version;

console.log('Writing version ' + version + ' to ' + tauriConfigPath)
fs.writeFileSync(tauriConfigPath, JSON.stringify(tauriConfig, null, 2));
