precision highp float;

uniform vec2 uResolution;
out vec4 fragColor;

void main() {
    vec2 size = uResolution;
    vec2 center = size / 2.0;
    vec2 pos = gl_FragCoord.xy;
    // gl_FragCoord は WebGL では左下原点だが、同心円は中心対称なので見た目は変わらない
    float dist = distance(pos, center);

    float stripe = mod(dist / 32.0, 2.0);
    // float stripe = float(int(dist / 32.0) % 2);
    vec3 red = vec3(1.0, 0.0, 0.0);
    vec3 cyan = vec3(0.0, 1.0, 1.0);
    vec3 color = mix(red, cyan, bvec3(stripe < 1.0));

    fragColor = vec4(color, 1.0);
}
