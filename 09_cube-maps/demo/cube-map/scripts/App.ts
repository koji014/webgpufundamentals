import GUI from 'muigui';
import { mat4 } from 'wgpu-matrix';
import generateMips_wgsl from '../shaders/generateMips.wgsl';
import index_wgsl from '../shaders/index.wgsl';

interface FaceInfo {
  faceColor: string;
  textColor: string;
  text: string;
}

type TextureSource = ImageBitmap | HTMLCanvasElement;

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
    context.configure({
      device,
      format: presentationFormat,
      alphaMode: 'premultiplied',
    });

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
            arrayStride: 3 * 4, // (3) floats 4 bytes each
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

    const faceSize = 128;
    const faceCanvases: HTMLCanvasElement[] = [
      { faceColor: '#F00', textColor: '#0FF', text: '+X' },
      { faceColor: '#FF0', textColor: '#00F', text: '-X' },
      { faceColor: '#0F0', textColor: '#F0F', text: '+Y' },
      { faceColor: '#0FF', textColor: '#F00', text: '-Y' },
      { faceColor: '#00F', textColor: '#FF0', text: '+Z' },
      { faceColor: '#F0F', textColor: '#0F0', text: '-Z' },
    ].map((faceInfo) => App.generateFace(faceSize, faceInfo));

    const texture = App.createTextureFromSources(device, faceCanvases, {
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
        { binding: 2, resource: texture.createView({ dimension: 'cube' }) },
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
      // front face
      -1,  1,  1,
      -1, -1,  1,
       1,  1,  1,
       1, -1,  1,
      // right face
       1,  1, -1,
       1,  1,  1,
       1, -1, -1,
       1, -1,  1,
      // back face
       1,  1, -1,
       1, -1, -1,
      -1,  1, -1,
      -1, -1, -1,
      // left face
      -1,  1,  1,
      -1,  1, -1,
      -1, -1,  1,
      -1, -1, -1,
      // bottom face
       1, -1,  1,
      -1, -1,  1,
       1, -1, -1,
      -1, -1, -1,
      // top face
      -1,  1,  1,
       1,  1,  1,
      -1,  1, -1,
       1,  1, -1,
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

  private static generateFace(
    size: number,
    { faceColor, textColor, text }: FaceInfo,
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2d コンテキストを取得できませんでした。');
    }
    ctx.fillStyle = faceColor;
    ctx.fillRect(0, 0, size, size);
    ctx.font = `${size * 0.7}px sans-serif`;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const m = ctx.measureText(text);
    ctx.fillText(
      text,
      (size - m.actualBoundingBoxRight + m.actualBoundingBoxLeft) / 2,
      (size - m.actualBoundingBoxDescent + m.actualBoundingBoxAscent) / 2,
    );
    return canvas;
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

  private static copySourcesToTexture(
    device: GPUDevice,
    texture: GPUTexture,
    sources: TextureSource[],
    { flipY }: { flipY?: boolean } = {},
  ) {
    sources.forEach((source, layer) => {
      device.queue.copyExternalImageToTexture(
        { source, flipY },
        { texture, origin: [0, 0, layer] },
        { width: source.width, height: source.height },
      );
    });

    if (texture.mipLevelCount > 1) {
      App.generateMips(device, texture);
    }
  }

  private static createTextureFromSources(
    device: GPUDevice,
    sources: TextureSource[],
    options: { mips?: boolean; flipY?: boolean } = {},
  ): GPUTexture {
    const source = sources[0];
    const texture = device.createTexture({
      label: 'cube map texture',
      format: 'rgba8unorm',
      mipLevelCount: options.mips
        ? App.numMipLevels(source.width, source.height)
        : 1,
      size: [source.width, source.height, sources.length],
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    App.copySourcesToTexture(device, texture, sources, options);
    return texture;
  }

  private static generateMips(device: GPUDevice, texture: GPUTexture) {
    if (!App.mipModule) {
      App.mipModule = device.createShaderModule({
        label: 'textured quad shaders for mip level generation',
        code: generateMips_wgsl,
      });

      App.mipSampler = device.createSampler({
        minFilter: 'linear',
        magFilter: 'linear',
      });
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
      for (let layer = 0; layer < texture.depthOrArrayLayers; ++layer) {
        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: App.mipSampler as GPUSampler },
            {
              binding: 1,
              resource: texture.createView({
                dimension: '2d',
                baseMipLevel: baseMipLevel - 1,
                mipLevelCount: 1,
                baseArrayLayer: layer,
                arrayLayerCount: 1,
              }),
            },
          ],
        });

        const renderPassDescriptor: GPURenderPassDescriptor = {
          label: 'mip gen renderPass',
          colorAttachments: [
            {
              view: texture.createView({
                dimension: '2d',
                baseMipLevel,
                mipLevelCount: 1,
                baseArrayLayer: layer,
                arrayLayerCount: 1,
              }),
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
    }

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  }
}
