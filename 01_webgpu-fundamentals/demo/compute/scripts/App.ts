import compute_wgsl from '../shaders/index.wgsl';

export class App {
  private static readonly INPUT = new Float32Array([1, 3, 5]);

  private readonly output: HTMLElement;
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly workBuffer: GPUBuffer;
  private readonly resultBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;

  private constructor(
    output: HTMLElement,
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    workBuffer: GPUBuffer,
    resultBuffer: GPUBuffer,
    bindGroup: GPUBindGroup,
  ) {
    this.output = output;
    this.device = device;
    this.pipeline = pipeline;
    this.workBuffer = workBuffer;
    this.resultBuffer = resultBuffer;
    this.bindGroup = bindGroup;
  }

  static async create(output: HTMLElement): Promise<App> {
    const device = await App.getDevice();
    const input = App.INPUT;

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

    return new App(
      output,
      device,
      pipeline,
      workBuffer,
      resultBuffer,
      bindGroup,
    );
  }

  // 計算を実行し、結果を画面に表示する
  async run() {
    const result = await this.compute();

    const format = (values: Float32Array) => Array.from(values).join(', ');
    const createRow = (label: string, values: Float32Array) => {
      const p = document.createElement('p');

      const labelSpan = document.createElement('span');
      labelSpan.className = 'text-neutral-400';
      labelSpan.textContent = label;

      p.append(labelSpan, `: [${format(values)}]`);
      return p;
    };

    this.output.replaceChildren(
      createRow('input', App.INPUT),
      createRow('result', result),
    );
  }

  // triangle の render() に相当
  private async compute() {
    // 計算用のコマンドをエンコードする
    const encoder = this.device.createCommandEncoder({
      label: 'doubling encoder',
    });

    // beginRenderPass ではなく beginComputePass を使う
    const pass = encoder.beginComputePass({ label: 'doubling compute pass' });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup); // 0 は、シェーダで記述した @group(0) に対応
    pass.dispatchWorkgroups(App.INPUT.length); // input.length = 3 -> WebGPU に対して「コンピュートシェーダを３回呼べ」という命令になる
    pass.end(); // コンピュートパスを終了

    // 「得られた結果をマップ可能なバッファへコピーするコマンド」をエンコードする。
    encoder.copyBufferToBuffer(
      this.workBuffer,
      0,
      this.resultBuffer,
      0,
      this.resultBuffer.size,
    );

    // コマンドのエンコードを完了し、GPU へ submit する
    const commandBuffer = encoder.finish();
    this.device.queue.submit([commandBuffer]);

    // 計算結果を読み出す。
    await this.resultBuffer.mapAsync(GPUMapMode.READ); // バッファをマップする

    // getMappedRange() は GPU メモリを指す ArrayBuffer を返す
    const mappedBuffer = this.resultBuffer.getMappedRange();

    // slice() で JS ヒープ上の新しい ArrayBuffer にバイト列をコピーする
    // __ unmap 後は mappedBuffer が無効化されるため、コピーして値を確保しておく
    const copiedBuffer = mappedBuffer.slice();

    // コピーした ArrayBuffer を Float32Array として解釈する
    // __ 読み書きには必ず View (TypedArray または DataView) を被せる必要あり
    const result = new Float32Array(copiedBuffer);

    this.resultBuffer.unmap(); // バッファのマップを解除する （ArrayBuffer の length は 0 となり、データにアクセスできなくなる）

    return result;
  }

  // WebGPU デバイスを取得
  private static async getDevice(): Promise<GPUDevice> {
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
        App.getDevice();
      }
    });

    return device;
  }
}
