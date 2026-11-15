/*
 * 七段骨骼核心：父子层级、前向运动学(FK)、关节拖拽、序列化。
 * 同一份代码在浏览器(全局 SKELETON_NS)与 Node(module.exports)中均可运行。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SKELETON_NS = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TAU = Math.PI * 2;

  function normAngle(a) {
    let x = a % TAU;
    if (x > Math.PI) x -= TAU;
    if (x < -Math.PI) x += TAU;
    return x;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // 沿角度插值时取最短弧，保证 -PI/PI 跨越处连续。
  function lerpAngle(a, b, t) {
    return a + normAngle(b - a) * t;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  class Bone {
    constructor(cfg) {
      this.id = cfg.id;
      this.name = cfg.name;
      this.parent = cfg.parent || null;
      this.length = cfg.length;
      this.restAngle = cfg.restAngle || 0; // 相对父骨的静止局部角
      this.color = cfg.color || "#4fa3ff";
      this.skin = cfg.skin || {}; // 皮肤宽度(px)
    }
  }

  class Skeleton {
    // bones: 按父子顺序排列的 Bone 配置；rootX/rootY 为根(骨盆)世界坐标
    constructor(boneConfigs, rootX, rootY) {
      this.rootX = rootX;
      this.rootY = rootY;
      this.bones = new Map();
      this.order = [];
      this.localRot = new Map(); // id -> 相对静止姿态的局部旋转增量
      for (const cfg of boneConfigs) {
        this.addBone(new Bone(cfg));
      }
      this.validate();
    }

    addBone(bone) {
      if (this.bones.has(bone.id)) {
        throw new Error("重复骨骼 id: " + bone.id);
      }
      if (bone.parent && !this.bones.has(bone.parent)) {
        throw new Error("骨骼 " + bone.id + " 的父节点必须先于子节点声明");
      }
      this.bones.set(bone.id, bone);
      this.order.push(bone.id);
      this.localRot.set(bone.id, 0);
    }

    validate() {
      if (this.order.length === 0) throw new Error("骨架至少需要一根骨");
      const roots = this.order.filter((id) => !this.bones.get(id).parent);
      if (roots.length !== 1) {
        throw new Error("骨架必须且只能有一个根骨，当前为 " + roots.length);
      }
      for (const id of this.order) {
        const b = this.bones.get(id);
        if (!(b.length > 0)) throw new Error("骨骼 " + id + " 长度必须为正数");
        let p = b.parent;
        let guard = 0;
        while (p) {
          if (p === id) throw new Error("骨骼 " + id + " 存在循环父子关系");
          p = this.bones.get(p).parent;
          if (++guard > this.order.length) throw new Error("父子层级出现循环");
        }
      }
    }

    get rootId() {
      return this.order.find((id) => !this.bones.get(id).parent);
    }

    getBone(id) {
      const b = this.bones.get(id);
      if (!b) throw new Error("未知骨骼: " + id);
      return b;
    }

    setRotation(id, angle) {
      this.localRot.set(id, normAngle(angle));
    }

    getRotation(id) {
      return this.localRot.get(id) || 0;
    }

    // 由局部旋转增量计算所有骨骼的世界角度与首/末端世界坐标
    solve() {
      const out = new Map();
      for (const id of this.order) {
        const bone = this.getBone(id);
        const localAngle = bone.restAngle + this.getRotation(id);
        let worldAngle;
        let sx;
        let sy;
        if (!bone.parent) {
          worldAngle = localAngle;
          sx = this.rootX;
          sy = this.rootY;
        } else {
          const parent = out.get(bone.parent);
          worldAngle = parent.worldAngle + localAngle;
          sx = parent.ex;
          sy = parent.ey;
        }
        const ex = sx + Math.cos(worldAngle) * bone.length;
        const ey = sy + Math.sin(worldAngle) * bone.length;
        out.set(id, {
          id,
          sx,
          sy,
          ex,
          ey,
          worldAngle,
          localAngle,
          length: bone.length,
        });
      }
      return out;
    }

    // 关节手柄：每根骨的末端；另加根骨起点(骨盆)
    handles(solved) {
      const list = [{ id: "__root__", boneId: this.rootId, x: this.rootX, y: this.rootY }];
      for (const id of this.order) {
        const s = solved.get(id);
        list.push({ id: "end:" + id, boneId: id, x: s.ex, y: s.ey });
      }
      return list;
    }

    hitTest(x, y, solved, radius) {
      let best = null;
      let bestD = radius;
      for (const h of this.handles(solved)) {
        const d = Math.hypot(x - h.x, y - h.y);
        if (d <= bestD) {
          bestD = d;
          best = h;
        }
      }
      return best;
    }

    // 拖拽某个关节 -> 修改对应骨骼的局部旋转；骨长恒定，不会拉伸任何骨。
    // 拖根手柄仅平移整具骨架；拖末端只旋转该骨，父骨完全不受影响。
    dragTo(handle, worldX, worldY) {
      if (handle.id === "__root__") {
        this.rootX = worldX;
        this.rootY = worldY;
        return;
      }
      const boneId = handle.boneId;
      const bone = this.getBone(boneId);
      const solved = this.solve();
      let px;
      let py;
      let parentWorldAngle;
      if (!bone.parent) {
        px = this.rootX;
        py = this.rootY;
        parentWorldAngle = 0;
      } else {
        const p = solved.get(bone.parent);
        px = p.ex;
        py = p.ey;
        parentWorldAngle = p.worldAngle;
      }
      const targetWorld = Math.atan2(worldY - py, worldX - px);
      const local = normAngle(targetWorld - parentWorldAngle - bone.restAngle);
      this.setRotation(boneId, local);
    }

    // 以当前局部旋转生成一份姿态 { id: angle }
    pose() {
      const p = {};
      for (const id of this.order) p[id] = this.getRotation(id);
      return p;
    }

    applyPose(pose) {
      for (const id of this.order) {
        if (typeof pose[id] === "number") this.setRotation(id, pose[id]);
      }
    }

    toJSON() {
      return {
        format: "skeleton/v1",
        root: { x: this.rootX, y: this.rootY },
        bones: this.order.map((id) => {
          const b = this.getBone(id);
          return {
            id: b.id,
            name: b.name,
            parent: b.parent,
            length: b.length,
            restAngle: b.restAngle,
            color: b.color,
            skin: b.skin,
          };
        }),
      };
    }

    static fromJSON(json) {
      const sk = new Skeleton(json.bones, json.root.x, json.root.y);
      return sk;
    }
  }

  return { Bone, Skeleton, TAU, normAngle, lerp, lerpAngle, clamp };
});
