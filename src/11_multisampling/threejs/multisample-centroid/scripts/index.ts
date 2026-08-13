import { App } from './App';

const canvas = document.querySelector<HTMLCanvasElement>('#webgl-canvas');
if (!canvas) {
  throw new Error('#webgl-canvas が見つかりません。');
}
const button = document.querySelector<HTMLButtonElement>('#toggle-interp');
if (!button) {
  throw new Error('#toggle-interp が見つかりません。');
}

const app = App.create(canvas);
app.start();

button.addEventListener('click', () => {
  app.setMode(app.mode === 'center' ? 'centroid' : 'center');
});
