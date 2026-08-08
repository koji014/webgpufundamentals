struct OurStruct {
    color: vec4f,
    offset: vec2f,
};

struct OtherStruct {
    scale: vec2f,
}

@group(0) @binding(0) var<uniform> ourStruct: OurStruct;
@group(0) @binding(1) var<uniform> otherStruct: OtherStruct;

@vertex fn vs(
    @builtin(vertex_index) vertexIndex : u32
) -> @builtin(position) vec4f {
    let pos = array(
        vec2f( 0.0,  0.5),  // top center
        vec2f(-0.5, -0.5),  // bottom left
        vec2f( 0.5, -0.5)   // bottom right
    );

    return vec4f(pos[vertexIndex] * otherStruct.scale + ourStruct.offset, 0.0, 1.0);
}

@fragment fn fs() -> @location(0) vec4f {
    return ourStruct.color;
}