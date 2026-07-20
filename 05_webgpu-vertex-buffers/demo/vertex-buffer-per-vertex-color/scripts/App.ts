import index_wgsl from '../shaders/index.wgsl';

type RGB = [number, number, number];

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
  private readonly changingUnitSize: number;
  private readonly changingOffsets: ChangingStorageOffsets;
  private readonly vertexBuffer: GPUBuffer;
  private readonly staticVertexBuffer: GPUBuffer;
  private readonly changingVertexBuffer: GPUBuffer;
  private readonly vertexValues: Float32Array<ArrayBuffer>;
  private readonly numObjects: number;
  private readonly numVertices: number;
  private readonly objectInfos: ObjectInfo[];
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private observer?: ResizeObserver;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    changingUnitSize: number;
    changingOffsets: ChangingStorageOffsets;
    vertexBuffer: GPUBuffer;
    staticVertexBuffer: GPUBuffer;
    changingVertexBuffer: GPUBuffer;
    vertexValues: Float32Array<ArrayBuffer>;
    numObjects: number;
    numVertices: number;
    objectInfos: ObjectInfo[];
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.changingUnitSize = fields.changingUnitSize;
    this.changingOffsets = fields.changingOffsets;
    this.vertexBuffer = fields.vertexBuffer;
    this.staticVertexBuffer = fields.staticVertexBuffer;
    this.changingVertexBuffer = fields.changingVertexBuffer;
    this.vertexValues = fields.vertexValues;
    this.numObjects = fields.numObjects;
    this.numVertices = fields.numVertices;
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
      label: 'shaderModule label',
      code: index_wgsl,
    });

    const pipeline = device.createRenderPipeline({
      label: 'pipeline label',
      layout: 'auto',
      vertex: {
        module: shaderModule,
        buffers: [
          {
            arrayStride: 5 * 4, // 5 floats, 4 bytes each
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' }, // position
              { shaderLocation: 4, offset: 8, format: 'float32x3' }, // perVertexColor
            ],
          },
          {
            arrayStride: 6 * 4, // 6 floats, 4 bytes each
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x4' }, // color
              { shaderLocation: 2, offset: 16, format: 'float32x2' }, // offset
            ],
          },
          {
            arrayStride: 2 * 4, // 2 floats, 4 bytes each
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 3, offset: 0, format: 'float32x2' }, // scale
            ],
          },
        ],
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
      4 * 4 + // color is 4 32bit floats (4bytes each)
      2 * 4; // offset is 2 32bit floats (4bytes each)
    const changingUnitSize = 2 * 4; // scale is 2 32bit floats (4bytes each)

    const staticVertexBufferSize = staticUnitSize * numObjects;
    const changingVertexBufferSize = changingUnitSize * numObjects;

    const staticStorageBufferOffsets = {
      color: 0,
      offset: 4,
    };

    const changingOffsets = {
      scale: 0,
    };

    const staticVertexBuffer = device.createBuffer({
      label: 'static vertex for objects',
      size: staticVertexBufferSize,

      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    const changingVertexBuffer = device.createBuffer({
      label: 'changing vertex for objects',
      size: changingVertexBufferSize,

      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    {
      const staticVertexValues = new Float32Array(staticVertexBufferSize / 4);
      for (let i = 0; i < numObjects; i++) {
        const staticOffset = i * (staticUnitSize / 4);

        staticVertexValues.set(
          [App.rand(), App.rand(), App.rand(), 1],
          staticOffset + staticStorageBufferOffsets.color,
        );
        staticVertexValues.set(
          [App.rand(-0.9, 0.9), App.rand(-0.9, 0.9)],
          staticOffset + staticStorageBufferOffsets.offset,
        );

        objectInfos.push({
          scale: App.rand(0.2, 0.5),
        });
      }
      device.queue.writeBuffer(staticVertexBuffer, 0, staticVertexValues);
    }

    const vertexValues = new Float32Array(changingVertexBufferSize / 4);

    const { vertexData, numVertices } = App.createCircleVertices({
      radius: 0.5,
      innerRadius: 0.25,
    });

    const vertexBuffer = device.createBuffer({
      label: 'vertex buffer vertices',
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertexData);

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
      changingUnitSize,
      changingOffsets,
      vertexBuffer,
      staticVertexBuffer,
      changingVertexBuffer,
      vertexValues,
      numObjects,
      numVertices,
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
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setVertexBuffer(1, this.staticVertexBuffer);
    pass.setVertexBuffer(2, this.changingVertexBuffer);

    const aspect = this.canvas.width / this.canvas.height;

    this.objectInfos.forEach(({ scale }, ndx) => {
      const offset = ndx * (this.changingUnitSize / 4);
      this.vertexValues.set(
        [scale / aspect, scale],
        offset + this.changingOffsets.scale,
      );
    });
    this.device.queue.writeBuffer(
      this.changingVertexBuffer,
      0,
      this.vertexValues,
    );

    pass.draw(this.numVertices, this.numObjects);

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

  private static createCircleVertices = ({
    radius = 1,
    numSubdivisions = 24,
    innerRadius = 0,
    startAngle = 0,
    endAngle = Math.PI * 2,
  } = {}) => {
    // 1つのサブディビジョンあたり2つの三角形、1つの三角形あたり3つの頂点、それぞれ5つの値（xy,rgb）。
    const numVertices = numSubdivisions * 2 * 3;
    const vertexData = new Float32Array(numVertices * (2 + 3));

    let offset = 0;
    const addVertex = (
      x: number,
      y: number,
      r: number,
      g: number,
      b: number,
    ) => {
      vertexData[offset++] = x;
      vertexData[offset++] = y;
      vertexData[offset++] = r;
      vertexData[offset++] = g;
      vertexData[offset++] = b;
    };

    const innerColor: RGB = [1, 1, 1];
    const outerColor: RGB = [0.1, 0.1, 0.1];

    // 1つのサブディビジョンあたり2つの三角形
    //
    // 0--1 4
    // | / /|
    // |/ / |
    // 2 3--5
    for (let i = 0; i < numSubdivisions; ++i) {
      const angle1 =
        startAngle + ((i + 0) * (endAngle - startAngle)) / numSubdivisions;
      const angle2 =
        startAngle + ((i + 1) * (endAngle - startAngle)) / numSubdivisions;

      const c1 = Math.cos(angle1);
      const s1 = Math.sin(angle1);
      const c2 = Math.cos(angle2);
      const s2 = Math.sin(angle2);

      // 最初の三角形
      addVertex(c1 * radius, s1 * radius, ...outerColor);
      addVertex(c2 * radius, s2 * radius, ...outerColor);
      addVertex(c1 * innerRadius, s1 * innerRadius, ...innerColor);

      // 2番目の三角形
      addVertex(c1 * innerRadius, s1 * innerRadius, ...innerColor);
      addVertex(c2 * radius, s2 * radius, ...outerColor);
      addVertex(c2 * innerRadius, s2 * innerRadius, ...innerColor);
    }

    return {
      vertexData,
      numVertices,
    };
  };
}
