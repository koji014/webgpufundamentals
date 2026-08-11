import GUI from 'muigui';

type Settings = {
  premultiply: boolean;
  color: [number, number, number];
  alpha: number;
};

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly settings: Settings;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private observer?: ResizeObserver;
  private gui?: GUI;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    settings: Settings;
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
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

    // alphaMode: 'premultiplied' でキャンバス自体を半透明にする。
    // 書き込む色は事前乗算済み（rgb <= alpha）である必要がある。
    context.configure({
      device,
      format: presentationFormat,
      alphaMode: 'premultiplied',
    });

    const settings: Settings = {
      premultiply: false,
      color: [1, 0, 0],
      alpha: 0.01,
    };

    const colorAttachment: GPURenderPassColorAttachment = {
      view: undefined as unknown as GPUTextureView,
      clearValue: [0, 0, 0, 0],
      loadOp: 'clear',
      storeOp: 'store',
    };

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: 'clear only renderPass',
      colorAttachments: [colorAttachment],
    };

    const app = new App({
      canvas,
      device,
      context,
      settings,
      colorAttachment,
      renderPassDescriptor,
    });

    const gui = new GUI();
    gui.onChange(() => app.render());
    Object.assign(gui.domElement.style, {
      top: '50px',
      right: '',
      left: '8px',
    });
    gui.add(settings, 'premultiply');
    gui.add(settings, 'alpha', 0, 1);
    gui.addColor(settings, 'color');
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
    const { color, alpha, premultiply } = this.settings;

    // premultiply ON なら自分で rgb に alpha を掛けて事前乗算済みの値にする。
    // OFF だと rgb > alpha の「不正な色」になり得て、結果はブラウザ依存になる。
    const premultiplier = premultiply ? alpha : 1;
    this.colorAttachment.clearValue = [
      color[0] * premultiplier,
      color[1] * premultiplier,
      color[2] * premultiplier,
      alpha,
    ];

    const currentTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = currentTexture.createView();

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);
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
}
