import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { analyze, settings, TIMES } from "../docs/core.js";
const base = process.env.BASE_URL || "http://127.0.0.1:8377/";
let server;
if (!process.env.BASE_URL) {
  server = spawn(
    "python3",
    ["-m", "http.server", "8377", "--directory", "docs", "--bind", "127.0.0.1"],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
}
const browser = await chromium.launch({ headless: true });
await mkdir("/tmp/tenorwell-shots", { recursive: true });
let count = 0;
const check = (v, m) => {
  count++;
  assert(v, m);
};
try {
  for (const width of [1440, 1024, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }),
      errors = [],
      failed = [],
      third = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("requestfailed", (r) => failed.push(r.url()));
    page.on("request", (r) => {
      if (!r.url().startsWith(base)) third.push(r.url());
    });
    await page.goto(base);
    await page.locator("#status").filter({ hasText: "APPLIED" }).waitFor();
    async function apply(cfg) {
      for (const id of ["scenario", "budget", "slice"])
        await page.locator("#" + id).selectOption(String(cfg[id]));
      await page.locator("#apply").click();
      await page.waitForFunction(
        () => !document.body.classList.contains("stale"),
      );
    }
    async function table(id) {
      return page
        .locator("#" + id + " tr")
        .evaluateAll((rows) =>
          rows.map((row) =>
            [...row.querySelectorAll("td")].map((td) => td.textContent),
          ),
        );
    }
    async function verify(cfg) {
      const r = analyze(cfg),
        fmt = (v, d = 6) => v.toFixed(d);
      for (const [id, v] of [
        ["rmse", r.summary.fit_rmse_w.toExponential(3)],
        ["density-count", String(r.summary.density_flags)],
        ["calendar-count", String(r.summary.calendar_flags)],
        ["world-name", r.name],
        ["slice-title", `${r.time.toFixed(3)} years to expiry`],
      ])
        check(
          (await page.locator("#" + id).textContent()) === v,
          width + ":" + id,
        );
      check(
        JSON.stringify(await table("fits")) ===
          JSON.stringify(
            r.fits.map((f) => [
              fmt(f.time, 3),
              ...f.parameters.map((v) => fmt(v, 7)),
              String(f.winner_id),
              `${f.accepted_count} / ${f.candidate_count}`,
              f.rmse_w.toExponential(4),
            ]),
          ),
        "all fitted parameters",
      );
      check(
        JSON.stringify(await table("selected")) ===
          JSON.stringify(
            r.selected.map((v) => [
              fmt(v.k, 2),
              fmt(Math.exp(v.k), 5),
              fmt(v.iv * 100, 4),
              fmt(v.w, 7),
              fmt(v.dw, 7),
              fmt(v.ddw, 7),
              fmt(v.g, 7),
              v.density_flag ? "FLAG" : "-",
            ]),
          ),
        "all selected61rows",
      );
      check(
        JSON.stringify(await table("surface-data")) ===
          JSON.stringify(
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
          ),
        "all surface915rows",
      );
      check(
        JSON.stringify(await table("calendar-data")) ===
          JSON.stringify(
            r.calendar.map((v) => [
              fmt(v.earlier, 3),
              fmt(v.later, 3),
              fmt(v.k, 2),
              v.delta_w.toExponential(7),
              v.flag ? "FLAG" : "-",
            ]),
          ),
        "all calendar854rows",
      );
      check(
        JSON.stringify(await table("nodes")) ===
          JSON.stringify(
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
          ),
        "all28nodes",
      );
      check(
        JSON.stringify(await table("candidates")) ===
          JSON.stringify(
            r.fits.flatMap((f) =>
              f.candidates.map((c) => [
                fmt(f.time, 3),
                String(c.id),
                ...c.parameters.map((v) => fmt(v, 7)),
                c.minimum_variance.toExponential(4),
                c.sse.toExponential(5),
                c.accepted ? "ACCEPT" : "REJECT",
              ]),
            ),
          ),
        "all candidates",
      );
      check(
        (await page.locator("#heatmap rect").count()) === 916,
        "all915heatmap cells plus selected outline",
      );
      check(
        (await page.locator("#heatmap circle").count()) ===
          r.summary.density_flags,
        "all diagnostic dots",
      );
      check(
        (await page.locator("#smile path").count()) === 1 &&
          (await page.locator("#density path").count()) === 1,
        "charts",
      );
      check(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "no page overflow",
      );
      check(
        (await page.locator("#smile").getAttribute("aria-label")).includes(
          String(r.time),
        ),
        "accessible chart label",
      );
    }
    await verify(settings());
    if (width === 1440 || width === 320) {
      await page.screenshot({ path: `/tmp/tenorwell-shots/${width}-hero.png` });
      await page.locator(".surface-panel").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `/tmp/tenorwell-shots/${width}-surface.png`,
      });
      await page.locator(".panels").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `/tmp/tenorwell-shots/${width}-charts.png`,
      });
      await page.locator("#audit").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `/tmp/tenorwell-shots/${width}-audit.png`,
      });
    }
    for (const scenario of [0, 1, 2])
      for (const budget of [0, 1]) {
        const cfg = { scenario, budget, slice: scenario === 2 ? 14 : 2 };
        await apply(cfg);
        await verify(cfg);
        if (
          (width === 1440 || width === 320) &&
          scenario === 2 &&
          budget === 1
        ) {
          await page.locator(".panels").scrollIntoViewIfNeeded();
          await page.screenshot({
            path: `/tmp/tenorwell-shots/${width}-negative-g.png`,
          });
        }
      }
    await apply({ scenario: 1, budget: 1, slice: 3 });
    await verify({ scenario: 1, budget: 1, slice: 3 });
    check(
      (await page.locator("#smile circle").count()) === 0,
      "intermediate has no calibration nodes",
    );
    await apply({ scenario: 2, budget: 1, slice: 0 });
    await page.locator("#slice").selectOption("0");
    check(
      (await page.locator("#status").textContent()) === "UNAPPLIED",
      "edited stale",
    );
    await page.locator("#apply").click();
    await verify({ scenario: 2, budget: 1, slice: 0 });
    check((await page.locator("#smile circle").count()) === 7, "anchor nodes");
    await page.locator("#slice").evaluate((el) => {
      const o = document.createElement("option");
      o.value = "15";
      o.textContent = "bad";
      el.append(o);
      el.value = "15";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator("#apply").click();
    check(
      (await page.locator("#status").textContent()) === "CHECK INPUT",
      "invalid UI guard",
    );
    check(
      (await page.locator("#error").textContent()).includes("0..14"),
      "error shown",
    );
    await page.locator("#reset").click();
    await verify(settings());
    check(errors.length === 0, "page errors" + errors);
    check(failed.length === 0, "request failures" + failed);
    check(third.length === 0, "third party");
    check(
      await page.evaluate(
        () => localStorage.length === 0 && sessionStorage.length === 0,
      ),
      "no storage",
    );
    check((await page.context().cookies()).length === 0, "no cookies");
    check(
      await page.evaluate(
        async () =>
          !("serviceWorker" in navigator) ||
          (await navigator.serviceWorker.getRegistrations()).length === 0,
      ),
      "no service workers",
    );
    check((await page.locator("h1").count()) === 1, "one h1");
    for (const id of ["scenario", "budget", "slice"])
      check(
        await page.locator("#" + id).evaluate((el) => el.labels?.length > 0),
        "form label",
      );
    await page.close();
  }
  console.log(
    `${count} browser assertions; five widths, all six fits, selected anchors/intermediates, every audit ledger, heatmap dots, stale/invalid/reset/no-network PASS`,
  );
} finally {
  await browser.close();
  if (server) server.kill();
}
