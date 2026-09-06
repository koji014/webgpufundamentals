import GUI from 'muigui';
import { mat4 } from '../../_lib/mat4';
import index_wgsl from '../shaders/index.wgsl';

interface Settings {
  baseRotation: number;
}

interface ObjectInfo {
  uniformBuffer: GPUBuffer;
  uniformValues: Float32Array<ArrayBuffer>;
  matrixValue: Float32Array<ArrayBuffer>;
  colorValue: Float32Array<ArrayBuffer>;
  bindGroup: GPUBindGroup;
}

interface DrawContext {
  pass: GPURenderPassEncoder;
  viewProjectionMatrix: Float32Array;
}

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly vertexBuffer: GPUBuffer;
  private readonly numVertices: number;
  private readonly objectInfos: ObjectInfo[];
  private readonly settings: Settings;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly depthStencilAttachment: GPURenderPassDepthStencilAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private objectNdx = 0;
  private depthTexture?: GPUTexture;
  private observer?: ResizeObserver;
  private gui?: GUI;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    vertexBuffer: GPUBuffer;
    numVertices: number;
    settings: Settings;
    colorAttachment: GPURenderPassColorAttachment;
    depthStencilAttachment: GPURenderPassDepthStencilAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.vertexBuffer = fields.vertexBuffer;
    this.numVertices = fields.numVertices;
    this.objectInfos = [];
    this.settings = fields.settings;
    this.colorAttachment = fields.colorAttachment;
    this.depthStencilAttachment = fields.depthStencilAttachment;
    this.renderPassDescriptor = fields.renderPassDescriptor;

    this.render = this.render.bind(this);
  }

  static async create(canvas: HTMLCanvasElement): Promise<App> {
    const device = await App.getDevice();

    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('webgpu コンテキストを取得できませんでした。');
    }

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format: presentationFormat,
      alphaMode: 'premultiplied',
    });

    const module = device.createShaderModule({
      code: index_wgsl,
    });

    const pipeline = device.createRenderPipeline({
      label: '2 attributes with color',
      layout: 'auto',
      vertex: {
        module,
        buffers: [
          {
            arrayStride: 4 * 4, // (3) float + (1) color(unorm8x4) = 16 bytes
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
              { shaderLocation: 1, offset: 12, format: 'unorm8x4' }, // color
            ],
          },
        ],
      },
      fragment: {
        module,
        targets: [{ format: presentationFormat }],
      },
      primitive: {
        cullMode: 'back',
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });

    const { vertexData, numVertices } = App.createCubeVertices();
    const vertexBuffer = device.createBuffer({
      label: 'vertex buffer vertices',
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertexData);

    const colorAttachment: GPURenderPassColorAttachment = {
      view: undefined as unknown as GPUTextureView,
      loadOp: 'clear',
      storeOp: 'store',
    };

    const depthStencilAttachment: GPURenderPassDepthStencilAttachment = {
      view: undefined as unknown as GPUTextureView,
      depthClearValue: 1.0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    };

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: 'our basic canvas renderPass',
      colorAttachments: [colorAttachment],
      depthStencilAttachment,
    };

    const settings: Settings = {
      baseRotation: 0,
    };

    const app = new App({
      canvas,
      device,
      context,
      pipeline,
      vertexBuffer,
      numVertices,
      settings,
      colorAttachment,
      depthStencilAttachment,
      renderPassDescriptor,
    });

    const radToDegOptions = {
      min: -360,
      max: 360,
      step: 1,
      converters: GUI.converters.radToDeg,
    };

    const gui = new GUI();
    gui.onChange(app.render);
    gui.add(settings, 'baseRotation', radToDegOptions);
    app.gui = gui;

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
    this.gui?.domElement.remove();
    this.gui = undefined;
    this.depthTexture?.destroy();
    this.depthTexture = undefined;
  }

  private createObjectInfo(): ObjectInfo {
    const uniformBufferSize = (16 + 4) * 4; // matrix + color
    const uniformBuffer = this.device.createBuffer({
      label: 'uniforms',
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformValues = new Float32Array(uniformBufferSize / 4);

    const kMatrixOffset = 0;
    const kColorOffset = 16;
    const matrixValue = uniformValues.subarray(
      kMatrixOffset,
      kMatrixOffset + 16,
    );
    const colorValue = uniformValues.subarray(kColorOffset, kColorOffset + 4);

    const bindGroup = this.device.createBindGroup({
      label: 'bind group for object',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: uniformBuffer }],
    });

    return { uniformBuffer, uniformValues, matrixValue, colorValue, bindGroup };
  }

  private drawObject(ctx: DrawContext, matrix: Float32Array, color: number[]) {
    const { pass, viewProjectionMatrix } = ctx;
    if (this.objectNdx === this.objectInfos.length) {
      this.objectInfos.push(this.createObjectInfo());
    }
    const { matrixValue, colorValue, uniformBuffer, uniformValues, bindGroup } =
      this.objectInfos[this.objectNdx++];

    mat4.multiply(viewProjectionMatrix, matrix, matrixValue);
    colorValue.set(color);

    this.device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    pass.setBindGroup(0, bindGroup);
    pass.draw(this.numVertices);
  }

  private render() {
    const canvasTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = canvasTexture.createView();

    if (
      !this.depthTexture ||
      this.depthTexture.width !== canvasTexture.width ||
      this.depthTexture.height !== canvasTexture.height
    ) {
      this.depthTexture?.destroy();
      this.depthTexture = this.device.createTexture({
        size: [canvasTexture.width, canvasTexture.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    this.depthStencilAttachment.view = this.depthTexture.createView();

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);
    pass.setPipeline(this.pipeline);
    pass.setVertexBuffer(0, this.vertexBuffer);

    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const projection = mat4.perspective(
      App.degToRad(60), // fieldOfView
      aspect,
      1, // zNear
      2000, // zFar
    );

    const eye = [0, 2, 3];
    const target = [0, 1, 0];
    const up = [0, 1, 0];

    const viewMatrix = mat4.lookAt(eye, target, up);
    const viewProjectionMatrix = mat4.multiply(projection, viewMatrix);

    this.objectNdx = 0;
    const ctx: DrawContext = { pass, viewProjectionMatrix };
    this.drawObject(
      ctx,
      mat4.rotationY(this.settings.baseRotation),
      [1, 1, 1, 1],
    );

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

  private static createCubeVertices() {
    // biome-ignore format: _
    const positions = [
      // left
      0, 0,  0,
      0, 0, -1,
      0, 1,  0,
      0, 1, -1,

      // right
      1, 0,  0,
      1, 0, -1,
      1, 1,  0,
      1, 1, -1,
    ];

    // biome-ignore format: _
    const indices = [
       0,  2,  1,    2,  3,  1,   // left
       4,  5,  6,    6,  5,  7,   // right
       0,  4,  2,    2,  4,  6,   // front
       1,  3,  5,    5,  3,  7,   // back
       0,  1,  4,    4,  1,  5,   // bottom
       2,  6,  3,    3,  6,  7,   // top
    ];

    // biome-ignore format: _
    const quadColors = [
      200,  70, 120,  // left
       80,  70, 200,  // right
       70, 200, 210,  // front
      160, 160, 220,  // back
       90, 130, 110,  // bottom
      200, 200,  70,  // top
    ];

    const numVertices = indices.length;
    const vertexData = new Float32Array(numVertices * 4); // xyz + color
    const colorData = new Uint8Array(vertexData.buffer);

    for (let i = 0; i < indices.length; ++i) {
      const positionNdx = indices[i] * 3;
      const position = positions.slice(positionNdx, positionNdx + 3);
      vertexData.set(position, i * 4);

      const quadNdx = ((i / 6) | 0) * 3;
      const color = quadColors.slice(quadNdx, quadNdx + 3);
      colorData.set(color, i * 16 + 12);
      colorData[i * 16 + 15] = 255;
    }

    return { vertexData, numVertices };
  }

  private static async getDevice(): Promise<GPUDevice> {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) {
      throw new Error('WebGPU対応ブラウザが必要です');
    }

    return device;
  }

  private static degToRad(d: number): number {
    return (d * Math.PI) / 180;
  }
}
