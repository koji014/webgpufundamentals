@fragment fn fs() -> @location(0) vec4f {
    return vec4f(1.0, 0.0, 0.0, 1.0); // Red
}

// @location(0): 一つ目のレンダーターゲット => 用意しておいた canvas のテクスチャとする（CPU側で設定）