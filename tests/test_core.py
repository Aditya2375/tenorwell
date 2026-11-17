import json
import math
import subprocess
import sys
import unittest
from copy import deepcopy
from tenorwell import core as c


def qr_linear(xs, ys):
    n = len(xs)
    q0 = [1 / math.sqrt(n)] * n
    r01 = math.fsum(a * b for a, b in zip(q0, xs))
    orth = [x - r01 / math.sqrt(n) for x in xs]
    r11 = math.sqrt(math.fsum(x * x for x in orth))
    q1 = [x / r11 for x in orth]
    b = math.fsum(a * b for a, b in zip(q1, ys)) / r11
    a = (math.fsum(a * b for a, b in zip(q0, ys)) - r01 * b) / math.sqrt(n)
    return a, b


def normalized_call(k, w):
    root = math.sqrt(w)
    dplus = -k / root + root / 2
    dminus = dplus - root
    n = lambda x: 0.5 * math.erfc(-x / math.sqrt(2))
    return n(dplus) - math.exp(k) * n(dminus)


class SurfaceTests(unittest.TestCase):
    def test_01_known_raw_fixture_and_derivatives(self):
        p = [0.02, 0.1, -0.4, 0, 0.2]
        w, d, dd = c.raw(0, p)
        self.assertAlmostEqual(w, 0.04, delta=1e-16)
        self.assertAlmostEqual(d, -0.04, delta=1e-16)
        self.assertAlmostEqual(dd, 0.5, delta=1e-16)
        for k in [-0.3, -0.13, 0, 0.14, 0.3]:
            w, d, dd = c.raw(k, p)
            eps = 1e-4
            lo, hi = c.raw(k - eps, p)[0], c.raw(k + eps, p)[0]
            self.assertAlmostEqual(d, (hi - lo) / (2 * eps), delta=1e-8)
            self.assertAlmostEqual(dd, (hi - 2 * w + lo) / (eps * eps), delta=2e-7)

    def test_02_grid_counts_nesting_and_node_contract(self):
        self.assertEqual(len(c.shapes(0)), 36)
        self.assertEqual(len(c.shapes(1)), 175)
        self.assertTrue(set(c.shapes(0)).issubset(set(c.shapes(1))))
        self.assertEqual(c.NODES, (-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3))
        self.assertEqual(len(c.MONEYNESS), 61)
        self.assertEqual(len(c.TIMES), 15)
        self.assertEqual(c.TIMES[0], 0.25)
        self.assertEqual(c.TIMES[-1], 2)
        for t in c.TENORS:
            self.assertIn(t, c.TIMES)

    def test_03_every_candidate_independent_qr_objective_and_winner(self):
        total = 0
        for world in range(3):
            for budget in range(2):
                for t in c.TENORS:
                    f = c.fit_slice(world, budget, t)
                    target = [o["iv"] ** 2 * t for o in f["observations"]]
                    accepted = []
                    for candidate in f["candidates"]:
                        a, b, rho, m, s = candidate["parameters"]
                        xs = [rho * (k - m) + math.hypot(k - m, s) for k in c.NODES]
                        expected = qr_linear(xs, target)
                        self.assertAlmostEqual(a, expected[0], delta=2e-14)
                        self.assertAlmostEqual(b, expected[1], delta=2e-13)
                        sse = math.fsum(
                            (aa + bb * x - y) ** 2
                            for aa, bb, x, y in [
                                (a, b, x, y) for x, y in zip(xs, target)
                            ]
                        )
                        self.assertAlmostEqual(candidate["sse"], sse, delta=1e-15)
                        admissible = (
                            b >= 0 and a + b * s * math.sqrt(1 - rho * rho) > 1e-8
                        )
                        self.assertEqual(candidate["accepted"], admissible)
                        if admissible:
                            accepted.append(candidate)
                        total += 1
                    winner = min(accepted, key=lambda v: (v["sse"], v["id"]))
                    self.assertEqual(f["winner_id"], winner["id"])
                    self.assertEqual(f["parameters"], winner["parameters"])
                    self.assertEqual(f["accepted_count"], len(accepted))
                    self.assertAlmostEqual(f["rmse_w"] ** 2 * 7, f["sse"], delta=1e-15)
        self.assertEqual(total, 2532)

    def test_04_finer_grid_no_worse_training_fit_not_shape_guarantee(self):
        for world in range(3):
            coarse = c.analyze({"scenario": world, "budget": 0, "slice": 6})
            fine = c.analyze({"scenario": world, "budget": 1, "slice": 6})
            self.assertLessEqual(
                fine["summary"]["fit_rmse_w"], coarse["summary"]["fit_rmse_w"] + 1e-15
            )
        self.assertGreater(
            fine["summary"]["density_flags"], coarse["summary"]["density_flags"]
        )

    def test_05_anchors_and_totalvariance_not_vol_interpolation(self):
        for world in range(3):
            result = c.analyze({"scenario": world, "budget": 1, "slice": 6})
            for i, t in enumerate(c.TENORS):
                for k in c.MONEYNESS:
                    v = c.evaluate(result["fits"], k, t)
                    truth = c.raw(k, result["fits"][i]["parameters"])
                    for a, b in zip([v["w"], v["dw"], v["ddw"]], truth):
                        self.assertAlmostEqual(a, b, delta=1e-15)
            for i in range(3):
                t = (c.TENORS[i] + c.TENORS[i + 1]) / 2
                for k in [-0.3, 0, 0.3]:
                    v = c.evaluate(result["fits"], k, t)
                    lo = c.raw(k, result["fits"][i]["parameters"])
                    hi = c.raw(k, result["fits"][i + 1]["parameters"])
                    for a, b, d in zip([v["w"], v["dw"], v["ddw"]], lo, hi):
                        self.assertAlmostEqual(a, (b + d) / 2, delta=1e-15)
                    self.assertAlmostEqual(v["iv"] ** 2 * t, v["w"], delta=1e-15)

    def test_06_g_sign_matches_independent_callprice_convexity(self):
        for world in range(3):
            for budget in range(2):
                r = c.analyze({"scenario": world, "budget": budget, "slice": 6})
                for t in [0.25, 0.75, 1.25, 2]:
                    for k in [-0.25, -0.15, -0.05, 0.05, 0.15, 0.25]:
                        v = c.evaluate(r["fits"], k, t)
                        strike = math.exp(k)
                        eps = 1e-4

                        def price(K):
                            kk = math.log(K)
                            return normalized_call(
                                kk, c.evaluate(r["fits"], kk, t)["w"]
                            )

                        second = (
                            price(strike + eps)
                            - 2 * price(strike)
                            + price(strike - eps)
                        ) / eps**2
                        if abs(v["g"]) > 1e-4:
                            self.assertEqual(
                                second > 0,
                                v["g"] > 0,
                                (world, budget, t, k, second, v["g"]),
                            )
                        dminus = -k / math.sqrt(v["w"]) - math.sqrt(v["w"]) / 2
                        # Normalized call curvature: phi(dminus)/(K sqrt(w)) * g.
                        theoretical = (
                            v["g"]
                            * math.exp(-0.5 * dminus * dminus)
                            / (math.sqrt(2 * math.pi * v["w"]) * strike)
                        )
                        self.assertAlmostEqual(second, theoretical, delta=2e-5)

    def test_07_interpolated_k_derivatives_finite_difference(self):
        for world in range(3):
            r = c.analyze({"scenario": world, "budget": 1, "slice": 6})
            for t in [0.375, 0.75, 1.25, 1.875]:
                for k in [-0.2, -0.07, 0.03, 0.2]:
                    eps = 1e-5
                    v = c.evaluate(r["fits"], k, t)
                    lo = c.evaluate(r["fits"], k - eps, t)["w"]
                    hi = c.evaluate(r["fits"], k + eps, t)["w"]
                    self.assertAlmostEqual(v["dw"], (hi - lo) / (2 * eps), delta=1e-8)
                    self.assertAlmostEqual(
                        v["ddw"], (hi - 2 * v["w"] + lo) / eps**2, delta=3e-6
                    )

    def test_08_complete_audit_counts_locations_tolerances(self):
        for world in range(3):
            for budget in range(2):
                r = c.analyze({"scenario": world, "budget": budget, "slice": 6})
                flat = [x for row in r["surface"] for x in row]
                self.assertEqual(len(flat), 915)
                self.assertEqual(len(r["calendar"]), 854)
                self.assertEqual(
                    r["summary"]["density_flags"], sum(x["g"] < -1e-9 for x in flat)
                )
                self.assertEqual(
                    r["summary"]["calendar_flags"],
                    sum(x["delta_w"] < -1e-10 for x in r["calendar"]),
                )
                self.assertEqual(
                    r["summary"]["worst_g"], min(flat, key=lambda x: x["g"])
                )
                self.assertEqual(
                    r["summary"]["worst_calendar"],
                    min(r["calendar"], key=lambda x: x["delta_w"]),
                )
                for i in range(14):
                    for j, k in enumerate(c.MONEYNESS):
                        v = r["calendar"][i * 61 + j]
                        self.assertEqual(v["k"], k)
                        self.assertEqual(
                            v["delta_w"],
                            r["surface"][i + 1][j]["w"] - r["surface"][i][j]["w"],
                        )
                if world == 0:
                    self.assertEqual(r["summary"]["density_flags"], 0)
                    self.assertEqual(r["summary"]["calendar_flags"], 0)
                if world == 1:
                    self.assertGreater(r["summary"]["calendar_flags"], 0)
                if world == 2:
                    self.assertGreater(r["summary"]["density_flags"], 0)

    def test_09_slice_is_display_only_and_results_are_detached(self):
        baseline = c.analyze()
        for index in range(15):
            r = c.analyze({**c.settings(), "slice": index})
            self.assertEqual(r["fits"], baseline["fits"])
            self.assertEqual(r["surface"], baseline["surface"])
            self.assertEqual(r["summary"], baseline["summary"])
            self.assertEqual(r["selected"], r["surface"][index])
        cfg = c.settings()
        copy = deepcopy(cfg)
        r = c.analyze(cfg)
        self.assertEqual(cfg, copy)
        r["fits"][0]["parameters"][0] = 123
        self.assertNotEqual(c.analyze()["fits"][0]["parameters"][0], 123)

    def test_10_strict_input_and_cli(self):
        invalid = [
            {},
            [],
            False,
            {**c.settings(), "extra": 1},
            {**c.settings(), "scenario": True},
            {**c.settings(), "scenario": 3},
            {**c.settings(), "budget": 2},
            {**c.settings(), "slice": -1},
            {**c.settings(), "slice": 15},
            {**c.settings(), "slice": 1.0},
            {**c.settings(), "slice": float("nan")},
        ]
        for v in invalid:
            with self.assertRaises(ValueError):
                c.analyze(v)
        for scenario in range(3):
            json.dumps(
                c.analyze({**c.settings(), "scenario": scenario}), allow_nan=False
            )
        command = [sys.executable, "-m", "tenorwell"]
        run = subprocess.run(
            command + ["--scenario", "2", "--budget", "1", "--slice", "14"],
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual(
            json.loads(run.stdout), c.analyze({"scenario": 2, "budget": 1, "slice": 14})
        )
        for args in [["--scenario", "3"], ["--slice", "1.5"], ["--budget", "-1"]]:
            run = subprocess.run(command + args, text=True, capture_output=True)
            self.assertNotEqual(run.returncode, 0)
            self.assertEqual(run.stdout, "")
            self.assertIn("error:", run.stderr)


if __name__ == "__main__":
    unittest.main()
