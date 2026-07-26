import * as THREE from 'three';

/**
 * Depth + view-space normal prepass.
 *
 * Everything downstream (GTAO, SSR, TAA reprojection, motion blur, DOF) reads
 * from here, so it deliberately lives on its own render target that no chain
 * pass is ever allowed to write to. That is the whole reason this is a separate
 * pass instead of an attachment on the beauty buffer: third-party passes call
 * renderer.clear() with autoClearDepth enabled and would silently wipe it.
 *
 * Only opaque, depth-writing meshes are rasterised. Sky domes (depthWrite:false),
 * transparent FX, sprites, points and lines are excluded — a particle in the
 * depth buffer produces exactly the kind of ghosting halo that gives temporal
 * AA a bad name. Other modules can opt a mesh out with `obj.userData.noGBuffer`.
 *
 * Normals are geometric, not normal-mapped, on purpose: the art bible calls for
 * high-frequency detail normals (PBR.detailNormalTiling = 12), and feeding those
 * into a 0.5m-radius AO kernel produces noise the denoiser then has to smear
 * back out. Macro occlusion wants macro normals.
 */
export class GBufferPass {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.name = 'gbuffer.normal';

    // Plain depth, not depth-stencil. The renderer is created with stencil
    // disabled, so the packed DEPTH24_STENCIL8 format buys nothing — and the
    // consumers that sample this texture (GTAO, SSR, volumetrics) reconstruct
    // view position from it expecting a straight depth read. Sampling a packed
    // depth-stencil target gave occlusion only at large depth discontinuities,
    // which showed up as hairline creases at silhouettes and no contact
    // shading anywhere, regardless of AO radius.
    const depth = new THREE.DepthTexture(1, 1);
    depth.format = THREE.DepthFormat;
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    depth.name = 'gbuffer.depth';
    this.target.depthTexture = depth;

    this.depthTexture = depth;
    this.normalTexture = this.target.texture;

    this._matCache = new Map();
    this._swapped = [];
    this._hidden = [];
    this._clearColor = new THREE.Color();
  }

  setSize(w, h) {
    this.target.setSize(w, h);
  }

  _normalMaterialFor(src) {
    const side = src.side ?? THREE.FrontSide;
    const flat = src.flatShading ? 1 : 0;
    const key = `${side}|${flat}`;
    let m = this._matCache.get(key);
    if (!m) {
      m = new THREE.MeshNormalMaterial({ side, flatShading: !!flat });
      m.blending = THREE.NoBlending;
      m.fog = false;
      this._matCache.set(key, m);
    }
    return m;
  }

  _prepare(scene) {
    const swapped = this._swapped;
    const hidden = this._hidden;

    scene.traverse((o) => {
      if (!o.visible) return;

      if (o.isPoints || o.isLine || o.isSprite || o.userData?.noGBuffer) {
        o.visible = false;
        hidden.push(o);
        return;
      }
      if (!o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !o.isBatchedMesh) return;

      const mat = o.material;
      if (Array.isArray(mat)) {
        // A multi-material mesh: if every slot is excluded, hide the whole thing.
        let anyOpaque = false;
        for (const m of mat) if (m && m.depthWrite !== false && !m.transparent) anyOpaque = true;
        if (!anyOpaque) { o.visible = false; hidden.push(o); return; }
        swapped.push([o, mat]);
        o.material = mat.map((m) => this._normalMaterialFor(m ?? {}));
      } else if (mat) {
        if (mat.depthWrite === false || mat.transparent === true) {
          o.visible = false;
          hidden.push(o);
          return;
        }
        swapped.push([o, mat]);
        o.material = this._normalMaterialFor(mat);
      }
    });
  }

  _restore() {
    for (let i = 0; i < this._swapped.length; i++) {
      this._swapped[i][0].material = this._swapped[i][1];
    }
    for (let i = 0; i < this._hidden.length; i++) this._hidden[i].visible = true;
    this._swapped.length = 0;
    this._hidden.length = 0;
  }

  render(renderer, scene, camera) {
    const prevBackground = scene.background;
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(this._clearColor);
    const prevAlpha = renderer.getClearAlpha();

    scene.background = null;
    renderer.autoClear = false;

    this._prepare(scene);

    renderer.setRenderTarget(this.target);
    // 0x8080ff == a normal of (0,0,1) facing the camera; keeps the sky from
    // producing a bogus horizon in the AO kernel.
    renderer.setClearColor(0x8080ff, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    this._restore();

    scene.background = prevBackground;
    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(this._clearColor, prevAlpha);
  }

  dispose() {
    this.target.dispose();
    for (const m of this._matCache.values()) m.dispose();
    this._matCache.clear();
  }
}
