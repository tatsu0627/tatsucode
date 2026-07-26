#!/usr/bin/env node
/**
 * Time material and level construction on the CPU, without a browser.
 * Geometry building needs no WebGL context, so a slow or hanging boot can be
 * localised here in seconds instead of minutes of headless rendering.
 */
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { MaterialLibrary } from '../src/world/materials.js';
import { buildLevel } from '../src/world/level.js';

// buildAll() is skipped: the decal atlas needs a canvas, which Node has no
// business providing. buildLevel pulls materials in lazily through get(), and
// it is geometry construction we are timing here.
let t = performance.now();
const ml = new MaterialLibrary(null, { scale: parseFloat(process.argv[2] || '0.5') });
console.log(`materials  ${(performance.now() - t).toFixed(0)}ms (lazy)`);

t = performance.now();
const root = new THREE.Group();
const r = buildLevel(ml, root);
console.log(`level      ${(performance.now() - t).toFixed(0)}ms`);
console.log(`  tris ${Math.round(r.tris)}  draws ${r.targets.length}  colliders ${r.colliders.length}`);
