precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uData;

void main() {
    float val = texture(uData, vUv).r;
    val *= 2.;
    // レンダーターゲットは RedFormat なので、格納されるのは r 成分のみ
    fragColor.r = val;
}
