const { readdirSync, cpSync, existsSync } = require('node:fs');
const path = require('node:path');

const pluginsDir = path.join(__dirname, '..', 'plugins');
const externalPluginsDir = path.join(__dirname, '..', 'plugins-external');

// Get list of external (non-bundled) plugins
const externalPlugins = new Set();
if (existsSync(externalPluginsDir)) {
  for (const name of readdirSync(externalPluginsDir)) {
    if (!name.startsWith('.')) {
      externalPlugins.add(name);
    }
  }
}

console.log('Copying Yaak plugins to', pluginsDir);

for (const name of readdirSync(pluginsDir)) {
  const dir = path.join(pluginsDir, name);
  if (name.startsWith('.')) continue;
  if (externalPlugins.has(name)) {
    console.log(`Skipping ${name} (external plugin)`);
    continue;
  }
  const destDir = path.join(__dirname, '../src-tauri/vendored/plugins/', name);
  console.log(`Copying ${name} to ${destDir}`);
  cpSync(path.join(dir, 'package.json'), path.join(destDir, 'package.json'));
  cpSync(path.join(dir, 'build'), path.join(destDir, 'build'), { recursive: true });
}
