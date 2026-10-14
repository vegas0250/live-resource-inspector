import { build } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build exited ${code}`))));
});

const shared = {
  configFile: false,
  root,
  publicDir: false,
  build: { outDir: 'dist', emptyOutDir: false, sourcemap: true, watch: {} },
};

await Promise.all([
  build({
    ...shared,
    base: './',
    plugins: [react()],
    build: {
      ...shared.build,
      rollupOptions: {
        input: {
          popup: path.join(root, 'pages', 'popup.html'),
          dashboard: path.join(root, 'pages', 'dashboard.html'),
        },
      },
    },
  }),
  build({
    ...shared,
    build: {
      ...shared.build,
      rollupOptions: {
        input: path.join(root, 'src/background/index.ts'),
        output: { format: 'es', entryFileNames: 'background.js', inlineDynamicImports: true },
      },
    },
  }),
  build({
    ...shared,
    build: {
      ...shared.build,
      rollupOptions: {
        input: path.join(root, 'src/content/index.ts'),
        output: {
          format: 'iife',
          name: 'LiveResourceInspectorContent',
          entryFileNames: 'content.js',
          inlineDynamicImports: true,
        },
      },
    },
  }),
]);
