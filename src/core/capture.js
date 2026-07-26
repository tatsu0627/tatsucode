import * as THREE from 'three';

/**
 * Capture mode — deterministic vantage points for automated screenshotting.
 *
 * Usage: index.html?shot=<id>[&t=<seconds>]
 *   - freezes player input, places the camera at a fixed pose
 *   - advances the world clock to a fixed time so lighting/animation are stable
 *   - sets window.__READY__ = true once the temporal accumulators (TAA, SSAO
 *     history, volumetrics) have converged, so screenshots are noise-free
 *
 * Add vantage points here as the level grows. Each should frame something a
 * reviewer would judge: silhouette lighting, material variety, a weapon
 * viewmodel, atmosphere depth.
 */
export const SHOTS = {
  // [position, lookAt, fov]
  hero:     { pos: [ 12.0, 2.6,  18.0], look: [ -4.0, 2.2, -10.0], fov: 65 },
  street:   { pos: [ -2.0, 1.7,  24.0], look: [ -2.0, 2.4, -30.0], fov: 75 },
  interior: { pos: [ -9.5, 1.7,  -2.0], look: [  2.0, 1.9,  -6.0], fov: 80 },
  weapon:   { pos: [  4.0, 1.7,   6.0], look: [ -6.0, 1.9,  -8.0], fov: 80, viewmodel: true },
  vista:    { pos: [ 20.0, 8.0,  30.0], look: [ -10.0, 1.0, -40.0], fov: 55 },
  shadows:  { pos: [ -14.0, 1.6,  10.0], look: [  6.0, 3.0,  -6.0], fov: 70 },
};

const CONVERGE_FRAMES = 64;

export function installCaptureMode(engine) {
  const params = new URLSearchParams(location.search);
  const shotId = params.get('shot');
  window.__READY__ = false;

  if (!shotId) {
    // Normal play: readiness still reported, for smoke tests.
    setTimeout(() => { window.__READY__ = true; }, 1500);
    return;
  }

  const shot = SHOTS[shotId] || SHOTS.hero;
  const t = parseFloat(params.get('t') ?? '0');

  engine.captureMode = true;
  if (engine.has('player')) {
    const p = engine.get('player');
    p.enabled = false;
    if (p.setPose) p.setPose(shot.pos, shot.look);
  }
  if (engine.has('weapons')) {
    engine.get('weapons').setVisible?.(shot.viewmodel !== false);
  }

  const cam = engine.camera;
  cam.position.fromArray(shot.pos);
  cam.lookAt(new THREE.Vector3().fromArray(shot.look));
  cam.fov = shot.fov;
  cam.updateProjectionMatrix();
  engine.elapsed = t;

  let frames = 0;
  const tick = () => {
    // Re-assert the pose each frame; gameplay modules may try to drive the camera.
    cam.position.fromArray(shot.pos);
    cam.lookAt(new THREE.Vector3().fromArray(shot.look));
    cam.fov = shot.fov;
    cam.updateProjectionMatrix();
    if (++frames >= CONVERGE_FRAMES) window.__READY__ = true;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
