# WebGPU の基礎

https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-fundamentals.html

---

## WebGPU の全体像

WebGPU がやることは 2 つ。

1. 三角形/点/線をテクスチャに描く（描画）
2. GPU 上で計算を実行する（コンピュート）

描画は頂点シェーダ（頂点位置を計算）とフラグメントシェーダ（ピクセルの色を計算）の組み合わせ、計算はコンピュートシェーダ（インデックス付きで N 回呼ぶ、`array.map` に近い）で行う。

| | WebGL | WebGPU |
| --- | --- | --- |
| 計算（GPGPU） | 描画専用。計算はテクスチャに焼くなどして代用 | 描画と並ぶ基本機能（コンピュートシェーダ） |
| API の性質 | 同期的。グローバルな状態機械（`gl.bindXxx` で対象を切り替える） | 非同期（`await` 必須）。状態はパイプライン/バインドグループにまとめて渡す |
| コード量 | 少なめでも動く | 低レベル。小さな例でも記述量が多い |

### デバイスを取得する

WebGL は `canvas.getContext('webgl')` 一発だが、WebGPU は adapter → device の 2 段階で、どちらも非同期。

```ts
const adapter = await navigator.gpu?.requestAdapter(); // 物理デバイス（物理的な GPU）
const device = await adapter?.requestDevice();         // 論理デバイス（抽象化した GPU）
```

- `adapter` … 実際の GPU ハードウェア
- `device` … そこへ命令を出す窓口。リソース生成もコマンド発行もすべて device 経由
- `device.lost` … device は別アプリが GPU を占有した等でロストしうる。意図的な破棄（`reason === 'destroyed'`）でなければ取り直す

### キャンバスと紐付ける

```ts
const context = canvas.getContext('webgpu');

// このシステムで最速に処理できる形式（"rgba8unorm" か "bgra8unorm"）
const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

context.configure({ device, format: presentationFormat });
```

- WebGL はデフォルトフレームバッファに直接描くが、WebGPU は毎フレーム `context.getCurrentTexture()` で描画先テクスチャを取り直す
- ここで決めた `presentationFormat` は、後述するパイプラインの `fragment.targets[n].format` と一致させる

---

## Vertex Shader / Fragment Shader

### シェーダ（WGSL）

シェーダは WGSL で書き、`createShaderModule` でモジュールにする。WebGL は頂点とフラグメントを別々にコンパイルして program にリンクするが、WebGPU は 1 つのモジュールに複数のエントリーポイント（`vs` / `fs`）を置ける。

```ts
const shaderModule = device.createShaderModule({
  label: 'our hardcoded red triangle shaders',
  code: triangle_wgsl,
});
```

頂点シェーダは頂点位置を返す。

```wgsl
@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  let pos = array(
    vec2f( 0.0,  0.5), // 上・中央
    vec2f(-0.5, -0.5), // 左下
    vec2f( 0.5, -0.5), // 右下
  );
  return vec4f(pos[vertexIndex], 0.0, 1.0);
}
```

- `pass.draw(3)` で 3 回呼ばれ、`vertexIndex` が 0→1→2 と渡る。WebGL の `gl_VertexID` に相当（`array.map` の index のようなもの）。このデモは頂点バッファを使わず、座標をシェーダ内にハードコードして index で選ぶ。
- 戻り値の `@builtin(position)` は WebGL の `gl_Position` に相当。座標系はクリップ空間で、X/Y とも左下 `-1` 〜 右上 `+1`（中心が原点）。描画先テクスチャのサイズに依存しないのも WebGL と同じ。

フラグメントシェーダはピクセルの色を返す。

```wgsl
@fragment fn fs() -> @location(0) vec4f {
  return vec4f(1.0, 0.0, 0.0, 1.0); // RGBA = 赤
}
```

- `@location(0)` は 1 つめのレンダーターゲットへの出力。パイプラインの `fragment.targets[0]`、パスの `colorAttachments[0]` と対応する。WebGL の `gl_FragColor`（`out vec4`）に相当。
- 頂点シェーダが決めた三角形を GPU がラスタライズし、内部の各ピクセルにつき 1 回フラグメントシェーダが呼ばれて色が決まる。「ピクセル中心が三角形の内側か」で塗る範囲を判定するのも WebGL と同じ。

### ラベル

WebGPU で生成するオブジェクトはほぼすべてに `label` を付けられる（`createShaderModule` / `createRenderPipeline` など）。必須ではないが、エラー時にメッセージへ出るので原因の特定が楽になる。

```
"WGSL syntax error in shaderModule at line 10"
→ "WGSL syntax error in shaderModule('our hardcoded red triangle shaders') at line 10"
```

### パイプラインとレンダーパス

描画は「パスを開き、その中でパイプラインをセットして描画命令を出す」流れ。パイプラインが「どう描くか」、パスが「どこに描くか」を持つ。WebGL でいうと、パイプラインはシェーダプログラム＋各種ステート（ブレンド・深度など）を 1 つに固めたもの、パスは描画先フレームバッファのバインドとクリアに当たる。

| | パイプライン | レンダーパス |
| --- | --- | --- |
| 役割 | 描き方の設定 | 描き先の指定と描画区間 |
| 生成 | `device.createRenderPipeline()` | `encoder.beginRenderPass(descriptor)` |
| コスト | 重い。初期化時に 1 回 | 軽い。毎フレーム開く |

このデモのパイプラインが指定するのは最小限。

```ts
device.createRenderPipeline({
  layout: 'auto',
  vertex:   { module, entryPoint: 'vs' }, // 頂点シェーダ
  fragment: {
    module, entryPoint: 'fs',             // フラグメントシェーダ
    targets: [{ format: presentationFormat }], // 出力先テクスチャの形式（context と揃える）
  },
});
```

`layout: 'auto'` はシェーダのコードからデータ配置を WebGPU に推測させる指定。頂点データを渡す場合の `vertex.buffers`、深度テストの `depthStencil`、ブレンドの `blend` などもパイプラインに含められるが、この記事のデモでは使わず後の章で扱う。

> （参考）[PipelineLayoutを理解する](https://zenn.dev/emadurandal/books/cb6818fd3a1b2e/viewer/pipeline-layout)

レンダーパスの descriptor が持つのは描き先まわり:

- 描き込み先テクスチャ（`colorAttachment.view`）
- 描画前にクリアするか（`colorAttachment.loadOp` … `'clear'` / `'load'`）
- 描画後に結果を残すか（`colorAttachment.storeOp` … `'store'` / `'discard'`）

### コマンドエンコーダと実行の流れ

命令はその場で GPU に送らず、いったんコマンドとして記録（エンコード）し、最後にまとめて送る。描画のたびに GPU と往復すると遅いため、命令を溜めてから一括送信する設計。WebGL の `gl.drawArrays` が即実行だったのと対照的。

登場するオブジェクト:

| 名前 | 生成 | 役割 | ライフサイクル |
| --- | --- | --- | --- |
| コマンドエンコーダ（`encoder`） | `device.createCommandEncoder()` | コマンドを記録する土台。コピー命令などパス以外もここに並ぶ | 毎フレーム作り `finish()` で使い捨て |
| レンダーパスのエンコーダ（`pass`） | `encoder.beginRenderPass(descriptor)` | 描画命令専用の記録係。描き先は descriptor で確定 | `beginRenderPass()`〜`pass.end()` の区間だけ |
| コマンドバッファ（`commandBuffer`） | `encoder.finish()` | 記録済みの命令列そのもの | `submit()` で消費 |

```ts
// 描画先テクスチャは毎フレーム取り直す（今このフレームで描くキャンバス表面が返る）
colorAttachment.view = context.getCurrentTexture().createView();

const encoder = device.createCommandEncoder({ label: 'our encoder' });

// descriptor を渡して描き先を確定させ、描画専用の記録係を開く
const pass = encoder.beginRenderPass(renderPassDescriptor);
pass.setPipeline(pipeline); // どう描くか
pass.draw(3);               // 頂点シェーダを 3 回呼ぶ（頂点 3 つ = 三角形 1 枚）
pass.end();                 // ここまででまだ何も実行されていない

const commandBuffer = encoder.finish(); // 記録した手順がバッファになる
device.queue.submit([commandBuffer]);   // submit で初めて GPU が動く
```

### キャンバスのリサイズ

- canvas は表示サイズ（CSS ピクセル）と描画解像度（`canvas.width/height`）が別物で、表示だけ変わって解像度が追従しないと拡大時にぼやける。
- `ResizeObserver` で表示サイズの変化を捉えて解像度を合わせ、再描画する。
- WebGL でリサイズ時に `gl.viewport` を張り直すのに相当する処理。ただし手段は違う。
  - WebGL：`canvas.width/height` の変更 ＋ `gl.viewport` の張り直しが必要
  - WebGPU：`canvas.width/height` を変えるだけ。ビューポートは既定で描画先テクスチャ全体なので追従は自動
  - `gl.viewport` そのものの対応 API はレンダーパスの `pass.setViewport(x, y, w, h, minDepth, maxDepth)`（NDC → ビューポート座標の線形マッピング）。既定がテクスチャ全体なので、部分描画したいときだけ呼ぶ

```ts
const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    // 横書きでは inlineSize = 横幅、blockSize = 高さ
    const width = entry.contentBoxSize[0].inlineSize;
    const height = entry.contentBoxSize[0].blockSize;

    // 最小 1px を保証しつつ、扱えるテクスチャ最大サイズを超えないようクランプ
    // （上限超過や 0 はテクスチャ生成でエラーになる）
    canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
    canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));

    render(); // 新サイズのテクスチャは render() 内の getCurrentTexture() が用意する
  }
});

observer.observe(canvas); // observe 直後に一度発火するので、初回描画の起点にもなる
```

---

## Compute Shader

### シェーダ（WGSL）

```wgsl
// bindGroup で渡すバッファに対応。read_write なので読み書きできる
@group(0) @binding(0) var<storage, read_write> data: array<f32>;

@compute @workgroup_size(1)
fn computeSomething(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  data[i] = data[i] * 2.0; // 各要素を 2 倍にして書き戻す
}
```

- `var<storage, read_write> data` は `@group(0) @binding(0)` で JS 側の bindGroup（後述）と結びつく。WebGL2 の SSBO に近いが、WebGL にはコンピュートシェーダ自体が無い。
- `@builtin(global_invocation_id)` は何番目の呼び出しかを表す。`dispatchWorkgroups(3)` なら `id.x` が 0→1→2 と渡り、各呼び出しが `data[i]` を 1 つ処理する。頂点シェーダの `vertex_index` に当たる立ち位置。
- `@workgroup_size(1)` は 1 ワークグループあたりのスレッド数。総実行数は「dispatch 数 × workgroup_size」で、このデモは 3 × 1 = 3 回。

### パイプライン

- コンピュートは描画とは別の関数でパイプラインを作る。
- 頂点/フラグメントが無いので `compute` に `module` と `entryPoint` を渡すだけ。

| 用途 | 生成関数 | 主な指定 |
| --- | --- | --- |
| 描画 | `device.createRenderPipeline()` | `vertex` / `fragment` |
| 計算 | `device.createComputePipeline()` | `compute`（`module` + `entryPoint`） |

```ts
const pipeline = device.createComputePipeline({
  label: 'doubling compute pipeline',
  layout: 'auto',
  compute: { module: shaderModule, entryPoint: 'computeSomething' },
});
```

実行も別系統で、`beginRenderPass` の代わりに `encoder.beginComputePass()` を開き、`pass.draw()` の代わりに `pass.dispatchWorkgroups(...)` で起動する。

### バッファと usage

`usage` はそのバッファを何に使うかの許可リスト。宣言していない用途で使うとエラーになる。複数用途はビットフラグを `|` で合成する（WebGL の `gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)` と同じ要領）。

```ts
const workBuffer = device.createBuffer({
  label: 'work buffer',
  size: input.byteLength, // Float32Array 3 個なら 12 バイト
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(workBuffer, 0, input); // JS の入力を GPU バッファへ書き込む
```

| フラグ | 意味 | このデモでの使いどころ |
| --- | --- | --- |
| `STORAGE` | シェーダの `var<storage, ...>` から読み書きできる | 値を読んで 2 倍にし書き戻す |
| `COPY_DST` | コピー先にできる（＝書き込める） | `writeBuffer` で入力を書き込む |
| `COPY_SRC` | コピー元にできる（＝読み出せる） | 結果を読み戻す（`copyBufferToBuffer`） |

1 つの `workBuffer` を 3 役で使うので 3 フラグを合成している。

```
JS の input ──writeBuffer──▶ workBuffer ──シェーダで読み書き──▶ workBuffer ──コピー──▶ 結果取得用バッファ
                (COPY_DST)      (STORAGE)                          (COPY_SRC)
```

### bindGroup でバッファをシェーダに渡す

- 描画は `pass.draw()` で頂点シェーダが動くだけだったが、コンピュートではどのバッファを使うかをシェーダに明示する。それが bindGroup。
- WebGL で uniform やテクスチャユニットを 1 つずつバインドしていたのを、まとめて 1 つの束にして渡すイメージ。

```ts
const bindGroup = device.createBindGroup({
  label: 'bindGroup for work buffer',
  layout: pipeline.getBindGroupLayout(0), // 引数の 0 = シェーダの @group(0)
  entries: [
    // binding: 0 = シェーダの @binding(0)。バッファは { buffer: ... } で渡す
    { binding: 0, resource: { buffer: workBuffer } },
  ],
});
```

`layout: 'auto'` で作ったパイプラインからは `getBindGroupLayout(n)` でレイアウトを取り出せる。`@group(g) @binding(b)` の (g, b) が、JS 側の `getBindGroupLayout(g)` と `entries[].binding` に対応する。

### 起動と結果の読み戻し

コンピュートパスを開いて起動する。

```ts
const pass = encoder.beginComputePass();
pass.setPipeline(pipeline);
pass.setBindGroup(0, bindGroup);       // 0 = シェーダの @group(0)
pass.dispatchWorkgroups(input.length); // シェーダを input.length 回呼べ、という命令
pass.end();
```

計算結果は `workBuffer` に書き戻るが、`STORAGE` のバッファは CPU から直接読めない。CPU 側へマップできる専用バッファ（`MAP_READ`）を別に用意し、そこへコピーしてから読む。WebGL の `gl.readPixels` に当たるが、WebGPU では非同期マップ経由になる。

```ts
// 読み戻し専用バッファ。MAP_READ で CPU 側へマップできる
const resultBuffer = device.createBuffer({
  size: input.byteLength,
  usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
});

encoder.copyBufferToBuffer(workBuffer, 0, resultBuffer, 0, resultBuffer.size);
device.queue.submit([encoder.finish()]);

await resultBuffer.mapAsync(GPUMapMode.READ);
const mapped = resultBuffer.getMappedRange();    // GPU メモリを指す ArrayBuffer
const result = new Float32Array(mapped.slice()); // slice でコピーしてから View を被せる
resultBuffer.unmap();                            // マップ解除。以後 mapped は length 0 で無効
```

- `getMappedRange()` の `ArrayBuffer` は `unmap()` で無効化される（長さ 0）。
- そのため、読みたい値は `unmap()` 前に `slice()` で JS ヒープへコピーしておく。
