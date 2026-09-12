export const mat3 = {
  fromMat4(m: Float32Array, dst?: Float32Array) {
    dst = dst || new Float32Array(12);

    dst[0] = m[0];
    dst[1] = m[1];
    dst[2] = m[2];
    dst[4] = m[4];
    dst[5] = m[5];
    dst[6] = m[6];
    dst[8] = m[8];
    dst[9] = m[9];
    dst[10] = m[10];

    return dst;
  },
};
