# WebGL から WebGPU へ

https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-from-webgl.html

---

## 設計思想の違い

### ステートフル vs ステートレス

| | WebGL | WebGPU |
| --- | --- | --- |
| 状態 | グローバル状態（`gl.bindBuffer` / `gl.enable` など）。変更するまで保持 | グローバル状態をほぼ持たない。設定はパイプラインに束ねる |
| 変更 | いつでも上書き可 | パイプラインは作成後は変更不可。変えたいなら別に作る |

WebGL で散らばっていた設定（カリング・深度テスト・ブレンド・属性レイアウト・出力フォーマット）が、WebGPU では1つのパイプラインに集約される。

`topology` は「頂点をどう繋いで描くか」の指定で、パイプライン作成時に固定する。三角形で描くか線で描くかを切り替えたいなら、値の違うパイプラインをそれぞれ作る。
```javascript
// 三角形として描くパイプライン
const trianglePipeline = device.createRenderPipeline({
  // ...
  primitive: { topology: 'triangle-list' },
});
// 線として描くパイプライン
const linePipeline = device.createRenderPipeline({
  // ...
  primitive: { topology: 'line-list' },
});
```

### 名前で接続 vs 番号で接続

| | WebGL | WebGPU |
| --- | --- | --- |
| 接続 | 名前で解決（`getUniformLocation('u_matrix')`） | `@location(n)` / `@group(g) @binding(b)` の番号をJS側と一致させる |

番号がズレてもエラーにならず表示だけ壊れる、というバグが起きやすい。CPU側とGPU側のレイアウト同期は自分の責任。

**WebGL** — シェーダの変数名を文字列で問い合わせて結びつける
```glsl
uniform mat4 u_matrix;   // シェーダ側の宣言
```
```javascript
const loc = gl.getUniformLocation(program, 'u_matrix'); // 同じ名前で場所を取得
gl.uniformMatrix4fv(loc, false, matrix);
```

**WebGPU** — 番号（`@binding`）で結びつける。名前は登場しない
```wgsl
@group(0) @binding(0) var<uniform> u_matrix: mat4x4f;   // シェーダ側の宣言
```
```javascript
device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: matrixBuffer } }], // 同じ番号で結ぶ
});
```

---

## 初期化

**WebGL**（同期）
```javascript
const gl = canvas.getContext('webgl');
```

**WebGPU**（非同期、adapter と device を分けて取得）
```javascript
const adapter = await navigator.gpu?.requestAdapter(); // GPU を選ぶ
const device  = await adapter?.requestDevice();        // 命令を出すデバイス
const context = canvas.getContext('webgpu');
context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() });
```

- `adapter` … 物理GPU（ブラウザが公開する表現）。機能(features)や上限(limits)を持つ。内蔵/外付けなど複数あり得て、1つ選ぶ
- `device` … adapter から作る論理デバイス。リソース生成もコマンド発行もすべて `device` 経由

---

## シェーダ言語（GLSL vs WGSL）

**GLSL** — 型が左、入出力を `attribute` / `varying` / `uniform` で区別
```glsl
attribute vec4 a_position;
varying   vec2 v_texCoord;
uniform   mat4 u_worldViewProjection;
```

**WGSL** — 型が右、すべて `@location` / `@builtin` / `@group @binding` で位置を明示
```wgsl
struct MyVSInput {
  @location(0) position: vec4f,
};
@group(0) @binding(0) var<uniform> vsUniforms: VSUniforms;
```

| 組み込み変数 | GLSL | WGSL |
| --- | --- | --- |
| 頂点出力位置 | `gl_Position` | `@builtin(position)`（頂点シェーダの戻り値） |
| フラグメント座標 | `gl_FragCoord` | `@builtin(position)`（0,0 が左上） |
| 頂点番号 | `gl_VertexID` | `@builtin(vertex_index)` |

コンパイル時のエラーチェックは、WebGL が `getShaderParameter` で手動。WebGPU は `createShaderModule({code})` でコンソールに出る。

---

## 属性（Attribute）

**WebGL** — 描画のたびにバインド＆レイアウト指定
```javascript
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
gl.enableVertexAttribArray(positionLoc);
```

**WebGPU** — レイアウトはパイプライン作成時に固定、描画時は実バッファを差すだけ
```javascript
// パイプライン側
vertex: {
  buffers: [{
    arrayStride: 3 * 4,                                   // 1頂点 = 3要素 × 4byte
    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
  }],
}
// 描画時
passEncoder.setVertexBuffer(0, positionBuffer);
```

ロケーションは WebGL では自動割り当てもあるが、WebGPU は `shaderLocation` を手動指定。

---

## Uniform

**WebGL** — 名前でロケーションを取り、型別関数で個別送信
```javascript
const loc = gl.getUniformLocation(program, 'u_worldViewProjection');
gl.uniformMatrix4fv(loc, false, matrix);
```

**WebGPU** — バッファにバイトオフセットを手計算で詰めて `writeBuffer` で送る
```javascript
const vsUniformBuffer = device.createBuffer({
  size: 2 * 16 * 4,                                       // mat4×2 = 32 × 4byte
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const values = new Float32Array(2 * 16);
const worldViewProjection = values.subarray(0, 16);       // 先頭16要素に書き込む
// …行列を計算…
device.queue.writeBuffer(vsUniformBuffer, 0, values);
```

WebGL は名前で自動解決してくれたが、WebGPU はバイトオフセットを自分で管理する。構造体も WebGL2 では任意だったのが実質必須になる。

---

## テクスチャ & サンプラー

**WebGL** — サンプラー設定がテクスチャに付随
```javascript
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
```

**WebGPU** — テクスチャとサンプラーは別オブジェクト。バインドグループで束ねる
```javascript
const tex = device.createTexture({
  size: [2, 2],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
```

WebGL では暗黙だったサンプラーが、WebGPU では明示的なオブジェクトになり必須。

これはシェーダ側にも表れる。GLSL は `sampler2D` がテクスチャとサンプリング状態を兼ねていて `texture2D()`（WebGL2 は `texture()`）で読む。WGSL はテクスチャとサンプラーを別々に宣言し、`textureSample()` に両方渡す。

**GLSL**
```glsl
uniform sampler2D uTexture;
// ...
vec4 color = texture2D(uTexture, vTexCoord); // WebGL2 では texture(uTexture, vTexCoord)
```

**WGSL**
```wgsl
@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
// ...
let color = textureSample(uTexture, uSampler, vTexCoord);
```

---

## プログラム／パイプライン & バインドグループ

**WebGL** — シェーダをアタッチ→リンク→使用
```javascript
gl.attachShader(program, vs);
gl.attachShader(program, fs);
gl.linkProgram(program);
gl.useProgram(program);
```

**WebGPU** — シェーダ・属性レイアウト・プリミティブ・深度・出力フォーマットを一括で固める
```javascript
const pipeline = device.createRenderPipeline({
  vertex:   { module: shaderModule, buffers: [/* 属性のレイアウト */] },
  fragment: { module: shaderModule, targets: [{ format: presentationFormat }] },
  primitive: { topology: 'triangle-list', cullMode: 'back' },
  depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
});
```

さらに WebGPU はバインドグループで、シェーダが使うリソース（バッファ・サンプラー・テクスチャ）を1束にまとめる。
```javascript
const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: vsUniformBuffer } }, // @group(0) @binding(0)
    { binding: 1, resource: { buffer: fsUniformBuffer } }, // @group(0) @binding(1)
    { binding: 2, resource: sampler },                     // @group(0) @binding(2)
    { binding: 3, resource: tex.createView() },            // @group(0) @binding(3)
  ],
});
```

`binding` 番号は WGSL の `@group(0) @binding(n)` と一致させる。

---

## 描画

**WebGL** — 呼んだそばから実行
```javascript
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
```

**WebGPU** — コマンドを記録してから submit
```javascript
const encoder = device.createCommandEncoder();
const pass = encoder.beginRenderPass(renderPassDescriptor); // クリア値/loadOp/storeOp を持つ
pass.setPipeline(pipeline);
pass.setBindGroup(0, bindGroup);
pass.setVertexBuffer(0, positionBuffer);
pass.setIndexBuffer(indicesBuffer, 'uint16');
pass.drawIndexed(indices.length);
pass.end();
device.queue.submit([encoder.finish()]);   // ここで実際に動く
```

`pass.end()` や `encoder.finish()` の時点では描画は起きず、`submit()` で初めて動く。WebGL の `gl.clear` に相当するのは `renderPassDescriptor` の `loadOp: 'clear'` / `clearValue`。記録→submit の詳細は `01_webgpu-fundamentals` を参照。

### 描画呼び出しと topology の対応

WebGL の `drawArrays` / `drawElements` は、**第1引数に topology（`gl.TRIANGLES` など）を持っていた**。

```javascript
gl.drawArrays(gl.TRIANGLES, 0, count);
//            ^topology
```

WebGPU ではこの topology が描画呼び出しから切り離され、パイプライン側に固定される。`draw()` / `drawIndexed()` には繋ぎ方の情報はもう無い。

```javascript
primitive: { topology: 'triangle-list' }  // 繋ぎ方はパイプラインに固定
pass.draw(count);                          // 実行だけ
```

| | WebGL | WebGPU |
| --- | --- | --- |
| 繋ぎ方（三角形/線/点） | `drawArrays`/`drawElements` の第1引数 | パイプラインの `primitive.topology` |
| インデックスなし（順番通り） | `gl.drawArrays()` | `pass.draw()` |
| インデックスあり（並び順を指定） | `gl.drawElements()` | `pass.drawIndexed()` |

インデックスバッファは「同じ頂点を使い回す」仕組み。四角形（三角形2枚）は `triangle-list` だと頂点6個必要だが、インデックス `[0,1,2, 2,1,3]` を使えば頂点4個のまま繋ぐ順だけ指定でき、重複を減らせる。

---

## 座標空間

| | WebGL | WebGPU |
| --- | --- | --- |
| Z クリップ範囲 | `-1〜1` | `0〜1` |
| ビューポート座標の原点 | 左下 | 左上（Y が反転） |

WebGL の投影行列をそのまま使うと Z 範囲が合わずクリップされる／深度が反転する。プロジェクション行列側で `0〜1` に合わせる。

### 座標変換の流れ

1. **モデル空間** … オブジェクト自身を原点とするローカル座標系。

> ↓ モデル座標変換 （頂点シェーダ）

2. **ワールド空間** … モデル行列（平行移動・回転・スケール）を掛け、シーン共通の原点へ。

> ↓ ビュー座標変換 （頂点シェーダ）

3. **ビュー空間** … ビュー行列（カメラ位置・向きの逆変換）を掛け、カメラを原点にした座標系へ。

> ↓ 投影変換 （頂点シェーダ）

4. **クリップ空間** … プロジェクション行列（透視投影 or 正射影）を掛けた直後の座標系。頂点シェーダの出力（gl_Position）はここ。

> ↓ クリッピング （固定機能パイプラインの処理）

> ↓ パースペクティブ除算 （固定機能パイプラインの処理／÷w）

5. **NDC** … クリップ空間の (x, y, z, w) を w で割った（パースペクティブ除算した）結果。
    - w は透視除算前のスケール因子。遠い頂点ほど w が大きくなるよう投影行列が作られており、割ることで「遠いものは小さく見える」効果になる。

> ↓ ビューポート変換 （固定機能パイプラインの処理）

6. **スクリーン空間** … NDC をピクセル座標にマッピングした最終結果（ただしまだ「頂点」のまま）。フレームバッファ座標の原点は WebGL が左下・WebGPU が左上（NDC 自体は y 上向きで共通）。

> ↓ ラスタライズ

> ↓ テクスチャマッピングなど （フラグメントシェーダ）

> ↓ カラー合成など

> ↓ ディスプレイへ

---

## 複数オブジェクトの描画

- WebGL … グローバル状態なので、ユニフォームを書き換えて `drawElements` を繰り返せばよい
- WebGPU … オブジェクトごとにユニフォームが異なるなら、オブジェクトごとにユニフォームバッファとバインドグループを用意する

WebGL アプリをそのまま1対1で移植すると遅くなることがある。データの持ち方や描画のまとめ方を WebGPU 向けに変える必要がある（元記事の注意書き）。

---

## その他の細かい違い

- **キャンバス管理**：WebGL は深度バッファ等を自動管理。WebGPU は自分で作成・リサイズする（1デバイスで複数キャンバスに描画可）。
- **ミップマップ**：WebGL は `gl.generateMipmap()`。WebGPU は相当関数がなく自前生成。
- **リソースのサイズ変更**：WebGL はいつでも再割り当て可。WebGPU はサイズ・`usage`・フォーマットが不変で、変えたいなら作り直して `destroy()`。
- **点・線の太さ**：WebGL は指定できることがある。WebGPU は幅1pxのみで、太いものは三角形で自作。
