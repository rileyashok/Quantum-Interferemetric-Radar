// Tests for the physics core. Run with: node simulator/sim.test.js
'use strict';
const assert = require('node:assert/strict');
const SPIR = require('./sim.js');

const BASE = {
  L: 37.6, v: 230, h: 11000,          // airliner
  h0: 35000, w0: 10, D: 20,           // team's platform values
  flux: 1e6, qe: 0.7, trans: 0.8, dark: 500, jitter: 50e-12,
};
const withP = o => Object.assign({}, BASE, o);
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

test('team formulas reproduce the true values from exact edge times', () => {
  const p = BASE, g = SPIR.geometry(p);
  const [c, A, B] = g.beams;
  const tr = B.tOn - A.tOn, ts = A.tOff - B.tOn, dtc = A.tOn - c.tOn;
  const v = p.D / tr, L = p.D * (ts / tr + 1), h = p.h0 * (v * dtc) / p.w0;
  assert.ok(rel(v, p.v) < 1e-12 && rel(L, p.L) < 1e-12 && rel(h, p.h) < 1e-12);
});

test('same seed gives the same result', () => {
  const a = SPIR.simulate(BASE, 7).est, b = SPIR.simulate(BASE, 7).est;
  assert.deepEqual(a, b);
});

test('clear sky: speed, length and altitude within 0.5%', () => {
  const s = SPIR.simulate(BASE, 1);
  assert.ok(s.est, 'no estimate');
  for (const k of ['v', 'L', 'h']) assert.ok(rel(s.est[k], s.truth[k]) < 0.005, `${k}: ${s.est[k]} vs ${s.truth[k]}`);
  assert.equal(s.warnings.length, 0, JSON.stringify(s.warnings));
});

test('plane shorter than beam spacing (negative ts) still measured', () => {
  const s = SPIR.simulate(withP({ L: 12, v: 550, h: 9000 }), 3);
  assert.ok(s.est.ts < 0);
  assert.ok(rel(s.est.L, 12) < 0.01, `L = ${s.est.L}`);
});

test('estimates are unbiased over many runs (moderate photon rate)', () => {
  const p = withP({ flux: 2e4 });
  const truth = SPIR.simulate(p, 1).truth;
  const ests = [];
  for (let i = 0; i < 300; i++) ests.push(SPIR.simulate(p, 1000 + i).est);
  const sum = SPIR.summarize(ests, truth);
  assert.equal(sum.failures, 0);
  for (const k of ['v', 'L', 'h']) {
    const { bias, sd, n } = sum.stats[k];
    assert.ok(Math.abs(bias) < 4 * sd / Math.sqrt(n) + 1e-4, `${k}: bias ${bias}, sd ${sd}`);
  }
});

test('fewer photons gives larger altitude spread', () => {
  const spread = flux => {
    const p = withP({ flux }), truth = SPIR.simulate(p, 1).truth, ests = [];
    for (let i = 0; i < 100; i++) ests.push(SPIR.simulate(p, 500 + i).est);
    return SPIR.summarize(ests, truth).stats.h.sd;
  };
  assert.ok(spread(1e4) > 3 * spread(1e6));
});

test('thick cloud raises the atmosphere warning', () => {
  const s = SPIR.simulate(withP({ trans: 0.002 }), 1);
  assert.ok(s.warnings.some(w => w.check === 'check_atmosphere'));
});

test('thick cloud with a weak laser raises the photon-count warning', () => {
  const s = SPIR.simulate(withP({ trans: 0.002, flux: 1e5 }), 1);
  assert.ok(s.warnings.some(w => w.check === 'check_photon_count'), s.warnings.map(w => w.check).join());
});

test('high dark counts raise the dark-count warning', () => {
  const s = SPIR.simulate(withP({ dark: 2e5 }), 1);
  assert.ok(s.warnings.some(w => w.check === 'check_dark_counts'));
});

test('slow target raises the bird warning; tabletop model does not', () => {
  const bird = SPIR.simulate(withP({ L: 1, v: 15, h: 300 }), 1);
  assert.ok(bird.warnings.some(w => w.check === 'check_bird_speed'));
  const toy = SPIR.simulate(withP({ L: 0.3, v: 0.5, h: 0.4, h0: 1, w0: 0.1, D: 0.26 }), 1);
  assert.ok(!toy.warnings.some(w => w.check === 'check_bird_speed'));
  assert.ok(rel(toy.est.h, 0.4) < 0.01, `toy h = ${toy.est.h}`);
});

test('LEO platform works', () => {
  const s = SPIR.simulate(withP({ h0: 500000, w0: 50 }), 2);
  assert.ok(rel(s.est.h, 11000) < 0.01, `h = ${s.est.h}`);
});

test('no signal: detection fails cleanly instead of crashing', () => {
  const s = SPIR.simulate(withP({ flux: 1, dark: 1000 }), 1);
  assert.ok(s.warnings.some(w => w.level === 'error'));
});

test('validation rejects a plane above the emitter', () => {
  assert.match(SPIR.validate(withP({ h: 40000 })), /below the emitter/);
  assert.match(SPIR.validate(withP({ L: 0 })), /Plane length/);
  assert.equal(SPIR.validate(BASE), null);
});

test('slowest preset stays fast enough for the browser', () => {
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) SPIR.simulate(withP({ L: 1, v: 15, h: 300, flux: 1e8 }), i);
  const ms = (Date.now() - t0) / 20;
  assert.ok(ms < 150, `${ms.toFixed(0)} ms per run`);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
