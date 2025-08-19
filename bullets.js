// Simple bullet system: spawn, update, render slender boxes with warm colors
// Exposes:
//   bulletsInit(gl)
//   bulletsSpawnPair(planePos, yaw, pitch, roll, planeSpeed)
//   bulletsUpdate(dt, SIZE, sampleHeightFn)
//   bulletsDrawPass(gl, loc, bandIndexToRender)

(function(){
  const BULLET_SPEED = 1950.0;  // m/s initial speed added to plane forward (3x)
  const BULLET_TTL = 3.0;       // seconds
  const G = 0.0;                // gravity on bullets (arc) — keep 0 for now
  const SIDE_OFFSET = 6.0;      // meters from fuselage center to each muzzle
  const BULLET_LEN = 34.0 ;
  const BULLET_RAD = 0.8;       // skinnier tracers

  let bullets = [];
  let sparks = [];

  // geometry: unit cube used and scaled per-instance
  let vao=null, vbo=null, ibo=null, indexCount=0;

  function createCube(gl){
    if(vao) return;
    const verts = [
      // pos(xyz) norm(xyz) col(rgb)
      // +Y
      -0.5, 0.5,-0.5,  0,1,0,  1,0.8,0.2,
       0.5, 0.5,-0.5,  0,1,0,  1,0.8,0.2,
       0.5, 0.5, 0.5,  0,1,0,  1,0.8,0.2,
      -0.5, 0.5, 0.5,  0,1,0,  1,0.8,0.2,
      // -Y
      -0.5,-0.5,-0.5,  0,-1,0, 1,0.6,0.1,
       0.5,-0.5,-0.5,  0,-1,0, 1,0.6,0.1,
       0.5,-0.5, 0.5,  0,-1,0, 1,0.6,0.1,
      -0.5,-0.5, 0.5,  0,-1,0, 1,0.6,0.1,
      // +X
       0.5,-0.5,-0.5,  1,0,0,  1,0.75,0.15,
       0.5, 0.5,-0.5,  1,0,0,  1,0.75,0.15,
       0.5, 0.5, 0.5,  1,0,0,  1,0.75,0.15,
       0.5,-0.5, 0.5,  1,0,0,  1,0.75,0.15,
      // -X
      -0.5,-0.5,-0.5, -1,0,0,  1,0.75,0.15,
      -0.5, 0.5,-0.5, -1,0,0,  1,0.75,0.15,
      -0.5, 0.5, 0.5, -1,0,0,  1,0.75,0.15,
      -0.5,-0.5, 0.5, -1,0,0,  1,0.75,0.15,
      // +Z
      -0.5,-0.5, 0.5,  0,0,1,  1,0.9,0.25,
       0.5,-0.5, 0.5,  0,0,1,  1,0.9,0.25,
       0.5, 0.5, 0.5,  0,0,1,  1,0.9,0.25,
      -0.5, 0.5, 0.5,  0,0,1,  1,0.9,0.25,
      // -Z
      -0.5,-0.5,-0.5,  0,0,-1, 1,0.7,0.1,
       0.5,-0.5,-0.5,  0,0,-1, 1,0.7,0.1,
       0.5, 0.5,-0.5,  0,0,-1, 1,0.7,0.1,
      -0.5, 0.5,-0.5,  0,0,-1, 1,0.7,0.1,
    ];
    const idx = [
      0,1,2, 0,2,3,  4,6,5, 4,7,6,
      8,9,10, 8,10,11,  12,14,13, 12,15,14,
      16,17,18, 16,18,19,  20,22,21, 20,23,22
    ];
    vao = gl.createVertexArray();
    vbo = gl.createBuffer();
    ibo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    const stride = 36;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,stride,0);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,3,gl.FLOAT,false,stride,12);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,stride,24);
    indexCount = idx.length;
    gl.bindVertexArray(null);
  }

  function normalize(v){ const l=Math.hypot(v.x,v.y,v.z)||1; return {x:v.x/l,y:v.y/l,z:v.z/l}; }
  function cross(a,b){ return { x:a.y*b.z - a.z*b.y, y:a.z*b.x - a.x*b.z, z:a.x*b.y - a.y*b.x }; }
  function add(a,b){ return { x:a.x+b.x, y:a.y+b.y, z:a.z+b.z }; }
  function mul(v,s){ return { x:v.x*s, y:v.y*s, z:v.z*s }; }
  function rotateAroundAxis(v, axis, angle){
    const u = normalize(axis); const c=Math.cos(angle), s=Math.sin(angle);
    const dot = u.x*v.x + u.y*v.y + u.z*v.z;
    return {
      x: v.x*c + (u.y*v.z - u.z*v.y)*s + u.x*dot*(1-c),
      y: v.y*c + (u.z*v.x - u.x*v.z)*s + u.y*dot*(1-c),
      z: v.z*c + (u.x*v.y - u.y*v.x)*s + u.z*dot*(1-c),
    };
  }
  function forwardFromEulerPlane(yaw, pitch){
    const cy=Math.cos(yaw), sy=Math.sin(yaw);
    const cp=Math.cos(pitch), sp=Math.sin(pitch);
    return { x: sy*cp, y: sp, z: -cy*cp };
  }
  function modelFromBasis(pos, right, up, fwd, sx, sy, sz){
    return new Float32Array([
      right.x*sx, right.y*sx, right.z*sx, 0,
      up.x*sy,    up.y*sy,    up.z*sy,    0,
      fwd.x*sz,   fwd.y*sz,   fwd.z*sz,   0,
      pos.x,      pos.y,      pos.z,      1
    ]);
  }

  function bulletsInit(gl){ createCube(gl); }

  function bulletsSpawnPair(planePos, yaw, pitch, roll, planeSpeed){
    const fwd = normalize(forwardFromEulerPlane(yaw, pitch));
    let right = normalize(cross({x:0,y:1,z:0}, fwd));
    // apply roll around forward
    right = normalize(rotateAroundAxis(right, fwd, roll));
    const up = normalize(cross(fwd, right));
    const baseVel = add(mul(fwd, BULLET_SPEED + Math.max(0, planeSpeed||0)), {x:0,y:0,z:0});
    const pLeft = add(planePos, mul(right, -SIDE_OFFSET));
    const pRight= add(planePos, mul(right,  SIDE_OFFSET));
    const color = [1.0, 0.8, 0.2];
    bullets.push({ pos:pLeft, vel:baseVel, ttl:BULLET_TTL, right, up, fwd, color });
    bullets.push({ pos:pRight, vel:baseVel, ttl:BULLET_TTL, right, up, fwd, color });
    // machine gun burst sound (mix alternating samples)
    // Ensure only one MG instance plays at a time: stop any existing loop then start a short one-shot
    if(typeof window.__mgActive==='number'){ /* noop counter */ }
    const mgKey = 'mg2'; // fixed variant to avoid timbre switching
    if(typeof soundsPlayOneShot==='function') soundsPlayOneShot(mgKey, { pos: planePos, volume: 0.45 });
  }

  function spawnImpact(pos, velHint){
    const n = 14;
    const base = { x: pos.x, y: pos.y, z: pos.z };
    const dirHint = normalize(velHint || {x:0,y:-1,z:0});
    for(let i=0;i<n;i++){
      // random hemisphere biased up and along incoming direction
      const a = Math.random()*Math.PI*2;
      const u = Math.random();
      const elev = Math.random()*0.7 + 0.3; // favor upwards
      const dir = normalize({ x: Math.cos(a)* (1.0-u) + dirHint.x*0.6,
                              y: elev,
                              z: Math.sin(a)* (1.0-u) + dirHint.z*0.6 });
      const spd = 120 + Math.random()*220;
      const ttl = 0.35 + Math.random()*0.35;
      const size = (3.0 + Math.random()*4.0) * 0.25; // 4x smaller
      sparks.push({ pos:{...base}, vel: mul(dir, spd), ttl, life: ttl, size, color:[1.0,0.75,0.2] });
    }
  }

  function bulletsUpdate(dt, SIZE, sampleHeightFn){
    const out=[];
    for(const b of bullets){
      b.ttl -= dt; if(b.ttl<=0) continue;
      // motion
      b.vel.y -= G*dt;
      b.pos.x += b.vel.x*dt; b.pos.y += b.vel.y*dt; b.pos.z += b.vel.z*dt;
      // ground collision
      const gy = sampleHeightFn ? sampleHeightFn(b.pos.x, b.pos.z, SIZE) : -99999;
      if(b.pos.y <= gy + 0.2){
        spawnImpact({x:b.pos.x, y:gy+0.1, z:b.pos.z}, b.vel);
        // ricochet/impact
        if(typeof soundsPlayOneShot==='function'){
          const rKey = ['ric1','ric2','ric3','ric4'][(Math.random()*4)|0];
          soundsPlayOneShot(rKey, { pos: {x:b.pos.x, y:gy, z:b.pos.z}, volume: 0.55 });
        }
        continue;
      }
      out.push(b);
    }
    bullets = out;
    // update sparks
    const sparksOut=[]; const GR = 26.0;
    for(const s of sparks){
      s.ttl -= dt; if(s.ttl<=0) continue;
      s.vel.y -= GR*dt;
      s.pos.x += s.vel.x*dt; s.pos.y += s.vel.y*dt; s.pos.z += s.vel.z*dt;
      const gy = sampleHeightFn ? sampleHeightFn(s.pos.x, s.pos.z, SIZE) : -99999;
      if(s.pos.y < gy + 0.05){ s.pos.y = gy + 0.05; s.vel.y *= -0.15; s.vel.x *= 0.7; s.vel.z *= 0.7; }
      sparksOut.push(s);
    }
    sparks = sparksOut;
  }

  function bulletsDrawPass(gl, loc, bandIndexToRender){
    if(!vao || (bullets.length===0 && sparks.length===0)) return;
    gl.bindVertexArray(vao);
    gl.uniform1i(loc.u_renderMode, 1);
    gl.uniform1f(loc.u_metallic, 0.0);
    gl.uniform1f(loc.u_roughness, 0.4);
    gl.uniform3f(loc.u_baseColor, 1.0, 0.85, 0.2);
    for(const b of bullets){
      const fwd = normalize(b.vel);
      let right = cross({x:0,y:1,z:0}, fwd);
      const rl = Math.hypot(right.x,right.y,right.z);
      if(rl < 1e-4) right = {x:1,y:0,z:0};
      right = normalize(right);
      const up = normalize(cross(fwd, right));
      const m = modelFromBasis(b.pos, right, up, fwd, BULLET_RAD, BULLET_RAD, BULLET_LEN);
      gl.uniformMatrix4fv(loc.u_model, false, m);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    }
    // Sparks — fade by remaining life
    if(sparks.length){
      for(const s of sparks){
        const fwd = normalize(s.vel.x||s.vel.y||s.vel.z ? s.vel : {x:0,y:1,z:0});
        let right = cross({x:0,y:1,z:0}, fwd);
        const rl = Math.hypot(right.x,right.y,right.z);
        if(rl < 1e-4) right = {x:1,y:0,z:0};
        right = normalize(right);
        const up = normalize(cross(fwd, right));
        const m = modelFromBasis(s.pos, right, up, fwd, s.size*0.15, s.size*0.15, s.size);
        const a = Math.max(0, Math.min(1, s.ttl / s.life));
        gl.uniform3f(loc.u_baseColor, s.color[0], s.color[1], s.color[2]);
        if(loc.u_alpha) gl.uniform1f(loc.u_alpha, a);
        gl.uniformMatrix4fv(loc.u_model, false, m);
        gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
      }
      if(loc.u_alpha) gl.uniform1f(loc.u_alpha, 1.0);
    }
    gl.bindVertexArray(null);
    gl.uniform1i(loc.u_renderMode, 0);
  }

  window.bulletsInit = bulletsInit;
  window.bulletsSpawnPair = bulletsSpawnPair;
  window.bulletsUpdate = bulletsUpdate;
  window.bulletsDrawPass = bulletsDrawPass;
})();


