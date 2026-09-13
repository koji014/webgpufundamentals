import GUI from 'muigui';
import { mat3 } from '../../_lib/mat3';
import { mat4 } from '../../_lib/mat4';
import index_wgsl from '../shaders/index.wgsl';

interface Settings {
  rotation: number;
}

export class App {
  private static readonly kFieldOfView = 60;
  private static readonly kZNear = 1;
  private static readonly kZFar = 2000;
  private static readonly kEye = [100, 150, 200];
  private static readonly kTarget = [0, 35, 0];
  private static readonly kUp = [0, 1, 0];
  private static readonly kColor = [0.2, 1, 0.2, 1]; // green
  private static readonly kLightWorldPosition = [-10, 30, 100];

  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniformValues: Float32Array<ArrayBuffer>;
  private readonly normalMatrixValue: Float32Array<ArrayBuffer>;
  private readonly worldViewProjectionValue: Float32Array<ArrayBuffer>;
  private readonly worldValue: Float32Array<ArrayBuffer>;
  private readonly colorValue: Float32Array<ArrayBuffer>;
  private readonly lightWorldPositionValue: Float32Array<ArrayBuffer>;
  private readonly viewWorldPositionValue: Float32Array<ArrayBuffer>;
  private readonly vertexBuffer: GPUBuffer;
  private readonly numVertices: number;
  private readonly bindGroup: GPUBindGroup;
  private readonly settings: Settings;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly depthStencilAttachment: GPURenderPassDepthStencilAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private depthTexture?: GPUTexture;
  private observer?: ResizeObserver;
  private gui?: GUI;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    uniformBuffer: GPUBuffer;
    uniformValues: Float32Array<ArrayBuffer>;
    normalMatrixValue: Float32Array<ArrayBuffer>;
    worldViewProjectionValue: Float32Array<ArrayBuffer>;
    worldValue: Float32Array<ArrayBuffer>;
    colorValue: Float32Array<ArrayBuffer>;
    lightWorldPositionValue: Float32Array<ArrayBuffer>;
    viewWorldPositionValue: Float32Array<ArrayBuffer>;
    vertexBuffer: GPUBuffer;
    numVertices: number;
    bindGroup: GPUBindGroup;
    settings: Settings;
    colorAttachment: GPURenderPassColorAttachment;
    depthStencilAttachment: GPURenderPassDepthStencilAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.uniformBuffer = fields.uniformBuffer;
    this.uniformValues = fields.uniformValues;
    this.normalMatrixValue = fields.normalMatrixValue;
    this.worldViewProjectionValue = fields.worldViewProjectionValue;
    this.worldValue = fields.worldValue;
    this.colorValue = fields.colorValue;
    this.lightWorldPositionValue = fields.lightWorldPositionValue;
    this.viewWorldPositionValue = fields.viewWorldPositionValue;
    this.vertexBuffer = fields.vertexBuffer;
    this.numVertices = fields.numVertices;
    this.bindGroup = fields.bindGroup;
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
      label: '2 attributes',
      layout: 'auto',
      vertex: {
        module,
        buffers: [
          {
            arrayStride: (3 + 3) * 4, // (3) position + (3) normal
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
              { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
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

    // normalMatrix(12) + worldViewProjection + world + color + lightWorldPosition + viewWorldPosition
    const uniformBufferSize = (12 + 16 + 16 + 4 + 4 + 4) * 4;
    const uniformBuffer = device.createBuffer({
      label: 'uniforms',
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformValues = new Float32Array(uniformBufferSize / 4);

    const kNormalMatrixOffset = 0;
    const kWorldViewProjectionOffset = 12;
    const kWorldOffset = 28;
    const kColorOffset = 44;
    const kLightWorldPositionOffset = 48;
    const kViewWorldPositionOffset = 52;
    const normalMatrixValue = uniformValues.subarray(
      kNormalMatrixOffset,
      kNormalMatrixOffset + 12,
    );
    const worldViewProjectionValue = uniformValues.subarray(
      kWorldViewProjectionOffset,
      kWorldViewProjectionOffset + 16,
    );
    const worldValue = uniformValues.subarray(kWorldOffset, kWorldOffset + 16);
    const colorValue = uniformValues.subarray(kColorOffset, kColorOffset + 4);
    const lightWorldPositionValue = uniformValues.subarray(
      kLightWorldPositionOffset,
      kLightWorldPositionOffset + 3,
    );
    const viewWorldPositionValue = uniformValues.subarray(
      kViewWorldPositionOffset,
      kViewWorldPositionOffset + 3,
    );

    const { vertexData, numVertices } = App.createFVertices();
    const vertexBuffer = device.createBuffer({
      label: 'vertex buffer vertices',
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertexData);

    const bindGroup = device.createBindGroup({
      label: 'bind group for object',
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: uniformBuffer }],
    });

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
      rotation: App.degToRad(0),
    };

    const app = new App({
      canvas,
      device,
      context,
      pipeline,
      uniformBuffer,
      uniformValues,
      normalMatrixValue,
      worldViewProjectionValue,
      worldValue,
      colorValue,
      lightWorldPositionValue,
      viewWorldPositionValue,
      vertexBuffer,
      numVertices,
      bindGroup,
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
    gui.add(settings, 'rotation', radToDegOptions);
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
      App.degToRad(App.kFieldOfView),
      aspect,
      App.kZNear,
      App.kZFar,
    );

    const viewMatrix = mat4.lookAt(App.kEye, App.kTarget, App.kUp);
    const viewProjectionMatrix = mat4.multiply(projection, viewMatrix);

    const world = mat4.rotationY(this.settings.rotation, this.worldValue);

    mat4.multiply(viewProjectionMatrix, world, this.worldViewProjectionValue);

    mat3.fromMat4(mat4.transpose(mat4.inverse(world)), this.normalMatrixValue);

    this.colorValue.set(App.kColor);
    this.lightWorldPositionValue.set(App.kLightWorldPosition);
    this.viewWorldPositionValue.set(App.kEye);

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformValues);

    pass.setBindGroup(0, this.bindGroup);
    pass.draw(this.numVertices);
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

  private static createFVertices() {
    // biome-ignore format: _
    const positions = [
      // left column
       -50,  75,  15,
       -20,  75,  15,
       -50, -75,  15,
       -20, -75,  15,

      // top rung
       -20,  75,  15,
        50,  75,  15,
       -20,  45,  15,
        50,  45,  15,

      // middle rung
       -20,  15,  15,
        20,  15,  15,
       -20, -15,  15,
        20, -15,  15,

      // left column back
       -50,  75, -15,
       -20,  75, -15,
       -50, -75, -15,
       -20, -75, -15,

      // top rung back
       -20,  75, -15,
        50,  75, -15,
       -20,  45, -15,
        50,  45, -15,

      // middle rung back
       -20,  15, -15,
        20,  15, -15,
       -20, -15, -15,
        20, -15, -15,
    ];

    // biome-ignore format: _
    const indices = [
       0,  2,  1,    2,  3,  1,   // left column
       4,  6,  5,    6,  7,  5,   // top run
       8, 10,  9,   10, 11,  9,   // middle run

      12, 13, 14,   14, 13, 15,   // left column back
      16, 17, 18,   18, 17, 19,   // top run back
      20, 21, 22,   22, 21, 23,   // middle run back

       0,  5, 12,   12,  5, 17,   // top
       5,  7, 17,   17,  7, 19,   // top rung right
       6, 18,  7,   18, 19,  7,   // top rung bottom
       6,  8, 18,   18,  8, 20,   // between top and middle rung
       8,  9, 20,   20,  9, 21,   // middle rung top
       9, 11, 21,   21, 11, 23,   // middle rung right
      10, 22, 11,   22, 23, 11,   // middle rung bottom
      10,  3, 22,   22,  3, 15,   // stem right
       2, 14,  3,   14, 15,  3,   // bottom
       0, 12,  2,   12, 14,  2,   // left
    ];

    // biome-ignore format: _
    const normals = [
        0,   0,   1,  // left column front
        0,   0,   1,  // top rung front
        0,   0,   1,  // middle rung front

        0,   0,  -1,  // left column back
        0,   0,  -1,  // top rung back
        0,   0,  -1,  // middle rung back

        0,   1,   0,  // top
        1,   0,   0,  // top rung right
        0,  -1,   0,  // top rung bottom
        1,   0,   0,  // between top and middle rung
        0,   1,   0,  // middle rung top
        1,   0,   0,  // middle rung right
        0,  -1,   0,  // middle rung bottom
        1,   0,   0,  // stem right
        0,  -1,   0,  // bottom
       -1,   0,   0,  // left
    ];

    const numVertices = indices.length;
    const vertexData = new Float32Array(numVertices * 6); // xyz + normal

    for (let i = 0; i < indices.length; ++i) {
      const positionNdx = indices[i] * 3;
      const position = positions.slice(positionNdx, positionNdx + 3);
      vertexData.set(position, i * 6);

      const quadNdx = ((i / 6) | 0) * 3;
      const normal = normals.slice(quadNdx, quadNdx + 3);
      vertexData.set(normal, i * 6 + 3);
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
