// Minimal glTF 2.0 loader (JSON + external .bin) for WebGL2
// Assumptions:
// - FLOAT attributes (POSITION, NORMAL)
// - UNSIGNED_INT indices
// - No morph/skin/animations
// - Materials ignored; our main program handles coloring/stylization

(function(){
  async function fetchJson(url){ const r = await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status+' for '+url); return r.json(); }
  async function fetchBin(url){ const r = await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status+' for '+url); return r.arrayBuffer(); }
  function dirOf(url){ const i = url.lastIndexOf('/'); return i>=0 ? url.slice(0,i+1) : ''; }

  function createBufferFromView(gl, bin, view){
    const start = view.byteOffset || 0;
    const end = start + view.byteLength;
    const slice = bin.slice(start, end);
    const target = view.target || gl.ARRAY_BUFFER;
    const buf = gl.createBuffer();
    gl.bindBuffer(target, buf);
    gl.bufferData(target, slice, gl.STATIC_DRAW);
    return buf;
  }

  function accessorInfo(gl, accessor){
    const comp = accessor.componentType; // 5126 float, 5125 uint
    let glType = null, compSize = 0, numComp = 0;
    if(comp === 5126){ glType = gl.FLOAT; compSize = 4; }
    else if(comp === 5125){ glType = gl.UNSIGNED_INT; compSize = 4; }
    else throw new Error('Unsupported componentType '+comp);
    const type = accessor.type; // SCALAR, VEC2, VEC3, VEC4, MAT4 etc
    if(type === 'SCALAR') numComp = 1; else if(type === 'VEC2') numComp = 2; else if(type === 'VEC3') numComp = 3; else if(type === 'VEC4') numComp = 4; else if(type === 'MAT4') numComp = 16; else throw new Error('Unsupported accessor.type '+type);
    return { glType, compSize, numComp, count: accessor.count, byteOffset: accessor.byteOffset || 0 };
  }

  // Minimal mat4 helpers (column-major)
  function mat4Identity(){ return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
  function mat4Multiply(a,b){
    const out = new Float32Array(16);
    for(let c=0;c<4;c++){
      const ai0=a[0+c*4], ai1=a[1+c*4], ai2=a[2+c*4], ai3=a[3+c*4];
      out[0+c*4] = ai0*b[0] + ai1*b[4] + ai2*b[8]  + ai3*b[12];
      out[1+c*4] = ai0*b[1] + ai1*b[5] + ai2*b[9]  + ai3*b[13];
      out[2+c*4] = ai0*b[2] + ai1*b[6] + ai2*b[10] + ai3*b[14];
      out[3+c*4] = ai0*b[3] + ai1*b[7] + ai2*b[11] + ai3*b[15];
    }
    return out;
  }
  function quatToMat4(qx,qy,qz,qw){
    const x=qx,y=qy,z=qz,w=qw;
    const x2=x+x, y2=y+y, z2=z+z;
    const xx=x*x2, xy=x*y2, xz=x*z2;
    const yy=y*y2, yz=y*z2, zz=z*z2;
    const wx=w*x2, wy=w*y2, wz=w*z2;
    return new Float32Array([
      1-(yy+zz), xy+wz,     xz-wy,     0,
      xy-wz,     1-(xx+zz), yz+wx,     0,
      xz+wy,     yz-wx,     1-(xx+yy), 0,
      0,         0,         0,         1
    ]);
  }
  function fromTRS(t,r,s){
    const T = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, (t? t[0]:0), (t? t[1]:0), (t? t[2]:0), 1]);
    const R = r ? quatToMat4(r[0],r[1],r[2],r[3]) : mat4Identity();
    const S = new Float32Array([ (s? s[0]:1),0,0,0, 0,(s? s[1]:1),0,0, 0,0,(s? s[2]:1),0, 0,0,0,1 ]);
    return mat4Multiply(T, mat4Multiply(R, S));
  }

  function makeVaoForPrimitive(gl, programLoc, gltf, buffers, primitive){
    // programLoc: { a_pos: 0, a_col: 1, a_norm: 2 }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // POSITION
    if(!primitive.attributes || typeof primitive.attributes.POSITION === 'undefined') throw new Error('POSITION missing');
    const posAcc = gltf.accessors[primitive.attributes.POSITION];
    const posView = gltf.bufferViews[posAcc.bufferView];
    const posBuf = buffers[posAcc.bufferView];
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    const posInf = accessorInfo(gl, posAcc);
    const posStride = posView.byteStride || (posInf.compSize * posInf.numComp);
    gl.enableVertexAttribArray(programLoc.a_pos);
    gl.vertexAttribPointer(programLoc.a_pos, posInf.numComp, posInf.glType, false, posStride, posInf.byteOffset);

    // NORMAL (optional but expected by our shader)
    if(typeof primitive.attributes.NORMAL !== 'undefined'){
      const nAcc = gltf.accessors[primitive.attributes.NORMAL];
      const nView = gltf.bufferViews[nAcc.bufferView];
      const nBuf = buffers[nAcc.bufferView];
      gl.bindBuffer(gl.ARRAY_BUFFER, nBuf);
      const nInf = accessorInfo(gl, nAcc);
      const nStride = nView.byteStride || (nInf.compSize * nInf.numComp);
      gl.enableVertexAttribArray(programLoc.a_norm);
      gl.vertexAttribPointer(programLoc.a_norm, nInf.numComp, nInf.glType, false, nStride, nInf.byteOffset);
    } else {
      // Fallback constant normal up if absent
      gl.disableVertexAttribArray(programLoc.a_norm);
      gl.vertexAttrib3f(programLoc.a_norm, 0, 1, 0);
    }

    // COLOR attribute not provided: set constant neutral
    gl.disableVertexAttribArray(programLoc.a_col);
    gl.vertexAttrib3f(programLoc.a_col, 0.8, 0.8, 0.8);

    // ELEMENTS
    if(typeof primitive.indices === 'undefined') throw new Error('indices missing');
    const iAcc = gltf.accessors[primitive.indices];
    const iView = gltf.bufferViews[iAcc.bufferView];
    const iBuf = buffers[iAcc.bufferView];
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
    const iInf = accessorInfo(gl, iAcc);

    const mode = (primitive.mode === 4 || typeof primitive.mode === 'undefined') ? gl.TRIANGLES : primitive.mode;
    // Attach material factors if present
    let material = null;
    if(typeof primitive.material === 'number' && gltf.materials && gltf.materials[primitive.material]){
      const mat = gltf.materials[primitive.material] || {};
      const pbr = mat.pbrMetallicRoughness || {};
      const base = pbr.baseColorFactor || [1,1,1,1];
      const metallic = (typeof pbr.metallicFactor === 'number') ? pbr.metallicFactor : 0.0;
      const roughness = (typeof pbr.roughnessFactor === 'number') ? pbr.roughnessFactor : 1.0;
      const emissive = mat.emissiveFactor || [0,0,0];
      material = { base, metallic, roughness, emissive };
    }
    const draw = { vao, indexCount: iInf.count, indexType: iInf.glType, indexOffsetBytes: iInf.byteOffset, mode, material, nodeMatrix: mat4Identity() };
    gl.bindVertexArray(null);
    return draw;
  }

  function computeSceneBounds(gltf){
    // Aggregate over all POSITION accessors
    const mins = [ Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY ];
    const maxs = [ Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY ];
    for(const acc of gltf.accessors){
      if(acc && acc.type === 'VEC3' && typeof acc.max !== 'undefined' && typeof acc.min !== 'undefined'){
        for(let i=0;i<3;i++){ mins[i] = Math.min(mins[i], acc.min[i]); maxs[i] = Math.max(maxs[i], acc.max[i]); }
      }
    }
    const size = [ maxs[0]-mins[0], maxs[1]-mins[1], maxs[2]-mins[2] ];
    const center = [ (maxs[0]+mins[0])/2, (maxs[1]+mins[1])/2, (maxs[2]+mins[2])/2 ];
    return { mins, maxs, size, center };
  }

  async function loadGltf(gl, url, programLoc){
    const gltf = await fetchJson(url);
    const base = dirOf(url);
    // Load buffers (single .bin typical)
    const binDatas = [];
    for(const buf of gltf.buffers){
      const bufUrl = /^https?:|^data:|^\.\//.test(buf.uri) ? buf.uri : (base + buf.uri);
      binDatas.push(await fetchBin(bufUrl));
    }
    // Create GL buffers per bufferView (slice from the referenced buffer)
    const buffers = new Array(gltf.bufferViews.length);
    for(let i=0;i<gltf.bufferViews.length;i++){
      const view = gltf.bufferViews[i];
      const bin = binDatas[view.buffer];
      buffers[i] = createBufferFromView(gl, bin, view);
    }
    // Load images and create GL textures (if any)
    async function loadImageElement(src){
      return new Promise((resolve, reject)=>{
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = ()=> resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    }
    const images = [];
    if(Array.isArray(gltf.images)){
      for(const img of gltf.images){
        const uri = /^https?:|^data:|^\./.test(img.uri) ? img.uri : (base + img.uri);
        images.push(await loadImageElement(uri));
      }
    }
    const glTextures = [];
    if(Array.isArray(gltf.textures)){
      for(const t of gltf.textures){
        const img = images[t.source];
        if(!img){ glTextures.push(null); continue; }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        glTextures.push(tex);
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    // Traverse scene graph to build drawables with node transforms
    const drawables = [];
    function buildForNode(nodeIdx, parentMat){
      const node = gltf.nodes[nodeIdx] || {};
      let localMat = null;
      if(node.matrix && node.matrix.length === 16){ localMat = new Float32Array(node.matrix); }
      else { localMat = fromTRS(node.translation, node.rotation, node.scale); }
      const worldMat = mat4Multiply(parentMat, localMat);
      if(typeof node.mesh === 'number' && gltf.meshes && gltf.meshes[node.mesh]){
        const mesh = gltf.meshes[node.mesh];
        for(const prim of mesh.primitives){
          const draw = makeVaoForPrimitive(gl, programLoc, gltf, buffers, prim);
          draw.nodeMatrix = worldMat;
          // Attach material textures if present
          if(typeof prim.material === 'number' && gltf.materials && gltf.materials[prim.material]){
            const mat = gltf.materials[prim.material] || {};
            const pbr = mat.pbrMetallicRoughness || {};
            const baseTexIdx = pbr.baseColorTexture && typeof pbr.baseColorTexture.index === 'number' ? pbr.baseColorTexture.index : null;
            const mrTexIdx = pbr.metallicRoughnessTexture && typeof pbr.metallicRoughnessTexture.index === 'number' ? pbr.metallicRoughnessTexture.index : null;
            draw.material.baseTex = (baseTexIdx!==null) ? glTextures[baseTexIdx] : null;
            draw.material.mrTex = (mrTexIdx!==null) ? glTextures[mrTexIdx] : null;
          }
          drawables.push(draw);
        }
      }
      if(Array.isArray(node.children)){
        for(const c of node.children){ buildForNode(c, worldMat); }
      }
    }
    const sceneIndex = (typeof gltf.scene === 'number') ? gltf.scene : 0;
    const scene = (gltf.scenes && gltf.scenes[sceneIndex]) || {};
    const roots = Array.isArray(scene.nodes) ? scene.nodes : [];
    for(const nIdx of roots){ buildForNode(nIdx, mat4Identity()); }
    const bounds = computeSceneBounds(gltf);
    return { drawables, bounds };
  }

  // Expose
  window.loadGltf = loadGltf;
})();


