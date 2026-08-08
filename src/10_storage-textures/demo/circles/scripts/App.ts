import index_wgsl from '../shaders/index.wgsl';

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPUComputePipeline;
  private observer?: ResizeObserver;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPUComputePipeline;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;

    this.render = this.render.bind(this);
  }

  static async create(canvas: HTMLCanvasElement): Promise<App> {
    const { device, hasBGRA8unormStorage } = await App.getDevice();

    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('webgpu コンテキストを取得できませんでした。');
    }

    const presentationFormat = hasBGRA8unormStorage
      ? navigator.gpu.getPreferredCanvasFormat()
      : 'rgba8unorm';

    context.configure({
      device,
      format: presentationFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const shaderModule = device.createShaderModule({
      label: 'circles in storage texture',
      code: index_wgsl.replaceAll(
        '__PRESENTATION_FORMAT__',
        presentationFormat,
      ),
    });

    const pipeline = device.createComputePipeline({
      label: 'circles in storage texture',
      layout: 'auto',
      compute: {
        module: shaderModule,
      },
    });

    const app = new App({ canvas, device, context, pipeline });

    device.lost.then(async (info) => {
      console.error(`WebGPU device was lost: ${info.message}`);
      if (info.reason !== 'destroyed') {
        app.dispose();
        const next = await App.create(canvas);
        next.start();
      }
    });

    return app;
  }

  start() {
    this.observer = new ResizeObserver((entries) => this.resize(entries));
    this.observer.observe(this.canvas);
  }

  dispose() {
    this.observer?.disconnect();
    this.observer = undefined;
  }

  private render() {
    const texture = this.context.getCurrentTexture();

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: texture }],
    });

    const encoder = this.device.createCommandEncoder({ label: 'our encoder' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(texture.width, texture.height);
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

  private static async getDevice(): Promise<{
    device: GPUDevice;
    hasBGRA8unormStorage: boolean;
  }> {
    const adapter = await navigator.gpu?.requestAdapter();

    const hasBGRA8unormStorage =
      adapter?.features.has('bgra8unorm-storage') ?? false;
    const device = await adapter?.requestDevice({
      requiredFeatures: hasBGRA8unormStorage ? ['bgra8unorm-storage'] : [],
    });
    if (!device) {
      throw new Error('WebGPU対応ブラウザが必要です');
    }

    return { device, hasBGRA8unormStorage };
  }
}
