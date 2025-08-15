  // ----- Mobile Virtual Joysticks -----
  const joyL = document.getElementById('joyL');
  const joyR = document.getElementById('joyR');
  const knobL = joyL ? joyL.querySelector('.knob') : null;
  const knobR = joyR ? joyR.querySelector('.knob') : null;
  let joyLActive=false, joyRActive=false;
  let joyLVec={x:0,y:0}, joyRVec={x:0,y:0};

  function setupJoystick(root, knob, onVec){
    if(!root || !knob) return;
    const radius = 80; // px
    function updateFromEvent(e){
      const t = ('touches' in e) ? e.touches[0] : e;
      const rect = root.getBoundingClientRect();
      const cx = rect.left + rect.width/2;
      const cy = rect.top + rect.height/2;
      let dx = t.clientX - cx;
      let dy = t.clientY - cy;
      const len = Math.hypot(dx,dy);
      const maxLen = radius;
      const cl = Math.min(1, len/maxLen);
      if(len>0){ dx = dx/len*cl; dy = dy/len*cl; } else { dx=0; dy=0; }
      const kx = dx*maxLen, ky = dy*maxLen;
      knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
      onVec({x:dx,y:dy});
    }
    function end(){ knob.style.transform='translate(-50%, -50%)'; onVec({x:0,y:0}); root.classList.remove('active'); }
    if(window.PointerEvent){
      root.addEventListener('pointerdown', e=>{ root.setPointerCapture(e.pointerId); root.classList.add('active'); updateFromEvent(e); });
      root.addEventListener('pointermove', e=>{ if(root.classList.contains('active')) updateFromEvent(e); });
      root.addEventListener('pointerup', end);
      root.addEventListener('pointercancel', end);
    } else {
      root.addEventListener('touchstart', e=>{ root.classList.add('active'); updateFromEvent(e); e.preventDefault(); }, {passive:false});
      root.addEventListener('touchmove', e=>{ if(root.classList.contains('active')) updateFromEvent(e); e.preventDefault(); }, {passive:false});
      root.addEventListener('touchend', end, {passive:false});
      root.addEventListener('touchcancel', end, {passive:false});
    }
  }

  setupJoystick(joyL, knobL, v=>{ joyLVec=v; joyLActive = (v.x!==0||v.y!==0); });
  setupJoystick(joyR, knobR, v=>{ joyRVec=v; joyRActive = (v.x!==0||v.y!==0); });

  function isTouchLike(){
    const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    return coarse || ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints>0);
  }
  function ensureJoystickVisibility(){
    if(!joyL||!joyR) return;
    if(isTouchLike()){
      joyL.style.display = 'block';
      joyR.style.display = 'block';
    }
  }
  ensureJoystickVisibility();
  addEventListener('resize', ensureJoystickVisibility);