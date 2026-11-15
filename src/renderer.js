import {
  mat3FromMat4,
  mat4Multiply,
  mat4RotationX,
  mat4RotationY,
  mat4Translation,
} from "./math.js";
import {
  buildCore,
  buildLineField,
  buildStructures,
  buildTerrain,
} from "./geometry.js";
import {
  lineFragmentShader,
  lineVertexShader,
  skyFragmentShader,
  skyVertexShader,
  surfaceFragmentShader,
  surfaceVertexShader,
} from "./shaders.js";

const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

const SURFACE_ATTRIBUTES = [
  { name: "aPosition", size: 3, offset: 0 },
  { name: "aNormal", size: 3, offset: 3 },
  { name: "aUv", size: 2, offset: 6 },
];

const SURFACE_UNIFORMS = [
  "uProjection",
  "uView",
  "uModel",
  "uNormalMatrix",
  "uTexture",
  "uTint",
  "uEmissiveColor",
  "uCameraPosition",
  "uTime",
  "uEmissive",
  "uTexScale",
  "uOpacity",
];

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("无法创建着色器对象");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "未知着色器错误";
    gl.deleteShader(shader);
    throw new Error(`着色器编译失败：${log}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  if (!program) {
    throw new Error("无法创建着色器程序");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "未知链接错误";
    gl.deleteProgram(program);
    throw new Error(`着色器程序链接失败：${log}`);
  }
  return program;
}

function collectUniforms(gl, program, names) {
  return Object.fromEntries(
    names.map((name) => [name, gl.getUniformLocation(program, name)]),
  );
}

function createSurfaceMesh(gl, program, geometry) {
  const vao = gl.createVertexArray();
  const vertexBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();

  if (!vao || !vertexBuffer || !indexBuffer) {
    throw new Error("无法创建网格 GPU 缓冲");
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW);

  const stride = SURFACE_ATTRIBUTES.reduce((sum, attribute) => sum + attribute.size, 0) * 4;
  for (const attribute of SURFACE_ATTRIBUTES) {
    const location = gl.getAttribLocation(program, attribute.name);
    if (location < 0) {
      throw new Error(`着色器缺少顶点属性 ${attribute.name}`);
    }
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(
      location,
      attribute.size,
      gl.FLOAT,
      false,
      stride,
      attribute.offset * 4,
    );
  }

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  return {
    vao,
    vertexBuffer,
    indexBuffer,
    indexCount: geometry.indexCount,
  };
}

function createProceduralTexture(gl) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("无法创建程序纹理画布");
  }

  const gradient = context.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, "#183c3d");
  gradient.addColorStop(0.48, "#0a2028");
  gradient.addColorStop(1, "#18302e");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  context.strokeStyle = "rgba(111, 233, 211, 0.12)";
  context.lineWidth = 1;
  for (let position = 0; position <= 512; position += 16) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, 512);
    context.stroke();
    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(512, position);
    context.stroke();
  }

  context.strokeStyle = "rgba(137, 255, 230, 0.42)";
  context.lineWidth = 2;
  for (let position = 0; position <= 512; position += 128) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, 512);
    context.stroke();
    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(512, position);
    context.stroke();
  }

  context.fillStyle = "rgba(230, 255, 247, 0.8)";
  context.font = "10px monospace";
  context.fillText("OA-07 // SURFACE MAP // RECOVERABLE", 22, 34);
  context.fillStyle = "rgba(120, 245, 219, 0.3)";
  for (let row = 0; row < 12; row += 1) {
    const value = ((row * 73) % 255).toString(2).padStart(8, "0");
    context.fillText(value, 22, 62 + row * 13);
  }

  context.fillStyle = "rgba(255, 180, 94, 0.65)";
  for (let index = 0; index < 9; index += 1) {
    context.fillRect(376 + index * 12, 464, 5, 5 + (index % 3) * 8);
  }

  const texture = gl.createTexture();
  if (!texture) {
    throw new Error("无法创建纹理对象");
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic");
  if (anisotropy) {
    const max = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(
      gl.TEXTURE_2D,
      anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
      Math.min(8, max),
    );
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  return texture;
}

function createSkyMesh(gl, program) {
  const vao = gl.createVertexArray();
  const vertexBuffer = gl.createBuffer();
  if (!vao || !vertexBuffer) {
    throw new Error("无法创建背景网格缓冲");
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );

  const location = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, vertexBuffer, count: 3 };
}

function createLineMesh(gl, program, geometry) {
  const vao = gl.createVertexArray();
  const vertexBuffer = gl.createBuffer();
  if (!vao || !vertexBuffer) {
    throw new Error("无法创建轨道线缓冲");
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  return {
    vao,
    vertexBuffer,
    ranges: geometry.ranges,
  };
}

export class SceneRenderer {
  constructor(canvas, camera, callbacks = {}) {
    this.canvas = canvas;
    this.camera = camera;
    this.callbacks = callbacks;
    this.gl = null;
    this.resources = null;
    this.generation = 0;
    this.contextLost = false;
    this.loseContextExtension = null;
    this.pixelWidth = 0;
    this.pixelHeight = 0;
    this.renderCalls = 0;
    this.lastFrameSample = null;

    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
  }

  handleContextLost = (event) => {
    event.preventDefault();
    this.contextLost = true;
    this.callbacks.onContextLost?.({
      generation: this.generation,
      renderCalls: this.renderCalls,
    });
  };

  handleContextRestored = () => {
    try {
      const gl = this.canvas.getContext("webgl2");
      if (!gl) {
        throw new Error("恢复后无法取得 WebGL2 上下文");
      }
      this.gl = gl;
      this.contextLost = false;
      this.loseContextExtension = gl.getExtension("WEBGL_lose_context");
      this.rebuildResources();
      this.callbacks.onContextRestored?.({
        generation: this.generation,
        resources: this.resourceSummary(),
      });
    } catch (error) {
      this.callbacks.onContextRestoreFailed?.(error);
    }
  };

  initialize() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      throw new Error("WebGL2 不可用");
    }

    this.gl = gl;
    this.loseContextExtension = gl.getExtension("WEBGL_lose_context");
    this.rebuildResources();
    return this;
  }

  rebuildResources() {
    if (!this.gl) {
      throw new Error("WebGL2 上下文不存在");
    }
    this.resources = this.createResources();
    this.generation += 1;
    this.pixelWidth = 0;
    this.pixelHeight = 0;
    return this.resources;
  }

  resourceSummary() {
    if (!this.resources) {
      return { programs: 0, buffers: 0, vertexArrays: 0, textures: 0 };
    }
    return this.resources.summary;
  }

  createResources() {
    const gl = this.gl;
    const surfaceProgram = createProgram(
      gl,
      surfaceVertexShader,
      surfaceFragmentShader,
    );
    const skyProgram = createProgram(gl, skyVertexShader, skyFragmentShader);
    const lineProgram = createProgram(gl, lineVertexShader, lineFragmentShader);

    const surface = {
      program: surfaceProgram,
      uniforms: collectUniforms(gl, surfaceProgram, SURFACE_UNIFORMS),
      terrain: createSurfaceMesh(gl, surfaceProgram, buildTerrain()),
      structures: createSurfaceMesh(gl, surfaceProgram, buildStructures()),
      core: createSurfaceMesh(gl, surfaceProgram, buildCore()),
    };
    const sky = {
      program: skyProgram,
      uniforms: collectUniforms(gl, skyProgram, ["uResolution", "uTime"]),
      mesh: createSkyMesh(gl, skyProgram),
    };
    const lines = {
      program: lineProgram,
      uniforms: collectUniforms(gl, lineProgram, [
        "uProjection",
        "uView",
        "uTime",
        "uColor",
        "uIntensity",
      ]),
      mesh: createLineMesh(gl, lineProgram, buildLineField()),
    };
    const texture = createProceduralTexture(gl);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearColor(0.018, 0.051, 0.064, 1);

    return {
      surface,
      sky,
      lines,
      texture,
      summary: {
        programs: 3,
        buffers: 8,
        vertexArrays: 5,
        textures: 1,
      },
    };
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (width === this.pixelWidth && height === this.pixelHeight) {
      return false;
    }

    this.pixelWidth = width;
    this.pixelHeight = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
    return true;
  }

  drawSurface(mesh, model, options) {
    const gl = this.gl;
    const { program, uniforms } = this.resources.surface;
    const camera = this.frameCamera;

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.uProjection, false, camera.projection);
    gl.uniformMatrix4fv(uniforms.uView, false, camera.view);
    gl.uniformMatrix4fv(uniforms.uModel, false, model);
    gl.uniformMatrix3fv(uniforms.uNormalMatrix, false, mat3FromMat4(model));
    gl.uniform3fv(uniforms.uCameraPosition, camera.eye);
    gl.uniform1f(uniforms.uTime, this.frameTime);
    gl.uniform3fv(uniforms.uTint, options.tint);
    gl.uniform3fv(uniforms.uEmissiveColor, options.emissiveColor);
    gl.uniform1f(uniforms.uEmissive, options.emissive);
    gl.uniform1f(uniforms.uTexScale, options.textureScale);
    gl.uniform1f(uniforms.uOpacity, options.opacity ?? 1);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.resources.texture);
    gl.uniform1i(uniforms.uTexture, 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
  }

  render(elapsedSeconds) {
    const gl = this.gl;
    if (!gl || this.contextLost || gl.isContextLost() || !this.resources) {
      return false;
    }

    this.resize();
    this.frameTime = elapsedSeconds;
    this.frameCamera = this.camera.matrices(this.pixelWidth / this.pixelHeight);
    const camera = this.frameCamera;
    const { sky, lines, surface } = this.resources;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.useProgram(sky.program);
    gl.uniform2f(sky.uniforms.uResolution, this.pixelWidth, this.pixelHeight);
    gl.uniform1f(sky.uniforms.uTime, elapsedSeconds);
    gl.bindVertexArray(sky.mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, sky.mesh.count);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    this.drawSurface(surface.terrain, IDENTITY_MATRIX, {
      tint: [0.15, 0.31, 0.3],
      emissiveColor: [0.08, 0.42, 0.35],
      emissive: 0.16,
      textureScale: 9,
    });
    this.drawSurface(surface.structures, IDENTITY_MATRIX, {
      tint: [0.24, 0.39, 0.4],
      emissiveColor: [0.3, 0.9, 0.78],
      emissive: 0.2,
      textureScale: 1.2,
    });

    const coreModel = mat4Multiply(
      mat4Translation(0, 2.48, 0),
      mat4Multiply(
        mat4RotationY(elapsedSeconds * 0.42),
        mat4RotationX(-0.14 + Math.sin(elapsedSeconds * 0.3) * 0.08),
      ),
    );
    this.drawSurface(surface.core, coreModel, {
      tint: [0.72, 0.4, 0.17],
      emissiveColor: [1, 0.49, 0.12],
      emissive: 1.45,
      textureScale: 2.8,
    });

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(lines.program);
    gl.uniformMatrix4fv(lines.uniforms.uProjection, false, camera.projection);
    gl.uniformMatrix4fv(lines.uniforms.uView, false, camera.view);
    gl.uniform1f(lines.uniforms.uTime, elapsedSeconds);
    gl.bindVertexArray(lines.mesh.vao);

    const lineStyles = [
      { color: [0.45, 1, 0.88], intensity: 0.9 },
      { color: [0.4, 0.92, 0.82], intensity: 0.7 },
      { color: [0.2, 0.55, 0.52], intensity: 0.52 },
      { color: [0.2, 0.55, 0.52], intensity: 0.42 },
      { color: [0.22, 0.72, 0.64], intensity: 0.42 },
    ];
    lines.mesh.ranges.forEach((range, index) => {
      const style = lineStyles[index] || lineStyles[lineStyles.length - 1];
      gl.uniform3fv(lines.uniforms.uColor, style.color);
      gl.uniform1f(lines.uniforms.uIntensity, style.intensity);
      gl.drawArrays(gl[range.mode], range.first, range.count);
    });

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    this.renderCalls += 1;
    return true;
  }

  sampleFrame() {
    const gl = this.gl;
    if (!gl || this.contextLost || gl.isContextLost()) {
      return null;
    }

    const points = [
      [0.5, 0.5],
      [0.31, 0.56],
      [0.72, 0.62],
      [0.16, 0.76],
    ];
    const pixel = new Uint8Array(4);
    let maxChannel = 0;

    for (const [x, y] of points) {
      gl.readPixels(
        Math.floor(this.pixelWidth * x),
        Math.floor(this.pixelHeight * y),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      maxChannel = Math.max(maxChannel, pixel[0], pixel[1], pixel[2]);
    }

    this.lastFrameSample = {
      maxChannel,
      nonBlack: maxChannel >= 24,
    };
    return this.lastFrameSample;
  }

  simulateLoss() {
    if (!this.gl || this.contextLost || this.gl.isContextLost()) {
      return false;
    }
    const extension =
      this.gl.getExtension("WEBGL_lose_context") || this.loseContextExtension;
    if (!extension) {
      throw new Error("当前浏览器不支持 WEBGL_lose_context");
    }
    this.loseContextExtension = extension;
    extension.loseContext();
    return true;
  }

  requestRestore() {
    if (!this.gl || (!this.contextLost && !this.gl.isContextLost())) {
      return false;
    }
    const extension =
      this.loseContextExtension ||
      this.gl.getExtension("WEBGL_lose_context");
    if (!extension) {
      throw new Error("丢失后无法取得 WEBGL_lose_context");
    }
    this.loseContextExtension = extension;
    extension.restoreContext();
    return true;
  }
}
