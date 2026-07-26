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
  // Framed against the actual level layout: admin block at (-14,-6), warehouse
  // at (15,-4), guard tower at (-1,-34), road running north-south at x=-2.
  // Each vantage needs an unobstructed subject, a foreground element for depth,
  // and something in the far distance for the haze to work on.
  hero:     { pos: [  3.0, 1.75,  10.5], look: [-13.0, 3.4, -11.0], fov: 68 },
  street:   { pos: [ -2.0, 1.70,  15.5], look: [ -2.0, 2.2, -34.0], fov: 75 },
  interior: { pos: [ -8.5, 1.70,   1.5], look: [-16.0, 1.8,  -6.0], fov: 80 },
  weapon:   { pos: [  3.0, 1.70,   8.0], look: [ -6.0, 2.0,  -6.0], fov: 80, viewmodel: true },
  vista:    { pos: [ 22.0, 9.00,  26.0], look: [ -6.0, 1.0, -26.0], fov: 55 },
  shadows:  { pos: [-13.0, 1.60,   8.0], look: [  4.0, 2.5,  -8.0], fov: 70 },
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
