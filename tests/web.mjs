import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { analyze, settings, raw, shapes, evaluate } from "../docs/core.js";
let assertions = 0;
const check = (v, m) => {
  assertions++;
  assert(v, m);
};
function compare(a, b, path = "") {
  if (typeof a === "number") {
    check(Number.isFinite(a) && Number.isFinite(b), path + " finite");
    check(
      Math.abs(a - b) < 2e-13 + Math.abs(a) * 3e-11,
      `${path}: ${a} != ${b}`,
    );
  } else if (a === null || typeof a !== "object") check(a === b, path);
  else {
    check(
      JSON.stringify(Object.keys(a)) === JSON.stringify(Object.keys(b)),
      path + " keys",
    );
    for (const k of Object.keys(a)) compare(a[k], b[k], path + "." + k);
  }
}
const configs = [];
for (const scenario of [0, 1, 2])
  for (const budget of [0, 1]) configs.push({ scenario, budget, slice: 6 });
const run = spawnSync(
  "python3",
  [
    "-c",
    "import sys,json;from tenorwell.core import analyze;print(json.dumps([analyze(c) for c in json.load(sys.stdin)],allow_nan=False))",
  ],
  {
    input: JSON.stringify(configs),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);
assert.equal(run.status, 0, run.stderr);
const expected = JSON.parse(run.stdout);
configs.forEach((cfg, i) => compare(analyze(cfg), expected[i], "full" + i));
for (const cfg of configs) {
  const base = analyze(cfg);
  for (let slice = 0; slice < 15; slice++) {
    const r = analyze({ ...cfg, slice });
    check(
      JSON.stringify(r.fits) === JSON.stringify(base.fits),
      "slice not fit input",
    );
    check(
      JSON.stringify(r.surface) === JSON.stringify(base.surface),
      "slice not surface input",
    );
    check(
      JSON.stringify(r.selected) === JSON.stringify(r.surface[slice]),
      "selected row",
    );
  }
  for (const v of base.selected) {
    const eps = 1e-4,
      lo = evaluate(base.fits, v.k - eps, base.time).w,
      hi = evaluate(base.fits, v.k + eps, base.time).w;
    check(Math.abs(v.dw - (hi - lo) / (2 * eps)) < 1e-6, "finite diff first");
    check(
      Math.abs(v.ddw - (hi - 2 * v.w + lo) / eps ** 2) < 3e-5,
      "finite diff second",
    );
  }
}
for (const v of [
  null,
  [],
  {},
  false,
  { ...settings(), extra: 1 },
  { ...settings(), scenario: true },
  { ...settings(), budget: 2 },
  { ...settings(), slice: NaN },
  { ...settings(), slice: 15 },
  { ...settings(), slice: 1.5 },
]) {
  assert.throws(() => analyze(v));
  assertions++;
}
const cfg = settings(),
  before = JSON.stringify(cfg);
analyze(cfg);
check(before === JSON.stringify(cfg), "input not mutated");
compare(raw(0, [0.02, 0.1, -0.4, 0, 0.2]), [0.04, -0.04, 0.5]);
check(shapes(0).length === 36 && shapes(1).length === 175, "grids");
console.log(
  `${assertions} JS assertions; 6 complete Python parity states,90 selected slices and finite-difference diagnostics PASS`,
);
