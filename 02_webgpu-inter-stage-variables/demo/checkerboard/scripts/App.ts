import checkerboard_frag_wgsl from '../shaders/checkerboard.frag.wgsl';
import checkerboard_vert_wgsl from '../shaders/checkerboard.vert.wgsl';

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.colorAttachment = fields.colorAttachment;
    this.renderPassDescriptor = fields.renderPassDescriptor;
  }

  static async create(canvas: HTMLCanvasElement): Promise<App> {
    const device = await App.getDevice();

    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('webgpu コンテキストを取得できませんでした。');
    }

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: presentationFormat });

    const vsModule = device.createShaderModule({
      label: 'hardcoded triangle',
      code: checkerboard_vert_wgsl,
    });
    const fsModule = device.createShaderModule({
      label: 'checkerboard',
      code: checkerboard_frag_wgsl,
    });

    const pipeline = device.createRenderPipeline({
      label: 'our hardcoded checkerboard triangle pipeline',
      layout: 'auto',
      vertex: {
        module: vsModule,
        // 分割した場合: そのモジュール内に、該当ステージの関数（@vertex なら @vertex、@fragment なら @fragment）が 1つしかない場合 → entryPoint を省略でき、その唯一の関数が自動的に選ばれる
        // entryPoint: 'vs',
      },
      fragment: {
        module: fsModule,
        // entryPoint: 'fs',
        targets: [{ format: presentationFormat }],
      },
    });

    const colorAttachment: GPURenderPassColorAttachment = {
      view: undefined as unknown as GPUTextureView,
      clearValue: [0.3, 0.3, 0.3, 1],
      loadOp: 'clear',
      storeOp: 'store',
    };

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: 'our basic canvas renderPass',
      colorAttachments: [colorAttachment],
    };

    return new App({
      canvas,
      device,
      context,
      pipeline,
      colorAttachment,
      renderPassDescriptor,
    });
  }

  start() {
    const observer = new ResizeObserver((entries) => this.resize(entries));
    observer.observe(this.canvas);
  }

  private render() {
    const currentTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = currentTexture.createView();

    const encoder = this.device.createCommandEncoder({
      label: 'ender checkerboard triangle encoder',
    });

    const pass = encoder.beginRenderPass(this.renderPassDescriptor);

    pass.setPipeline(this.pipeline);
    pass.draw(3);
    pass.end();

    const commandBuffer = encoder.finish();

    this.device.queue.submit([commandBuffer]);
  }

  private resize(entries: ResizeObserverEntry[]) {
    for (const entry of entries) {
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;

      const maxSize = this.device.limits.maxTextureDimension2D;
      this.canvas.width = Math.max(1, Math.min(width, maxSize));
      this.canvas.height = Math.max(1, Math.min(height, maxSize));
    }
    this.render();
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
