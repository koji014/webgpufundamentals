import compute_wgsl from '../shaders/compute.wgsl';
import render_wgsl from '../shaders/render.wgsl';

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly computePipeline: GPUComputePipeline;
  private readonly renderPipeline: GPURenderPipeline;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private observer?: ResizeObserver;
  private storageBuffer?: GPUBuffer;
  private uniformBuffer?: GPUBuffer;
  private computeBindGroup?: GPUBindGroup;
  private renderBindGroup?: GPUBindGroup;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    computePipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.computePipeline = fields.computePipeline;
    this.renderPipeline = fields.renderPipeline;
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

    const computeModule = device.createShaderModule({
      label: 'circles into storage buffer',
      code: compute_wgsl,
    });
    const computePipeline = device.createComputePipeline({
      label: 'circles into storage buffer',
      layout: 'auto',
      compute: { module: computeModule },
    });

    const renderModule = device.createShaderModule({
      label: 'draw storage buffer',
      code: render_wgsl,
    });
    const renderPipeline = device.createRenderPipeline({
      label: 'draw storage buffer',
      layout: 'auto',
      vertex: { module: renderModule },
      fragment: {
        module: renderModule,
        targets: [{ format: presentationFormat }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    const colorAttachment: GPURenderPassColorAttachment = {
      view: undefined as unknown as GPUTextureView,
      clearValue: [0.3, 0.3, 0.3, 1],
      loadOp: 'clear',
      storeOp: 'store',
    };
    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: 'draw storage buffer',
      colorAttachments: [colorAttachment],
    };

    const app = new App({
      canvas,
      device,
      context,
      computePipeline,
      renderPipeline,
      colorAttachment,
      renderPassDescriptor,
    });

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
    this.storageBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }

  private render() {
    if (!this.computeBindGroup || !this.renderBindGroup) {
      return;
    }

    const encoder = this.device.createCommandEncoder({ label: 'our encoder' });

    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(this.canvas.width, this.canvas.height);
    computePass.end();

    const currentTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = currentTexture.createView();
    const renderPass = encoder.beginRenderPass(this.renderPassDescriptor);
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroup);
    renderPass.draw(4);
    renderPass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  private resize(entries: ResizeObserverEntry[]) {
    for (const entry of entries) {
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;

      const maxSize = this.device.limits.maxTextureDimension2D;
      this.canvas.width = Math.max(1, Math.min(width, maxSize));
      this.canvas.height = Math.max(1, Math.min(height, maxSize));
    }

    this.storageBuffer?.destroy();
    this.uniformBuffer?.destroy();

    const { width, height } = this.canvas;

    this.storageBuffer = this.device.createBuffer({
      label: 'pixels',
      size: width * height * 4, // 1 ピクセル = 4 バイト（rgba8）
      // size: width * height * 16,
      usage: GPUBufferUsage.STORAGE,
    });

    // ストレージバッファは 1D 配列で幅・高さを持たないため、サイズをユニフォームで渡す
    // （2D 座標 ⇄ 1D インデックスの変換や中心の計算に使う）
    this.uniformBuffer = this.device.createBuffer({
      label: 'size',
      size: 2 * 4, // 2 要素の 32bit 整数
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Uint32Array([width, height]),
    );

    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.storageBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });

    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.storageBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });

    this.render();
  }

  private static async getDevice(): Promise<GPUDevice> {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) {
      throw new Error('WebGPU対応ブラウザが必要です');
    }

    return device;
  }
}
