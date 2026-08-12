import GUI from 'muigui';
import { mat4 } from 'wgpu-matrix';
import generateMips_wgsl from '../shaders/generateMips.wgsl';
import index_wgsl from '../shaders/index.wgsl';

type BlendComponent = {
  operation: GPUBlendOperation;
  srcFactor: GPUBlendFactor;
  dstFactor: GPUBlendFactor;
};

type Uniform = {
  buffer: GPUBuffer;
  values: Float32Array<ArrayBuffer>;
  matrix: Float32Array<ArrayBuffer>;
};

type TextureSet = {
  srcTexture: GPUTexture;
  dstTexture: GPUTexture;
  srcBindGroup: GPUBindGroup;
  dstBindGroup: GPUBindGroup;
};

export class App {
  private static mipModule?: GPUShaderModule;
  private static mipSampler?: GPUSampler;
  private static readonly pipelineByFormat: Record<string, GPURenderPipeline> =
    {};

  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly presentationFormat: GPUTextureFormat;
  private readonly module: GPUShaderModule;
  private readonly pipelineLayout: GPUPipelineLayout;
  private readonly dstPipeline: GPURenderPipeline;
  private readonly textureSets: TextureSet[];
  private readonly srcUniform: Uniform;
  private readonly dstUniform: Uniform;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;

  private readonly settings: {
    alphaMode: GPUCanvasAlphaMode;
    textureSet: number;
    preset: string;
  };
  private readonly color: BlendComponent;
  private readonly alpha: BlendComponent;
  private readonly clear: {
    color: [number, number, number];
    alpha: number;
    premultiply: boolean;
  };
  private readonly constant: {
    color: [number, number, number];
    alpha: number;
  };

  private observer?: ResizeObserver;
  private gui?: GUI;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    presentationFormat: GPUTextureFormat;
    module: GPUShaderModule;
    pipelineLayout: GPUPipelineLayout;
    dstPipeline: GPURenderPipeline;
    textureSets: TextureSet[];
    srcUniform: Uniform;
    dstUniform: Uniform;
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
    settings: App['settings'];
    color: BlendComponent;
    alpha: BlendComponent;
    clear: App['clear'];
    constant: App['constant'];
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.presentationFormat = fields.presentationFormat;
    this.module = fields.module;
    this.pipelineLayout = fields.pipelineLayout;
    this.dstPipeline = fields.dstPipeline;
    this.textureSets = fields.textureSets;
    this.srcUniform = fields.srcUniform;
    this.dstUniform = fields.dstUniform;
    this.colorAttachment = fields.colorAttachment;
    this.renderPassDescriptor = fields.renderPassDescriptor;
    this.settings = fields.settings;
    this.color = fields.color;
    this.alpha = fields.alpha;
    this.clear = fields.clear;
    this.constant = fields.constant;

    this.render = this.render.bind(this);
  }

  static async create(canvas: HTMLCanvasElement): Promise<App> {
    const device = await App.getDevice();

    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('webgpu コンテキストを取得できませんでした。');
    }

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

    const module = device.createShaderModule({
      label: 'textured quad shaders',
      code: index_wgsl,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {} },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const dstPipeline = device.createRenderPipeline({
      label: 'dst pipeline',
      layout: pipelineLayout,
      vertex: { module },
      fragment: {
        module,
        targets: [{ format: presentationFormat }],
      },
    });

    const size = 300;
    const srcCanvas = App.createSourceImage(size);
    const dstCanvas = App.createDestinationImage(size);

    const srcTextureUnpremultipliedAlpha = App.createTextureFromSource(
      device,
      srcCanvas,
      { mips: true },
    );
    const dstTextureUnpremultipliedAlpha = App.createTextureFromSource(
      device,
      dstCanvas,
      { mips: true },
    );

    const srcTexturePremultipliedAlpha = App.createTextureFromSource(
      device,
      srcCanvas,
      { mips: true, premultipliedAlpha: true },
    );
    const dstTexturePremultipliedAlpha = App.createTextureFromSource(
      device,
      dstCanvas,
      { mips: true, premultipliedAlpha: true },
    );

    const srcUniform = App.makeUniformBufferAndValues(device);
    const dstUniform = App.makeUniformBufferAndValues(device);

    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });

    const srcBindGroupUnpremultipliedAlpha = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: srcTextureUnpremultipliedAlpha },
        { binding: 2, resource: { buffer: srcUniform.buffer } },
      ],
    });
    const dstBindGroupUnpremultipliedAlpha = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: dstTextureUnpremultipliedAlpha },
        { binding: 2, resource: { buffer: dstUniform.buffer } },
      ],
    });
    const srcBindGroupPremultipliedAlpha = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: srcTexturePremultipliedAlpha },
        { binding: 2, resource: { buffer: srcUniform.buffer } },
      ],
    });
    const dstBindGroupPremultipliedAlpha = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: dstTexturePremultipliedAlpha },
        { binding: 2, resource: { buffer: dstUniform.buffer } },
      ],
    });

    // textureSet 0 = 事前乗算あり, 1 = 事前乗算なし
    const textureSets: TextureSet[] = [
      {
        srcTexture: srcTexturePremultipliedAlpha,
        dstTexture: dstTexturePremultipliedAlpha,
        srcBindGroup: srcBindGroupPremultipliedAlpha,
        dstBindGroup: dstBindGroupPremultipliedAlpha,
      },
      {
        srcTexture: srcTextureUnpremultipliedAlpha,
        dstTexture: dstTextureUnpremultipliedAlpha,
        srcBindGroup: srcBindGroupUnpremultipliedAlpha,
        dstBindGroup: dstBindGroupUnpremultipliedAlpha,
      },
    ];

    // 初期のブレンド設定
    const color: BlendComponent = {
      operation: 'add',
      srcFactor: 'one',
      dstFactor: 'one-minus-src',
    };
    const alpha: BlendComponent = {
      operation: 'add',
      srcFactor: 'one',
      dstFactor: 'one-minus-src',
    };
    const constant = {
      color: [1, 0.5, 0.25] as [number, number, number],
      alpha: 1,
    };
    const clear = {
      color: [0, 0, 0] as [number, number, number],
      alpha: 0,
      premultiply: true,
    };
    const settings: App['settings'] = {
      alphaMode: 'premultiplied',
      textureSet: 0,
      preset: 'default (copy)',
    };

    const colorAttachment: GPURenderPassColorAttachment = {
      view: undefined as unknown as GPUTextureView,
      clearValue: [0, 0, 0, 0],
      loadOp: 'clear',
      storeOp: 'store',
    };
    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: 'blend renderPass',
      colorAttachments: [colorAttachment],
    };

    const app = new App({
      canvas,
      device,
      context,
      presentationFormat,
      module,
      pipelineLayout,
      dstPipeline,
      textureSets,
      srcUniform,
      dstUniform,
      colorAttachment,
      renderPassDescriptor,
      settings,
      color,
      alpha,
      clear,
      constant,
    });

    app.setupGUI();

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
    App.makeBlendComponentValid(this.color);
    App.makeBlendComponentValid(this.alpha);
    this.gui?.updateDisplay();

    // ブレンド状態はパイプライン固定なので、設定が変わるたびに src パイプラインを作り直す
    const srcPipeline = this.device.createRenderPipeline({
      label: 'src pipeline',
      layout: this.pipelineLayout,
      vertex: { module: this.module },
      fragment: {
        module: this.module,
        targets: [
          {
            format: this.presentationFormat,
            blend: { color: this.color, alpha: this.alpha },
          },
        ],
      },
    });

    const { srcTexture, dstTexture, srcBindGroup, dstBindGroup } =
      this.textureSets[this.settings.textureSet];

    // alphaMode はキャンバス設定なので描画のたびに反映する
    this.context.configure({
      device: this.device,
      format: this.presentationFormat,
      alphaMode: this.settings.alphaMode,
    });

    const canvasTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = canvasTexture.createView();

    const { color: clearColor, alpha: clearAlpha, premultiply } = this.clear;
    const premultiplier = premultiply ? clearAlpha : 1;
    this.colorAttachment.clearValue = [
      clearColor[0] * premultiplier,
      clearColor[1] * premultiplier,
      clearColor[2] * premultiplier,
      clearAlpha,
    ];

    this.updateUniforms(this.srcUniform, canvasTexture, srcTexture);
    this.updateUniforms(this.dstUniform, canvasTexture, dstTexture);

    const encoder = this.device.createCommandEncoder({
      label: 'render quad encoder',
    });
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);

    // 先に宛先（dst）を描画
    pass.setPipeline(this.dstPipeline);
    pass.setBindGroup(0, dstBindGroup);
    pass.draw(6);

    // その上にソース（src）をブレンド描画。constant 係数用の定数色もここで設定する
    pass.setPipeline(srcPipeline);
    pass.setBindGroup(0, srcBindGroup);
    pass.setBlendConstant([...this.constant.color, this.constant.alpha]);
    pass.draw(6);

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

  private setupGUI() {
    // operation に指定できるブレンド演算。min/max は係数を無視する
    const operations: GPUBlendOperation[] = [
      'add',
      'subtract',
      'reverse-subtract',
      'min',
      'max',
    ];
    // srcFactor / dstFactor に指定できるブレンド係数の一覧
    const factors: GPUBlendFactor[] = [
      'zero',
      'one',
      'src',
      'one-minus-src',
      'src-alpha',
      'one-minus-src-alpha',
      'dst',
      'one-minus-dst',
      'dst-alpha',
      'one-minus-dst-alpha',
      'src-alpha-saturated',
      'constant',
      'one-minus-constant',
    ];
    // よく使うブレンドの組み合わせ
    const presets: Record<
      string,
      { color: GPUBlendComponent; alpha?: GPUBlendComponent }
    > = {
      'default (copy)': {
        color: { operation: 'add', srcFactor: 'one', dstFactor: 'zero' },
      },
      'premultiplied blend (source-over)': {
        color: {
          operation: 'add',
          srcFactor: 'one',
          dstFactor: 'one-minus-src-alpha',
        },
      },
      'un-premultiplied blend': {
        color: {
          operation: 'add',
          srcFactor: 'src-alpha',
          dstFactor: 'one-minus-src-alpha',
        },
      },
      'destination-over': {
        color: {
          operation: 'add',
          srcFactor: 'one-minus-dst-alpha',
          dstFactor: 'one',
        },
      },
      'source-in': {
        color: { operation: 'add', srcFactor: 'dst-alpha', dstFactor: 'zero' },
      },
      'destination-in': {
        color: { operation: 'add', srcFactor: 'zero', dstFactor: 'src-alpha' },
      },
      'source-out': {
        color: {
          operation: 'add',
          srcFactor: 'one-minus-dst-alpha',
          dstFactor: 'zero',
        },
      },
      'destination-out': {
        color: {
          operation: 'add',
          srcFactor: 'zero',
          dstFactor: 'one-minus-src-alpha',
        },
      },
      'source-atop': {
        color: {
          operation: 'add',
          srcFactor: 'dst-alpha',
          dstFactor: 'one-minus-src-alpha',
        },
      },
      'destination-atop': {
        color: {
          operation: 'add',
          srcFactor: 'one-minus-dst-alpha',
          dstFactor: 'src-alpha',
        },
      },
      'additive (lighten)': {
        color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
      },
    };

    const gui = new GUI();
    gui.onChange(() => this.render());
    Object.assign(gui.domElement.style, {
      top: '8px',
      right: '8px',
      left: '',
    });

    gui
      .add(this.settings, 'alphaMode', ['opaque', 'premultiplied'])
      .name('canvas alphaMode');
    gui.add(this.settings, 'textureSet', [
      'premultiplied alpha',
      'un-premultiplied alpha',
    ]);
    gui
      .add(this.settings, 'preset', Object.keys(presets))
      .name('blending preset')
      .onChange((presetName: string) => {
        const preset = presets[presetName];
        Object.assign(this.color, preset.color);
        Object.assign(this.alpha, preset.alpha ?? preset.color);
        gui.updateDisplay();
      });

    const colorFolder = gui.addFolder('color');
    colorFolder.add(this.color, 'operation', operations);
    colorFolder.add(this.color, 'srcFactor', factors);
    colorFolder.add(this.color, 'dstFactor', factors);

    const alphaFolder = gui.addFolder('alpha');
    alphaFolder.add(this.alpha, 'operation', operations);
    alphaFolder.add(this.alpha, 'srcFactor', factors);
    alphaFolder.add(this.alpha, 'dstFactor', factors);

    // constant / one-minus-constant を係数に選んだときに使う定数色
    const constantFolder = gui.addFolder('constant');
    constantFolder.addColor(this.constant, 'color');
    constantFolder.add(this.constant, 'alpha', 0, 1);

    const clearFolder = gui.addFolder('clear color');
    clearFolder.add(this.clear, 'premultiply');
    clearFolder.add(this.clear, 'alpha', 0, 1);
    clearFolder.addColor(this.clear, 'color');

    this.gui = gui;
  }

  private updateUniforms(
    uniform: Uniform,
    canvasTexture: GPUTexture,
    texture: GPUTexture,
  ) {
    const projectionMatrix = mat4.ortho(
      0,
      canvasTexture.width,
      canvasTexture.height,
      0,
      -1,
      1,
    );
    mat4.scale(
      projectionMatrix,
      [texture.width, texture.height, 1],
      uniform.matrix,
    );
    this.device.queue.writeBuffer(uniform.buffer, 0, uniform.values);
  }

  private static async getDevice(): Promise<GPUDevice> {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) {
      throw new Error('WebGPU対応ブラウザが必要です');
    }

    return device;
  }

  private static hsl(h: number, s: number, l: number): string {
    return `hsl(${(h * 360) | 0}, ${s * 100}%, ${(l * 100) | 0}%)`;
  }

  private static hsla(h: number, s: number, l: number, a: number): string {
    return `hsla(${(h * 360) | 0}, ${s * 100}%, ${(l * 100) | 0}%, ${a})`;
  }

  private static createSourceImage(size: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2d コンテキストを取得できませんでした。');
    }
    ctx.translate(size / 2, size / 2);

    ctx.globalCompositeOperation = 'screen';
    const numCircles = 3;
    for (let i = 0; i < numCircles; ++i) {
      ctx.rotate((Math.PI * 2) / numCircles);
      ctx.save();
      ctx.translate(size / 6, 0);
      ctx.beginPath();

      const radius = size / 3;
      ctx.arc(0, 0, radius, 0, Math.PI * 2);

      const gradient = ctx.createRadialGradient(0, 0, radius / 2, 0, 0, radius);
      const h = i / numCircles;
      gradient.addColorStop(0.5, App.hsla(h, 1, 0.5, 1));
      gradient.addColorStop(1, App.hsla(h, 1, 0.5, 0));

      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.restore();
    }
    return canvas;
  }

  private static createDestinationImage(size: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2d コンテキストを取得できませんでした。');
    }

    const gradient = ctx.createLinearGradient(0, 0, size, size);
    for (let i = 0; i <= 6; ++i) {
      gradient.addColorStop(i / 6, App.hsl(i / -6, 1, 0.5));
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = 'rgba(0, 0, 0, 255)';
    ctx.globalCompositeOperation = 'destination-out';
    ctx.rotate(Math.PI / -4);
    for (let i = 0; i < size * 2; i += 32) {
      ctx.fillRect(-size, i, size * 2, 16);
    }

    return canvas;
  }

  private static numMipLevels(...sizes: number[]): number {
    const maxSize = Math.max(...sizes);
    return (1 + Math.log2(maxSize)) | 0;
  }

  private static copySourceToTexture(
    device: GPUDevice,
    texture: GPUTexture,
    source: HTMLCanvasElement,
    { premultipliedAlpha }: { premultipliedAlpha?: boolean } = {},
  ) {
    device.queue.copyExternalImageToTexture(
      { source },
      { texture, premultipliedAlpha },
      { width: source.width, height: source.height },
    );

    if (texture.mipLevelCount > 1) {
      App.generateMips(device, texture);
    }
  }

  private static createTextureFromSource(
    device: GPUDevice,
    source: HTMLCanvasElement,
    options: { premultipliedAlpha?: boolean; mips?: boolean } = {},
  ): GPUTexture {
    const texture = device.createTexture({
      label: `texture premultiplied=${options.premultipliedAlpha}`,
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

  private static makeUniformBufferAndValues(device: GPUDevice): Uniform {
    const kMatrixOffset = 0;

    const uniformBufferSize = 16 * 4; // mat4x4f（16 個の f32、各 4 バイト）
    const buffer = device.createBuffer({
      label: 'uniforms for quad',
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const values = new Float32Array(uniformBufferSize / 4);
    const matrix = values.subarray(kMatrixOffset, 16);
    return { buffer, values, matrix };
  }

  private static makeBlendComponentValid(blend: BlendComponent) {
    const { operation } = blend;
    if (operation === 'min' || operation === 'max') {
      blend.srcFactor = 'one';
      blend.dstFactor = 'one';
    }
  }
}
