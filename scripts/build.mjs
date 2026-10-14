import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

await run(process.execPath, [path.join(root, 'scripts', 'make-icons.mjs')]);
await rm(dist, { recursive: true, force: true });

await build(uiConfig(true));
await build(workerConfig('src/background/index.ts', 'background.js'));
await build(workerConfig('src/content/index.ts', 'content.js', 'iife'));
await cp(path.join(root, 'public', 'manifest.json'), path.join(dist, 'manifest.json'));
await cp(path.join(root, 'public', 'icons'), path.join(dist, 'icons'), { recursive: true });
console.log('extension ready: dist/');

function uiConfig(emptyOutDir) {
  return {
    configFile: false,
    root,
    base: './',
    publicDir: false,
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir,
      sourcemap: false,
      rollupOptions: {
        input: {
          popup: path.join(root, 'pages', 'popup.html'),
          dashboard: path.join(root, 'pages', 'dashboard.html'),
        },
      },
    },
  };
}

function workerConfig(entry, fileName, format = 'es') {
  return {
    configFile: false,
    root,
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: false,
      rollupOptions: {
        input: path.join(root, entry),
        output: {
          format,
          entryFileNames: fileName,
          inlineDynamicImports: true,
          name: format === 'iife' ? 'LiveResourceInspectorContent' : undefined,
        },
      },
    },
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}
