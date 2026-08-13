import { App } from './App';

const main = async () => {
  const canvasNone = document.querySelector<HTMLCanvasElement>(
    '#webgpu-canvas-none',
  );
  const canvasMsaa = document.querySelector<HTMLCanvasElement>(
    '#webgpu-canvas-msaa',
  );
  if (!canvasNone || !canvasMsaa) {
    throw new Error('比較用のキャンバスが見つかりません。');
  }

  const [appNone, appMsaa] = await Promise.all([
    App.create(canvasNone, 1),
    App.create(canvasMsaa, 4),
  ]);
  appNone.start();
  appMsaa.start();
};

main();
