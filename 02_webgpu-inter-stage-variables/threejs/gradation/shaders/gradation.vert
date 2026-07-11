out vec4 vColor;

void main() {
    const vec2 pos[3] = vec2[](
        vec2( 0.0,  0.5), // top center
        vec2(-0.5, -0.5), // bottom left
        vec2( 0.5, -0.5)  // bottom right
    );

    const vec4 color[3] = vec4[](
        vec4(1.0, 0.0, 0.0, 1.0), // red
        vec4(0.0, 1.0, 0.0, 1.0), // green
        vec4(0.0, 0.0, 1.0, 1.0)  // blue
    );

    vColor = color[gl_VertexID];
    gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
}
