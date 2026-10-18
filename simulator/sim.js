/*
 * SPI-R beam simulator: physics and estimation core.
 *
 * No DOM access, so the same file runs in the browser (as window.SPIR) and in
 * Node (via require) for tests.
 *
 * Geometry (side view, plane flying left to right):
 *   - An emitter at altitude h0 sends three beams down to a ground station.
 *   - Beams A and B are vertical, a distance D apart (A at x = 0, B at x = D).
 *   - The cone beam is slanted: it leaves the emitter w0 to the left of beam A
 *     and converges onto the same ground point as beam A. At altitude h its
 *     edge is d1 = w0 * h / h0 to the left of beam A.
 *   - The plane is a line of length L at altitude h moving at speed v.
 *
 * Units: metres, seconds, photons per second.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPIR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_BINS = 4000;          // coarse time bins per detector
  const MIN_COUNTS_PER_BIN = 30;  // expected photons in an unblocked bin
  const REFINE_HALF_WINDOW = 3;   // coarse bins searched either side of an edge

  // Thresholds for the checks. The team's backend left these blank; these are our picks.
  const LIMITS = {
    minTransmission: 0.05,  // check_atmosphere
    maxDarkFraction: 0.1,   // check_dark_counts: dark rate / signal rate
    minBinsPerBlock: 4,     // check_photon_count: coarse bins while a beam is blocked
    birdSpeed: 35,          // check_bird_speed, m/s (about 78 mph)
  };

  // ---------- random numbers (seeded, so runs are reproducible) ----------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(rng) {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }

  function poisson(rng, mu) {
    if (mu <= 0) return 0;
    if (mu < 30) {
      const limit = Math.exp(-mu);
      let k = 0, p = rng();
      while (p > limit) { k++; p *= rng(); }
      return k;
    }
    return Math.max(0, Math.round(mu + Math.sqrt(mu) * gauss(rng)));
  }

  function overlap(a, b, c, d) {
    return Math.max(0, Math.min(b, d) - Math.max(a, c));
  }

  // ---------- model ----------

  function validate(p) {
    const names = {
      L: 'Plane length', v: 'Speed', h: 'Altitude',
      h0: 'Emitter altitude', w0: 'Cone half-width', D: 'Beam spacing',
      flux: 'Photon flux', qe: 'Detector efficiency', trans: 'Sky transmission',
    };
    for (const k in names) {
      if (!(p[k] > 0) || !isFinite(p[k])) return `${names[k]} must be a positive number.`;
    }
    if (!(p.dark >= 0)) return 'Dark count rate cannot be negative.';
    if (!(p.jitter >= 0)) return 'Timing jitter cannot be negative.';
    if (p.h >= p.h0) return 'The plane has to fly below the emitter (altitude less than emitter altitude).';
    return null;
  }

  function geometry(p) {
    const d1 = p.w0 * p.h / p.h0;
    const pad = 0.15 * (p.D + d1 + p.L);
    const x0 = -d1 - pad;              // nose position at t = 0
    const xEnd = p.D + p.L + pad;      // nose position when the run ends
    const beams = [
      { id: 'cone', label: 'Cone', x: -d1 },
      { id: 'A', label: 'Beam A', x: 0 },
      { id: 'B', label: 'Beam B', x: p.D },
    ].map(b => Object.assign(b, {
      tOn: (b.x - x0) / p.v,           // nose reaches the beam
      tOff: (b.x - x0 + p.L) / p.v,    // tail clears the beam
    }));
    return { d1, x0, xEnd, span: (xEnd - x0) / p.v, beams };
  }

  function rates(p) {
    const signal = p.flux * p.trans * p.qe;
    return { signal, on: signal + p.dark, off: p.dark };
  }

  function truthOf(p, g) {
    return {
      v: p.v, L: p.L, h: p.h, d1: g.d1,
      tr: p.D / p.v,
      ts: (p.L - p.D) / p.v,
      dtc: g.d1 / p.v,
    };
  }

  // ---------- estimation ----------

  // Classify coarse bins as blocked / unblocked and return the longest blocked run.
  function findBlockedRun(counts, muOn, muOff) {
    const lo = Math.max(muOff, muOn * 1e-6);
    if (muOn <= lo * 1.5) return null;  // no contrast between on and off
    // Count where the on and off Poisson likelihoods are equal.
    const thr = (muOn - lo) / Math.log(muOn / lo);
    const n = counts.length;
    const blocked = new Uint8Array(n);
    for (let i = 0; i < n; i++) blocked[i] = counts[i] < thr ? 1 : 0;
    for (let i = 1; i < n - 1; i++) {
      if (!blocked[i] && blocked[i - 1] && blocked[i + 1]) blocked[i] = 1;  // bridge one-bin gaps
    }
    let best = null;
    for (let i = 0; i < n;) {
      if (!blocked[i]) { i++; continue; }
      let j = i;
      while (j < n && blocked[j]) j++;
      if (!best || j - i > best.end - best.start) best = { start: i, end: j };
      i = j;
    }
    return best;
  }

  // Draw the individual photon times inside some coarse bins, consistent with
  // their counts (given a count, photons in a bin are spread in proportion to the rate).
  function photonTimes(rng, det, r, dt, jitter, i0, i1) {
    const times = [];
    for (let i = i0; i < i1; i++) {
      const n = det.counts[i];
      if (!n) continue;
      const a = i * dt, b = a + dt;
      const segs = [
        [a, Math.min(b, det.tOn), r.on],
        [Math.max(a, det.tOn), Math.min(b, det.tOff), r.off],
        [Math.max(a, det.tOff), b, r.on],
      ].filter(s => s[1] > s[0] && s[2] > 0);
      const weights = segs.map(s => (s[1] - s[0]) * s[2]);
      const total = weights.reduce((x, y) => x + y, 0);
      if (!(total > 0)) continue;
      for (let k = 0; k < n; k++) {
        let u = rng() * total, s = 0;
        while (s < segs.length - 1 && u > weights[s]) { u -= weights[s]; s++; }
        const [sa, sb] = segs[s];
        times.push(sa + rng() * (sb - sa) + (jitter ? jitter * gauss(rng) : 0));
      }
    }
    return Float64Array.from(times).sort();
  }

  // Maximum-likelihood time of a step in photon rate (r1 before, r2 after) within [a, b].
  // Log-likelihood, up to a constant: n(tau) * ln(r1/r2) - (r1 - r2) * (tau - a),
  // where n(tau) is the number of photons before tau. It only peaks at a photon
  // time or at the window ends, so those are the only candidates checked.
  function stepTime(times, a, b, r1, r2) {
    const k = Math.log(r1 / r2), slope = r1 - r2;
    let bestT = a, bestLL = 0, atEvent = false, n = 0;
    for (let j = 0; j < times.length; j++) {
      const t = times[j];
      if (t < a || t > b) continue;
      const before = n * k - slope * (t - a);
      const after = (n + 1) * k - slope * (t - a);
      if (before > bestLL) { bestLL = before; bestT = t; atEvent = true; }
      if (after > bestLL) { bestLL = after; bestT = t; atEvent = true; }
      n++;
    }
    if (n * k - slope * (b - a) > bestLL) { bestT = b; atEvent = false; }
    return { t: bestT, atEvent };
  }

  function refineEdge(rng, det, r, dt, jitter, nb, edgeBin, falling) {
    const i0 = Math.max(0, edgeBin - REFINE_HALF_WINDOW);
    const i1 = Math.min(nb, edgeBin + REFINE_HALF_WINDOW);
    const times = photonTimes(rng, det, r, dt, jitter, i0, i1);
    const off = Math.max(r.off, r.on * 1e-6);
    const res = falling
      ? stepTime(times, i0 * dt, i1 * dt, r.on, off)
      : stepTime(times, i0 * dt, i1 * dt, off, r.on);
    // The fit lands on the last photon before the beam goes dark (or the first after
    // it comes back). The true edge is on average one photon gap 1/r.on further on.
    if (!res.atEvent) return res.t;
    return res.t + (falling ? 1 : -1) / r.on;
  }

  function estimateEdges(rng, det, r, dt, jitter, nb) {
    const run = findBlockedRun(det.counts, r.on * dt, r.off * dt);
    if (!run) return null;
    return {
      tOn: refineEdge(rng, det, r, dt, jitter, nb, run.start, true),
      tOff: refineEdge(rng, det, r, dt, jitter, nb, run.end, false),
    };
  }

  // Turn the six edge times into speed, length and altitude (team formulas).
  function combine(p, dets) {
    const [c, A, B] = dets.map(d => d.est);
    if (!A || !B) return null;
    const tr = ((B.tOn - A.tOn) + (B.tOff - A.tOff)) / 2;  // A -> B delay, nose and tail averaged
    if (!(tr > 0)) return null;
    const v = p.D / tr;
    const ts = A.tOff - B.tOn;                               // A and B both blocked (negative = gap)
    const L = p.D * (ts / tr + 1);
    const out = { tr, ts, v, L, dtc: null, d1: null, h: null };
    if (c) {
      out.dtc = ((A.tOn - c.tOn) + (A.tOff - c.tOff)) / 2;   // cone -> A delay
      out.d1 = v * out.dtc;
      out.h = p.h0 * out.d1 / p.w0;                          // similar triangles: d1 / h = w0 / h0
    }
    return out;
  }

  function pct(x) {
    return x < 0.01 ? `${(x * 100).toPrecision(2)}%` : `${Math.round(x * 100)}%`;
  }

  function checks(p, r, dt, dets, est) {
    const out = [];
    if (p.trans < LIMITS.minTransmission) {
      out.push({ level: 'warn', check: 'check_atmosphere',
        text: `Poor atmospheric conditions: only ${pct(p.trans)} of the light gets through.` });
    }
    if (r.off > LIMITS.maxDarkFraction * r.signal) {
      out.push({ level: 'warn', check: 'check_dark_counts',
        text: `Dark counts are ${pct(r.off / r.signal)} of the signal, so a blocked beam is hard to tell from an open one.` });
    }
    if ((p.L / p.v) / dt < LIMITS.minBinsPerBlock) {
      out.push({ level: 'warn', check: 'check_photon_count',
        text: `Not enough photons: only about ${Math.round(r.on * p.L / p.v)} photons per detector arrive in the time the plane blocks a beam.` });
    }
    dets.forEach(d => {
      if (!d.est) out.push({ level: 'error', check: 'detection', text: `${d.label}: no blockage found in the photon counts.` });
    });
    if (est) {
      // Skip for the tabletop model, where everything is slow.
      if (p.h0 >= 100 && est.v < LIMITS.birdSpeed) {
        out.push({ level: 'warn', check: 'check_bird_speed',
          text: `Estimated speed ${est.v.toFixed(1)} m/s is under ${LIMITS.birdSpeed} m/s, so this could be a bird rather than an aircraft.` });
      }
      if (est.h != null && !(est.h > 0 && est.h < p.h0)) {
        out.push({ level: 'error', check: 'altitude', text: 'Altitude estimate is outside the physical range (0 to emitter altitude).' });
      }
    }
    return out;
  }

  // ---------- public entry points ----------

  function simulate(p, seed) {
    const err = validate(p);
    if (err) throw new Error(err);
    const rng = mulberry32(seed);
    const g = geometry(p);
    const r = rates(p);
    const nb = Math.max(1, Math.min(MAX_BINS, Math.floor(g.span * r.on / MIN_COUNTS_PER_BIN)));
    const dt = g.span / nb;
    const detectors = g.beams.map(b => {
      const counts = new Float64Array(nb);
      for (let i = 0; i < nb; i++) {
        const a = i * dt, blocked = overlap(a, a + dt, b.tOn, b.tOff);
        counts[i] = poisson(rng, r.on * (dt - blocked) + r.off * blocked);
      }
      return Object.assign({}, b, { counts });
    });
    detectors.forEach(d => { d.est = estimateEdges(rng, d, r, dt, p.jitter, nb); });
    const est = combine(p, detectors);
    return {
      params: p, seed, geom: g, rates: r, dt, nb, detectors, est,
      truth: truthOf(p, g),
      warnings: checks(p, r, dt, detectors, est),
    };
  }

  // Bias and spread of relative errors over many runs' estimates.
  function summarize(estimates, truth) {
    const stats = {};
    ['v', 'L', 'h'].forEach(k => {
      const errs = estimates
        .filter(e => e && e[k] != null && isFinite(e[k]))
        .map(e => (e[k] - truth[k]) / truth[k]);
      const n = errs.length;
      const mean = n ? errs.reduce((a, b) => a + b, 0) / n : NaN;
      const sd = n > 1 ? Math.sqrt(errs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
      stats[k] = { n, bias: mean, sd };
    });
    const failures = estimates.filter(e => !e || e.h == null).length;
    return { n: estimates.length, failures, stats };
  }

  return { simulate, summarize, validate, geometry, rates, LIMITS };
});
