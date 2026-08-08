import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

const root = fileURLToPath(new URL('src', import.meta.url));

const input = {
  main: `${root}/index.html`,
  ...Object.fromEntries(
    globSync('*/{demo,threejs}/**/index.html', { cwd: root }).map((file) => [
      file.replace(/\/index\.html$/, '').replaceAll('/', '_'),
      `${root}/${file}`,
    ]),
  ),
};

export default defineConfig({
  root,
  appType: 'mpa',
  plugins: [
    tailwindcss(),
    glsl({
      minify: true,
    }),
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: { input },
  },
});
