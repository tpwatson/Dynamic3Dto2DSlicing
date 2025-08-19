// Procedural Minecraft-like clouds rendered as 3D thin boxes at high altitude
// Exposes:
//   cloudsInit(gl, SIZE)
//   cloudsDrawPass(gl, loc, bandIndexToRender, camPos, SIZE, timeSec)

(function(){
  const CLOUD_ALTITUDE = 3000.0;   // world units (meters)
  const CELL_SIZE = 360.0;          // width/depth of one cloud block
  const BLOCK_HEIGHT = 20.0;       // vertical thickness of clouds
  const SEED_DENSITY = 0.0002;     // seeds per cell (tune density)
  const GROW_START = 1;         // seed neighbor probability
  const GROW_DECAY = 0.01;         // probability decrement per hop
  const GROW_MIN = 0.20;           // stop expanding below this

  // Generated for one base tile [-SIZE, SIZE) × [-SIZE, SIZE)
  let gridW = 0, gridH = 0;
  let occupied = null;         // boolean grid (Uint8Array)
  let blocks = [];             // array of {x,z}

  // GL resources for a unit cube with pos/normal/color attributes
  let cubeVao = null, cubeVbo = null, cubeIbo = null, cubeIndexCount = 0;

  function createCube(gl){
    if(cubeVao) return;
    const p = [
      // pos(xyz) normal(xyz) color(rgb)
      // +Y (top)
      -0.5, 0.5,-0.5,  0,1,0,  1,1,1,
       0.5, 0.5,-0.5,  0,1,0,  1,1,1,
       0.5, 0.5, 0.5,  0,1,0,  1,1,1,
      -0.5, 0.5, 0.5,  0,1,0,  1,1,1,
      // -Y (bottom)
      -0.5,-0.5,-0.5,  0,-1,0, 1,1,1,
       0.5,-0.5,-0.5,  0,-1,0, 1,1,1,
       0.5,-0.5, 0.5,  0,-1,0, 1,1,1,
      -0.5,-0.5, 0.5,  0,-1,0, 1,1,1,
      // +X
       0.5,-0.5,-0.5,  1,0,0,  1,1,1,
       0.5, 0.5,-0.5,  1,0,0,  1,1,1,
       0.5, 0.5, 0.5,  1,0,0,  1,1,1,
       0.5,-0.5, 0.5,  1,0,0,  1,1,1,
      // -X
      -0.5,-0.5,-0.5, -1,0,0,  1,1,1,
      -0.5, 0.5,-0.5, -1,0,0,  1,1,1,
      -0.5, 0.5, 0.5, -1,0,0,  1,1,1,
      -0.5,-0.5, 0.5, -1,0,0,  1,1,1,
      // +Z
      -0.5,-0.5, 0.5,  0,0,1,  1,1,1,
       0.5,-0.5, 0.5,  0,0,1,  1,1,1,
       0.5, 0.5, 0.5,  0,0,1,  1,1,1,
      -0.5, 0.5, 0.5,  0,0,1,  1,1,1,
      // -Z
      -0.5,-0.5,-0.5,  0,0,-1, 1,1,1,
       0.5,-0.5,-0.5,  0,0,-1, 1,1,1,
       0.5, 0.5,-0.5,  0,0,-1, 1,1,1,
      -0.5, 0.5,-0.5,  0,0,-1, 1,1,1,
    ];
    const indices = [
      0,1,2, 0,2,3,     4,6,5, 4,7,6,
      8,9,10, 8,10,11,  12,14,13, 12,15,14,
      16,17,18, 16,18,19,  20,22,21, 20,23,22
    ];
    cubeVao = gl.createVertexArray();
    cubeVbo = gl.createBuffer();
    cubeIbo = gl.createBuffer();
    gl.bindVertexArray(cubeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(p), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    const stride = 36; // 9 floats * 4 bytes
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 24);
    cubeIndexCount = indices.length;
    gl.bindVertexArray(null);
  }

  function idx(x,y){ return y*gridW + x; }

  function genCloudGrid(SIZE){
    const span = SIZE * 2.0;
    gridW = Math.max(1, Math.floor(span / CELL_SIZE));
    gridH = Math.max(1, Math.floor(span / CELL_SIZE));
    occupied = new Uint8Array(gridW*gridH);

    // seeds
    const q = [];
    for(let y=0;y<gridH;y++){
      for(let x=0;x<gridW;x++){
        if(Math.random() < SEED_DENSITY){
          occupied[idx(x,y)] = 1; // mark seed cell as cloud
          q.push({x,y,p:GROW_START});
        }
      }
    }
    // Ensure at least a few seeds
    if(q.length === 0){
      const sx = (Math.random()*gridW)|0; const sy = (Math.random()*gridH)|0;
      occupied[idx(sx,sy)] = 1; q.push({x:sx,y:sy,p:GROW_START});
    }

    // growth BFS with decaying probability
    const dirs = [ [1,0], [-1,0], [0,1], [0,-1] ];
    while(q.length){
      const n = q.shift();
      const nextP = n.p - GROW_DECAY;
      if(nextP < GROW_MIN) continue;
      for(const d of dirs){
        const nx = n.x + d[0];
        const ny = n.y + d[1];
        if(nx<0||ny<0||nx>=gridW||ny>=gridH) continue;
        const id = idx(nx,ny);
        if(occupied[id]) continue;
        // mild edge taper: fewer neighbors -> lower chance
        let neigh = 0;
        for(const e of dirs){
          const ex = nx + e[0], ey = ny + e[1];
          if(ex>=0&&ey>=0&&ex<gridW&&ey<gridH && occupied[idx(ex,ey)]) neigh++;
        }
        const taper = (4 - neigh) * 0.07; // 0..0.28 reduction
        const prob = Math.max(0, nextP - taper);
        if(Math.random() < prob){
          occupied[id] = 1;
          q.push({x:nx,y:ny,p:prob});
        }
      }
    }

    // collect blocks
    blocks = [];
    for(let y=0;y<gridH;y++){
      for(let x=0;x<gridW;x++){
        if(occupied[idx(x,y)]){
          const wx = (x/(gridW))*span - SIZE + CELL_SIZE*0.5;
          const wz = (y/(gridH))*span - SIZE + CELL_SIZE*0.5;
          blocks.push({x:wx, z:wz});
        }
      }
    }
  }

  function modelMatrix(tx,ty,tz, sx,sy,sz){
    return new Float32Array([
      sx,0,0,0,
      0,sy,0,0,
      0,0,sz,0,
      tx,ty,tz,1
    ]);
  }

  function cloudsInit(gl, SIZE){
    createCube(gl);
    genCloudGrid(SIZE);
  }

  // Draw clouds during the per-layer pass; depth test should be enabled by caller
  function cloudsDrawPass(gl, loc, bandIndexToRender, camPos, SIZE, timeSec){
    if(!cubeVao || blocks.length===0) return;
    // Blending for semi-transparent clouds
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(loc.u_renderMode, 1);
    // White, rough diffuse
    gl.uniform3f(loc.u_baseColor, 1.0, 1.0, 1.0);
    gl.uniform1f(loc.u_metallic, 0.0);
    gl.uniform1f(loc.u_roughness, 0.95);
    if(loc.u_alpha){ gl.uniform1f(loc.u_alpha, 0.7); }
    // render for a small wrapped grid so clouds follow the camera like terrain
    const translations = [-2,-1,0,1,2];
    const tileSpan = SIZE * 2.0;
    const baseX = Math.floor(camPos.x / tileSpan) * tileSpan;
    const baseZ = Math.floor(camPos.z / tileSpan) * tileSpan;
    gl.bindVertexArray(cubeVao);
    for(const ox of translations){
      for(const oz of translations){
        const offX = baseX + ox * tileSpan;
        const offZ = baseZ + oz * tileSpan;
        for(const b of blocks){
          const tx = b.x + offX;
          const tz = b.z + offZ;
          const ty = CLOUD_ALTITUDE;
          const m = modelMatrix(tx, ty, tz, CELL_SIZE, BLOCK_HEIGHT, CELL_SIZE);
          gl.uniformMatrix4fv(loc.u_model, false, m);
          gl.drawElements(gl.TRIANGLES, cubeIndexCount, gl.UNSIGNED_SHORT, 0);
        }
      }
    }
    gl.bindVertexArray(null);
    if(loc.u_alpha){ gl.uniform1f(loc.u_alpha, 1.0); }
    gl.disable(gl.BLEND);
  }

  window.cloudsInit = cloudsInit;
  window.cloudsDrawPass = cloudsDrawPass;
})();


