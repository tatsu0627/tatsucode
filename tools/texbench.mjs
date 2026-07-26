#!/usr/bin/env node
/**
 * Time each procedural texture set on the CPU.
 *
 * Texture synthesis needs no WebGL context, so it can be measured here without
 * a browser — which makes it the cheapest way to find out whether a slow boot
 * is texture generation or GPU work. Prints per-set timings and bails loudly on
 * any set that takes pathologically long.
 */
import { performance } from 'node:perf_hooks';

const scale = parseFloat(process.argv[2] || '0.5');
const { TextureLibrary, TEXTURE_NAMES } = await import('../src/world/texgen.js');

console.log(`generating ${TEXTURE_NAMES.length} sets at scale ${scale}\n`);
const lib = new TextureLibrary(null, { scale });

let total = 0;
for (const name of TEXTURE_NAMES) {
  const t0 = performance.now();
  let size = '?';
  try {
    const set = lib.get(name);
    size = set.size;
  } catch (e) {
    console.log(`  ${name.padEnd(16)} FAILED: ${e.message}`);
    continue;
  }
  const ms = performance.now() - t0;
  total += ms;
  const flag = ms > 3000 ? '  <-- SLOW' : '';
  console.log(`  ${name.padEnd(16)} ${size}px  ${ms.toFixed(0).padStart(6)}ms${flag}`);
}
console.log(`\ntotal ${(total / 1000).toFixed(1)}s`);
