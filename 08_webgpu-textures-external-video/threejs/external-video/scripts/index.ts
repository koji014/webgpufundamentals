import { App } from './App';

const main = async () => {
  const canvas = document.querySelector<HTMLCanvasElement>('#webgl-canvas');
  if (!canvas) {
    throw new Error('#webgl-canvas が見つかりません。');
  }

  const app = await App.create(canvas);
  app.start();
};

main();
