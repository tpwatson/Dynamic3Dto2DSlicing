// Terrain module: heightmap -> terrain mesh buffers, collision sampling

let terrainHeights = null; // Float32Array w*h of heights (world units)
let terrainW = 0, terrainH = 0;
let indexCountTerrain = 0;
let terrainVbo = null, terrainIbo = null, terrainVaoBound = false;

function getTerrainIndexCount(){ return indexCountTerrain; }
function bindTerrainBuffers(gl){
  if(!terrainVbo || !terrainIbo) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, terrainVbo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIbo);
}
function sampleTerrainHeightAtWorldImpl(wx, wz, SIZE){
  if(!terrainHeights) return 0.0;
  const u = (wx / (SIZE*2.0) + 0.5) * (terrainW - 1);
  const v = (wz / (SIZE*2.0) + 0.5) * (terrainH - 1);
  const i0 = Math.max(0, Math.min(terrainW-1, Math.floor(u)));
  const j0 = Math.max(0, Math.min(terrainH-1, Math.floor(v)));
  const i1 = Math.min(terrainW-1, i0+1);
  const j1 = Math.min(terrainH-1, j0+1);
  const fu = u - i0, fv = v - j0;
  const h00 = terrainHeights[j0*terrainW + i0];
  const h10 = terrainHeights[j0*terrainW + i1];
  const h01 = terrainHeights[j1*terrainW + i0];
  const h11 = terrainHeights[j1*terrainW + i1];
  const h0 = h00*(1.0-fu) + h10*fu;
  const h1 = h01*(1.0-fu) + h11*fu;
  return h0*(1.0-fv) + h1*fv;
}

function buildTerrainFromImage(gl, img, GRID, SIZE, HEIGHT_SCALE){
  const w = GRID, h = GRID;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const imgd = cx.getImageData(0,0,img.width,img.height).data;

  function srgbToLinear(c){ c = Math.max(0, Math.min(1, c)); if(c <= 0.04045) return c/12.92; return Math.pow((c + 0.055)/1.055, 2.4); }
  function pixelLuminanceAt(idx){ const r = imgd[idx]*(1/255); const g = imgd[idx+1]*(1/255); const b = imgd[idx+2]*(1/255); const srgbLum = 0.2126*r + 0.7152*g + 0.0722*b; return srgbToLinear(srgbLum); }
  function sample(x,y){
    const xClamped = Math.max(0, Math.min(img.width-1, x));
    const yClamped = Math.max(0, Math.min(img.height-1, y));
    const x0 = Math.floor(xClamped), y0 = Math.floor(yClamped);
    const x1 = Math.min(img.width-1, x0+1), y1 = Math.min(img.height-1, y0+1);
    const fx = xClamped - x0, fy = yClamped - y0;
    const idx00=(y0*img.width+x0)*4, idx10=(y0*img.width+x1)*4, idx01=(y1*img.width+x0)*4, idx11=(y1*img.width+x1)*4;
    const v00=pixelLuminanceAt(idx00), v10=pixelLuminanceAt(idx10), v01=pixelLuminanceAt(idx01), v11=pixelLuminanceAt(idx11);
    const v0 = v00*(1-fx)+v10*fx, v1 = v01*(1-fx)+v11*fx; return v0*(1-fy)+v1*fy;
  }

  // heights and normals
  const heights = new Float32Array(w*h);
  for(let j=0;j<h;j++){
    for(let i=0;i<w;i++){
      const u=i/(w-1), v=j/(h-1);
      const sx=u*(img.width-1), sy=v*(img.height-1);
      const elev=sample(sx,sy);
      heights[j*w+i]=elev*HEIGHT_SCALE;
    }
  }

  const stepX=(SIZE*2)/(w-1), stepZ=(SIZE*2)/(h-1);
  const getHeight=(ii,jj)=>{ const iC=Math.max(0,Math.min(w-1,ii)); const jC=Math.max(0,Math.min(h-1,jj)); return heights[jC*w+iC]; };
  function computeNormal(ii,jj){
    const hl=getHeight(ii-1,jj), hr=getHeight(ii+1,jj), hu=getHeight(ii,jj-1), hd=getHeight(ii,jj+1);
    const dx=(hr-hl)/(2*stepX), dz=(hd-hu)/(2*stepZ);
    const tx=[1,dx,0], tz=[0,dz,1];
    const nx = tz[1]*tx[2] - tz[2]*tx[1];
    const ny = tz[2]*tx[0] - tz[0]*tx[2];
    const nz = tz[0]*tx[1] - tz[1]*tx[0];
    const len=Math.max(1e-6,Math.hypot(nx,ny,nz));
    return [nx/len, ny/len, nz/len];
  }

  const verts=new Float32Array(w*h*9);
  const ind=new Uint32Array((w-1)*(h-1)*6);
  let p=0;
  for(let j=0;j<h;j++){
    for(let i=0;i<w;i++){
      const u=i/(w-1), v=j/(h-1);
      const x=(u-0.5)*SIZE*2, z=(v-0.5)*SIZE*2;
      const y=heights[j*w+i];
      const n=computeNormal(i,j);
      const elevN=y/HEIGHT_SCALE;
      let col=[0.3,0.55,0.35];
      if(elevN>0.55) col=[0.5,0.42,0.32];
      if(elevN>0.82) col=[0.9,0.9,0.92];
      verts[p++]=x; verts[p++]=y; verts[p++]=z;
      verts[p++]=n[0]; verts[p++]=n[1]; verts[p++]=n[2];
      verts[p++]=col[0]; verts[p++]=col[1]; verts[p++]=col[2];
    }
  }
  let q=0;
  for(let j=0;j<h-1;j++){
    for(let i=0;i<w-1;i++){
      const a=j*w+i, b=a+1, c1=a+w, d=c1+1;
      ind[q++]=a; ind[q++]=c1; ind[q++]=b;
      ind[q++]=b; ind[q++]=c1; ind[q++]=d;
    }
  }

  indexCountTerrain = ind.length;

  if(!terrainVbo) terrainVbo = gl.createBuffer();
  if(!terrainIbo) terrainIbo = gl.createBuffer();
  // Bind into currently bound VAO
  gl.bindBuffer(gl.ARRAY_BUFFER, terrainVbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ind, gl.STATIC_DRAW);
  // Configure vertex attributes for layout: pos(3), norm(3), col(3)
  const stride = 36;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 24);

  terrainHeights = heights;
  terrainW = w; terrainH = h;

  return { vbo: terrainVbo, ibo: terrainIbo, indexCount: indexCountTerrain };
}

// Export to global for index.html
window.buildTerrainFromImage = buildTerrainFromImage;
window.sampleTerrainHeightAtWorld = (wx, wz, SIZE)=> sampleTerrainHeightAtWorldImpl(wx, wz, SIZE);
window.getTerrainIndexCount = getTerrainIndexCount;
window.bindTerrainBuffers = bindTerrainBuffers;


