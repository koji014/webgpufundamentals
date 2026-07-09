// storage タイプの変数 data を宣言 （読み出し可能、書き込み可能）
@group(0) @binding(0) var<storage, read_write> data: array<f32>;

@compute @workgroup_size(1) fn computeSomething(
    @builtin(global_invocation_id) id: vec3u
) {
    let i = id.x;
    data[i] = data[i] * 2.0;
}