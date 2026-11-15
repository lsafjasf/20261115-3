/* WebGL1 渲染器：盒体 + 圆管，深度测试保证遮挡顺序，片元 discard 实现剖切 */
(function (global) {
  'use strict';

  const VERT = `
    attribute vec3 aPos;
    attribute vec3 aNormal;
    attribute vec3 aColor;
    uniform mat4 uView;
    uniform mat4 uProj;
    uniform mat4 uModel;
    varying vec3 vNormal;
    varying vec3 vColor;
    varying vec3 vWorld;
    void main() {
      vWorld = aPos;
      vNormal = aNormal;
      vColor = aColor;
      gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
    }`;

  const FRAG = `
    precision mediump float;
    varying vec3 vNormal;
    varying vec3 vColor;
    varying vec3 vWorld;
    uniform vec3 uLightDir;
    uniform vec3 uCamPos;
    uniform vec4 uClipPlane;   // xyz: 法线, w: 高度（法线·点 > w 的片元被裁掉）
    uniform int uClipEnabled;
    uniform float uSelected;
    uniform float uAlpha;
    uniform vec3 uTint;
    void main() {
      if (uClipEnabled == 1) {
        if (dot(uClipPlane.xyz, vWorld) > uClipPlane.w) discard;
      }
      vec3 n = normalize(vNormal);
      float diff = max(dot(n, normalize(uLightDir)), 0.0);
      vec3 viewDir = normalize(uCamPos - vWorld);
      float amb = 0.42;
      vec3 col = vColor * uTint * (amb + 0.62 * diff);
      float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.0) * 0.18;
      col += vec3(rim);
      if (uSelected > 0.5) col = mix(col, vec3(1.0, 0.95, 0.4), 0.45);
      gl_FragColor = vec4(col, uAlpha);
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s));
    }
    return s;
  }

  /* 盒体网格：位置 + 法线 + 颜色，24 顶点 36 索引 */
  function boxMesh(min, max, color) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const c = color;
    const faces = [
      { n: [1, 0, 0], q: [[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]] },
      { n: [-1, 0, 0], q: [[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]] },
      { n: [0, 1, 0], q: [[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]] },
      { n: [0, -1, 0], q: [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]] },
      { n: [0, 0, 1], q: [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]] },
      { n: [0, 0, -1], q: [[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]] }
    ];
    const positions = [], normals = [], colors = [];
    faces.forEach(f => {
      f.q.forEach(p => {
        positions.push(p[0], p[1], p[2]);
        normals.push(f.n[0], f.n[1], f.n[2]);
        colors.push(c[0], c[1], c[2]);
      });
    });
    const indices = [];
    for (let f = 0; f < 6; f++) {
      const o = f * 4;
      indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    return { positions, normals, colors, indices };
  }

  function mergeBoxes(boxes) {
    const positions = [], normals = [], colors = [], indices = [];
    let offset = 0;
    boxes.forEach(b => {
      const m = boxMesh(b.min, b.max, b.color);
      positions.push(...m.positions); normals.push(...m.normals); colors.push(...m.colors);
      m.indices.forEach(i => indices.push(i + offset));
      offset += m.positions.length / 3;
    });
    return { positions, normals, colors, indices };
  }

  function Renderer(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true })
      || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('当前环境不支持 WebGL');
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;
    this.loc = {
      pos: gl.getAttribLocation(prog, 'aPos'),
      normal: gl.getAttribLocation(prog, 'aNormal'),
      color: gl.getAttribLocation(prog, 'aColor'),
      view: gl.getUniformLocation(prog, 'uView'),
      proj: gl.getUniformLocation(prog, 'uProj'),
      model: gl.getUniformLocation(prog, 'uModel'),
      light: gl.getUniformLocation(prog, 'uLightDir'),
      cam: gl.getUniformLocation(prog, 'uCamPos'),
      clip: gl.getUniformLocation(prog, 'uClipPlane'),
      clipEn: gl.getUniformLocation(prog, 'uClipEnabled'),
      selected: gl.getUniformLocation(prog, 'uSelected'),
      alpha: gl.getUniformLocation(prog, 'uAlpha')
      ,tint: gl.getUniformLocation(prog, 'uTint')
    };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this.meshes = [];
  }

  Renderer.prototype.upload = function (data, tag) {
    const gl = this.gl;
    const mesh = {
      tag, count: (data.indices ? data.indices.length : data.positions.length / 3),
      indexed: !!data.indices
    };
    mesh.pos = makeBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(data.positions));
    mesh.nrm = makeBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(data.normals));
    mesh.col = makeBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(data.colors));
    if (data.indices) {
      mesh.idx = makeBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices));
    }
    this.meshes.push(mesh);
    return this.meshes.length - 1;
  };

  function makeBuffer(gl, target, data) {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  }

  Renderer.prototype.beginFrame = function (view, proj, camPos, clip) {
    const gl = this.gl, L = this.loc;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.055, 0.085, 0.145, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(L.view, false, view);
    gl.uniformMatrix4fv(L.proj, false, proj);
    gl.uniformMatrix4fv(L.model, false, M3D.mat4Identity());
    gl.uniform3fv(L.light, new Float32Array([0.5, 1.0, 0.35]));
    gl.uniform3fv(L.cam, new Float32Array(camPos));
    this._clipEnabled = clip.enabled ? 1 : 0;
    gl.uniform1i(L.clipEn, this._clipEnabled);
    gl.uniform4fv(L.clip, new Float32Array(clip.plane));
    gl.uniform1f(L.alpha, 1);
    gl.uniform3fv(L.tint, new Float32Array([1, 1, 1]));
    gl.depthMask(true);
  };

  Renderer.prototype.draw = function (meshId, selected, model) {
    const gl = this.gl, L = this.loc, m = this.meshes[meshId];
    gl.uniformMatrix4fv(L.model, false, model || M3D.mat4Identity());
    gl.uniform1f(L.selected, selected ? 1 : 0);
    bindAttr(gl, L.pos, m.pos, 3);
    bindAttr(gl, L.normal, m.nrm, 3);
    bindAttr(gl, L.color, m.col, 3);
    if (m.indexed) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    }
  };

  Renderer.prototype.drawTransparent = function (meshId, alpha, model) {
    const gl = this.gl, L = this.loc, m = this.meshes[meshId];
    gl.uniformMatrix4fv(L.model, false, model || M3D.mat4Identity());
    gl.uniform3fv(L.tint, new Float32Array(this._tint || [1, 1, 1]));
    gl.uniform1i(L.clipEn, 0);
    gl.uniform1f(L.selected, 0);
    gl.uniform1f(L.alpha, alpha);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    bindAttr(gl, L.pos, m.pos, 3);
    bindAttr(gl, L.normal, m.nrm, 3);
    bindAttr(gl, L.color, m.col, 3);
    if (m.indexed) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.uniform1f(L.alpha, 1);
    gl.uniform3fv(L.tint, new Float32Array([1, 1, 1]));
    gl.uniform1i(L.clipEn, this._clipEnabled ? 1 : 0);
  };

  Renderer.prototype.setTint = function (tint) {
    this._tint = tint;
    this.gl.uniform3fv(this.loc.tint, new Float32Array(tint));
  };

  function bindAttr(gl, loc, buf, size) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  global.GL = { Renderer, boxMesh, mergeBoxes };
})(window);
