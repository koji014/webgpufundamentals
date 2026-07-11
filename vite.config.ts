import { globSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

const input = {
  main: 'index.html',
  ...Object.fromEntries(
    globSync('*/{demo,threejs}/**/index.html').map((file) => [
      file.replace(/\/index\.html$/, '').replaceAll('/', '_'),
      file,
    ]),
  ),
};

export default defineConfig({
  appType: 'mpa',
  plugins: [
    tailwindcss(),
    glsl({
      minify: true,
    }),
  ],
  build: {
    rollupOptions: { input },
  },
});
