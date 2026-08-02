@group(0) @binding(0) var tex: texture_storage_2d<__PRESENTATION_FORMAT__, write>;

@compute @workgroup_size(1) fn cs(
    @builtin(global_invocation_id) id: vec3u
) {
    let size = textureDimensions(tex);
    let center = vec2f(size) / 2.0;
    let pos = id.xy;
    let dist = distance(vec2f(pos), center);

    let stripe = dist / 32.0 % 2.0;
    let red = vec4f(1, 0, 0, 1);
    let cyan = vec4f(0, 1, 1, 1);
    let color = select(red, cyan, stripe < 1.0);

    textureStore(tex, pos, color);
}
