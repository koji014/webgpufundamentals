struct Uni {
    size: vec2u,
};

@vertex fn vs(
    @builtin(vertex_index) vertexIndex: u32
) -> @builtin(position) vec4f {
    let pos = array(
        vec2f(-1.0, -1.0),
        vec2f( 1.0, -1.0),
        vec2f(-1.0,  1.0),
        vec2f( 1.0,  1.0),
    );
    return vec4f(pos[vertexIndex], 0.0, 1.0);
}

@group(0) @binding(0) var<storage, read> buf: array<u32>;
// @group(0) @binding(0) var<storage, read> buf: array<vec4f>;
@group(0) @binding(1) var<uniform> uni: Uni;

@fragment fn fs(
    @builtin(position) position: vec4f
) -> @location(0) vec4f {
    let pos = vec2u(position.xy); // バッファの添字に使うためキャスト Ex. (1.5, 0.5) → (1, 0)
    let index = pos.y * uni.size.x + pos.x;

    let packedColor = buf[index];
    let rgba = vec4u(
        packedColor & 0x000000ffu,
        (packedColor >> 8) & 0x000000ffu,
        (packedColor >> 16) & 0x000000ffu,
        (packedColor >> 24) & 0x000000ffu,
    );
    return vec4f(rgba) / 255.0;
    // return buf[index];
}
