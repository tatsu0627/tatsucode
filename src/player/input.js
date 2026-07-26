/**
 * Raw input capture: keyboard, mouse buttons, pointer-lock look deltas.
 *
 * Deltas ACCUMULATE between reads rather than being sampled per event, so a
 * 1000Hz mouse on a 60Hz display loses nothing — every count contributes to the
 * frame's rotation. `consumeLook()` drains and zeroes them.
 *
 * Nothing here knows about the game; the player controller maps it to intent.
 */

const CODE_MAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  ControlLeft: 'crouch', ControlRight: 'crouch', KeyC: 'crouchToggle',
  KeyR: 'reload',
  KeyI: 'inspect',
  KeyV: 'fireMode',
  KeyF: 'inspect',
};

export class Input {
  constructor() {
    this.keys = Object.create(null);
    this.pressed = Object.create(null);   // edge-triggered, cleared by endFrame()
    this.mouse = { left: false, right: false };
    this.mousePressed = { left: false, right: false };
    this.lookX = 0;
    this.lookY = 0;
    this.locked = false;
    this.enabled = true;
    this.wheel = 0;
    this._listeners = [];
  }

  attach(canvas) {
    this.canvas = canvas;
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._listeners.push([target, type, fn]);
    };

    on(window, 'keydown', (e) => {
      if (e.repeat) return;
      const a = CODE_MAP[e.code];
      if (!a) return;
      if (e.code === 'Space') e.preventDefault();
      this.keys[a] = true;
      this.pressed[a] = true;
    });
    on(window, 'keyup', (e) => {
      const a = CODE_MAP[e.code];
      if (a) this.keys[a] = false;
    });

    on(canvas, 'mousedown', (e) => {
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.mousePressed.left = true; }
      if (e.button === 2) { this.mouse.right = true; this.mousePressed.right = true; }
    });
    on(window, 'mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    on(canvas, 'contextmenu', (e) => e.preventDefault());

    on(document, 'mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      // movementX/Y are already sub-pixel accumulated by the browser.
      this.lookX += e.movementX || 0;
      this.lookY += e.movementY || 0;
    });

    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        // Releasing the lock must not leave a key or button stuck down.
        for (const k in this.keys) this.keys[k] = false;
        this.mouse.left = this.mouse.right = false;
        this.lookX = this.lookY = 0;
      }
    });
    on(window, 'blur', () => {
      for (const k in this.keys) this.keys[k] = false;
      this.mouse.left = this.mouse.right = false;
    });
    on(canvas, 'wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  requestLock() {
    if (!this.enabled || !this.canvas) return;
    try { this.canvas.requestPointerLock?.(); } catch { /* headless / denied */ }
  }

  down(action) { return !!this.keys[action]; }
  justPressed(action) { return !!this.pressed[action]; }

  /** Drains accumulated look delta in raw pixels. */
  consumeLook(out) {
    out.x = this.lookX; out.y = this.lookY;
    this.lookX = 0; this.lookY = 0;
    return out;
  }

  endFrame() {
    for (const k in this.pressed) this.pressed[k] = false;
    this.mousePressed.left = false;
    this.mousePressed.right = false;
    this.wheel = 0;
  }

  dispose() {
    for (const [t, type, fn] of this._listeners) t.removeEventListener(type, fn);
    this._listeners.length = 0;
  }
}
