type Vec = Float32Array | number[];

export const vec3 = {
  cross(a: Vec, b: Vec, dst?: Float32Array) {
    dst = dst || new Float32Array(3);

    const t0 = a[1] * b[2] - a[2] * b[1];
    const t1 = a[2] * b[0] - a[0] * b[2];
    const t2 = a[0] * b[1] - a[1] * b[0];

    dst[0] = t0;
    dst[1] = t1;
    dst[2] = t2;

    return dst;
  },

  subtract(a: Vec, b: Vec, dst?: Float32Array) {
    dst = dst || new Float32Array(3);

    dst[0] = a[0] - b[0];
    dst[1] = a[1] - b[1];
    dst[2] = a[2] - b[2];

    return dst;
  },

  normalize(v: Vec, dst?: Float32Array) {
    dst = dst || new Float32Array(3);

    const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    // 0 除算を避ける
    if (length > 0.00001) {
      dst[0] = v[0] / length;
      dst[1] = v[1] / length;
      dst[2] = v[2] / length;
    } else {
      dst[0] = 0;
      dst[1] = 0;
      dst[2] = 0;
    }

    return dst;
  },
};
