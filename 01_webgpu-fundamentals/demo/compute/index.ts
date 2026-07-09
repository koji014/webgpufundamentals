import compute_wgsl from './index.wgsl';

const main = async () => {
  // WebGPU デバイスを取得
  const getDevice = async (): Promise<GPUDevice> => {
    const adapter = await navigator.gpu?.requestAdapter(); // 物理デバイス（物理的なGPU）
    const device = await adapter?.requestDevice(); // 論理デバイス（抽象化したGPU）
    if (!device) {
      throw new Error('WebGPU対応ブラウザが必要です');
    }

    // デバイスがロストした段階で resolve
    device.lost.then((info) => {
      console.error(`WebGPU device was lost: ${info.message}`);
      // 'reason' will be 'destroyed' if we intentionally destroy the device.
      if (info.reason !== 'destroyed') {
        // try again
        getDevice();
      }
    });

    return device;
  };

  const device = await getDevice();

  // 結果を表示する要素
  const output = document.querySelector<HTMLDivElement>('#output');
  if (!output) {
    throw new Error('#output が見つかりません。');
  }

  // シェーダモジュールを生成
  const shaderModule = device.createShaderModule({
    label: 'doubling compute module',
    code: compute_wgsl,
  });

  // コンピュートパイプラインを生成
  // createRenderPipeline ではなく createComputePipeline を使う
  const pipeline = device.createComputePipeline({
    label: 'doubling compute pipeline',
    layout: 'auto',
    compute: {
      module: shaderModule,
      entryPoint: 'computeSomething',
    },
  });

  // データを用意
  const input = new Float32Array([1, 3, 5]);

  // 計算の入出力に使うバッファを、GPU 上に用意する。
  const workBuffer = device.createBuffer({
    label: 'work buffer',
    size: input.byteLength, // バッファのサイズ （単位:バイト） = 今回の場合、Float32Array の値を ３ つ扱うので 12 バイト
    // WebGPU で利用するバッファでは、必ず usage を指定する必要あり
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
    // GPUBufferUsage.STORAGE: storage として利用できる -> シェーダ側の var<storage,...> と対応
    // GPUBufferUsage.COPY_DST: このバッファをデータのコピー先とできる
    // GPUBufferUsage.COPY_SRC: このバッファをデータのコピー元とできる
  });
  // JavaScript側で用意した入力データを、GPU 上のバッファへコピーする。
  device.queue.writeBuffer(workBuffer, 0, input);

  // GPU の外から見えるように、計算結果をコピーする新たなバッファを、GPU 上に用意する
  const resultBuffer = device.createBuffer({
    label: 'result buffer',
    size: input.byteLength,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    // GPUBufferUsage.MAP_READ: データを GPU の 外へマップできる
  });

  // 計算をする際にどのバッファを使えばよいかシェーダに指示するため、
  // bindGroup を設定する。
  const bindGroup = device.createBindGroup({
    label: 'bindGroup for work buffer',
    // パイプラインから bindGroup を取得
    layout: pipeline.getBindGroupLayout(0), // getBindGroupLayout(0) の 0 は、シェーダで記述した @group(0) に相当
    entries: [
      // {binding: 0 ... } は、シェーダで記述した @group(0) @binding(0) に相当
      // buffer リソースは { buffer: ... }（GPUBufferBinding）で渡す
      { binding: 0, resource: { buffer: workBuffer } },
    ],
  });

  // triangle の render() に相当
  const compute = async () => {
    // 計算用のコマンドをエンコードする
    const encoder = device.createCommandEncoder({ label: 'doubling encoder' });

    // beginRenderPass ではなく beginComputePass を使う
    const pass = encoder.beginComputePass({ label: 'doubling compute pass' });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup); // 0 は、シェーダで記述した @group(0) に対応
    pass.dispatchWorkgroups(input.length); // input.length = 3 -> WebGPU に対して「コンピュートシェーダを３回呼べ」という命令になる
    pass.end(); // コンピュートパスを終了

    // 「得られた結果をマップ可能なバッファへコピーするコマンド」をエンコードする。
    encoder.copyBufferToBuffer(
      workBuffer,
      0,
      resultBuffer,
      0,
      resultBuffer.size,
    );

    // コマンドのエンコードを完了し、GPU へ submit する
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    // 計算結果を読み出す。
    await resultBuffer.mapAsync(GPUMapMode.READ); // バッファをマップする

    // getMappedRange() は GPU メモリを指す ArrayBuffer を返す
    const mappedBuffer = resultBuffer.getMappedRange();

    // slice() で JS ヒープ上の新しい ArrayBuffer にバイト列をコピーする
    // __ unmap 後は mappedBuffer が無効化されるため、コピーして値を確保しておく
    const copiedBuffer = mappedBuffer.slice();

    // コピーした ArrayBuffer を Float32Array として解釈する
    // __ 読み書きには必ず View (TypedArray または DataView) を被せる必要あり
    const result = new Float32Array(copiedBuffer);

    resultBuffer.unmap(); // バッファのマップを解除する （ArrayBuffer の length は 0 となり、データにアクセスできなくなる）

    return result;
  };

  const result = await compute();

  // 結果を画面に表示する
  const format = (values: Float32Array) => Array.from(values).join(', ');
  const createRow = (label: string, values: Float32Array) => {
    const p = document.createElement('p');

    const labelSpan = document.createElement('span');
    labelSpan.className = 'text-neutral-400';
    labelSpan.textContent = label;

    p.append(labelSpan, `: [${format(values)}]`);
    return p;
  };

  output.replaceChildren(
    createRow('input', input),
    createRow('result', result),
  );
};

main();
