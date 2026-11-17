"""Finite candidate SVI fits and sampled surface shape diagnostics."""

import math
from copy import deepcopy
from itertools import product

TENORS = (0.25, 0.5, 1.0, 2.0)
NODES = tuple(i / 10 for i in range(-3, 4))
MONEYNESS = tuple(i / 100 for i in range(-30, 31))
TIMES = tuple(0.25 + i / 8 for i in range(15))
DEFAULT = {"scenario": 0, "budget": 0, "slice": 6}
WORLDS = (
    (
        "A quiet synthetic surface",
        "Four gently skewed smiles share a stable generating shape. Fitting still introduces approximation error.",
    ),
    (
        "A maturity out of order",
        "The one-year synthetic total variance is scaled down to 22%. Independent slice fitting does not fix calendar inconsistency.",
    ),
    (
        "Sharp wings, smooth fit",
        "Steep synthetic smiles can fit well while implying negative sampled density diagnostics. Positive total variance is not enough.",
    ),
)
G_TOL = 1e-9
CAL_TOL = 1e-10


def settings():
    return deepcopy(DEFAULT)


def validate(value):
    if type(value) is not dict or set(value) != set(DEFAULT):
        raise ValueError("settings require exactly scenario, budget and slice")
    for key, upper in (("scenario", 2), ("budget", 1), ("slice", 14)):
        if type(value[key]) is not int or not 0 <= value[key] <= upper:
            raise ValueError(f"{key} must be an integer in 0..{upper}")


def shapes(budget):
    """Ordered finite candidate set; no continuous nonlinear optimizer."""
    m = (-0.08, 0, 0.08) if budget == 0 else (-0.08, -0.04, 0, 0.04, 0.08)
    s = (0.04, 0.12, 0.24) if budget == 0 else (0.04, 0.08, 0.12, 0.18, 0.24)
    rho = (-0.8, -0.4, 0, 0.4) if budget == 0 else (-0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4)
    return list(product(m, s, rho))


def raw(k, parameters):
    """Internal fixed positive-width raw SVI and analytic k derivatives."""
    a, b, rho, m, s = parameters
    z = k - m
    h = math.sqrt(z * z + s * s)
    return [a + b * (rho * z + h), b * (rho + z / h), b * s * s / h**3]


def truth_parameters(scenario, t):
    p = [0.018 * t, 0.11 * t, -0.55, 0.025, 0.13]
    if scenario == 1 and t == 1:
        p[0] *= 0.22
        p[1] *= 0.22
    elif scenario == 2:
        p = [0.002 * t, 0.9 * math.sqrt(t), -0.55, 0.025, 0.055]
    return p


def fit_slice(scenario, budget, t):
    """Seven synthetic IV nodes become variance targets; conditional OLS a,b."""
    truth = truth_parameters(scenario, t)
    observations = [{"k": k, "iv": math.sqrt(raw(k, truth)[0] / t)} for k in NODES]
    targets = [o["iv"] ** 2 * t for o in observations]
    mean_y = sum(targets) / len(targets)
    candidates = []
    best = None
    for index, (m, s, rho) in enumerate(shapes(budget)):
        feature = [rho * (k - m) + math.sqrt((k - m) ** 2 + s * s) for k in NODES]
        mean_x = sum(feature) / len(feature)
        xx = sum((x - mean_x) ** 2 for x in feature)
        b = sum((x - mean_x) * (y - mean_y) for x, y in zip(feature, targets)) / xx
        a = mean_y - b * mean_x
        parameters = [a, b, rho, m, s]
        minimum = a + b * s * math.sqrt(1 - rho * rho)
        accepted = b >= 0 and minimum > 1e-8
        sse = sum((raw(k, parameters)[0] - y) ** 2 for k, y in zip(NODES, targets))
        candidate = {
            "id": index,
            "parameters": parameters,
            "minimum_variance": minimum,
            "accepted": accepted,
            "sse": sse,
        }
        candidates.append(candidate)
        if accepted and (best is None or sse < best["sse"]):
            best = candidate
    if best is None:
        raise ValueError("fixed synthetic case has no admissible fit")
    residuals = [
        {
            **o,
            "target_w": targets[i],
            "fitted_w": raw(o["k"], best["parameters"])[0],
            "fitted_iv": math.sqrt(raw(o["k"], best["parameters"])[0] / t),
            "residual_w": raw(o["k"], best["parameters"])[0] - targets[i],
        }
        for i, o in enumerate(observations)
    ]
    return {
        "time": t,
        "parameters": best["parameters"][:],
        "winner_id": best["id"],
        "sse": best["sse"],
        "rmse_w": math.sqrt(best["sse"] / len(NODES)),
        "accepted_count": sum(c["accepted"] for c in candidates),
        "candidate_count": len(candidates),
        "candidates": candidates,
        "observations": residuals,
    }


def evaluate(fits, k, time):
    """Internal bounded-domain interpolation of total variance and k derivatives."""
    interval = min(2, next((i for i in range(3) if time <= TENORS[i + 1]), 2))
    u = (time - TENORS[interval]) / (TENORS[interval + 1] - TENORS[interval])
    left, right = raw(k, fits[interval]["parameters"]), raw(
        k, fits[interval + 1]["parameters"]
    )
    w, d, dd = [(1 - u) * a + u * b for a, b in zip(left, right)]
    if not math.isfinite(w) or w <= 0:
        raise ValueError("variance must be positive in the fixed model")
    g = (1 - k * d / (2 * w)) ** 2 - d * d / 4 * (1 / w + 0.25) + dd / 2
    return {
        "k": k,
        "time": time,
        "w": w,
        "iv": math.sqrt(w / time),
        "dw": d,
        "ddw": dd,
        "g": g,
        "density_flag": g < -G_TOL,
        "left": interval,
        "right": interval + 1,
        "fraction": u,
    }


def analyze(value=None):
    config = settings() if value is None else value
    validate(config)
    config = deepcopy(config)
    fits = [fit_slice(config["scenario"], config["budget"], t) for t in TENORS]
    rows = [[evaluate(fits, k, t) for k in MONEYNESS] for t in TIMES]
    calendar = [
        {
            "k": k,
            "earlier": TIMES[i],
            "later": TIMES[i + 1],
            "delta_w": rows[i + 1][j]["w"] - rows[i][j]["w"],
            "flag": rows[i + 1][j]["w"] - rows[i][j]["w"] < -CAL_TOL,
        }
        for i in range(14)
        for j, k in enumerate(MONEYNESS)
    ]
    flat = [cell for row in rows for cell in row]
    worst_g = min(flat, key=lambda c: c["g"])
    minimum_calendar_delta = min(c["delta_w"] for c in calendar)
    # Report the first cell within a fixed roundoff tie band of the true minimum.
    worst_calendar = next(
        c for c in calendar if c["delta_w"] <= minimum_calendar_delta + 1e-14
    )
    return {
        "settings": config,
        "name": WORLDS[config["scenario"]][0],
        "description": WORLDS[config["scenario"]][1],
        "fits": fits,
        "surface": rows,
        "selected": rows[config["slice"]],
        "time": TIMES[config["slice"]],
        "calendar": calendar,
        "summary": {
            "density_checks": len(flat),
            "density_flags": sum(c["density_flag"] for c in flat),
            "calendar_checks": len(calendar),
            "calendar_flags": sum(c["flag"] for c in calendar),
            "worst_g": deepcopy(worst_g),
            "worst_calendar": deepcopy(worst_calendar),
            "fit_rmse_w": math.sqrt(sum(f["sse"] for f in fits) / 28),
            "candidates_per_slice": len(shapes(config["budget"])),
        },
    }
