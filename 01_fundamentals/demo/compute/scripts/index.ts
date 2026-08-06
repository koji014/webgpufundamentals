import { App } from './App';

const main = async () => {
  const output = document.querySelector<HTMLDivElement>('#output');
  if (!output) {
    throw new Error('#output が見つかりません。');
  }

  const app = await App.create(output);
  await app.run();
};

main();
