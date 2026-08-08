import index_wgsl from '../shaders/index.wgsl';

type RGB = [number, number, number];

interface ChangingOffsets {
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
  private readonly changingOffsets: ChangingOffsets;
  private readonly vertexBuffer: GPUBuffer;
  private readonly indexBuffer: GPUBuffer;
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
    changingOffsets: ChangingOffsets;
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
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
    this.indexBuffer = fields.indexBuffer;
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
            arrayStride: 2 * 4 + 4, // 2 floats, 4 bytes each + 4 bytes
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' }, // position
              { shaderLocation: 4, offset: 8, format: 'unorm8x4' }, // perVertexColor
            ],
          },
          {
            arrayStride: 4 + 2 * 4, // 4 bytes + 2 floats, 4 bytes each
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'unorm8x4' }, // color
              { shaderLocation: 2, offset: 4, format: 'float32x2' }, // offset
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
      4 + // color is 4 bytes
      2 * 4; // offset is 2 32bit floats (4bytes each)
    const changingUnitSize = 2 * 4; // scale is 2 32bit floats (4bytes each)

    const staticVertexBufferSize = staticUnitSize * numObjects;
    const changingVertexBufferSize = changingUnitSize * numObjects;

    const staticOffsets = {
      color: 0,
      offset: 1,
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
      const staticVertexValuesU8 = new Uint8Array(staticVertexBufferSize);
      const staticVertexValuesF32 = new Float32Array(
        staticVertexValuesU8.buffer,
      );
      for (let i = 0; i < numObjects; i++) {
        const staticOffsetU8 = i * staticUnitSize;
        const staticOffsetF32 = staticOffsetU8 / 4;

        staticVertexValuesU8.set(
          [App.rand() * 255, App.rand() * 255, App.rand() * 255, 255],
          staticOffsetU8 + staticOffsets.color,
        );
        staticVertexValuesF32.set(
          [App.rand(-0.9, 0.9), App.rand(-0.9, 0.9)],
          staticOffsetF32 + staticOffsets.offset,
        );

        objectInfos.push({
          scale: App.rand(0.2, 0.5),
        });
      }
      device.queue.writeBuffer(staticVertexBuffer, 0, staticVertexValuesF32);
    }

    const vertexValues = new Float32Array(changingVertexBufferSize / 4);

    const { vertexData, indexData, numVertices } = App.createCircleVertices({
      radius: 0.5,
      innerRadius: 0.25,
    });

    const vertexBuffer = device.createBuffer({
      label: 'vertex buffer',
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertexData);

    const indexBuffer = device.createBuffer({
      label: 'index buffer',
      size: indexData.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, indexData);

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
      indexBuffer,
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
    pass.setIndexBuffer(this.indexBuffer, 'uint32');

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

    pass.drawIndexed(this.numVertices, this.numObjects);

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
    // 各サブディビジョンに2つの頂点、+円を一周するための1つ。
    const numVertices = (numSubdivisions + 1) * 2;

    // 位置（xy）に2つの32ビット値、色（rgb_）に1つの32ビット値
    // 32ビットの色値は、4つの8ビット値として書き込み/読み取りされる
    const vertexData = new Float32Array(numVertices * (2 + 1));
    const colorData = new Uint8Array(vertexData.buffer);

    let offset = 0;
    let colorOffset = 8;
    const addVertex = (
      x: number,
      y: number,
      r: number,
      g: number,
      b: number,
    ) => {
      vertexData[offset++] = x;
      vertexData[offset++] = y;
      offset += 1; // 色をスキップ
      colorData[colorOffset++] = r * 255;
      colorData[colorOffset++] = g * 255;
      colorData[colorOffset++] = b * 255;
      colorOffset += 9; // 余分なバイトと位置をスキップ
    };

    const innerColor: RGB = [1, 1, 1];
    const outerColor: RGB = [0.1, 0.1, 0.1];

    // 1つのサブディビジョンあたり2つの三角形
    //
    // 0  2  4  6  8 ...
    //
    // 1  3  5  7  9 ...
    for (let i = 0; i <= numSubdivisions; ++i) {
      const angle =
        startAngle + ((i + 0) * (endAngle - startAngle)) / numSubdivisions;

      const c1 = Math.cos(angle);
      const s1 = Math.sin(angle);

      addVertex(c1 * radius, s1 * radius, ...outerColor);
      addVertex(c1 * innerRadius, s1 * innerRadius, ...innerColor);
    }

    const indexData = new Uint32Array(numSubdivisions * 6);
    let ndx = 0;

    // 1番目の三角形  2番目の三角形  3番目の三角形  4番目の三角形
    // 0 1 2    2 1 3    2 3 4    4 3 5
    //
    // 0--2        2     2--4        4  .....
    // | /        /|     | /        /|
    // |/        / |     |/        / |
    // 1        1--3     3        3--5  .....
    for (let i = 0; i < numSubdivisions; ++i) {
      const ndxOffset = i * 2;

      // 最初の三角形
      indexData[ndx++] = ndxOffset;
      indexData[ndx++] = ndxOffset + 1;
      indexData[ndx++] = ndxOffset + 2;

      // 2番目の三角形
      indexData[ndx++] = ndxOffset + 2;
      indexData[ndx++] = ndxOffset + 1;
      indexData[ndx++] = ndxOffset + 3;
    }

    return {
      vertexData,
      indexData,
      numVertices: indexData.length,
    };
  };
}
