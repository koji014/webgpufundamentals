import * as THREE from 'three';
import center_frag from '../shaders/center.frag';
import center_vert from '../shaders/center.vert';
import centroid_frag from '../shaders/centroid.frag';
import centroid_vert from '../shaders/centroid.vert';

type InterpolationMode = 'center' | 'centroid';

export class App {
  static RENDERER_PARAM = {
    clearColor: 0x4d4d4d, // [0.3, 0.3, 0.3, 1]
    alpha: 1,
  };

  static RESOLUTION_DIVISOR = 16;

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly mesh: THREE.Mesh;

  private readonly materials: Record<
    InterpolationMode,
    THREE.RawShaderMaterial
  >;

  mode: InterpolationMode = 'center';

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.Camera;
    mesh: THREE.Mesh;
    materials: Record<InterpolationMode, THREE.RawShaderMaterial>;
  }) {
    this.canvas = fields.canvas;
    this.renderer = fields.renderer;
    this.scene = fields.scene;
    this.camera = fields.camera;
    this.mesh = fields.mesh;
    this.materials = fields.materials;
  }

  static create(canvas: HTMLCanvasElement): App {
    // https://webgl2fundamentals.org/webgl/lessons/ja/webgl2-whats-new.html#:~:text=%E5%B0%91%E3%81%AA%E3%81%8F%E3%81%A8%E3%82%8216%E3%81%A7%E3%81%99%E3%80%82-,%E3%83%9E%E3%83%AB%E3%83%81%E3%82%B5%E3%83%B3%E3%83%97%E3%83%AB%E3%83%AC%E3%83%B3%E3%83%80%E3%83%AA%E3%83%B3%E3%82%B0%E3%83%90%E3%83%83%E3%83%95%E3%82%A1,-WebGL1%E3%81%A7%E3%81%AFGPU
    // https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext#antialias
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); // antialias: true で既定フレームバッファがマルチサンプルになり、 centroid 補間が効くようになる
    const clearColor = new THREE.Color(App.RENDERER_PARAM.clearColor);
    renderer.setClearColor(clearColor, App.RENDERER_PARAM.alpha);

    const scene = new THREE.Scene();
    const camera = new THREE.Camera();

    const geometry = new THREE.BufferGeometry();
    const positions = Array.from({ length: 3 }, () => [0, 0, 0]).flat();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );

    const materials: Record<InterpolationMode, THREE.RawShaderMaterial> = {
      center: new THREE.RawShaderMaterial({
        vertexShader: center_vert,
        fragmentShader: center_frag,
        glslVersion: THREE.GLSL3,
      }),
      centroid: new THREE.RawShaderMaterial({
        vertexShader: centroid_vert,
        fragmentShader: centroid_frag,
        glslVersion: THREE.GLSL3,
      }),
    };

    const mesh = new THREE.Mesh(geometry, materials.center);
    scene.add(mesh);

    return new App({ canvas, renderer, scene, camera, mesh, materials });
  }

  start() {
    const observer = new ResizeObserver((entries) => this.resize(entries));
    observer.observe(this.canvas);
  }

  setMode(mode: InterpolationMode) {
    this.mode = mode;
    this.mesh.material = this.materials[mode];
    this.render();
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  private resize(entries: ResizeObserverEntry[]) {
    const maxTextureDimension2D = this.renderer.capabilities.maxTextureSize;

    for (const entry of entries) {
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;

      const lowWidth = Math.round(width / App.RESOLUTION_DIVISOR);
      const lowHeight = Math.round(height / App.RESOLUTION_DIVISOR);

      const drawWidth = Math.max(1, Math.min(lowWidth, maxTextureDimension2D));
      const drawHeight = Math.max(
        1,
        Math.min(lowHeight, maxTextureDimension2D),
      );

      this.renderer.setSize(drawWidth, drawHeight, false);
    }
    this.render();
  }
}
