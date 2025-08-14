// Post composition module: per-layer FBOs and fullscreen composite

let layerFbos = null, layerTexs = null, layerDepth = null;
let RES_SCALE_POST = 1.0;
let LAYERS_POST = 1;

let quadProgPost = null, quadLocPost = null, fsVaoPost = null, fsVboPost = null;
let cardProgPost = null, cardLocPost = null;

function ensureFullscreenGeomPost(gl){
  if(fsVaoPost) return;
  fsVaoPost = gl.createVertexArray();
  fsVboPost = gl.createBuffer();
  gl.bindVertexArray(fsVaoPost);
  gl.bindBuffer(gl.ARRAY_BUFFER, fsVboPost);
  const verts = new Float32Array([
    -1,-1, 0,0,
     1,-1, 1,0,
    -1, 1, 0,1,
     1, 1, 1,1,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
}

function compilePost(gl, type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ console.error(gl.getShaderInfoLog(s)); throw new Error('post compile'); } return s; }
function linkPost(gl, vs, fs){ const p=gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,fs); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)){ console.error(gl.getProgramInfoLog(p)); throw new Error('post link'); } return p; }

function initQuadProgramPost(gl){
  if(quadProgPost) return;
  const VSQ = `#version 300 es\nlayout(location=0) in vec2 a_pos;\nlayout(location=1) in vec2 a_uv;\nout vec2 v_uv;\nvoid main(){ v_uv = a_uv; gl_Position = vec4(a_pos,0.0,1.0); }`;
  const FSQ = `#version 300 es\nprecision highp float;\n\nin vec2 v_uv;\n\nuniform sampler2D u_tex;\nuniform vec2 u_texel;      // 1/textureSize in pixels\nuniform float u_edgePx;    // outline width in px (texture space)\n\nout vec4 o_color;\n\nvoid main(){\n  vec4 base = texture(u_tex, v_uv);\n  float a = base.a;\n  vec2 o = u_texel * u_edgePx;\n  float a1 = texture(u_tex, v_uv + vec2( o.x, 0.0)).a;\n  float a2 = texture(u_tex, v_uv + vec2(-o.x, 0.0)).a;\n  float a3 = texture(u_tex, v_uv + vec2(0.0,  o.y)).a;\n  float a4 = texture(u_tex, v_uv + vec2(0.0, -o.y)).a;\n  float a5 = texture(u_tex, v_uv + vec2( o.x,  o.y)).a;\n  float a6 = texture(u_tex, v_uv + vec2(-o.x,  o.y)).a;\n  float a7 = texture(u_tex, v_uv + vec2( o.x, -o.y)).a;\n  float a8 = texture(u_tex, v_uv + vec2(-o.x, -o.y)).a;\n  float nmax = max(max(max(a1,a2),max(a3,a4)), max(max(a5,a6), max(a7,a8)));\n  float isEdgeOutside = step(a, 0.05) * step(0.05, nmax); // outside but near filled texel\n  vec4 outline = vec4(0.0, 0.0, 0.0, 1.0);\n  o_color = mix(base, outline, isEdgeOutside);\n}`;
  quadProgPost = linkPost(gl, compilePost(gl, gl.VERTEX_SHADER, VSQ), compilePost(gl, gl.FRAGMENT_SHADER, FSQ));
  quadLocPost = { u_tex: gl.getUniformLocation(quadProgPost, 'u_tex'), u_texel: gl.getUniformLocation(quadProgPost, 'u_texel'), u_edgePx: gl.getUniformLocation(quadProgPost, 'u_edgePx') };
}

function createLayerTargets(gl, canvasWidth, canvasHeight, layers, resScale){
  LAYERS_POST = layers; RES_SCALE_POST = resScale;
  const rw = Math.max(1, Math.floor(canvasWidth * resScale));
  const rh = Math.max(1, Math.floor(canvasHeight * resScale));
  if(!layerFbos) layerFbos = new Array(layers);
  if(!layerTexs) layerTexs = new Array(layers);
  if(!layerDepth) layerDepth = new Array(layers);
  for(let i=0;i<layers;i++){
    if(layerTexs[i]){ gl.deleteTexture(layerTexs[i]); layerTexs[i]=null; }
    if(layerDepth[i]){ gl.deleteRenderbuffer(layerDepth[i]); layerDepth[i]=null; }
    if(layerFbos[i]){ gl.deleteFramebuffer(layerFbos[i]); layerFbos[i]=null; }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, rw, rh);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    layerTexs[i] = tex; layerDepth[i] = rb; layerFbos[i] = fbo;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function bindLayerFbo(gl, i){ gl.bindFramebuffer(gl.FRAMEBUFFER, layerFbos[i]); }

function drawLayersFullscreen(gl, canvasWidth, canvasHeight, passes){
  ensureFullscreenGeomPost(gl); initQuadProgramPost(gl);
  gl.useProgram(quadProgPost);
  gl.bindVertexArray(fsVaoPost);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const texelX = 1.0 / (canvasWidth * RES_SCALE_POST);
  const texelY = 1.0 / (canvasHeight * RES_SCALE_POST);
  gl.uniform2f(quadLocPost.u_texel, texelX, texelY);
  gl.uniform1f(quadLocPost.u_edgePx, 1.5);
  for(let i=passes-1;i>=0;i--){
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layerTexs[i]);
    gl.uniform1i(quadLocPost.u_tex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  gl.disable(gl.BLEND);
}

function initCardProgramPost(gl){
  if(cardProgPost) return;
  const VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
out vec2 v_uv;
uniform vec2 u_viewport; // pixels
uniform vec4 u_rect;     // x,y,w,h in pixels
uniform vec2 u_tilt;     // tiltX (rad, about X), tiltY (rad, about Y)

vec2 project(vec2 local){
  // local in [-0.5,0.5] range
  vec3 p = vec3(local.x * u_rect.z, -local.y * u_rect.w, 0.0);
  float cx = cos(u_tilt.x), sx = sin(u_tilt.x);
  float cy = cos(u_tilt.y), sy = sin(u_tilt.y);
  // rotate around Y then X
  vec3 ry = vec3(cy*p.x + sy*p.z, p.y, -sy*p.x + cy*p.z);
  vec3 rx = vec3(ry.x, cx*ry.y - sx*ry.z, sx*ry.y + cx*ry.z);
  float zCam = 800.0; // pseudo camera distance for perspective
  float persp = zCam / (zCam - rx.z);
  vec2 p2 = rx.xy * persp;
  vec2 center = vec2(u_rect.x + u_rect.z*0.5, u_rect.y + u_rect.w*0.5);
  vec2 px = center + p2;
  // to NDC
  vec2 ndc = vec2((px.x / u_viewport.x) * 2.0 - 1.0, 1.0 - (px.y / u_viewport.y) * 2.0);
  return ndc;
}

void main(){
  v_uv = a_uv;
  vec2 local = a_pos * 0.5; // [-1,1] -> [-0.5,0.5]
  vec2 ndc = project(local);
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

  const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_uvOffset; // parallax offset in UV space
 uniform vec2 u_texel;   // 1/texture size
 uniform float u_edgePx; // outline width in px
out vec4 o_color;
void main(){
  vec2 uv = v_uv + u_uvOffset;
  vec4 base = texture(u_tex, uv);
  float a = base.a;
  vec2 o = u_texel * u_edgePx;
  float a1 = texture(u_tex, uv + vec2( o.x, 0.0)).a;
  float a2 = texture(u_tex, uv + vec2(-o.x, 0.0)).a;
  float a3 = texture(u_tex, uv + vec2(0.0,  o.y)).a;
  float a4 = texture(u_tex, uv + vec2(0.0, -o.y)).a;
  float a5 = texture(u_tex, uv + vec2( o.x,  o.y)).a;
  float a6 = texture(u_tex, uv + vec2(-o.x,  o.y)).a;
  float a7 = texture(u_tex, uv + vec2( o.x, -o.y)).a;
  float a8 = texture(u_tex, uv + vec2(-o.x, -o.y)).a;
  float nmax = max(max(max(a1,a2),max(a3,a4)), max(max(a5,a6), max(a7,a8)));
  float isEdgeOutside = step(a, 0.05) * step(0.05, nmax);
  vec4 outline = vec4(0.0, 0.0, 0.0, 1.0);
  o_color = mix(base, outline, isEdgeOutside);
}`;

  const v = compilePost(gl, gl.VERTEX_SHADER, VS);
  const f = compilePost(gl, gl.FRAGMENT_SHADER, FS);
  cardProgPost = linkPost(gl, v, f);
  cardLocPost = {
    u_tex: gl.getUniformLocation(cardProgPost, 'u_tex'),
    u_viewport: gl.getUniformLocation(cardProgPost, 'u_viewport'),
    u_rect: gl.getUniformLocation(cardProgPost, 'u_rect'),
    u_tilt: gl.getUniformLocation(cardProgPost, 'u_tilt'),
    u_uvOffset: gl.getUniformLocation(cardProgPost, 'u_uvOffset'),
    u_texel: gl.getUniformLocation(cardProgPost, 'u_texel'),
    u_edgePx: gl.getUniformLocation(cardProgPost, 'u_edgePx'),
  };
}

function drawDioramaCard(gl, viewportW, viewportH, passes, opts){
  if(!layerTexs) return;
  ensureFullscreenGeomPost(gl); initCardProgramPost(gl);
  gl.useProgram(cardProgPost);
  gl.bindVertexArray(fsVaoPost);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  gl.uniform2f(cardLocPost.u_viewport, viewportW, viewportH);
  gl.uniform4f(cardLocPost.u_rect, opts.x|0, opts.y|0, Math.max(1, opts.w|0), Math.max(1, opts.h|0));
  gl.uniform2f(cardLocPost.u_tilt, opts.tiltX||0, opts.tiltY||0);

  const depth = opts.depth || 0.12; // UV parallax scale
  const texelX = 1.0 / (viewportW * RES_SCALE_POST);
  const texelY = 1.0 / (viewportH * RES_SCALE_POST);
  gl.uniform2f(cardLocPost.u_texel, texelX, texelY);
  gl.uniform1f(cardLocPost.u_edgePx, 1.5);
  for(let i=passes-1;i>=0;i--){
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layerTexs[i]);
    gl.uniform1i(cardLocPost.u_tex, 0);
    const t = passes<=1 ? 0.0 : (i/(passes-1)); // 0..1 far->near
    const dz = (t - 0.5) * 2.0; // -1..1 centered
    const offX = -(opts.tiltY||0) * depth * dz;
    const offY =  (opts.tiltX||0) * depth * dz;
    gl.uniform2f(cardLocPost.u_uvOffset, offX, offY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  gl.disable(gl.BLEND);

  // Optional scissor clip to mirror bounds in device pixels
  if(opts && opts.clip){
    // Use scissor around subsequent draws if any; here, none. Reserved for future decorations.
  }
}

// Export API
window.postCreateLayerTargets = createLayerTargets;
window.postBindLayerFbo = bindLayerFbo;
window.postDrawLayersFullscreen = drawLayersFullscreen;
window.postDrawDioramaCard = drawDioramaCard;


