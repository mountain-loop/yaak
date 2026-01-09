const { execSync } = require('node:child_process');

const version = tryExecSync('wasm-pack --version');
if (version.startsWith('wasm-pack ')) {
  console.log('wasm-pack already installed');
  return;
}

console.log('Installing wasm-pack via cargo...');
execSync('cargo install wasm-pack --locked', { stdio: 'inherit' });

function tryExecSync(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString('utf-8');
  } catch (_) {
    return '';
  }
}
