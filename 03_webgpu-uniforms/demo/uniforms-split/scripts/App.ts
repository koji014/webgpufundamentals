import triangle_wgsl from '../shaders/index.wgsl';

interface UniformOffsets {
  scale: number;
}

interface ObjectInfo {
  scale: number;
  uniformBuffer: GPUBuffer;
  uniformValues: Float32Array;
  bindGroup: GPUBindGroup;
}

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformOffsets: UniformOffsets;
  private readonly objectInfos: ObjectInfo[];
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private observer?: ResizeObserver;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    uniformOffsets: UniformOffsets;
    objectInfos: ObjectInfo[];
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.uniformOffsets = fields.uniformOffsets;
    this.objectInfos = fields.objectInfos;
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
    const staticUniformBufferSize =
      4 * 4 + // color is 4 32bit floats (4bytes each): vec4f
      2 * 4 + // offset is 2 32bit floats (4bytes each): vec2f
      2 * 4; // padding

    const uniformBufferSize = 2 * 4; // scale is 2 32bit floats (4bytes each): vec2f

    const staticUniformOffsets = {
      color: 0,
      offset: 4,
    };

    const uniformOffsets = {
      scale: 0,
    };

    const numObjects = 100;
    const objectInfos = [];

    for (let i = 0; i < numObjects; i++) {
      // GPU 側のメモリ
      const staticUniformBuffer = device.createBuffer({
        label: `static uniforms for obj: ${i}`,
        size: staticUniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      {
        // CPU 側のメモリ
        const uniformValues = new Float32Array(staticUniformBufferSize / 4); // 要素数: staticUniformBufferSize / 4
        uniformValues.set(
          [App.rand(), App.rand(), App.rand(), 1],
          staticUniformOffsets.color,
        ); // set the color
        uniformValues.set(
          [App.rand(-0.9, 0.9), App.rand(-0.9, 0.9)],
          staticUniformOffsets.offset,
        ); // set the offset
        device.queue.writeBuffer(staticUniformBuffer, 0, uniformValues);
      }

      // GPU 側のメモリ
      const uniformBuffer = device.createBuffer({
        label: `changing uniforms for obj: ${i}`,
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const uniformValues = new Float32Array(uniformBufferSize / 4);

      const bindGroup = device.createBindGroup({
        label: `bind group for obj: ${i}`,
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: staticUniformBuffer },
          { binding: 1, resource: uniformBuffer },
        ],
      });

      objectInfos.push({
        scale: App.rand(0.2, 0.5),
        uniformBuffer,
        uniformValues,
        bindGroup,
      });
    }

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
      objectInfos,
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
    const currentTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = currentTexture.createView();

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);
    pass.setPipeline(this.pipeline);

    const aspect = this.canvas.width / this.canvas.height;

    for (const { scale, bindGroup, uniformBuffer, uniformValues } of this
      .objectInfos) {
      uniformValues.set([scale / aspect, scale], this.uniformOffsets.scale);
      this.device.queue.writeBuffer(uniformBuffer, 0, uniformValues);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
    }

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

  private static rand = (min?: number, max?: number) => {
    if (min === undefined) {
      min = 0;
      max = 1;
    } else if (max === undefined) {
      max = min;
      min = 0;
    }
    return min + Math.random() * (max - min);
  };
}
