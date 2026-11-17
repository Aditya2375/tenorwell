import { analyze, settings, TIMES, TENORS } from "./core.js";
const $ = (id) => document.getElementById(id),
  text = (id, v) => ($(id).textContent = v),
  fmt = (n, d = 6) => n.toFixed(d),
  pct = (n) => (n * 100).toFixed(3) + "%",
  cell = (tag, value) => {
    const n = document.createElement(tag);
    n.textContent = value;
    return n;
  };
let current;
TIMES.forEach((t, i) => {
  const o = cell("option", t.toFixed(3));
  o.value = i;
  $("slice").append(o);
});
function rows(id, values, flags = []) {
  const frag = document.createDocumentFragment();
  values.forEach((r, i) => {
    const tr = document.createElement("tr");
    r.forEach((v) => tr.append(cell("td", v)));
    if (flags[i]) tr.lastChild.className = "flag";
    frag.append(tr);
  });
  $(id).replaceChildren(frag);
}
function node(tag, attributes = {}, value) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([k, v]) => n.setAttribute(k, String(v)));
  if (value !== undefined) n.textContent = value;
  return n;
}
function plot(id, data, key, color, nodes = []) {
  const svg = $(id),
    width = Math.max(230, svg.clientWidth),
    height = svg.clientHeight,
    l = 47,
    r = 12,
    top = 20,
    bottom = 35,
    w = width - l - r,
    h = height - top - bottom,
    values = [...data.map((v) => v[key]), ...nodes.map((v) => v.iv)],
    lo = Math.min(...values, key === "g" ? 0 : Infinity),
    hi = Math.max(...values, key === "g" ? 0 : -Infinity),
    pad = Math.max((hi - lo) * 0.12, 0.0001),
    ymin = lo - pad,
    ymax = hi + pad,
    x = (k) => l + ((k + 0.3) / 0.6) * w,
    y = (v) => top + ((ymax - v) / (ymax - ymin)) * h;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();
  for (const v of [ymin, (ymin + ymax) / 2, ymax]) {
    svg.append(
      node("line", { x1: l, x2: l + w, y1: y(v), y2: y(v), class: "axis" }),
      node(
        "text",
        { x: l - 7, y: y(v) + 3, "text-anchor": "end" },
        key === "iv" ? (100 * v).toFixed(1) + "%" : v.toFixed(2),
      ),
    );
  }
  if (key === "g")
    svg.append(
      node("line", { x1: l, x2: l + w, y1: y(0), y2: y(0), class: "zero" }),
    );
  svg.append(
    node("path", {
      d: data
        .map(
          (v, i) =>
            (i ? "L" : "M") + x(v.k).toFixed(2) + " " + y(v[key]).toFixed(2),
        )
        .join(" "),
      class: color,
    }),
  );
  nodes.forEach((v) =>
    svg.append(
      node("circle", { cx: x(v.k), cy: y(v.iv), r: 3, class: "node" }),
    ),
  );
  for (const k of [-0.3, 0, 0.3])
    svg.append(
      node(
        "text",
        {
          x: x(k),
          y: height - 13,
          "text-anchor": k === -0.3 ? "start" : k === 0.3 ? "end" : "middle",
        },
        k.toFixed(2),
      ),
    );
  svg.setAttribute(
    "aria-label",
    `${id === "smile" ? "Fitted IV" : "g diagnostic"} at ${current.time} years. Values in selected slice table below.`,
  );
}
function heatmap(r) {
  const svg = $("heatmap"),
    width = Math.max(235, svg.clientWidth),
    height = svg.clientHeight,
    l = 48,
    right = 12,
    top = 13,
    bottom = 33,
    w = width - l - right,
    h = height - top - bottom,
    cw = w / 61,
    ch = h / 15,
    all = r.surface.flat().map((v) => v.iv),
    lo = Math.min(...all),
    hi = Math.max(...all);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();
  for (let i = 0; i < 15; i++)
    for (let j = 0; j < 61; j++) {
      const v = r.surface[i][j],
        u = (v.iv - lo) / (hi - lo || 1),
        color = `rgb(${Math.round(229 - u * 193)},${Math.round(236 - u * 159)},${Math.round(251 - u * 106)})`;
      svg.append(
        node("rect", {
          x: l + j * cw,
          y: top + i * ch,
          width: cw + 0.25,
          height: ch + 0.25,
          fill: color,
        }),
      );
      if (v.density_flag)
        svg.append(
          node("circle", {
            cx: l + (j + 0.5) * cw,
            cy: top + (i + 0.5) * ch,
            r: 1.15,
            fill: "#e8a47a",
          }),
        );
    }
  svg.append(
    node("rect", {
      x: l - 2,
      y: top + r.settings.slice * ch,
      width: w + 4,
      height: ch,
      fill: "none",
      stroke: "#182e50",
      "stroke-width": 2,
    }),
  );
  for (const i of [0, 2, 6, 10, 14])
    svg.append(
      node(
        "text",
        { x: l - 7, y: top + (i + 0.65) * ch, "text-anchor": "end" },
        TIMES[i].toFixed(2),
      ),
    );
  for (const j of width < 400 ? [0, 30, 60] : [0, 15, 30, 45, 60])
    svg.append(
      node(
        "text",
        {
          x: l + (j + 0.5) * cw,
          y: height - 9,
          "text-anchor": j === 0 ? "start" : j === 60 ? "end" : "middle",
        },
        r.surface[0][j].k.toFixed(2),
      ),
    );
  text("iv-range", `${pct(lo)} to ${pct(hi)}`);
}
function render(r) {
  current = r;
  text("world-name", r.name);
  text("world-desc", r.description);
  text("rmse", r.summary.fit_rmse_w.toExponential(3));
  text("density-count", String(r.summary.density_flags));
  text(
    "density-detail",
    `of ${r.summary.density_checks} checked · tolerance −10⁻⁹`,
  );
  text("calendar-count", String(r.summary.calendar_flags));
  text(
    "calendar-detail",
    `of ${r.summary.calendar_checks} checked · tolerance −10⁻¹⁰`,
  );
  text("slice-title", `${r.time.toFixed(3)} years to expiry`);
  const anchor = TENORS.indexOf(r.time);
  text(
    "slice-note",
    anchor >= 0
      ? "Blue: fitted smile. Orange circles: synthetic calibration nodes at this anchor maturity. All nodes are training data."
      : "Blue: linearly interpolated total variance converted back to IV. No calibration nodes exist at this intermediate maturity.",
  );
  const g = r.summary.worst_g,
    c = r.summary.worst_calendar;
  text(
    "worst-g",
    `Lowest sampled g: ${g.g.toFixed(6)} at k=${g.k.toFixed(2)}, T=${g.time.toFixed(3)} years.`,
  );
  text(
    "worst-calendar",
    `Near-minimum later-minus-earlier w: ${c.delta_w.toExponential(4)} at k=${c.k.toFixed(2)}, T=${c.earlier.toFixed(3)}→${c.later.toFixed(3)}. First cell within 10⁻¹⁴ of minimum.`,
  );
  rows(
    "fits",
    r.fits.map((f) => [
      f.time.toFixed(3),
      ...f.parameters.map((v) => v.toFixed(7)),
      String(f.winner_id),
      `${f.accepted_count} / ${f.candidate_count}`,
      f.rmse_w.toExponential(4),
    ]),
  );
  const vals = (v) => [
    fmt(v.k, 2),
    fmt(Math.exp(v.k), 5),
    fmt(v.iv * 100, 4),
    fmt(v.w, 7),
    fmt(v.dw, 7),
    fmt(v.ddw, 7),
    fmt(v.g, 7),
    v.density_flag ? "FLAG" : "-",
  ];
  rows(
    "selected",
    r.selected.map(vals),
    r.selected.map((v) => v.density_flag),
  );
  rows(
    "nodes",
    r.fits.flatMap((f) =>
      f.observations.map((o) => [
        fmt(f.time, 3),
        fmt(o.k, 2),
        fmt(o.iv * 100, 5),
        fmt(o.fitted_iv * 100, 5),
        fmt(o.target_w, 8),
        fmt(o.fitted_w, 8),
        o.residual_w.toExponential(4),
      ]),
    ),
  );
  rows(
    "candidates",
    r.fits.flatMap((f) =>
      f.candidates.map((c) => [
        fmt(f.time, 3),
        String(c.id),
        ...c.parameters.map((v) => v.toFixed(7)),
        c.minimum_variance.toExponential(4),
        c.sse.toExponential(5),
        c.accepted ? "ACCEPT" : "REJECT",
      ]),
    ),
    r.fits.flatMap((f) => f.candidates.map((c) => !c.accepted)),
  );
  rows(
    "surface-data",
    r.surface.flatMap((row) =>
      row.map((v) => [
        fmt(v.time, 3),
        fmt(v.k, 2),
        fmt(v.iv * 100, 4),
        fmt(v.w, 7),
        fmt(v.dw, 7),
        fmt(v.ddw, 7),
        fmt(v.g, 7),
        v.density_flag ? "FLAG" : "-",
      ]),
    ),
    r.surface.flatMap((row) => row.map((v) => v.density_flag)),
  );
  rows(
    "calendar-data",
    r.calendar.map((v) => [
      fmt(v.earlier, 3),
      fmt(v.later, 3),
      fmt(v.k, 2),
      v.delta_w.toExponential(7),
      v.flag ? "FLAG" : "-",
    ]),
    r.calendar.map((v) => v.flag),
  );
  heatmap(r);
  plot(
    "smile",
    r.selected,
    "iv",
    "curve",
    anchor >= 0 ? r.fits[anchor].observations : [],
  );
  plot("density", r.selected, "g", "diagnostic");
  document.body.classList.remove("stale");
  text("status", "APPLIED");
  text("error", "");
}
function read() {
  const cfg = {};
  for (const id of ["scenario", "budget", "slice"]) {
    if (!/^\d+$/.test($(id).value))
      throw new Error("Select a documented value for every field.");
    cfg[id] = Number($(id).value);
  }
  return cfg;
}
function set(cfg) {
  for (const id of ["scenario", "budget", "slice"]) $(id).value = cfg[id];
}
$("controls").addEventListener("change", () => {
  document.body.classList.add("stale");
  text("status", "UNAPPLIED");
});
$("controls").addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    render(analyze(read()));
  } catch (e) {
    text("error", e.message);
    text("status", "CHECK INPUT");
    document.body.classList.add("stale");
  }
});
$("reset").addEventListener("click", () => {
  set(settings());
  render(analyze());
});
let timer;
window.addEventListener("resize", () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (current) {
      heatmap(current);
      const a = TENORS.indexOf(current.time);
      plot(
        "smile",
        current.selected,
        "iv",
        "curve",
        a >= 0 ? current.fits[a].observations : [],
      );
      plot("density", current.selected, "g", "diagnostic");
    }
  }, 100);
});
set(settings());
render(analyze());
