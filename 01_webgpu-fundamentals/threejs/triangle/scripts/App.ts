import * as THREE from 'three';
import triangle_frag from '../shaders/triangle.frag';
import triangle_vert from '../shaders/triangle.vert';

export class App {
  static RENDERER_PARAM = {
    clearColor: 0x4d4d4d, // [0.3, 0.3, 0.3, 1]
    alpha: 1,
  };

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.Camera;
  }) {
    this.canvas = fields.canvas;
    this.renderer = fields.renderer;
    this.scene = fields.scene;
    this.camera = fields.camera;
  }

  static create(canvas: HTMLCanvasElement): App {
    const renderer = new THREE.WebGLRenderer({ canvas });
    const clearColor = new THREE.Color(App.RENDERER_PARAM.clearColor);
    renderer.setClearColor(clearColor, App.RENDERER_PARAM.alpha);

    const scene = new THREE.Scene();
    const camera = new THREE.Camera();

    const geometry = new THREE.BufferGeometry();
    // gl_VertexID が 0→1→2 と渡り drawElements で 3 頂点が描画される
    geometry.setIndex([0, 1, 2]);

    const material = new THREE.RawShaderMaterial({
      vertexShader: triangle_vert,
      fragmentShader: triangle_frag,
      glslVersion: THREE.GLSL3,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    return new App({ canvas, renderer, scene, camera });
  }

  start() {
    const observer = new ResizeObserver((entries) => this.resize(entries));
    observer.observe(this.canvas);
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  private resize(entries: ResizeObserverEntry[]) {
    const maxTextureDimension2D = this.renderer.capabilities.maxTextureSize;

    for (const entry of entries) {
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;

      const drawWidth = Math.max(1, Math.min(width, maxTextureDimension2D));
      const drawHeight = Math.max(1, Math.min(height, maxTextureDimension2D));

      // 第 3 引数 false: canvas の style（Tailwind で指定した表示サイズ） は上書きしない
      this.renderer.setSize(drawWidth, drawHeight, false);
    }
    this.render();
  }
}
