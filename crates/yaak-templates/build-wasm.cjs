const { execSync } = require('node:child_process');

if (process.env.SKIP_WASM_BUILD === '1') {
  console.log('Skipping wasm-pack build (SKIP_WASM_BUILD=1)');
  return;
}

execSync('wasm-pack build --target bundler', { stdio: 'inherit' });
