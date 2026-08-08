import triangle_wgsl from '../shaders/index.wgsl';

interface ChangingStorageOffsets {
  scale: number;
}

interface ObjectInfo {
  scale: number;
}

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly changingStorageBuffer: GPUBuffer;
  private readonly storageValues: Float32Array<ArrayBuffer>;
  private readonly changingUnitSize: number;
  private readonly changingOffsets: ChangingStorageOffsets;
  private readonly bindGroup: GPUBindGroup;
  private readonly numObjects: number;
  private readonly objectInfos: ObjectInfo[];
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private observer?: ResizeObserver;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    changingStorageBuffer: GPUBuffer;
    storageValues: Float32Array<ArrayBuffer>;
    changingUnitSize: number;
    changingOffsets: ChangingStorageOffsets;
    bindGroup: GPUBindGroup;
    numObjects: number;
    objectInfos: ObjectInfo[];
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.changingStorageBuffer = fields.changingStorageBuffer;
    this.storageValues = fields.storageValues;
    this.changingUnitSize = fields.changingUnitSize;
    this.changingOffsets = fields.changingOffsets;
    this.bindGroup = fields.bindGroup;
    this.numObjects = fields.numObjects;
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

    const numObjects = 100;
    const objectInfos: ObjectInfo[] = [];

    // uniforms のためのバッファを作成する
    const staticUnitSize =
      4 * 4 + // color is 4 32bit floats (4bytes each): vec4f
      2 * 4 + // offset is 2 32bit floats (4bytes each): vec2f
      2 * 4; // padding
    const changingUnitSize = 2 * 4; // scale is 2 32bit floats (4bytes each): vec2f

    const staticStorageBufferSize = staticUnitSize * numObjects;
    const changingStorageBufferSize = changingUnitSize * numObjects;

    const staticStorageBufferOffsets = {
      color: 0,
      offset: 4,
    };

    const changingOffsets = {
      scale: 0,
    };

    const staticStorageBuffer = device.createBuffer({
      label: 'static storage for objects',
      size: staticStorageBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const changingStorageBuffer = device.createBuffer({
      label: 'changing storage for objects',
      size: changingStorageBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    {
      const staticStorageValues = new Float32Array(staticStorageBufferSize / 4);
      for (let i = 0; i < numObjects; i++) {
        const staticOffset = i * (staticUnitSize / 4);

        staticStorageValues.set(
          [App.rand(), App.rand(), App.rand(), 1],
          staticOffset + staticStorageBufferOffsets.color,
        );
        staticStorageValues.set(
          [App.rand(-0.9, 0.9), App.rand(-0.9, 0.9)],
          staticOffset + staticStorageBufferOffsets.offset,
        );

        objectInfos.push({
          scale: App.rand(0.2, 0.5),
        });
      }
      device.queue.writeBuffer(staticStorageBuffer, 0, staticStorageValues);
    }

    const storageValues = new Float32Array(changingStorageBufferSize / 4);

    const bindGroup = device.createBindGroup({
      label: 'bind group for objects',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: staticStorageBuffer },
        { binding: 1, resource: changingStorageBuffer },
      ],
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
      changingStorageBuffer,
      storageValues,
      changingUnitSize,
      changingOffsets,
      bindGroup,
      numObjects,
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

    this.objectInfos.forEach(({ scale }, ndx) => {
      const offset = ndx * (this.changingUnitSize / 4);
      this.storageValues.set(
        [scale / aspect, scale],
        offset + this.changingOffsets.scale,
      );
    });
    this.device.queue.writeBuffer(
      this.changingStorageBuffer,
      0,
      this.storageValues,
    );

    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3, this.numObjects);

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
