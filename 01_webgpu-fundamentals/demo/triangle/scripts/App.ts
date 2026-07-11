import triangle_wgsl from '../shaders/index.wgsl';

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;

  private constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    pipeline: GPURenderPipeline,
    colorAttachment: GPURenderPassColorAttachment,
    renderPassDescriptor: GPURenderPassDescriptor,
  ) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.pipeline = pipeline;
    this.colorAttachment = colorAttachment;
    this.renderPassDescriptor = renderPassDescriptor;
  }

  static async create(canvas: HTMLCanvasElement): Promise<App> {
    const device = await App.getDevice();

    // WebGPU コンテキストを取得
    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('webgpu コンテキストを取得できませんでした。');
    }

    // 推奨の canvas フォーマットを取得（そのシステムにおいて最速な処理方法が選択できる）
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat(); //  "rgba8unorm" or "bgra8unorm"

    // デバイスと WebGPU コンテキストを紐付ける
    context.configure({ device, format: presentationFormat });

    // シェーダモジュールを生成
    const shaderModule = device.createShaderModule({
      label: 'our hardcoded red triangle shaders',
      code: triangle_wgsl,
    });

    // レンダーパイプラインを生成
    const pipeline = device.createRenderPipeline({
      label: 'our hardcoded red triangle pipeline',
      layout: 'auto',
      vertex: {
        module: shaderModule, // データのレイアウトを、シェーダのコードの内容から WebGPU が自動で設定する（今回はレイアウトすべきデータ自体がない）
        entryPoint: 'vs', // 頂点シェーダのエントリーポイント名
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs', // フラグメントシェーダのエントリーポイント名
        targets: [
          { format: presentationFormat }, // １つめのレンダーターゲットにフォーマットを指定 = フラグメントシェーダの返り値の設定で記述した location(0) に相当
        ],
      },
    });

    // view は描画時に設定するため、いったん未設定のまま生成する。
    const colorAttachment: GPURenderPassColorAttachment = {
      view: undefined as unknown as GPUTextureView, // render() 内で getCurrentTexture から設定する
      clearValue: [0.3, 0.3, 0.3, 1], // 背景色
      loadOp: 'clear', // 描画開始前にテクスチャ全体を背景色でクリアする
      // loadOp: 'load', // その時点のテクスチャの内容を GPU にロードして、そこに上書きで描画していく
      storeOp: 'store', // 描画内容をテクスチャに保存する
      // storeOp: 'discard', // 描画内容を破棄する
    };

    // 描画先とするテクスチャの指定と、そのテクスチャをどう扱うかの設定
    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: 'our basic canvas renderPass',
      colorAttachments: [
        colorAttachment, // フラグメントシェーダの返り値の設定で記述した location(0) に対応するもの
      ],
    };

    return new App(
      canvas,
      device,
      context,
      pipeline,
      colorAttachment,
      renderPassDescriptor,
    );
  }

  // canvas の監視を開始し、初回描画の起点にする
  start() {
    const observer = new ResizeObserver((entries) => this.resize(entries));
    // observe した直後にも一度コールバックが発火するため、これが初回描画の起点にもなる
    observer.observe(this.canvas);
  }

  private render() {
    // canvas のコンテキストから、カレントテクスチャを得る。
    const currentTexture = this.context.getCurrentTexture();
    // それをレンダーパスに設定して、描画対象として指定する。
    this.colorAttachment.view = currentTexture.createView(); // createView: テクスチャの一部の範囲だけを切り出す指定ができる（引数なし＝デフォルトの範囲）

    // コマンドエンコーダを生成する。コマンドのエンコードができる状態にする。
    const encoder = this.device.createCommandEncoder({ label: 'our encoder' });

    // 1. レンダーパスのエンコーダを生成する
    // __ エンコーダに renderPassDescriptor を渡すことで、描画対象とするテクスチャを指定
    // 2. コマンドエンコーダは、コマンドバッファを生成するために使用する
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);

    // 3. 各種コマンドをコマンドバッファに並べる
    pass.setPipeline(this.pipeline); // パイプラインをセット
    pass.draw(3); // 頂点シェーダを３回呼び出す
    pass.end(); // レンダーパスを終了

    // エンコーダを finish する。
    // finish を実行することで、上でコマンドを並べて定義した手順が入ったコマンドバッファが得られる
    const commandBuffer = encoder.finish();

    // コマンドバッファを送信すると、コマンドが実行される
    // __ WebGPU は、エンコードしたコマンドを submit すると動く
    this.device.queue.submit([commandBuffer]);
  }

  // canvas のリサイズ
  private resize(entries: ResizeObserverEntry[]) {
    // entries: サイズが変化した監視対象ごとの情報の配列（ここでは canvas 1 つ分）
    for (const entry of entries) {
      // contentBoxSize[0]: 要素のコンテンツ領域の新しいサイズ
      // __ 横書きの場合、 inlineSize = 横幅、 blockSize = 高さ
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;

      // 描画解像度を表示サイズに合わせる。
      // __ 最小 1px を保証しつつ、GPU が扱えるテクスチャ最大サイズ (maxTextureDimension2D) を超えないようクランプする
      const maxSize = this.device.limits.maxTextureDimension2D;
      this.canvas.width = Math.max(1, Math.min(width, maxSize));
      this.canvas.height = Math.max(1, Math.min(height, maxSize));
      // ※ canvas のサイズには、デバイスによる上限の制限あり
      // __ この上限を超えると、WebGPU は、大きすぎるテクスチャを生成しようとしてエラーを出力する。また、サイズが0の場合も同様にエラーとなる。
    }
    this.render(); // リサイズ後のサイズの新たなテクスチャの生成は、render の中に書いた context.getCurrentTexture() が行なう
  }

  // WebGPU デバイスを取得
  private static async getDevice(): Promise<GPUDevice> {
    const adapter = await navigator.gpu?.requestAdapter(); // 物理デバイス（物理的なGPU）
    const device = await adapter?.requestDevice(); // 論理デバイス（抽象化したGPU）
    if (!device) {
      throw new Error('WebGPU対応ブラウザが必要です');
    }

    device.lost.then((info) => {
      console.error(`WebGPU device was lost: ${info.message}`);
      // 'reason' will be 'destroyed' if we intentionally destroy the device.
      if (info.reason !== 'destroyed') {
        // try again
        App.getDevice();
      }
    });

    return device;
  }
}
