import GUI from 'muigui';
import { makeZToWMatrix, mat4 } from '../../_lib/mat4';
import index_wgsl from '../shaders/index.wgsl';

interface Settings {
  translation: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  fudgeFactor: number;
}

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniformValues: Float32Array<ArrayBuffer>;
  private readonly matrixValue: Float32Array<ArrayBuffer>;
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
    matrixValue: Float32Array<ArrayBuffer>;
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
    this.matrixValue = fields.matrixValue;
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

    const shaderModule = device.createShaderModule({
      code: index_wgsl,
    });

    const pipeline = device.createRenderPipeline({
      label: '2 attributes',
      layout: 'auto',
      vertex: {
        module: shaderModule,
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
        module: shaderModule,
        targets: [{ format: presentationFormat }],
      },
      primitive: {
        cullMode: 'front',
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });

    // matrix
    const uniformBufferSize = 16 * 4;
    const uniformBuffer = device.createBuffer({
      label: 'uniforms',
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformValues = new Float32Array(uniformBufferSize / 4);

    const kMatrixOffset = 0;

    const matrixValue = uniformValues.subarray(
      kMatrixOffset,
      kMatrixOffset + 16,
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
      translation: [
        canvas.clientWidth / 2 - 200,
        canvas.clientHeight / 2 - 75,
        -1000,
      ],
      rotation: [App.degToRad(40), App.degToRad(25), App.degToRad(325)],
      scale: [3, 3, 3],
      fudgeFactor: 10,
    };

    const app = new App({
      canvas,
      device,
      context,
      pipeline,
      uniformBuffer,
      uniformValues,
      matrixValue,
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
    gui.add(settings.translation, '0', 0, 1000).name('translation.x');
    gui.add(settings.translation, '1', 0, 1000).name('translation.y');
    gui.add(settings.translation, '2', -1400, 1000).name('translation.z');
    gui.add(settings.rotation, '0', radToDegOptions).name('rotation.x');
    gui.add(settings.rotation, '1', radToDegOptions).name('rotation.y');
    gui.add(settings.rotation, '2', radToDegOptions).name('rotation.z');
    gui.add(settings.scale, '0', -5, 5).name('scale.x');
    gui.add(settings.scale, '1', -5, 5).name('scale.y');
    gui.add(settings.scale, '2', -5, 5).name('scale.z');
    gui.add(settings, 'fudgeFactor', 0, 50);
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

    const projection = mat4.ortho(
      0, // left
      this.canvas.clientWidth, // right
      this.canvas.clientHeight, // bottom
      0, // top
      1200, // near
      -1000, // far
    );
    mat4.multiply(
      makeZToWMatrix(this.settings.fudgeFactor),
      projection,
      this.matrixValue,
    );
    mat4.translate(
      this.matrixValue,
      this.settings.translation,
      this.matrixValue,
    );
    mat4.rotateX(this.matrixValue, this.settings.rotation[0], this.matrixValue);
    mat4.rotateY(this.matrixValue, this.settings.rotation[1], this.matrixValue);
    mat4.rotateZ(this.matrixValue, this.settings.rotation[2], this.matrixValue);
    mat4.scale(this.matrixValue, this.settings.scale, this.matrixValue);

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
      0, 0, 0,
      30, 0, 0,
      0, 150, 0,
      30, 150, 0,

      // top rung
      30, 0, 0,
      100, 0, 0,
      30, 30, 0,
      100, 30, 0,

      // middle rung
      30, 60, 0,
      70, 60, 0,
      30, 90, 0,
      70, 90, 0,

      // left column back
      0, 0, 30,
      30, 0, 30,
      0, 150, 30,
      30, 150, 30,

      // top rung back
      30, 0, 30,
      100, 0, 30,
      30, 30, 30,
      100, 30, 30,

      // middle rung back
      30, 60, 30,
      70, 60, 30,
      30, 90, 30,
      70, 90, 30,
    ];

    // biome-ignore format: _
    const indices = [
      // front
      0,  1,  2,    2,  1,  3,  // left column
      4,  5,  6,    6,  5,  7,  // top run
      8,  9, 10,   10,  9, 11,  // middle run

      // back
      12,  14,  13,   14, 15, 13,  // left column back
      16,  18,  17,   18, 19, 17,  // top run back
      20,  22,  21,   22, 23, 21,  // middle run back

      0, 12, 5,   12, 17, 5,   // top
      5, 17, 7,   17, 19, 7,   // top rung right
      6, 7, 18,   18, 7, 19,   // top rung bottom
      6, 18, 8,   18, 20, 8,   // between top and middle rung
      8, 20, 9,   20, 21, 9,   // middle rung top
      9, 21, 11,  21, 23, 11,  // middle rung right
      10, 11, 22, 22, 11, 23,  // middle rung bottom
      10, 22, 3,  22, 15, 3,   // stem right
      2, 3, 14,   14, 3, 15,   // bottom
      0, 2, 12,   12, 2, 14,   // left
    ];

    // biome-ignore format: _
    const quadColors = [
      200,  70, 120,  // left column front
      200,  70, 120,  // top rung front
      200,  70, 120,  // middle rung front

       80,  70, 200,  // left column back
       80,  70, 200,  // top rung back
       80,  70, 200,  // middle rung back

       70, 200, 210,  // top
      160, 160, 220,  // top rung right
       90, 130, 110,  // top rung bottom
      200, 200,  70,  // between top and middle rung
      210, 100,  70,  // middle rung top
      210, 160,  70,  // middle rung right
       70, 180, 210,  // middle rung bottom
      100,  70, 210,  // stem right
       76, 210, 100,  // bottom
      140, 210,  80,  // left
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

    return {
      vertexData,
      numVertices,
    };
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
