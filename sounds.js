// Simple WebAudio manager for SFX and loops
// Exposes:
//   soundsInit()
//   soundsResume()  // resume AudioContext on user gesture
//   soundsSetListener(pos)  // {x,y,z}
//   soundsPlayOneShot(key, { pos, volume })
//   soundsStartLoop(key, { volume }) -> handle
//   soundsStopLoop(handle)

(function(){
  let ctx = null;
  let buffers = {};
  let listenerPos = { x:0, y:0, z:0 };
  const base = 'assets/sounds/';
  const manifest = {
    mg1: 'ww2_airplane_machinegun1.mp3',
    mg2: 'ww2_airplane_machinegun2.mp3',
    mg3: 'ww2_airplane_machinegun3.mp3',
    eng: 'ww2_airplane_engine2.mp3',
    ric1: 'bullet_ricochet1.mp3',
    ric2: 'bullet_ricochet2.mp3',
    ric3: 'bullet_ricochet3.mp3',
    ric4: 'bullet_ricochet4.mp3',
  };

  function ensureCtx(){ if(!ctx){ ctx = new (window.AudioContext||window.webkitAudioContext)(); } return ctx; }

  async function loadBuffer(url){
    const c = ensureCtx();
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    return await c.decodeAudioData(arr);
  }

  async function soundsInit(){
    ensureCtx();
    const entries = Object.entries(manifest);
    await Promise.all(entries.map(async ([k,f])=>{ buffers[k] = await loadBuffer(base+f); }));
  }

  function soundsResume(){ try{ ensureCtx().resume(); }catch(e){} }
  function soundsSetListener(pos){ if(!pos) return; listenerPos.x=pos.x; listenerPos.y=pos.y; listenerPos.z=pos.z; }

  function createChain(volume, pan){
    const c = ensureCtx();
    const gain = c.createGain();
    gain.gain.value = (typeof volume==='number') ? volume : 1.0;
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    if(p){ p.pan.value = (typeof pan==='number') ? pan : 0; gain.connect(p); p.connect(c.destination); return { in: gain, out: p };
    } else { gain.connect(c.destination); return { in: gain, out: gain }; }
  }

  function panVolForPos(pos){
    if(!pos) return { volume: 1.0, pan: 0.0 };
    const dx = pos.x - listenerPos.x;
    const dz = pos.z - listenerPos.z;
    const dist = Math.hypot(dx, dz);
    const pan = Math.max(-1, Math.min(1, dx / 120));
    const volume = 1.0 / (1.0 + (dist/180)**2);
    return { volume, pan };
  }

  function soundsPlayOneShot(key, opts){
    const buf = buffers[key]; if(!buf) return;
    const c = ensureCtx();
    const pv = panVolForPos(opts && opts.pos);
    const vol = (opts && typeof opts.volume==='number') ? opts.volume : 1.0;
    const chain = createChain(vol * pv.volume, pv.pan);
    const src = c.createBufferSource();
    src.buffer = buf; src.connect(chain.in); src.start();
  }

  function soundsStartLoop(key, opts){
    const buf = buffers[key]; if(!buf) return null;
    const c = ensureCtx();
    const chain = createChain((opts && opts.volume) || 0.6, 0);
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true; src.connect(chain.in);
    const startOffset = (opts && typeof opts.startOffset==='number') ? Math.max(0, Math.min(buf.duration-0.01, opts.startOffset)) : 0;
    if(startOffset > 0){ src.loopStart = startOffset; src.loopEnd = buf.duration; }
    src.start(0, startOffset);
    const handle = { src, chain };
    return handle;
  }

  function soundsStopLoop(h){ try{ if(h && h.src){ h.src.stop(); } }catch(e){} }
  function soundsUpdateLoop(h, opts){
    if(!h || !opts) return;
    if(opts.volume != null){ try{ h.chain.in.gain.value = opts.volume; }catch(e){} }
    if(opts.rate != null){ try{ h.src.playbackRate.value = Math.max(0.25, Math.min(3.0, opts.rate)); }catch(e){} }
    if(opts.pan != null && h.chain && h.chain.out && 'pan' in h.chain.out){ try{ h.chain.out.pan.value = opts.pan; }catch(e){} }
  }

  window.soundsInit = soundsInit;
  window.soundsResume = soundsResume;
  window.soundsSetListener = soundsSetListener;
  window.soundsPlayOneShot = soundsPlayOneShot;
  window.soundsStartLoop = soundsStartLoop;
  window.soundsStopLoop = soundsStopLoop;
  window.soundsUpdateLoop = soundsUpdateLoop;
})();


