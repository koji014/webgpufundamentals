import { App } from './App';

const canvas = document.querySelector<HTMLCanvasElement>('#webgl-canvas');
if (!canvas) {
  throw new Error('#webgl-canvas が見つかりません。');
}

const app = App.create(canvas);
app.start();
