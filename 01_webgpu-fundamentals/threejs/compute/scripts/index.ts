import { App } from './App';

const output = document.querySelector<HTMLDivElement>('#output');
if (!output) {
  throw new Error('#output が見つかりません。');
}

const app = App.create(output);
app.run();
