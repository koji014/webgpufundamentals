import { mat4 } from './mat4';

export interface TRSParams {
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

export class TRS {
  translation: Float32Array;
  rotation: Float32Array;
  scale: Float32Array;

  constructor({
    translation = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
  }: TRSParams = {}) {
    this.translation = new Float32Array(translation);
    this.rotation = new Float32Array(rotation);
    this.scale = new Float32Array(scale);
  }

  getMatrix(dst: Float32Array): Float32Array {
    mat4.translation(this.translation, dst);
    mat4.rotateX(dst, this.rotation[0], dst);
    mat4.rotateY(dst, this.rotation[1], dst);
    mat4.rotateZ(dst, this.rotation[2], dst);
    mat4.scale(dst, this.scale, dst);
    return dst;
  }
}
