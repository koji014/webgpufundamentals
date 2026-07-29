precision highp float;

uniform sampler2D map;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
    fragColor = texture(map, vTexCoord);
}
