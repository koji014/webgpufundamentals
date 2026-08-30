import { App } from './App';

const main = async () => {
  const canvas = document.querySelector<HTMLCanvasElement>('#webgpu-canvas');
  if (!canvas) {
    throw new Error('#webgpu-canvas が見つかりません。');
  }

  const app = await App.create(canvas);
  app.start();
};

main();
