// Minimal equirectangular sky module for index.html
// Exposes: createSkyTexture(gl, img), drawSkyBackground(gl, aspect, fovy, getDir, canvas, SKYBOX_URL)

let skyProg = null;
let skyLoc = null;
let skyTex = null;
let fsVaoSky = null, fsVboSky = null;

function ensureFullscreenGeomSky(gl){
  if(fsVaoSky) return;
  fsVaoSky = gl.createVertexArray();
  fsVboSky = gl.createBuffer();
  gl.bindVertexArray(fsVaoSky);
  gl.bindBuffer(gl.ARRAY_BUFFER, fsVboSky);
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

function compileSky(gl, type, src){ const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ console.error(gl.getShaderInfoLog(s)); throw new Error('sky shader compile'); } return s; }
function linkSky(gl, vs, fs){ const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); if(!gl.getProgramParameter(p, gl.LINK_STATUS)){ console.error(gl.getProgramInfoLog(p)); throw new Error('sky link'); } return p; }

function initSkyProgram(gl){
  if(skyProg) return;
  const VSQ = `#version 300 es\nlayout(location=0) in vec2 a_pos;\nlayout(location=1) in vec2 a_uv;\nout vec2 v_uv;\nvoid main(){ v_uv = a_uv; gl_Position = vec4(a_pos,0.0,1.0); }`;
  // Note: flip Z in atan to match our -Z forward
  const FSS = `#version 300 es\nprecision highp float;\n\nin vec2 v_uv;\n\nuniform sampler2D u_sky;\nuniform vec3 u_right;\nuniform vec3 u_up;\nuniform vec3 u_forward;\nuniform float u_aspect;\nuniform float u_tanHalfFovY;\n\nout vec4 o_color;\n\nvoid main(){\n  vec2 ndc = v_uv * 2.0 - 1.0;\n  vec3 dirCam = normalize(vec3(ndc.x * u_aspect * u_tanHalfFovY, ndc.y * u_tanHalfFovY, -1.0));\n  vec3 dirWorld = normalize(u_right * dirCam.x + u_up * dirCam.y + u_forward * dirCam.z);\n  float pi = 3.14159265358979323846;\n  float theta = acos(clamp(dirWorld.y, -1.0, 1.0));
  float phi = atan(dirWorld.z, -dirWorld.x);
  vec2 uv = vec2(phi / (2.0*pi) + 0.5, 1.0 - (theta / pi));
  vec3 col = texture(u_sky, uv).rgb;
  o_color = vec4(col, 1.0);
}`;
  const v = compileSky(gl, gl.VERTEX_SHADER, VSQ);
  const f = compileSky(gl, gl.FRAGMENT_SHADER, FSS);
  skyProg = linkSky(gl, v, f);
  skyLoc = {
    u_sky: gl.getUniformLocation(skyProg, 'u_sky'),
    u_right: gl.getUniformLocation(skyProg, 'u_right'),
    u_up: gl.getUniformLocation(skyProg, 'u_up'),
    u_forward: gl.getUniformLocation(skyProg, 'u_forward'),
    u_aspect: gl.getUniformLocation(skyProg, 'u_aspect'),
    u_tanHalfFovY: gl.getUniformLocation(skyProg, 'u_tanHalfFovY'),
  };
}

function normalize3(v){ const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
function cross3(a,b){ return [ a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0] ]; }

function createSkyTexture(gl, img){
  if(skyTex){ gl.deleteTexture(skyTex); skyTex = null; }
  skyTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, skyTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
}

function drawSkyBackground(gl, aspect, fovy, getDir, canvas, SKYBOX_URL_UNUSED){
  if(!skyTex) return;
  ensureFullscreenGeomSky(gl);
  initSkyProgram(gl);
  gl.useProgram(skyProg);
  gl.bindVertexArray(fsVaoSky);
  const fwdV = normalize3([getDir().x, getDir().y, getDir().z]);
  const worldUp = [0,1,0];
  let rightV = cross3(fwdV, worldUp);
  // If looking almost straight up/down, fallback to a stable right axis
  if(Math.hypot(rightV[0], rightV[1], rightV[2]) < 1e-3){ rightV = [1,0,0]; }
  rightV = normalize3(rightV);
  const upV = normalize3(cross3(rightV, fwdV));
  gl.uniform3f(skyLoc.u_forward, fwdV[0], fwdV[1], fwdV[2]);
  gl.uniform3f(skyLoc.u_right, rightV[0], rightV[1], rightV[2]);
  gl.uniform3f(skyLoc.u_up, upV[0], upV[1], upV[2]);
  gl.uniform1f(skyLoc.u_aspect, aspect);
  gl.uniform1f(skyLoc.u_tanHalfFovY, Math.tan(fovy*0.5));
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, skyTex);
  gl.uniform1i(skyLoc.u_sky, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// expose globals
window.createSkyTexture = createSkyTexture;
window.drawSkyBackground = drawSkyBackground;


