import GUI from 'muigui';
import { mat4 } from '../../_lib/mat4';
import index_wgsl from '../shaders/index.wgsl';

interface Settings {
  translation: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
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
  private readonly indexBuffer: GPUBuffer;
  private readonly numVertices: number;
  private readonly bindGroup: GPUBindGroup;
  private readonly settings: Settings;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
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
    indexBuffer: GPUBuffer;
    numVertices: number;
    bindGroup: GPUBindGroup;
    settings: Settings;
    colorAttachment: GPURenderPassColorAttachment;
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
    this.indexBuffer = fields.indexBuffer;
    this.numVertices = fields.numVertices;
    this.bindGroup = fields.bindGroup;
    this.settings = fields.settings;
    this.colorAttachment = fields.colorAttachment;
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
      label: 'just 2d position',
      layout: 'auto',
      vertex: {
        module: shaderModule,
        buffers: [
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        targets: [{ format: presentationFormat }],
      },
    });

    // color, matrix
    const uniformBufferSize = (4 + 16) * 4;
    const uniformBuffer = device.createBuffer({
      label: 'uniforms',
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformValues = new Float32Array(uniformBufferSize / 4);

    const kColorOffset = 0;
    const kMatrixOffset = 4;

    const colorValue = uniformValues.subarray(kColorOffset, kColorOffset + 4);
    const matrixValue = uniformValues.subarray(
      kMatrixOffset,
      kMatrixOffset + 16,
    );

    colorValue.set([Math.random(), Math.random(), Math.random(), 1]);

    const { vertexData, indexData, numVertices } = App.createFVertices();
    const vertexBuffer = device.createBuffer({
      label: 'vertex buffer vertices',
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

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: 'our basic canvas renderPass',
      colorAttachments: [colorAttachment],
    };

    const settings: Settings = {
      translation: [45, 100, 0],
      rotation: [App.degToRad(40), App.degToRad(25), App.degToRad(325)],
      scale: [1, 1, 1],
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
      indexBuffer,
      numVertices,
      bindGroup,
      settings,
      colorAttachment,
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
    gui.add(settings.translation, '2', -1000, 1000).name('translation.z');
    gui.add(settings.rotation, '0', radToDegOptions).name('rotation.x');
    gui.add(settings.rotation, '1', radToDegOptions).name('rotation.y');
    gui.add(settings.rotation, '2', radToDegOptions).name('rotation.z');
    gui.add(settings.scale, '0', -5, 5).name('scale.x');
    gui.add(settings.scale, '1', -5, 5).name('scale.y');
    gui.add(settings.scale, '2', -5, 5).name('scale.z');
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
  }

  private render() {
    const currentTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = currentTexture.createView();

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);
    pass.setPipeline(this.pipeline);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');

    mat4.projection(
      this.canvas.clientWidth,
      this.canvas.clientHeight,
      400,
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
    pass.drawIndexed(this.numVertices);

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
    const vertexData = new Float32Array([
      // left column
        0,   0,  0,
       30,   0,  0,
        0, 150,  0,
       30, 150,  0,

      // top rung
       30,   0,  0,
      100,   0,  0,
       30,  30,  0,
      100,  30,  0,

      // middle rung
       30,  60,  0,
       70,  60,  0,
       30,  90,  0,
       70,  90,  0,
    ]);

    // biome-ignore format: _
    const indexData = new Uint32Array([
       0,  1,  2,    2,  1,  3,  // left column
       4,  5,  6,    6,  5,  7,  // top rung
       8,  9, 10,   10,  9, 11,  // middle rung
    ]);

    return {
      vertexData,
      indexData,
      numVertices: indexData.length,
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
