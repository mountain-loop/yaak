const { readdirSync, cpSync } = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const pluginsDir = process.env.YAAK_PLUGINS_DIR;
if (!pluginsDir) {
  console.log('Skipping bundled plugins build because YAAK_PLUGINS_DIR is not set');
  return;
}

console.log('Installing Yaak plugins dependencies', pluginsDir);
execSync('npm ci', { cwd: pluginsDir });
console.log('Building Yaak plugins', pluginsDir);
execSync('npm run build', { cwd: pluginsDir });

console.log('Copying Yaak plugins to', pluginsDir);

const pluginsRoot = path.join(pluginsDir, 'plugins');
for (const name of readdirSync(pluginsRoot)) {
  const dir = path.join(pluginsRoot, name);
  if (name.startsWith('.')) continue;
  const destDir = path.join(__dirname, '../src-tauri/vendored/plugins/', name);
  console.log(`Copying ${name} to ${destDir}`);
  cpSync(path.join(dir, 'package.json'), path.join(destDir, 'package.json'));
  cpSync(path.join(dir, 'build/index.js'), path.join(destDir, 'build/index.js'));
}
