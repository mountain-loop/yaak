#!/usr/bin/env node

/**
 * Script to run Tauri dev server with dynamic port configuration.
 * Loads port from .env.local if present, otherwise uses default port 1420.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.local if it exists
const envLocalPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  const envVars = envContent
    .split('\n')
    .filter(line => line && !line.startsWith('#'))
    .reduce((acc, line) => {
      const [key, value] = line.split('=');
      if (key && value) {
        acc[key.trim()] = value.trim();
      }
      return acc;
    }, {});

  Object.assign(process.env, envVars);
}

const port = process.env.YAAK_DEV_PORT || '1420';
const config = JSON.stringify({ build: { devUrl: `http://localhost:${port}` } });

// Get additional arguments passed after npm run app-dev --
const additionalArgs = process.argv.slice(2);

const args = [
  'dev',
  '--no-watch',
  '--config', './src-tauri/tauri.development.conf.json',
  '--config', config,
  ...additionalArgs
];

const result = spawnSync('tauri', args, { stdio: 'inherit', shell: false, env: process.env });

process.exit(result.status || 0);
