struct OurVertexShaderOutput {
    @builtin(position) position: vec4f,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> OurVertexShaderOutput {
    let pos = array(
        vec2f(0.0, 0.5),   // top center
        vec2f(-0.5, -0.5), // bottom left
        vec2f(0.5, -0.5)   // bottom right
    );

    var vsOutput: OurVertexShaderOutput;
    vsOutput.position = vec4f(pos[vertexIndex], 0.0, 1.0);
    return vsOutput;
}