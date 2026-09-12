import { mat4 } from './mat4';
import type { TRS } from './TRS';

export class SceneGraphNode {
  name: string;
  children: SceneGraphNode[] = [];
  localMatrix = mat4.identity();
  worldMatrix = mat4.identity();
  parent: SceneGraphNode | null = null;
  source?: TRS;

  constructor(name: string, source?: TRS) {
    this.name = name;
    this.source = source;
  }

  addChild(child: SceneGraphNode) {
    child.setParent(this);
  }

  removeChild(child: SceneGraphNode) {
    child.setParent(null);
  }

  setParent(parent: SceneGraphNode | null) {
    // 今の親から自分を外す
    if (this.parent) {
      const ndx = this.parent.children.indexOf(this);
      if (ndx >= 0) {
        this.parent.children.splice(ndx, 1);
      }
    }
    // 新しい親に付ける
    if (parent) {
      parent.children.push(this);
    }
    this.parent = parent;
  }

  updateWorldMatrix() {
    // source があれば localMatrix を作り直す
    this.source?.getMatrix(this.localMatrix);

    if (this.parent) {
      // 親があれば 親のworldMatrix × localMatrix
      mat4.multiply(
        this.parent.worldMatrix,
        this.localMatrix,
        this.worldMatrix,
      );
    } else {
      // 親がなければ localMatrix をそのまま world にコピー
      mat4.copy(this.localMatrix, this.worldMatrix);
    }

    // 子へ再帰
    for (const child of this.children) {
      child.updateWorldMatrix();
    }
  }
}
