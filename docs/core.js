// Original finite-candidate raw-SVI calibration and sampled shape diagnostics.
export const TENORS = [0.25, 0.5, 1, 2],
  NODES = Array.from({ length: 7 }, (_, i) => (i - 3) / 10),
  MONEYNESS = Array.from({ length: 61 }, (_, i) => (i - 30) / 100),
  TIMES = Array.from({ length: 15 }, (_, i) => 0.25 + i / 8),
  G_TOL = 1e-9,
  CAL_TOL = 1e-10;
export const WORLDS = [
  [
    "A quiet synthetic surface",
    "Four gently skewed smiles share a stable generating shape. Fitting still introduces approximation error.",
  ],
  [
    "A maturity out of order",
    "The one-year synthetic total variance is scaled down to 22%. Independent slice fitting does not fix calendar inconsistency.",
  ],
  [
    "Sharp wings, smooth fit",
    "Steep synthetic smiles can fit well while implying negative sampled density diagnostics. Positive total variance is not enough.",
  ],
];
export function settings() {
  return { scenario: 0, budget: 0, slice: 6 };
}
export function validate(v) {
  if (
    v === null ||
    typeof v !== "object" ||
    Object.getPrototypeOf(v) !== Object.prototype ||
    Object.keys(v).sort().join(",") !== Object.keys(settings()).sort().join(",")
  )
    throw new Error("settings require exactly scenario, budget and slice");
  for (const [key, upper] of [
    ["scenario", 2],
    ["budget", 1],
    ["slice", 14],
  ])
    if (!Number.isSafeInteger(v[key]) || v[key] < 0 || v[key] > upper)
      throw new Error(`${key} must be an integer in 0..${upper}`);
}
export function shapes(budget) {
  const ms = budget === 0 ? [-0.08, 0, 0.08] : [-0.08, -0.04, 0, 0.04, 0.08],
    ss = budget === 0 ? [0.04, 0.12, 0.24] : [0.04, 0.08, 0.12, 0.18, 0.24],
    rs =
      budget === 0
        ? [-0.8, -0.4, 0, 0.4]
        : [-0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4],
    out = [];
  for (const m of ms)
    for (const s of ss) for (const r of rs) out.push([m, s, r]);
  return out;
}
export function raw(k, p) {
  const [a, b, r, m, s] = p,
    z = k - m,
    h = Math.sqrt(z * z + s * s);
  return [a + b * (r * z + h), b * (r + z / h), (b * s * s) / h ** 3];
}
export function truthParameters(scenario, t) {
  let p = [0.018 * t, 0.11 * t, -0.55, 0.025, 0.13];
  if (scenario === 1 && t === 1) {
    p[0] *= 0.22;
    p[1] *= 0.22;
  } else if (scenario === 2)
    p = [0.002 * t, 0.9 * Math.sqrt(t), -0.55, 0.025, 0.055];
  return p;
}
export function fitSlice(scenario, budget, t) {
  const truth = truthParameters(scenario, t),
    observations = NODES.map((k) => ({
      k,
      iv: Math.sqrt(raw(k, truth)[0] / t),
    })),
    targets = observations.map((o) => o.iv ** 2 * t),
    meanY = targets.reduce((s, v) => s + v, 0) / targets.length,
    candidates = [];
  let best = null;
  shapes(budget).forEach(([m, s, rho], index) => {
    const feature = NODES.map(
        (k) => rho * (k - m) + Math.sqrt((k - m) ** 2 + s * s),
      ),
      meanX = feature.reduce((s, v) => s + v, 0) / feature.length,
      xx = feature.reduce((s, x) => s + (x - meanX) ** 2, 0),
      b =
        feature.reduce((s, x, i) => s + (x - meanX) * (targets[i] - meanY), 0) /
        xx,
      a = meanY - b * meanX,
      parameters = [a, b, rho, m, s],
      minimum = a + b * s * Math.sqrt(1 - rho * rho),
      accepted = b >= 0 && minimum > 1e-8,
      sse = NODES.reduce(
        (s, k, i) => s + (raw(k, parameters)[0] - targets[i]) ** 2,
        0,
      ),
      candidate = {
        id: index,
        parameters,
        minimum_variance: minimum,
        accepted,
        sse,
      };
    candidates.push(candidate);
    if (accepted && (best === null || sse < best.sse)) best = candidate;
  });
  if (best === null)
    throw new Error("fixed synthetic case has no admissible fit");
  const residuals = observations.map((o, i) => ({
    ...o,
    target_w: targets[i],
    fitted_w: raw(o.k, best.parameters)[0],
    fitted_iv: Math.sqrt(raw(o.k, best.parameters)[0] / t),
    residual_w: raw(o.k, best.parameters)[0] - targets[i],
  }));
  return {
    time: t,
    parameters: [...best.parameters],
    winner_id: best.id,
    sse: best.sse,
    rmse_w: Math.sqrt(best.sse / NODES.length),
    accepted_count: candidates.filter((c) => c.accepted).length,
    candidate_count: candidates.length,
    candidates,
    observations: residuals,
  };
}
export function evaluate(fits, k, time) {
  let interval = 2;
  for (let i = 0; i < 3; i++)
    if (time <= TENORS[i + 1]) {
      interval = i;
      break;
    }
  const u =
      (time - TENORS[interval]) / (TENORS[interval + 1] - TENORS[interval]),
    left = raw(k, fits[interval].parameters),
    right = raw(k, fits[interval + 1].parameters),
    [w, d, dd] = left.map((v, i) => (1 - u) * v + u * right[i]);
  if (!Number.isFinite(w) || w <= 0)
    throw new Error("variance must be positive in the fixed model");
  const g =
    (1 - (k * d) / (2 * w)) ** 2 - ((d * d) / 4) * (1 / w + 0.25) + dd / 2;
  return {
    k,
    time,
    w,
    iv: Math.sqrt(w / time),
    dw: d,
    ddw: dd,
    g,
    density_flag: g < -G_TOL,
    left: interval,
    right: interval + 1,
    fraction: u,
  };
}
export function analyze(value = settings()) {
  validate(value);
  const config = { ...value },
    fits = TENORS.map((t) => fitSlice(config.scenario, config.budget, t)),
    rows = TIMES.map((t) => MONEYNESS.map((k) => evaluate(fits, k, t))),
    calendar = [];
  for (let i = 0; i < 14; i++)
    for (let j = 0; j < 61; j++) {
      const delta = rows[i + 1][j].w - rows[i][j].w;
      calendar.push({
        k: MONEYNESS[j],
        earlier: TIMES[i],
        later: TIMES[i + 1],
        delta_w: delta,
        flag: delta < -CAL_TOL,
      });
    }
  const flat = rows.flat(),
    worstG = flat.reduce((a, b) => (b.g < a.g ? b : a)),
    minimumCalendarDelta = Math.min(...calendar.map((c) => c.delta_w)),
    worstCalendar = calendar.find(
      (c) => c.delta_w <= minimumCalendarDelta + 1e-14,
    );
  return {
    settings: config,
    name: WORLDS[config.scenario][0],
    description: WORLDS[config.scenario][1],
    fits,
    surface: rows,
    selected: rows[config.slice],
    time: TIMES[config.slice],
    calendar,
    summary: {
      density_checks: flat.length,
      density_flags: flat.filter((c) => c.density_flag).length,
      calendar_checks: calendar.length,
      calendar_flags: calendar.filter((c) => c.flag).length,
      worst_g: { ...worstG },
      worst_calendar: { ...worstCalendar },
      fit_rmse_w: Math.sqrt(fits.reduce((s, f) => s + f.sse, 0) / 28),
      candidates_per_slice: shapes(config.budget).length,
    },
  };
}
