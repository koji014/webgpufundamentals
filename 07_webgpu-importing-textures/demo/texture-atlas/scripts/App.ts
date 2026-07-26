import GUI from 'muigui';
import { mat4 } from 'wgpu-matrix';
import noodlesUrl from '../../../textures/noodles.jpg';
import generateMips_wgsl from '../shaders/generateMips.wgsl';
import index_wgsl from '../shaders/index.wgsl';

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly vertexBuffer: GPUBuffer;
  private readonly indexBuffer: GPUBuffer;
  private readonly numVertices: number;
  private readonly bindGroup: GPUBindGroup;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniformValues: Float32Array<ArrayBuffer>;
  private readonly matrixValue: Float32Array<ArrayBuffer>;
  private readonly settings: { rotation: [number, number, number] };
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly depthStencilAttachment: GPURenderPassDepthStencilAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private depthTexture?: GPUTexture;
  private observer?: ResizeObserver;
  private gui?: GUI;

  private static mipModule?: GPUShaderModule;
  private static mipSampler?: GPUSampler;
  private static readonly pipelineByFormat: Record<string, GPURenderPipeline> =
    {};

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    numVertices: number;
    bindGroup: GPUBindGroup;
    uniformBuffer: GPUBuffer;
    uniformValues: Float32Array<ArrayBuffer>;
    matrixValue: Float32Array<ArrayBuffer>;
    settings: { rotation: [number, number, number] };
    colorAttachment: GPURenderPassColorAttachment;
    depthStencilAttachment: GPURenderPassDepthStencilAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.vertexBuffer = fields.vertexBuffer;
    this.indexBuffer = fields.indexBuffer;
    this.numVertices = fields.numVertices;
    this.bindGroup = fields.bindGroup;
    this.uniformBuffer = fields.uniformBuffer;
    this.uniformValues = fields.uniformValues;
    this.matrixValue = fields.matrixValue;
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
            arrayStride: (3 + 2) * 4, // (3+2) floats 4 bytes each
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        targets: [{ format: presentationFormat }],
      },
      // 立方体なので裏面カリングと深度テストを有効にする
      primitive: { cullMode: 'back' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });

    const { vertexData, indexData, numVertices } = App.createCubeVertices();

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

    const texture = await App.createTextureFromImage(device, noodlesUrl, {
      mips: true,
      flipY: false,
    });

    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });

    const uniformBufferSize = 16 * 4; // matrix は 16 個の 32bit float
    const uniformBuffer = device.createBuffer({
      label: 'uniforms',
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const uniformValues = new Float32Array(uniformBufferSize / 4);
    const matrixValue = uniformValues.subarray(0, 16);

    const bindGroup = device.createBindGroup({
      label: 'bind group for object',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: uniformBuffer },
        { binding: 1, resource: sampler },
        { binding: 2, resource: texture },
      ],
    });

    const colorAttachment: GPURenderPassColorAttachment = {
      view: undefined as unknown as GPUTextureView,
      clearValue: [0.3, 0.3, 0.3, 1],
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

    const settings: { rotation: [number, number, number] } = {
      rotation: [App.degToRad(20), App.degToRad(25), App.degToRad(0)],
    };

    const app = new App({
      canvas,
      device,
      context,
      pipeline,
      vertexBuffer,
      indexBuffer,
      numVertices,
      bindGroup,
      uniformBuffer,
      uniformValues,
      matrixValue,
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
    Object.assign(gui.domElement.style, {
      top: '50px',
      right: '',
      left: '8px',
    });
    gui.add(settings.rotation, '0', radToDegOptions).name('rotation.x');
    gui.add(settings.rotation, '1', radToDegOptions).name('rotation.y');
    gui.add(settings.rotation, '2', radToDegOptions).name('rotation.z');
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

    // 深度テクスチャはキャンバスと同サイズが必要。無い/サイズ違いなら作り直す。
    if (
      !this.depthTexture ||
      this.depthTexture.width !== currentTexture.width ||
      this.depthTexture.height !== currentTexture.height
    ) {
      this.depthTexture?.destroy();
      this.depthTexture = this.device.createTexture({
        size: [currentTexture.width, currentTexture.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    this.depthStencilAttachment.view = this.depthTexture.createView();

    const encoder = this.device.createCommandEncoder({
      label: 'render encoder',
    });
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);
    pass.setPipeline(this.pipeline);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint16');

    const fov = App.degToRad(60);
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const projection = mat4.perspective(
      fov,
      aspect,
      0.1, // zNear
      10, // zFar
    );
    const view = mat4.lookAt(
      [0, 1, 5], // camera position
      [0, 0, 0], // target
      [0, 1, 0], // up
    );

    const model = mat4.rotationX(this.settings.rotation[0]);
    mat4.rotateY(model, this.settings.rotation[1], model);
    mat4.rotateZ(model, this.settings.rotation[2], model);

    const viewProjection = mat4.multiply(projection, view);
    mat4.multiply(viewProjection, model, this.matrixValue);

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

  private static createCubeVertices() {
    // biome-ignore format:_
    const vertexData = new Float32Array([
      //  position   |  texture coordinate
      //-------------+----------------------
      // front face     select the top left image
      -1,  1,  1,        0   , 0  ,
      -1, -1,  1,        0   , 0.5,
      1,  1,  1,        0.25, 0  ,
      1, -1,  1,        0.25, 0.5,
      // right face     select the top middle image
      1,  1, -1,        0.25, 0  ,
      1,  1,  1,        0.5 , 0  ,
      1, -1, -1,        0.25, 0.5,
      1, -1,  1,        0.5 , 0.5,
      // back face      select to top right image
      1,  1, -1,        0.5 , 0  ,
      1, -1, -1,        0.5 , 0.5,
      -1,  1, -1,        0.75, 0  ,
      -1, -1, -1,        0.75, 0.5,
      // left face       select the bottom left image
      -1,  1,  1,        0   , 0.5,
      -1,  1, -1,        0.25, 0.5,
      -1, -1,  1,        0   , 1  ,
      -1, -1, -1,        0.25, 1  ,
      // bottom face     select the bottom middle image
      1, -1,  1,        0.25, 0.5,
      -1, -1,  1,        0.5 , 0.5,
      1, -1, -1,        0.25, 1  ,
      -1, -1, -1,        0.5 , 1  ,
      // top face        select the bottom right image
      -1,  1,  1,        0.5 , 0.5,
      1,  1,  1,        0.75, 0.5,
      -1,  1, -1,        0.5 , 1  ,
      1,  1, -1,        0.75, 1  ,
    ]);

    // biome-ignore format:_
    const indexData = new Uint16Array([
      0,  1,  2,  2,  1,  3,  // front
      4,  5,  6,  6,  5,  7,  // right
      8,  9, 10, 10,  9, 11,  // back
      12, 13, 14, 14, 13, 15, // left
      16, 17, 18, 18, 17, 19, // bottom
      20, 21, 22, 22, 21, 23, // top
    ]);

    return { vertexData, indexData, numVertices: indexData.length };
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

  private static numMipLevels(...sizes: number[]): number {
    const maxSize = Math.max(...sizes);
    return (1 + Math.log2(maxSize)) | 0;
  }

  private static async loadImageBitmap(url: string): Promise<ImageBitmap> {
    const res = await fetch(url);
    const blob = await res.blob();
    return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  }

  private static copySourceToTexture(
    device: GPUDevice,
    texture: GPUTexture,
    source: ImageBitmap,
    { flipY }: { flipY?: boolean } = {},
  ) {
    device.queue.copyExternalImageToTexture(
      { source, flipY },
      { texture },
      { width: source.width, height: source.height },
    );

    if (texture.mipLevelCount > 1) {
      App.generateMips(device, texture);
    }
  }

  private static createTextureFromSource(
    device: GPUDevice,
    source: ImageBitmap,
    options: { mips?: boolean; flipY?: boolean } = {},
  ): GPUTexture {
    const texture = device.createTexture({
      label: 'texture from image',
      format: 'rgba8unorm',
      mipLevelCount: options.mips
        ? App.numMipLevels(source.width, source.height)
        : 1,
      size: [source.width, source.height],
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    App.copySourceToTexture(device, texture, source, options);
    return texture;
  }

  private static async createTextureFromImage(
    device: GPUDevice,
    url: string,
    options: { mips?: boolean; flipY?: boolean } = {},
  ): Promise<GPUTexture> {
    const source = await App.loadImageBitmap(url);
    return App.createTextureFromSource(device, source, options);
  }

  private static generateMips(device: GPUDevice, texture: GPUTexture) {
    if (!App.mipModule) {
      App.mipModule = device.createShaderModule({
        label: 'textured quad shaders for mip level generation',
        code: generateMips_wgsl,
      });

      App.mipSampler = device.createSampler({ minFilter: 'linear' });
    }

    if (!App.pipelineByFormat[texture.format]) {
      App.pipelineByFormat[texture.format] = device.createRenderPipeline({
        label: 'mip level generator pipeline',
        layout: 'auto',
        vertex: { module: App.mipModule },
        fragment: {
          module: App.mipModule,
          targets: [{ format: texture.format }],
        },
      });
    }
    const pipeline = App.pipelineByFormat[texture.format];

    const encoder = device.createCommandEncoder({ label: 'mip gen encoder' });

    for (
      let baseMipLevel = 1;
      baseMipLevel < texture.mipLevelCount;
      ++baseMipLevel
    ) {
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: App.mipSampler as GPUSampler },
          {
            binding: 1,
            resource: texture.createView({
              baseMipLevel: baseMipLevel - 1,
              mipLevelCount: 1,
            }),
          },
        ],
      });

      const renderPassDescriptor: GPURenderPassDescriptor = {
        label: 'mip gen renderPass',
        colorAttachments: [
          {
            view: texture.createView({ baseMipLevel, mipLevelCount: 1 }),
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      };

      const pass = encoder.beginRenderPass(renderPassDescriptor);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();
    }

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  }
}
