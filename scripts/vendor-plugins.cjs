const { readdirSync, cpSync } = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const pluginsDir = path.join(__dirname, '..', 'plugins');

console.log('Copying Yaak plugins to', pluginsDir);

for (const name of readdirSync(pluginsDir)) {
  const dir = path.join(pluginsDir, name);
  if (name.startsWith('.')) continue;
  console.log('Building plugin', dir);
  execSync('npm run build', { cwd: dir });
  const destDir = path.join(__dirname, '../src-tauri/vendored/plugins/', name);
  console.log(`Copying ${name} to ${destDir}`);
  cpSync(path.join(dir, 'package.json'), path.join(destDir, 'package.json'));
  cpSync(path.join(dir, 'build/index.js'), path.join(destDir, 'build/index.js'));
}
