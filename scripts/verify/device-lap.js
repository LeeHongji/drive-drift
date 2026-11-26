// Page-side harness: presses real keyboard / gamepad / touch controls to match what the drift bot asks for.
window.__drive = (device) => {
  const g = window.__game;
  const R = (window.__lap = { device, hits: 0, steps: 0, maxMult: 1, drifts: 0, lap0: g.state().laps, t0: performance.now(), offs: 0 });
  const held = {};
  const pad = { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false };
  const btn = (v) => ({ pressed: v > 0.5, touched: v > 0, value: +v });
  if (device === 'pad') {
    navigator.getGamepads = () => {
      const b = Array.from({ length: 17 }, () => btn(0));
      b[0] = btn(pad.nitro); b[2] = btn(pad.handbrake); b[6] = btn(pad.brake); b[7] = btn(pad.throttle);
      return [{ connected: true, mapping: 'standard', index: 0, id: 'harness pad', axes: [pad.steer, 0, 0, 0], buttons: b, timestamp: performance.now() }];
    };
    window.dispatchEvent(new Event('gamepadconnected'));
  }
  const ptr = (type, id, x, y) => {
    const target = document.elementFromPoint(x, y) || document.body;
    target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 11 }));
  };
  const centre = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  let steerDown = false; let lastSteer = 0; let started = false;
  const touchBtn = (name, id, on) => {
    if (!!held[name] === on) return;
    held[name] = on;
    const [x, y] = centre('#touch .' + name);
    ptr(on ? 'pointerdown' : 'pointerup', id, x, y);
  };
  const apply = {
    keys(w) {
      const want = { KeyW: w.throttle > 0.5, KeyS: w.brake > 0.5, KeyA: w.steer < -0.5, KeyD: w.steer > 0.5, Space: w.handbrake, KeyN: w.nitro };
      for (const code in want) {
        if (want[code] === !!held[code]) continue;
        held[code] = want[code];
        window.dispatchEvent(new KeyboardEvent(want[code] ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true }));
      }
    },
    pad(w) { Object.assign(pad, w); },
    touch(w) {
      const x0 = innerWidth * 0.17, y0 = innerHeight * 0.66;
      // Like a thumb: lift to centre, put it down again and drag to the side for lock.
      if (w.steer !== lastSteer) {
        lastSteer = w.steer;
        if (steerDown) { ptr('pointerup', 11, x0, y0); steerDown = false; }
        if (w.steer !== 0) { ptr('pointerdown', 11, x0, y0); ptr('pointermove', 11, x0 + w.steer * 170, y0); steerDown = true; }
      }
      if (!started) { started = true; ptr('pointerdown', 15, x0, y0); ptr('pointerup', 15, x0, y0); }
      touchBtn('drift', 12, w.handbrake);
      touchBtn('brake', 13, w.brake > 0.5);
      touchBtn('nitro', 14, w.nitro);
    },
  };
  let wasDrift = false;
  g.setAutopilot(false);
  g.reset();
  g.coDrive((want, car) => {
    R.steps++;
    if (car.hit > 0) R.hits++;
    if (car.drift && !wasDrift) R.drifts++;
    wasDrift = car.drift;
    apply[device](want);
  });
  const iv = setInterval(() => { const st = g.state(); R.maxMult = Math.max(R.maxMult, st.mult); R.laps = st.laps - R.lap0; R.s = Math.round(st.s); R.kmh = Math.round(st.kmh); R.inputDevice = g.inputs.device; R.seconds = +((performance.now() - R.t0) / 1000).toFixed(1); R.last = document.querySelector('#laps')?.innerText.replace(/\s+/g, ' ').slice(0, 80); }, 250);
  return 'driving with ' + device;
};
'driver ready';
