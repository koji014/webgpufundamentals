import triangle_wgsl from '../shaders/index.wgsl';

interface UniformOffsets {
  color: number;
  scale: number;
  offset: number;
}

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformOffsets: UniformOffsets;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniformValues: Float32Array<ArrayBuffer>;
  private readonly bindGroup: GPUBindGroup;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private observer?: ResizeObserver;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    uniformOffsets: UniformOffsets;
    uniformBuffer: GPUBuffer;
    uniformValues: Float32Array<ArrayBuffer>;
    bindGroup: GPUBindGroup;
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.uniformOffsets = fields.uniformOffsets;
    this.uniformBuffer = fields.uniformBuffer;
    this.uniformValues = fields.uniformValues;
    this.bindGroup = fields.bindGroup;
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

    const shaderModule = device.createShaderModule({
      label: 'our hardcoded rgb triangle shaders',
      code: triangle_wgsl,
    });

    const pipeline = device.createRenderPipeline({
      label: 'triangle with uniforms',
      layout: 'auto',
      vertex: {
        module: shaderModule,
      },
      fragment: {
        module: shaderModule,
        targets: [{ format: presentationFormat }],
      },
    });

    // uniforms のためのバッファを作成する
    const uniformBufferSize =
      4 * 4 + // color is 4 32bit floats (4bytes each): vec4f
      2 * 4 + // scale is 2 32bit floats (4bytes each): vec2f
      2 * 4; // offset is 2 32bit floats (4bytes each): vec2f

    // GPU 側のメモリ
    const uniformBuffer = device.createBuffer({
      label: 'uniforms for triangle',
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // CPU 側のメモリ
    const uniformValues = new Float32Array(uniformBufferSize / 4); // 要素数: uniformBufferSize / 4

    const uniformOffsets = {
      color: 0,
      scale: 4,
      offset: 6,
    };

    uniformValues.set([0, 1, 0, 1], uniformOffsets.color); // set the color
    uniformValues.set([-0.5, -0.25], uniformOffsets.offset); // set the offset

    const bindGroup = device.createBindGroup({
      label: 'triangle bind group',
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: uniformBuffer }],
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

    const app = new App({
      canvas,
      device,
      context,
      pipeline,
      uniformOffsets,
      uniformBuffer,
      uniformValues,
      bindGroup,
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
  }

  private render() {
    const aspect = this.canvas.width / this.canvas.height;
    this.uniformValues.set([0.5 / aspect, 0.5], this.uniformOffsets.scale); // set the scale
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformValues);

    const currentTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = currentTexture.createView();

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
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

    return device;
  }
}
