// Minimal equirectangular sky module for index.html
// Exposes: createSkyTexture(gl, img), drawSkyBackground(gl, aspect, fovy, getDir, canvas, SKYBOX_URL)

let skyProg = null;
let skyLoc = null;
let skyTex = null;
let fsVaoSky = null, fsVboSky = null;

// Procedural sky toggles/options
let useProceduralSky = true;
let procOptions = {
  starDensity: 900.0,   // grid scale (higher = more cells)
  starProb: 0.0,        // probability per cell (0 for daytime look)
  starSize: 0.36,       // star core size (cell space)
  starSharp: 3.0,       // sharpness of points
  twinkleSpeed: 0.8,    // twinkle rate
  twinkleAmp: 0.25,     // twinkle amplitude
  starTint: [0.90, 0.95, 1.0], // slightly blue-white
  moonOn: false,
  moonRadiusDeg: 0.55,  // apparent radius in degrees
  moonBrightness: 2.2,
  moonHue: [1.0, 0.98, 0.94],
  // Light blue overcast gradient
  baseTop:    [0.68, 0.80, 0.90],
  baseBottom: [0.60, 0.73, 0.86],
};

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
  const FSS = `#version 300 es
precision highp float;

 in vec2 v_uv;

 uniform sampler2D u_sky;
 uniform vec3 u_right;
 uniform vec3 u_up;
 uniform vec3 u_forward;
 uniform float u_aspect;
 uniform float u_tanHalfFovY;
 uniform int   u_useProc;
 // Procedural uniforms
 uniform float u_time;
 uniform float u_starDensity;
 uniform float u_starProb;
 uniform float u_starSize;
 uniform float u_starSharp;
 uniform float u_twinkleSpeed;
 uniform float u_twinkleAmp;
 uniform vec3  u_starTint;
 uniform int   u_moonOn;
 uniform float u_moonRadius;
 uniform float u_moonBrightness;
 uniform vec3  u_moonHue;
 uniform vec3  u_baseTop;
 uniform vec3  u_baseBottom;

 out vec4 o_color;

 float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
 vec2  hash22(vec2 p){ float n = sin(dot(p, vec2(127.1,311.7))); return fract(vec2(262144.0,32768.0) * n); }

 float starResponse(vec2 p, float size, float sharp){
   float base = exp(-dot(p,p) / (size*size*0.15));
   float ax = exp(-pow(abs(p.x), sharp) / size) + exp(-pow(abs(p.y), sharp) / size);
   float c = cos(3.14159265/3.0), s = sin(3.14159265/3.0);
   mat2 R = mat2(c,-s,s,c);
   vec2 p2 = R*p; vec2 p3 = R*p2;
   float a1 = exp(-pow(abs(p2.x), sharp) / size) + exp(-pow(abs(p2.y), sharp) / size);
   float a2 = exp(-pow(abs(p3.x), sharp) / size) + exp(-pow(abs(p3.y), sharp) / size);
   return base + 0.6*ax + 0.45*a1 + 0.45*a2;
 }

 void main(){
   vec2 ndc = v_uv * 2.0 - 1.0;
   vec3 dirCam = normalize(vec3(ndc.x * u_aspect * u_tanHalfFovY, ndc.y * u_tanHalfFovY, -1.0));
   vec3 dirWorld = normalize(u_right * dirCam.x + u_up * dirCam.y + u_forward * dirCam.z);
   float pi = 3.14159265358979323846;
   float yaw = atan(dirWorld.x, -dirWorld.z);
   float pitch = asin(clamp(dirWorld.y, -1.0, 1.0));
   vec2 uvSky = vec2(yaw / (2.0*pi) + 0.5, 0.5 - (pitch / pi));

   if(u_useProc == 0){
     vec3 colT = texture(u_sky, uvSky).rgb;
     o_color = vec4(colT, 1.0);
     return;
   }

   // Overcast light-blue gradient base
   float t = clamp(dirWorld.y * 0.55 + 0.5, 0.0, 1.0);
   vec3 col = mix(u_baseBottom, u_baseTop, t);

   // Optional stars (usually off)
   vec2 cellCoord = uvSky * u_starDensity;
   vec2 cellId = floor(cellCoord);
   vec2 f = fract(cellCoord) - 0.5;
   float r = hash21(cellId);
   if(r < u_starProb){
     vec2 jitter = (hash22(cellId) - 0.5) * 0.7;
     vec2 p = f - jitter;
     float tw = 1.0 + u_twinkleAmp * sin(u_time * u_twinkleSpeed + r * 31.7);
     float resp = starResponse(p, u_starSize, u_starSharp) * tw;
     float inten = mix(0.65, 1.0, r);
     col += u_starTint * resp * inten;
   }

   if(u_moonOn == 1){
     float yawM = u_time * 0.03;
     float pitchM = 0.28;
     vec3 moonDir = normalize(vec3(cos(yawM), sin(pitchM), sin(yawM)));
     float cosAng = clamp(dot(dirWorld, moonDir), -1.0, 1.0);
     float ang = acos(cosAng);
     float rim = smoothstep(u_moonRadius, u_moonRadius*0.8, ang);
     float core = smoothstep(u_moonRadius*0.6, u_moonRadius*0.2, ang);
     vec3 moon = u_moonHue * (core * u_moonBrightness + rim * (u_moonBrightness*0.25));
     col += moon;
   }

   col = clamp(col, 0.0, 1.0);
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
    u_useProc: gl.getUniformLocation(skyProg, 'u_useProc'),
    u_time: gl.getUniformLocation(skyProg, 'u_time'),
    u_starDensity: gl.getUniformLocation(skyProg, 'u_starDensity'),
    u_starProb: gl.getUniformLocation(skyProg, 'u_starProb'),
    u_starSize: gl.getUniformLocation(skyProg, 'u_starSize'),
    u_starSharp: gl.getUniformLocation(skyProg, 'u_starSharp'),
    u_twinkleSpeed: gl.getUniformLocation(skyProg, 'u_twinkleSpeed'),
    u_twinkleAmp: gl.getUniformLocation(skyProg, 'u_twinkleAmp'),
    u_starTint: gl.getUniformLocation(skyProg, 'u_starTint'),
    u_moonOn: gl.getUniformLocation(skyProg, 'u_moonOn'),
    u_moonRadius: gl.getUniformLocation(skyProg, 'u_moonRadius'),
    u_moonBrightness: gl.getUniformLocation(skyProg, 'u_moonBrightness'),
    u_moonHue: gl.getUniformLocation(skyProg, 'u_moonHue'),
    u_baseTop: gl.getUniformLocation(skyProg, 'u_baseTop'),
    u_baseBottom: gl.getUniformLocation(skyProg, 'u_baseBottom'),
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
  useProceduralSky = false;
}

function drawSkyBackground(gl, aspect, fovy, getDir, canvas, SKYBOX_URL_UNUSED){
  ensureFullscreenGeomSky(gl);
  initSkyProgram(gl);
  gl.useProgram(skyProg);
  gl.bindVertexArray(fsVaoSky);
  const fwdV = normalize3([getDir().x, getDir().y, getDir().z]);
  const worldUp = [0,1,0];
  // Right-handed basis: right = up × forward
  let rightV = cross3(worldUp, fwdV);
  if(Math.hypot(rightV[0], rightV[1], rightV[2]) < 1e-3){ rightV = [1,0,0]; }
  rightV = normalize3(rightV);
  // Up from right × forward for orthonormal frame
  const upV = normalize3(cross3(rightV, fwdV));
  gl.uniform3f(skyLoc.u_forward, fwdV[0], fwdV[1], fwdV[2]);
  gl.uniform3f(skyLoc.u_right, rightV[0], rightV[1], rightV[2]);
  gl.uniform3f(skyLoc.u_up, upV[0], upV[1], upV[2]);
  gl.uniform1f(skyLoc.u_aspect, aspect);
  gl.uniform1f(skyLoc.u_tanHalfFovY, Math.tan(fovy*0.5));
  const timeSec = (typeof performance!=='undefined') ? performance.now()*0.001 : Date.now()*0.001;
  gl.uniform1i(skyLoc.u_useProc, (useProceduralSky || !skyTex) ? 1 : 0);
  if(skyLoc.u_time) gl.uniform1f(skyLoc.u_time, timeSec);
  if(useProceduralSky || !skyTex){
    gl.uniform1f(skyLoc.u_starDensity, procOptions.starDensity);
    gl.uniform1f(skyLoc.u_starProb, procOptions.starProb);
    gl.uniform1f(skyLoc.u_starSize, procOptions.starSize);
    gl.uniform1f(skyLoc.u_starSharp, procOptions.starSharp);
    gl.uniform1f(skyLoc.u_twinkleSpeed, procOptions.twinkleSpeed);
    gl.uniform1f(skyLoc.u_twinkleAmp, procOptions.twinkleAmp);
    gl.uniform3f(skyLoc.u_starTint, procOptions.starTint[0], procOptions.starTint[1], procOptions.starTint[2]);
    gl.uniform1i(skyLoc.u_moonOn, procOptions.moonOn ? 1 : 0);
    const rad = (procOptions.moonRadiusDeg||0.55) * Math.PI / 180.0;
    gl.uniform1f(skyLoc.u_moonRadius, rad);
    gl.uniform1f(skyLoc.u_moonBrightness, procOptions.moonBrightness);
    gl.uniform3f(skyLoc.u_moonHue, procOptions.moonHue[0], procOptions.moonHue[1], procOptions.moonHue[2]);
    if(skyLoc.u_baseTop) gl.uniform3f(skyLoc.u_baseTop, procOptions.baseTop[0], procOptions.baseTop[1], procOptions.baseTop[2]);
    if(skyLoc.u_baseBottom) gl.uniform3f(skyLoc.u_baseBottom, procOptions.baseBottom[0], procOptions.baseBottom[1], procOptions.baseBottom[2]);
  } else {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, skyTex);
    gl.uniform1i(skyLoc.u_sky, 0);
  }
  // Draw sky behind everything and ensure it presents before terrain
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// expose globals
window.createSkyTexture = createSkyTexture;
window.drawSkyBackground = drawSkyBackground;
window.setProceduralSky = function(enabled){ useProceduralSky = !!enabled; };
window.configureProceduralSky = function(opts){ if(!opts) return; Object.assign(procOptions, opts); };


