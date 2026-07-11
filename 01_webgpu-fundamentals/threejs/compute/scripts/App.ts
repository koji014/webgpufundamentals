import * as THREE from 'three';
import compute_frag from '../shaders/compute.frag';
import compute_vert from '../shaders/compute.vert';

export class App {
  private static readonly INPUT = new Float32Array([1, 3, 5]);

  private readonly output: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly renderTarget: THREE.WebGLRenderTarget;

  private constructor(
    output: HTMLElement,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderTarget: THREE.WebGLRenderTarget,
  ) {
    this.output = output;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.renderTarget = renderTarget;
  }

  static create(output: HTMLElement): App {
    const input = App.INPUT;

    // canvas は DOM には追加しない
    const renderer = new THREE.WebGLRenderer();

    // 浮動小数レンダーターゲットへの書き込み／読み戻しに必要な拡張
    // __ WebGL2 では EXT_color_buffer_float。未対応環境では読み戻しに失敗する
    const gl = renderer.getContext();
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('float レンダーターゲットに未対応の環境です');
    }

    // 入力データをテクスチャに載せる。
    // __ RedFormat（単一チャネル R32F）なので、入力の Float32Array を 1 要素 = 1 テクセルとしてそのまま渡せる
    const dataTexture = new THREE.DataTexture(
      input,
      input.length, // 幅 = 要素数
      1, // 高さ = 1
      THREE.RedFormat,
      THREE.FloatType,
    );

    // データを書き換えるたびに needsUpdate = true => 次の描画で再アップロードされる
    dataTexture.needsUpdate = true;
    // ※ 画像URLから読み込む普通の TextureLoader の場合、Three.js が「画像の読み込み完了」を検知して自動で needsUpdate = true にしてくれるが、DataTexture は自動ではないので自分で設定する必要がある

    // 計算結果の書き込み先 ／ 解像度が 3 × 1（幅3ピクセル × 高さ1ピクセル） の RenderTarget （FBO）
    const renderTarget = new THREE.WebGLRenderTarget(
      input.length, // 幅
      1, // 高さ
      {
        format: THREE.RedFormat,
        type: THREE.FloatType,
      },
    );

    const scene = new THREE.Scene();
    const camera = new THREE.Camera();

    // クリップ空間 [-1,1] を覆う板ポリ。各ピクセル＝各入力要素として計算する
    const geometry = new THREE.PlaneGeometry(2, 2);

    const material = new THREE.RawShaderMaterial({
      vertexShader: compute_vert,
      fragmentShader: compute_frag,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uData: { value: dataTexture },
      },
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    return new App(output, renderer, scene, camera, renderTarget);
  }

  // 計算を実行し、結果を画面に表示する
  run() {
    const result = this.compute();

    const format = (values: Float32Array) => Array.from(values).join(', ');
    const createRow = (label: string, values: Float32Array) => {
      const p = document.createElement('p');

      const labelSpan = document.createElement('span');
      labelSpan.className = 'text-neutral-400';
      labelSpan.textContent = label;

      p.append(labelSpan, `: [${format(values)}]`);
      return p;
    };

    this.output.replaceChildren(
      createRow('input', App.INPUT),
      createRow('result', result),
    );
  }

  private compute() {
    const length = App.INPUT.length;

    // レンダーターゲットへ描画＝各テクセルに対しフラグメントシェーダで計算を実行する
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null); // 既定の描画先に戻す

    // FBO に書き込まれた結果（＝GPUの計算結果）を CPU側のメモリに読み戻す
    // __ RedFormat なので 1 テクセル = 1 float ／ 要素数ぶんの Float32Array にそのまま結果が入る
    const result = new Float32Array(length);
    this.renderer.readRenderTargetPixels(
      this.renderTarget, // 読み出し元の FBO
      0, // 読み出し開始 x
      0, // 読み出し開始 y
      length, // 読み出す幅（= 要素数）
      1, // 読み出す高さ（= 1）
      result, // 結果を書き込む先の Float32Array
    );

    return result;
  }
}
