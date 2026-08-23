import index_wgsl from '../shaders/index.wgsl';

export class App {
  private readonly output: HTMLElement;
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly input: Float32Array;
  private readonly workBuffer: GPUBuffer;
  private readonly resultBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;

  private constructor(fields: {
    output: HTMLElement;
    device: GPUDevice;
    pipeline: GPUComputePipeline;
    input: Float32Array;
    workBuffer: GPUBuffer;
    resultBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
  }) {
    this.output = fields.output;
    this.device = fields.device;
    this.pipeline = fields.pipeline;
    this.input = fields.input;
    this.workBuffer = fields.workBuffer;
    this.resultBuffer = fields.resultBuffer;
    this.bindGroup = fields.bindGroup;
  }

  static async create(output: HTMLElement): Promise<App> {
    const device = await App.getDevice();

    const shaderModule = device.createShaderModule({
      label: 'add elements compute module',
      code: index_wgsl,
    });

    // 同じバッファを異なるオフセットで a / b / dst に割り当てるために手動レイアウトを使う
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'storage',
            hasDynamicOffset: true,
          },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'storage',
            hasDynamicOffset: true,
          },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'storage',
            hasDynamicOffset: true,
          },
        },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const pipeline = device.createComputePipeline({
      label: 'add elements compute pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
      },
    });

    // 1 本のバッファ内に a / b / dst の 3 セットを 256 バイト間隔で並べる。
    // （動的オフセットは 256 バイト単位でアライメントが必要）
    const input = new Float32Array(64 * 3); // (64 * 4 バイト) * 3 セット = 768 バイト
    input.set([1, 3, 5]); // a
    input.set([11, 12, 13], 64); // b

    // 計算の入出力に使うバッファを、GPU 上に用意する
    const workBuffer = device.createBuffer({
      label: 'work buffer',
      size: input.byteLength,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(workBuffer, 0, input);

    // 計算結果を GPU の外へ読み出すためのバッファ
    const resultBuffer = device.createBuffer({
      label: 'result buffer',
      size: input.byteLength,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // 3つの binding すべてに同じ workBuffer を割り当てる。
    // オフセットは setBindGroup 時に動的に指定するため、ここでは size のみ指定する。
    // size を省略するとバッファ全体がデフォルトになり、offset > 0 で範囲外エラーになる。
    const bindGroup = device.createBindGroup({
      label: 'bindGroup for work buffer',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: workBuffer, size: 256 } },
        { binding: 1, resource: { buffer: workBuffer, size: 256 } },
        { binding: 2, resource: { buffer: workBuffer, size: 256 } },
      ],
    });

    return new App({
      output,
      device,
      pipeline,
      input,
      workBuffer,
      resultBuffer,
      bindGroup,
    });
  }

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
      createRow('a', this.input.slice(0, 3)),
      createRow('b', this.input.slice(64, 64 + 3)),
      createRow('dst', result.slice(128, 128 + 3)),
    );
  }

  private async compute() {
    const encoder = this.device.createCommandEncoder({
      label: 'adding encoder',
    });

    const pass = encoder.beginComputePass({ label: 'adding compute pass' });
    pass.setPipeline(this.pipeline);

    // 動的オフセットで a=0, b=256, dst=512 バイト目を指すようにする
    pass.setBindGroup(0, this.bindGroup, [0, 256, 512]);
    pass.dispatchWorkgroups(3);
    pass.end();

    encoder.copyBufferToBuffer(
      this.workBuffer,
      0,
      this.resultBuffer,
      0,
      this.resultBuffer.size,
    );

    const commandBuffer = encoder.finish();
    this.device.queue.submit([commandBuffer]);

    await this.resultBuffer.mapAsync(GPUMapMode.READ);
    const mappedBuffer = this.resultBuffer.getMappedRange();
    const copiedBuffer = mappedBuffer.slice();
    const result = new Float32Array(copiedBuffer);
    this.resultBuffer.unmap();

    return result;
  }

  private static async getDevice(): Promise<GPUDevice> {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) {
      throw new Error('WebGPU対応ブラウザが必要です');
    }

    device.lost.then((info) => {
      console.error(`WebGPU device was lost: ${info.message}`);
    });

    return device;
  }
}
