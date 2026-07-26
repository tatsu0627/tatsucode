import { POST } from '../core/artdirection.js';

/**
 * MENUS — main, pause, settings.
 *
 * The only part of the overlay that takes pointer events. Visual language:
 * left-aligned, condensed uppercase, hairline rules, one accent, blurred plate
 * behind. No rounded cards, no drop shadows on panels, no gradients on buttons —
 * a military shooter menu is a document, not a dashboard.
 *
 * Settings write straight through to the modules that own them:
 *   quality  -> render.quality.preset  (+ render.setQuality?.())
 *   passes   -> render.passes[name]
 *   fov/sens -> engine.settings        (documented shared bag, see ui.js)
 *   volumes  -> audio.setVolume()
 */

const PASS_LABELS = {
  ssao: 'Ambient Occlusion', ssr: 'Screen-Space Reflections', volumetric: 'Volumetric Light',
  taa: 'Temporal AA', motionblur: 'Motion Blur', bloom: 'Bloom', dof: 'Depth of Field',
  grain: 'Film Grain', chromatic: 'Chromatic Aberration', vignette: 'Vignette',
  sharpen: 'Sharpen', gbuffer: 'G-Buffer', lighting: 'Deferred Lighting', tonemap: 'Tonemap',
};
const LOCKED_PASSES = new Set(['gbuffer', 'lighting', 'tonemap']);

export const DEFAULTS = {
  quality: 'ultra',
  fov: 80,
  sensitivity: 1.0,
  invertY: false,
  damageNumbers: true,
  hitmarkers: true,
  compass: true,
  masterVolume: 0.85,
  sfxVolume: 1.0,
  ambienceVolume: 0.7,
  passes: {},
};

export class Menus {
  constructor(engine, host, ui) {
    this.engine = engine;
    this.ui = ui;
    this.host = host;
    this.stack = [];
    this.settings = { ...DEFAULTS, passes: {} };
    this.started = false;
    this._passesBuilt = false;
    this._load();
    this._build();
  }

  // ---- persistence ----------------------------------------------------------

  _load() {
    try {
      const raw = localStorage.getItem('blacksite.settings');
      if (raw) Object.assign(this.settings, JSON.parse(raw));
    } catch { /* private mode / disabled storage — defaults are fine */ }
  }

  _save() {
    try { localStorage.setItem('blacksite.settings', JSON.stringify(this.settings)); }
    catch { /* ignore */ }
  }

  // ---- construction ---------------------------------------------------------

  _build() {
    this.host.innerHTML = `
      <div class="menu-scrim"></div>

      <section class="menu menu-main" data-menu="main">
        <div class="menu-brand">
          <div class="menu-eyebrow">TASK FORCE 141 &nbsp;//&nbsp; CLASSIFIED</div>
          <h1 class="menu-title">OPERATION<br><em>BLACKSITE</em></h1>
          <div class="menu-sub">DESERT COMPOUND &nbsp;·&nbsp; 17:42 LOCAL &nbsp;·&nbsp; CLEAR</div>
        </div>
        <nav class="menu-nav">
          <button class="menu-item" data-act="play"><span class="mi-tick"></span>DEPLOY</button>
          <button class="menu-item" data-act="settings"><span class="mi-tick"></span>SETTINGS</button>
          <button class="menu-item" data-act="controls"><span class="mi-tick"></span>CONTROLS</button>
        </nav>
        <div class="menu-foot">BUILD 1.0.0 · THREE.JS · WEBGL2</div>
      </section>

      <section class="menu menu-pause" data-menu="pause">
        <div class="menu-brand">
          <div class="menu-eyebrow">MISSION SUSPENDED</div>
          <h1 class="menu-title small">PAUSED</h1>
        </div>
        <nav class="menu-nav">
          <button class="menu-item" data-act="resume"><span class="mi-tick"></span>RESUME</button>
          <button class="menu-item" data-act="settings"><span class="mi-tick"></span>SETTINGS</button>
          <button class="menu-item" data-act="controls"><span class="mi-tick"></span>CONTROLS</button>
          <button class="menu-item danger" data-act="abort"><span class="mi-tick"></span>ABORT TO MENU</button>
        </nav>
      </section>

      <section class="menu menu-panel" data-menu="settings">
        <header class="panel-head">
          <div class="menu-eyebrow">CONFIGURATION</div>
          <h2>SETTINGS</h2>
          <button class="panel-back" data-act="back">ESC · BACK</button>
        </header>
        <div class="panel-body" data-body="settings"></div>
      </section>

      <section class="menu menu-panel" data-menu="controls">
        <header class="panel-head">
          <div class="menu-eyebrow">REFERENCE</div>
          <h2>CONTROLS</h2>
          <button class="panel-back" data-act="back">ESC · BACK</button>
        </header>
        <div class="panel-body keys">
          ${[
            ['W A S D', 'Move'], ['SHIFT', 'Sprint'], ['CTRL / C', 'Crouch'],
            ['SPACE', 'Jump'], ['MOUSE 1', 'Fire'], ['MOUSE 2', 'Aim down sights'],
            ['R', 'Reload'], ['G', 'Frag grenade'], ['1 – 3', 'Weapon select'],
            ['ESC', 'Pause'],
          ].map(([k, v]) => `<div class="keyrow"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}
        </div>
      </section>
    `;

    this.host.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      this.ui.audio?.play('ui_click');
      if (act === 'play') this.startGame();
      else if (act === 'resume') this.close();
      else if (act === 'settings') this.open('settings');
      else if (act === 'controls') this.open('controls');
      else if (act === 'back') this.back();
      else if (act === 'abort') { this.stack = []; this.started = false; this.open('main'); }
    });
    this.host.addEventListener('pointerenter', e => {
      if (e.target.closest?.('.menu-item')) this.ui.audio?.play('ui_hover');
    }, true);

    this.menus = {};
    for (const el of this.host.querySelectorAll('[data-menu]')) {
      this.menus[el.dataset.menu] = el;
    }
  }

  _buildSettings() {
    if (this._passesBuilt) return;
    const body = this.host.querySelector('[data-body="settings"]');
    const render = this.engine.modules.get('render');
    let passNames = Object.keys(render?.passes || {});
    if (!passNames.length) passNames = POST.order.slice();
    passNames = passNames.filter(p => !LOCKED_PASSES.has(p));

    const rows = [];
    const group = t => rows.push(`<div class="grp">${t}</div>`);
    const row = (label, control, hint = '') => rows.push(
      `<div class="row"><div class="row-l"><span>${label}</span>${hint ? `<i>${hint}</i>` : ''}</div>` +
      `<div class="row-r">${control}</div></div>`);

    group('DISPLAY');
    row('Quality Preset',
      `<div class="seg" data-set="quality">` +
      ['low', 'high', 'ultra'].map(v =>
        `<button data-v="${v}">${v.toUpperCase()}</button>`).join('') + `</div>`,
      'Scales shadow, particle and post budgets');
    row('Field of View',
      `<div class="sld"><input type="range" min="65" max="120" step="1" data-set="fov"><output></output></div>`);

    group('INPUT');
    row('Sensitivity',
      `<div class="sld"><input type="range" min="0.1" max="4" step="0.05" data-set="sensitivity"><output></output></div>`);
    row('Invert Vertical', this._toggle('invertY'));

    group('HUD');
    row('Damage Numbers', this._toggle('damageNumbers'));
    row('Hitmarkers', this._toggle('hitmarkers'));
    row('Compass', this._toggle('compass'));

    group('POST PROCESSING');
    for (const p of passNames) {
      row(PASS_LABELS[p] || p, this._toggle('pass:' + p));
    }

    group('AUDIO');
    row('Master', `<div class="sld"><input type="range" min="0" max="1" step="0.01" data-set="masterVolume"><output></output></div>`);
    row('Weapons &amp; Effects', `<div class="sld"><input type="range" min="0" max="1" step="0.01" data-set="sfxVolume"><output></output></div>`);
    row('Ambience', `<div class="sld"><input type="range" min="0" max="1" step="0.01" data-set="ambienceVolume"><output></output></div>`);

    body.innerHTML = rows.join('');

    // Default any pass we have not seen before to on.
    for (const p of passNames) {
      if (this.settings.passes[p] === undefined) this.settings.passes[p] = true;
    }

    body.addEventListener('input', e => {
      const k = e.target.dataset.set;
      if (!k) return;
      this.settings[k] = parseFloat(e.target.value);
      this._syncOne(e.target);
      this.apply();
      this._save();
    });
    body.addEventListener('click', e => {
      const seg = e.target.closest('.seg button');
      if (seg) {
        this.settings[seg.parentElement.dataset.set] = seg.dataset.v;
        this._syncControls(); this.apply(); this._save();
        this.ui.audio?.play('ui_click');
        return;
      }
      const tgl = e.target.closest('.tgl');
      if (tgl) {
        const k = tgl.dataset.set;
        if (k.startsWith('pass:')) {
          const p = k.slice(5);
          this.settings.passes[p] = !this.settings.passes[p];
        } else this.settings[k] = !this.settings[k];
        this._syncControls(); this.apply(); this._save();
        this.ui.audio?.play('ui_click');
      }
    });

    this._passesBuilt = true;
    this._syncControls();
  }

  _toggle(key) {
    return `<button class="tgl" data-set="${key}" role="switch"><span class="tgl-track"><span class="tgl-knob"></span></span><em>OFF</em></button>`;
  }

  _syncOne(input) {
    const out = input.parentElement.querySelector('output');
    if (!out) return;
    const k = input.dataset.set;
    const v = this.settings[k];
    out.textContent = (k === 'fov') ? `${Math.round(v)}°`
      : (k.endsWith('Volume')) ? `${Math.round(v * 100)}`
      : v.toFixed(2);
  }

  _syncControls() {
    for (const seg of this.host.querySelectorAll('.seg')) {
      const v = this.settings[seg.dataset.set];
      for (const b of seg.children) b.classList.toggle('on', b.dataset.v === v);
    }
    for (const inp of this.host.querySelectorAll('input[type=range][data-set]')) {
      inp.value = this.settings[inp.dataset.set];
      this._syncOne(inp);
    }
    for (const t of this.host.querySelectorAll('.tgl')) {
      const k = t.dataset.set;
      const on = k.startsWith('pass:') ? !!this.settings.passes[k.slice(5)] : !!this.settings[k];
      t.classList.toggle('on', on);
      t.setAttribute('aria-checked', String(on));
      t.querySelector('em').textContent = on ? 'ON' : 'OFF';
    }
  }

  // ---- application ----------------------------------------------------------

  /** Push settings into the modules that own them. Safe before they exist. */
  apply() {
    const e = this.engine;
    e.settings = e.settings || {};
    Object.assign(e.settings, {
      fov: this.settings.fov,
      sensitivity: this.settings.sensitivity,
      invertY: this.settings.invertY,
      quality: this.settings.quality,
    });

    const render = e.modules.get('render');
    if (render) {
      try {
        render.quality = render.quality || {};
        if (render.quality.preset !== this.settings.quality) {
          render.quality.preset = this.settings.quality;
          render.setQuality?.(this.settings.quality);
        }
        render.passes = render.passes || {};
        for (const [k, v] of Object.entries(this.settings.passes)) {
          if (render.passes[k] !== v) {
            render.passes[k] = v;
            render.setPass?.(k, v);
          }
        }
      } catch { /* render is another agent's module; never let it break the menu */ }
    }

    const audio = e.modules.get('audio');
    try {
      audio?.setVolume?.('master', this.settings.masterVolume);
      audio?.setVolume?.('sfx', this.settings.sfxVolume);
      audio?.setVolume?.('ambience', this.settings.ambienceVolume);
    } catch { /* ignore */ }

    this.ui.onSettingsChanged?.(this.settings);
  }

  // ---- navigation -----------------------------------------------------------

  get open_() { return this.stack.length > 0; }

  open(name) {
    if (name === 'settings') this._buildSettings();
    if (this.stack[this.stack.length - 1] !== name) this.stack.push(name);
    this._render();
  }

  back() {
    this.stack.pop();
    if (!this.stack.length && !this.started) this.stack.push('main');
    this._render();
  }

  close() {
    this.stack.length = 0;
    this._render();
    this.ui.requestPointerLock();
  }

  startGame() {
    this.started = true;
    this.stack.length = 0;
    this._render();
    this.ui.onGameStart();
  }

  toggglePause() { this.togglePause(); }

  togglePause() {
    if (!this.started) return;
    if (this.stack.length) this.back();
    else this.open('pause');
  }

  _render() {
    const top = this.stack[this.stack.length - 1] || null;
    for (const [name, el] of Object.entries(this.menus)) {
      el.classList.toggle('show', name === top);
    }
    this.host.classList.toggle('active', !!top);
    document.body.classList.toggle('menu-open', !!top);
    const p = this.engine.modules.get('player');
    if (p && !this.engine.captureMode) {
      if (top) {
        if (this._playerWasEnabled === undefined) this._playerWasEnabled = p.enabled !== false;
        p.enabled = false;
      } else if (this._playerWasEnabled !== undefined) {
        p.enabled = this._playerWasEnabled;
        this._playerWasEnabled = undefined;
      }
    }
    this.ui.audio?.setMenuDuck?.(!!top);
  }
}
