import * as THREE from 'three';
import { ReticleLayer } from './reticle.js';
import { Compass } from './compass.js';
import { ScreenFx } from './screenfx.js';
import { Menus } from './menus.js';
import { C, clamp, damp, lerp } from './theme.js';

/**
 * Owns all DOM overlay: HUD, menus, hitmarkers, killfeed.
 *
 * CONTRACT (called by other modules)
 *   hitmarker(kind)              — 'body' | 'head' | 'kill'. Combat calls this.
 *   setCrosshairSpread(px)       — bloom in screen pixels (half-gap). Weapons calls
 *                                  this; if it is not called, spread is derived
 *                                  from weapons.current.spread (radians).
 *   damageTaken(fromWorldPos, amount)
 *                                — directional indicator + vignette + hit flash.
 *   damageNumber(worldPos, amount, kind)
 *   kill({killer, victim, weapon, headshot, byPlayer})   — pushes a killfeed row.
 *   grenade(id, worldPos, fuse)  — live grenade indicator; clearGrenade(id).
 *   flashbang(strength, seconds)
 *   notify(text, seconds)        — centre-bottom line.
 *   setObjective(text, worldPos) / setMarkers([{pos|bearing, kind, label}])
 *
 * PUBLISHED STATE (read by others, written here)
 *   engine.settings   — {fov, sensitivity, invertY, quality}. Player/weapons may
 *                       read these; they are driven by the settings menu.
 *   engine.screenFX   — {desaturation, whiteout, damage, bloomBoost,
 *                        chromaticBoost, vignetteBoost, pulse}. The render module
 *                        may consume these in the post chain and then set
 *                        engine.screenFX.handled = true, which switches off the
 *                        DOM fallback versions of the same effects.
 *
 * CAPTURE
 *   Hidden whenever `?shot=` / engine.captureMode is set, so automated
 *   screenshots judge the render. `?shot=hero&hud=1` shows the HUD populated with
 *   representative state for reviewing the overlay itself; `&hud=clean` shows the
 *   HUD in its resting state.
 *
 * PERFORMANCE
 *   No DOM writes unless a value changed (see _text/_cls). Everything that
 *   animates every frame lives on one canvas, which clears only its dirty rect.
 */
export class UiModule {
  constructor() {
    this.root = null;
    this.spread = 0;
    this._spreadSetAt = -1;
    this._ads = 0;
    this._cache = {};
    this._killfeed = [];
    this._alert = { text: '', until: 0 };
    this._toast = { text: '', until: 0 };
    this._markers = [];
    this._objective = { text: 'SECURE THE COMPOUND', pos: new THREE.Vector3(0, 1, 0) };
    this._grenades = new Map();
    this._hidden = false;
    this._t = 0;
    this._v = new THREE.Vector3();
  }

  async init(engine) {
    this.engine = engine;
    this.root = document.getElementById('ui-root');
    if (!this.root) return;

    const params = new URLSearchParams(location.search);
    this._shot = params.get('shot');
    this._hudParam = params.get('hud');

    this.root.innerHTML = SKELETON;
    this.root.classList.add('ui-root');

    const q = s => this.root.querySelector(s);
    this.el = {
      hud: q('.hud'),
      reticle: q('.hud-reticle'),
      compass: q('.compass-cv'),
      topstrip: q('.topstrip'),
      objText: q('.obj-text'),
      objDist: q('.obj-dist'),
      killfeed: q('.killfeed'),
      ammo: q('.ammo'),
      ammoName: q('.ammo-name'),
      ammoMode: q('.ammo-mode'),
      mag: q('.ammo-mag'),
      res: q('.ammo-res'),
      reload: q('.reload'),
      reloadFill: q('.reload-fill'),
      equip: q('.equip'),
      alert: q('.alert'),
      toast: q('.toast'),
      menus: q('.menu-layer'),
    };

    this.reticle = new ReticleLayer(this.el.reticle);
    this.compass = new Compass(this.el.compass);
    this.screenFx = new ScreenFx(engine, this.root);
    this.menus = new Menus(engine, this.el.menus, this);
    this.menus.apply();

    this.audio = engine.modules.get('audio') || null;

    this._bindInput();
    this.resize(window.innerWidth, window.innerHeight);

    // Capture runs headless with no gesture: never show the menu there.
    if (!this._shot) this.menus.open('main');
    else if (this._hudParam) this._seedCaptureState();
  }

  // ---- public API -----------------------------------------------------------

  hitmarker(kind = 'body') {
    if (!this.menus?.settings.hitmarkers) return;
    this.reticle?.hitmarker(kind);
    this.audio?.play?.(kind === 'kill' ? 'hitmarker_kill'
      : kind === 'head' ? 'hitmarker_head' : 'hitmarker');
  }

  setCrosshairSpread(px) {
    this.spread = Math.max(0, px || 0);
    this._spreadSetAt = this._t;
  }

  /** @param from THREE.Vector3 | [x,y,z] | number (radians, screen-relative) */
  damageTaken(from, amount = 20) {
    const ang = typeof from === 'number' ? from : this._bearingTo(from);
    this.reticle?.hitDirection(ang, amount);
    this.screenFx?.damage(ang, amount);
    this.audio?.play?.('hurt');
  }

  damageNumber(worldPos, amount, kind = 'body') {
    if (!this.menus?.settings.damageNumbers) return;
    const s = this._project(worldPos);
    if (!s || !s.onScreen) return;
    this.reticle?.damageNumber(s.x, s.y, amount, kind);
  }

  kill({ killer = 'PLAYER', victim = 'ENEMY', weapon = '', headshot = false, byPlayer = true } = {}) {
    this._killfeed.push({ killer, victim, weapon, headshot, byPlayer, t: this._t });
    if (this._killfeed.length > 5) this._killfeed.shift();
    this._renderKillfeed();
  }

  grenade(id, worldPos, fuse) {
    this._grenades.set(id, { pos: this._toVec(worldPos), fuse });
  }
  clearGrenade(id) {
    this._grenades.delete(id);
    this.reticle?.clearGrenade(id);
  }

  flashbang(strength = 1, seconds = 4.5) {
    this.screenFx?.flashbang(strength, seconds);
    this.audio?.play?.('flashbang');
  }

  notify(text, seconds = 2.6) { this._toast = { text, until: this._t + seconds }; }
  alert(text, seconds = 1.4) { this._alert = { text, until: this._t + seconds }; }

  setObjective(text, worldPos) {
    if (text) this._objective.text = text;
    if (worldPos) this._objective.pos.copy(this._toVec(worldPos));
  }
  setMarkers(list) { this._markers = list || []; }

  // ---- lifecycle ------------------------------------------------------------

  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.reticle?.resize(w, h, dpr);
    this.compass?.resize(dpr);
    // One scalar keeps the HUD proportional from 720p to 4K without media queries.
    const s = clamp(Math.min(w / 1600, h / 900) * 0.35 + 0.68, 0.78, 1.5);
    this.root?.style.setProperty('--s', s.toFixed(3));
  }

  onGameStart() {
    this.requestPointerLock();
    this.audio?.unlock?.();
    this.audio?.play?.('ui_deploy');
    this.notify('OBJECTIVE · ' + this._objective.text, 3.2);
  }

  requestPointerLock() {
    if (this.engine?.captureMode) return;
    try { document.getElementById('viewport')?.requestPointerLock?.(); } catch { /* ignore */ }
  }

  onSettingsChanged(s) {
    this._cls(this.el.topstrip, 'off', !s.compass);
  }

  _bindInput() {
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') { this.menus.togglePause(); }
      else if (e.code === 'F1') { this._cls(this.el.hud, 'off', !this.el.hud.classList.contains('off')); e.preventDefault(); }
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.engine?.captureMode) return;
      const locked = !!document.pointerLockElement;
      if (!locked && this.menus.started && !this.menus.stack.length) this.menus.open('pause');
    });
    // WebAudio needs a real gesture; any click anywhere is enough.
    const unlock = () => this.audio?.unlock?.();
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
  }

  // ---- frame ----------------------------------------------------------------

  update(dt) {
    try { this._update(dt); } catch (err) {
      // The HUD must never take the frame loop down with it.
      if (!this._loggedError) { this._loggedError = true; console.warn('[ui]', err); }
    }
  }

  _update(dt) {
    if (!this.root) return;
    this._t += dt;

    const eng = this.engine;
    const capture = eng.captureMode || !!this._shot;
    const hide = capture && !this._hudParam;
    if (hide !== this._hidden) {
      this._hidden = hide;
      this.root.style.display = hide ? 'none' : '';
    }
    if (hide) return;
    if (capture) this._cls(this.el.menus, 'active', false);

    const player = eng.modules.get('player');
    const weapons = eng.modules.get('weapons');
    const cur = weapons?.current;

    // ---- crosshair --------------------------------------------------------
    const adsRaw = player?.adsFactor ?? (player?.state?.ads ? 1 : 0);
    this._ads = damp(this._ads, clamp(adsRaw, 0, 1), 14, dt);

    if (this._t - this._spreadSetAt > 0.4) {
      // Weapons has not driven the crosshair this frame — derive it ourselves so
      // the reticle still breathes with the weapon rather than sitting frozen.
      let px = weapons?.spreadPx;
      if (px == null) {
        const rad = (cur?.spread ?? 0.006) * (weapons?.bloom ?? 1);
        const fov = (eng.camera?.fov ?? 80) * Math.PI / 180;
        px = Math.tan(rad) / Math.tan(fov / 2) * (window.innerHeight / 2);
      }
      this.spread = damp(this.spread, clamp(px, 0, 90), 10, dt);
    }

    const reloadingNow = !!(weapons?.reloading || weapons?.isReloading || weapons?.state === 'reload');
    this.reticle.update(dt);
    this.reticle.draw({
      spread: this.spread,
      ads: this._ads,
      hidden: this.el.hud.classList.contains('off'),
    });

    // ---- compass ----------------------------------------------------------
    if (this.menus.settings.compass) {
      const heading = this._heading();
      this.compass.setMarkers(this._compassMarkers());
      this.compass.draw(heading);
      const d = this._objective.pos.distanceTo(eng.camera.position);
      this._text(this.el.objDist, `${Math.round(d)}M`);
      this._text(this.el.objText, this._objective.text);
    }

    // ---- ammo -------------------------------------------------------------
    const mag = cur?.ammo ?? 0;
    const magSize = cur?.magSize ?? 30;
    const reserve = cur?.reserve ?? 0;
    this._text(this.el.ammoName, (cur?.name ?? 'UNARMED').toUpperCase());
    this._text(this.el.ammoMode, (cur?.fireMode ?? (cur?.semi ? 'SEMI' : 'AUTO')).toUpperCase());
    this._text(this.el.mag, String(mag));
    this._text(this.el.res, String(reserve));

    const low = magSize > 0 && mag / magSize <= 0.25;
    const empty = mag <= 0;
    this._cls(this.el.ammo, 'low', low && !empty);
    this._cls(this.el.ammo, 'empty', empty);

    let prog = weapons?.reloadProgress;
    if (prog == null && weapons?.reloadTime) {
      prog = clamp((weapons.reloadElapsed ?? 0) / weapons.reloadTime, 0, 1);
    }
    this._cls(this.el.reload, 'show', reloadingNow);
    if (reloadingNow) {
      this.el.reloadFill.style.transform = `scaleX(${(prog ?? 0.5).toFixed(3)})`;
    }

    // ---- equipment --------------------------------------------------------
    const eq = player?.equipment ?? { frag: 2, flash: 1 };
    this._text(this.root.querySelector('.eq-frag .eq-c'), String(eq.frag ?? 0));
    this._text(this.root.querySelector('.eq-flash .eq-c'), String(eq.flash ?? 0));

    // ---- health / screen fx ------------------------------------------------
    const hp = clamp((player?.health ?? 100) / (player?.maxHealth || 100), 0, 1);
    this.screenFx.update(dt, hp);

    // ---- grenades ----------------------------------------------------------
    for (const [id, g] of this._grenades) {
      g.fuse -= dt;
      if (g.fuse <= -0.2) { this._grenades.delete(id); this.reticle.clearGrenade(id); continue; }
      const s = this._project(g.pos);
      this.reticle.setGrenade(id, s, eng.camera.position.distanceTo(g.pos), Math.max(0, g.fuse));
    }

    // ---- text lines --------------------------------------------------------
    let alert = this._t < this._alert.until ? this._alert.text : '';
    if (!alert) {
      if (empty && !reloadingNow) alert = 'PRESS <b>R</b> TO RELOAD';
      else if (low && !reloadingNow) alert = 'LOW AMMO';
    }
    this._html(this.el.alert, alert);
    this._cls(this.el.alert, 'show', !!alert);
    this._cls(this.el.alert, 'urgent', empty && !reloadingNow);

    const toast = this._t < this._toast.until ? this._toast.text : '';
    this._html(this.el.toast, toast);
    this._cls(this.el.toast, 'show', !!toast);

    if (this._t - (this._lastFeedPrune || 0) > 0.5) {
      this._lastFeedPrune = this._t;
      this._pruneKillfeed();
    }

    if (capture && this._hudParam === '1') this._pinCaptureAnimations();
  }

  // ---- helpers --------------------------------------------------------------

  _toVec(p) {
    if (!p) return new THREE.Vector3();
    if (p.isVector3) return p;
    if (Array.isArray(p)) return new THREE.Vector3(p[0], p[1], p[2]);
    return new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0);
  }

  /** Screen-relative bearing to a world point: 0 = dead ahead, +ve = clockwise. */
  _bearingTo(p) {
    const cam = this.engine.camera;
    const v = this._v.copy(this._toVec(p)).applyMatrix4(cam.matrixWorldInverse);
    return Math.atan2(v.x, -v.z);
  }

  _project(p) {
    const cam = this.engine.camera;
    const v = this._v.copy(this._toVec(p));
    const cs = v.clone().applyMatrix4(cam.matrixWorldInverse);
    const angle = Math.atan2(cs.x, -cs.z);
    if (cs.z >= -0.05) return { onScreen: false, angle, x: 0, y: 0 };
    v.project(cam);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const onScreen = x > 40 && x < window.innerWidth - 40 && y > 40 && y < window.innerHeight - 40;
    return { onScreen, angle, x, y };
  }

  /** Degrees clockwise from world north (-Z). */
  _heading() {
    const e = new THREE.Euler().setFromQuaternion(this.engine.camera.quaternion, 'YXZ');
    return ((-e.y * 180 / Math.PI) % 360 + 360) % 360;
  }

  _compassMarkers() {
    const out = [];
    const bearingOf = p => {
      const cam = this.engine.camera;
      const dx = p.x - cam.position.x, dz = p.z - cam.position.z;
      return ((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360;
    };
    out.push({ bearing: bearingOf(this._objective.pos), kind: 'objective' });
    for (const m of this._markers) {
      out.push({
        bearing: m.bearing != null ? m.bearing : bearingOf(this._toVec(m.pos)),
        kind: m.kind || 'objective',
      });
    }
    return out;
  }

  _renderKillfeed() {
    const rows = this._killfeed.map(k => {
      const cls = k.byPlayer ? 'mine' : '';
      return `<div class="kf-row ${cls}">` +
        `<span class="kf-a">${esc(k.killer)}</span>` +
        `<span class="kf-w">${ICON_RIFLE}${k.headshot ? HEADSHOT_DOT : ''}</span>` +
        `<span class="kf-b">${esc(k.victim)}</span></div>`;
    }).join('');
    this._html(this.el.killfeed, rows);
  }

  _pruneKillfeed() {
    const before = this._killfeed.length;
    this._killfeed = this._killfeed.filter(k => this._t - k.t < 7.5);
    if (this._killfeed.length !== before) this._renderKillfeed();
  }

  // DOM writes are gated on change — a HUD that touches the DOM every frame is
  // the single easiest way to lose 3 ms a frame for nothing.
  _text(el, v) {
    if (!el) return;
    const k = el.className + ':t';
    if (this._cache[k] === v) return;
    this._cache[k] = v;
    el.textContent = v;
  }
  _html(el, v) {
    if (!el) return;
    const k = el.className + ':h';
    if (this._cache[k] === v) return;
    this._cache[k] = v;
    el.innerHTML = v;
  }
  _cls(el, name, on) {
    if (!el) return;
    if (el.classList.contains(name) === !!on) return;
    el.classList.toggle(name, !!on);
  }

  // ---- capture support ------------------------------------------------------

  /** Representative state so `?shot=x&hud=1` is worth actually looking at. */
  _seedCaptureState() {
    const p = this.engine.modules.get('player');
    if (p) { p.health = 46; p.equipment = { frag: 2, flash: 1 }; }
    const w = this.engine.modules.get('weapons');
    if (w?.current) { w.current.ammo = 7; w.current.reserve = 120; }

    this.kill({ killer: 'RAVEN 2-1', victim: 'HOSTILE · RIFLEMAN', headshot: true, byPlayer: true });
    this.kill({ killer: 'HOSTILE · MG', victim: 'RAVEN 3-4', byPlayer: false });
    this.kill({ killer: 'RAVEN 2-1', victim: 'HOSTILE · SNIPER', byPlayer: true });

    this.spread = 11;
    this._spreadSetAt = 1e9;                 // hold it; nothing else is driving
    this.setObjective('SECURE THE COMPOUND', [-18, 1, -46]);
    this.setMarkers([{ pos: [30, 1, -20], kind: 'enemy' }, { pos: [-6, 1, 30], kind: 'ally' }]);
    this.grenade('demo', [3.0, 1.2, 4.0], 1.6);
    this.notify('OBJECTIVE · SECURE THE COMPOUND', 1e9);

    this._demo = true;
    // Queue the transient elements; _pinCaptureAnimations freezes them at peak.
    this.reticle.hitmarker('head');
    this.reticle.hitDirection(-2.2, 34);
    this.reticle.damageNumber(window.innerWidth * 0.5 + 96, window.innerHeight * 0.5 - 54, 137, 'head');
    this.reticle.damageNumber(window.innerWidth * 0.5 - 128, window.innerHeight * 0.5 + 18, 26, 'body');
  }

  /** Freeze transient animations at their peak so a still frame shows them. */
  _pinCaptureAnimations() {
    if (!this._demo) return;
    for (const m of this.reticle.hitmarkers) m.t = 0.05;
    for (const d of this.reticle.dirs) d.t = 0.30;
    for (const n of this.reticle.numbers) {
      if (n._ox === undefined) { n._ox = n.x; n._oy = n.y; }
      n.t = 0.18; n.x = n._ox; n.y = n._oy;
    }
    const g = this._grenades.get('demo');
    if (g) g.fuse = 1.6;
  }
}

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Weapon glyph drawn as inline SVG: an icon font would be another request and a
// unicode glyph renders differently on every platform.
const ICON_RIFLE =
  `<svg viewBox="0 0 34 12" width="30" height="11" aria-hidden="true">` +
  `<path fill="currentColor" d="M1 3h22v2h-4v1.6h-2.2V5h-1.9l-1.5 3.2h-2.4l.9-3.2H1z"/>` +
  `<path fill="currentColor" d="M23 2.2h9v1.5h-9zM26.5 5h2v2.6h-2z"/></svg>`;
const HEADSHOT_DOT = `<svg viewBox="0 0 10 10" width="9" height="9" class="kf-hs" aria-hidden="true">` +
  `<circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.4"/>` +
  `<circle cx="5" cy="5" r="0.9" fill="currentColor"/></svg>`;

const SKELETON = `
<div class="hud">
  <div class="fx fx-desat"></div>
  <div class="fx fx-blood"></div>
  <div class="fx-dirs">
    <div class="fx-dir"></div><div class="fx-dir"></div>
    <div class="fx-dir"></div><div class="fx-dir"></div>
  </div>
  <div class="fx fx-hit"></div>

  <div class="topstrip">
    <canvas class="compass-cv"></canvas>
    <div class="objective">
      <span class="obj-pip"></span>
      <span class="obj-text">SECURE THE COMPOUND</span>
      <span class="obj-dist">0M</span>
    </div>
  </div>

  <div class="killfeed"></div>

  <div class="ammo">
    <div class="ammo-head">
      <span class="ammo-name">M4</span>
      <span class="ammo-mode">AUTO</span>
    </div>
    <div class="ammo-rule"></div>
    <div class="ammo-nums">
      <span class="ammo-mag">30</span>
      <span class="ammo-slash">/</span>
      <span class="ammo-res">210</span>
    </div>
    <div class="reload">
      <div class="reload-track"><div class="reload-fill"></div></div>
      <span class="reload-label">RELOADING</span>
    </div>
  </div>

  <div class="equip">
    <div class="eq eq-frag"><span class="eq-k">G</span><span class="eq-n">FRAG</span><span class="eq-c">2</span></div>
    <div class="eq eq-flash"><span class="eq-k">F</span><span class="eq-n">FLASH</span><span class="eq-c">1</span></div>
  </div>

  <div class="alert"></div>
  <div class="toast"></div>

  <canvas class="hud-reticle"></canvas>
  <div class="fx fx-white"></div>
</div>
<div class="menu-layer"></div>
`;
