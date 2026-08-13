import { App } from './App';

const canvasNone =
  document.querySelector<HTMLCanvasElement>('#webgl-canvas-none');
const canvasMsaa =
  document.querySelector<HTMLCanvasElement>('#webgl-canvas-msaa');
if (!canvasNone || !canvasMsaa) {
  throw new Error('比較用のキャンバスが見つかりません。');
}

const appNone = App.create(canvasNone, false);
const appMsaa = App.create(canvasMsaa, true);
appNone.start();
appMsaa.start();
