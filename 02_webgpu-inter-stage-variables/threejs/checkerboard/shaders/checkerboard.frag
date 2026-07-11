precision highp float;

out vec4 fragColor;

void main() {
    vec4 red = vec4(1.0, 0.0, 0.0, 1.0);
    vec4 cyan = vec4(0.0, 1.0, 1.0, 1.0);

    // WebGL の gl_FragCoord.y は下原点（左下が 0）、WGSL は上原点。市松の縦方向の位相が上下反転する
    uvec2 grid = uvec2(gl_FragCoord.xy) / 8u;
    bool checker = (grid.x + grid.y) % 2u == 1u;

    fragColor = mix(red, cyan, bvec4(checker));
}
