struct Uni {
    size: vec2u,
};

@group(0) @binding(0) var<storage, read_write> buf: array<u32>;
// @group(0) @binding(0) var<storage, read_write> buf: array<vec4f>;
@group(0) @binding(1) var<uniform> uni: Uni;

@compute @workgroup_size(1) fn cs(
    @builtin(global_invocation_id) id: vec3u
) {
    let center = vec2f(uni.size) / 2.0;
    let pos = id.xy;
    let dist = distance(vec2f(pos), center);

    let stripe = dist / 32.0 % 2.0;
    let red = vec4f(1, 0, 0, 1);
    let cyan = vec4f(0, 1, 1, 1);
    let color = select(red, cyan, stripe < 1.0);

    let index = pos.y * uni.size.x + pos.x;

    let rgba = vec4u(color * 255.0);
    let packedColor = rgba.r | (rgba.g << 8) | (rgba.b << 16) | (rgba.a << 24);
    buf[index] = packedColor;
    // buf[index] = color;
}
