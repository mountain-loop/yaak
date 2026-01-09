#!/usr/bin/env node

/**
 * Runs `npm run dev` in parallel for all workspaces that have a dev script.
 * Handles cleanup of child processes on exit.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Read root package.json to get workspaces
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const workspaces = rootPkg.workspaces || [];

// Find all workspaces with a dev script
const workspacesWithDev = workspaces.filter((ws) => {
  const pkgPath = path.join(rootDir, ws, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.scripts?.dev != null;
});

if (workspacesWithDev.length === 0) {
  console.log('No workspaces with dev script found');
  process.exit(0);
}

console.log(`Starting dev for ${workspacesWithDev.length} workspaces...`);

const children = [];

// Spawn all dev processes
for (const ws of workspacesWithDev) {
  const cwd = path.join(rootDir, ws);
  const child = spawn('npm', ['run', 'dev'], {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('error', (err) => {
    console.error(`Error in ${ws}:`, err.message);
  });

  children.push({ ws, child });
}

// Cleanup function to kill all children
function cleanup() {
  for (const { ws, child } of children) {
    if (child.exitCode === null) {
      // Process still running
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', child.pid, '/f', '/t'], { shell: true });
      } else {
        child.kill('SIGTERM');
      }
    }
  }
}

// Handle various exit signals
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

process.on('exit', cleanup);

// Keep the process running
process.stdin.resume();
