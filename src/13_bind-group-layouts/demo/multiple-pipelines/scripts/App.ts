import plus3_wgsl from '../shaders/plus3.wgsl';
import times2_wgsl from '../shaders/times2.wgsl';

export class App {
  private readonly output: HTMLElement;
  private readonly device: GPUDevice;
  private readonly pipelineTimes2: GPUComputePipeline;
  private readonly pipelinePlus3: GPUComputePipeline;
  private readonly input: Float32Array;
  private readonly workBuffer: GPUBuffer;
  private readonly resultBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;

  private constructor(fields: {
    output: HTMLElement;
    device: GPUDevice;
    pipelineTimes2: GPUComputePipeline;
    pipelinePlus3: GPUComputePipeline;
    input: Float32Array;
    workBuffer: GPUBuffer;
    resultBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
  }) {
    this.output = fields.output;
    this.device = fields.device;
    this.pipelineTimes2 = fields.pipelineTimes2;
    this.pipelinePlus3 = fields.pipelinePlus3;
    this.input = fields.input;
    this.workBuffer = fields.workBuffer;
    this.resultBuffer = fields.resultBuffer;
    this.bindGroup = fields.bindGroup;
  }

  static async create(output: HTMLElement): Promise<App> {
    const device = await App.getDevice();

    const moduleTimes2 = device.createShaderModule({
      label: 'doubling compute module',
      code: times2_wgsl,
    });

    const modulePlus3 = device.createShaderModule({
      label: 'adding 3 compute module',
      code: plus3_wgsl,
    });

    // 1つの bind group layout を、2つのパイプラインで共有する。
    // これにより同じ bindGroup を両方のパイプラインで使い回せる。
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'storage',
            hasDynamicOffset: false,
            // minBindingSize: 0（＝サイズ制約なし）。
            // data は array<f32> 宣言なので、渡す値の数に応じて異なるサイズのバッファをバインドできる。
            minBindingSize: 0,
          },
        },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const pipelineTimes2 = device.createComputePipeline({
      label: 'doubling compute pipeline',
      layout: pipelineLayout,
      compute: {
        module: moduleTimes2,
      },
    });

    const pipelinePlus3 = device.createComputePipeline({
      label: 'plus 3 compute pipeline',
      layout: pipelineLayout,
      compute: {
        module: modulePlus3,
      },
    });

    const input = new Float32Array([1, 3, 5]);

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

    // 手動で作った bindGroupLayout を直接指定して bindGroup を作る。
    // pipeline.getBindGroupLayout(0) は使わない（どちらのパイプラインでも同じレイアウトを共有する）。
    const bindGroup = device.createBindGroup({
      label: 'bindGroup for work buffer',
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: workBuffer }],
    });

    return new App({
      output,
      device,
      pipelineTimes2,
      pipelinePlus3,
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
      createRow('input', this.input),
      createRow('result', result),
    );
  }

  private async compute() {
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    // 同じ bindGroup のまま、パイプラインを切り替えて 2 を掛けてから 3 を足す
    pass.setBindGroup(0, this.bindGroup);
    pass.setPipeline(this.pipelineTimes2);
    pass.dispatchWorkgroups(this.input.length);
    pass.setPipeline(this.pipelinePlus3);
    pass.dispatchWorkgroups(this.input.length);
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
