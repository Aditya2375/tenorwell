# Tenorwell

**A smooth fit can still break.** An original finite-candidate raw-SVI calibration lab with sampled volatility-surface shape diagnostics.

[Open the lab](https://aditya2375.github.io/tenorwell/) · [Source](https://github.com/Aditya2375/tenorwell)

Tenorwell generates 28 synthetic implied-volatility nodes at four maturities, fits a smile at each maturity, and interpolates total variance between them. The page shows the surface, selected smile, sampled butterfly diagnostic, every fit parameter, all candidate objectives and both complete audit ledgers. No observed market prices or option quotes are used.

**No flags on this grid means only no flags on this grid.** A small fitting error or positive total variance is not proof of absence of static arbitrage. This app neither repairs arbitrage nor implements the cited paper's arbitrage-free SSVI calibration. It does not check global wing limits or all points between samples.

## The experiment

Choose a teaching world and candidate grid, select a maturity to inspect, then apply.

- **Quiet control:** a gently skewed generating shape is shared across maturities. Finite-candidate approximation still leaves residuals.
- **Maturity out of order:** the one-year synthetic total variance is reduced to 22% of its control level. Independent slice fits do not repair the resulting calendar inconsistency.
- **Sharp wings:** steep synthetic shapes can have negative density-sign diagnostics despite positive total variance and smooth fits. The larger candidate grid fits the nodes more closely but can expose more sampled defects.

The three controls are bounded integers: scenario 0..2, budget 0..1 and selected slice 0..14. The slice control is a display selection. It does not enter the calibration objective or change the fitted parameters. Edited controls are marked unapplied; invalid values retain the visibly stale last results. Reset restores defaults.

The heatmap uses actual computed IV at 15 maturities and 61 log-forward moneyness points. Every cell is in the full surface ledger. Orange dots mark negative sampled g values. Selected-smile charts show calibration nodes only when the selected time is one of the four anchor maturities. Narrow screens use responsive chart coordinates and locally scrolling tables. There is no decorative 3D surface that hides negative regions.

## Model contract

### Synthetic targets

Maturities are abstract year fractions `T = (0.25, 0.5, 1, 2)`. Each has seven nodes `k = (-0.30, -0.20, ..., 0.30)`, where `k = log(K/F_T)` is log-forward moneyness, not strike itself.

For each node, an explicit synthetic generating raw-SVI function supplies positive total variance. The target IV is `sqrt(w/T)`. Calibration then converts that IV back to `w_target = IV^2 * T`. All 28 nodes are training data. There is no holdout, price inversion, bid/ask spread, observed underlying, discount curve or real option data. IV is annualized by the formula's year-fraction convention, not by sqrt(252).

Control truth parameters, in the order `(a,b,rho,m,s)`, are:

```text
(0.018*T, 0.11*T, -0.55, 0.025, 0.13)
```

The calendar-fault world multiplies the first two parameters by 0.22 only at `T=1`. Sharp-wing truth is:

```text
(0.002*T, 0.9*sqrt(T), -0.55, 0.025, 0.055)
```

The generator's shape is off the candidate grids. Synthetic generating parameters are not handed to the fitter.

### Finite calibration

Raw SVI describes total variance, not IV directly:

```text
w(k) = a + b * [rho*(k-m) + sqrt((k-m)^2 + s^2)]
```

For each fixed nonlinear shape `(m,s,rho)`, call the bracketed quantity `x(k)`. Centered ordinary least squares fits `w_target = a + b*x`. A candidate is accepted only if `b >= 0` and `a + b*s*sqrt(1-rho^2) > 1e-8`, the global positive-minimum condition for this positive-width, bounded-rho raw SVI. This is a positivity filter, not a butterfly or calendar arbitrage filter. It is deliberately not enough to guarantee a consistent surface.

Candidates are enumerated in the Cartesian product order m, then s, then rho:

| Grid  | m                           | s                            | rho                                 | Candidates per maturity |
| ----- | --------------------------- | ---------------------------- | ----------------------------------- | ----------------------- |
| Small | -0.08, 0, 0.08              | 0.04, 0.12, 0.24             | -0.8, -0.4, 0, 0.4                  | 36                      |
| Large | -0.08, -0.04, 0, 0.04, 0.08 | 0.04, 0.08, 0.12, 0.18, 0.24 | -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4 | 175                     |

The accepted candidate with minimum sum of squared total-variance residuals wins. Exact ties keep the earlier candidate. Every attempted candidate, including rejected ones, remains visible. There are four independent fits, not a shared surface-parameter fit. Conditional OLS parameters themselves are not restricted to a discrete a/b grid, but inadmissible conditional solutions are rejected rather than boundary-refitted. This is therefore the minimum over the accepted enumerated conditional solutions, not a general constrained or continuous global optimum.

The large grid contains the small grid, so its training objective cannot be worse apart from floating roundoff. That does not guarantee a better financial model, smoother surface or fewer defects. Fit RMSE is in total-variance units across 28 training nodes; it is not IV RMSE, forecast error or observed market accuracy.

### Maturity interpolation

At fixed k, interpolate total variance linearly between fitted anchor maturities. The first and second derivatives with respect to k use the same interpolation weights. Convert back to IV only after interpolation: `IV = sqrt(w/T)`. IV itself is not linearly interpolated. No extrapolation is offered.

The audit grid has 15 maturities `T = 0.25 + j/8`, `j=0..14`, and 61 moneyness points `k = i/100`, `i=-30..30`. Intermediate maturities are audited too. Linear total-variance interpolation is not a general butterfly-arbitrage guarantee.

## Shape diagnostics

### Sampled butterfly diagnostic

For every one of the 915 grid points:

```text
z   = k - m
h   = sqrt(z^2 + s^2)
w'  = b * (rho + z/h)
w'' = b*s^2 / h^3

g(k) = (1 - k*w'/(2*w))^2 - (w'^2/4)*(1/w + 1/4) + w''/2
```

At intermediate maturities, w and its derivatives are first interpolated as described above. `g < -1e-9` is flagged. In the smooth positive-variance setting, g controls the sign of the corresponding option-price density. g itself is **not** a probability density. A continuous no-butterfly-arbitrage claim would also require a condition for every k and an appropriate global wing limit. Neither is checked here.

### Sampled calendar diagnostic

At each fixed k, compute later-minus-earlier total variance for every adjacent pair of grid maturities. There are `14*61 = 854` comparisons. Differences below `-1e-10` are flagged. For the summary location only, cells within `1e-14` total-variance units of the actual minimum are treated as roundoff ties; the first in maturity-then-k order is reported. All deltas and flags remain unchanged, and the ledger retains the exact floating-point minimum too. The comparison is at constant log-forward moneyness, as in the cited primary paper, not at arbitrary equal strikes under moving forwards.

No executable spread price, profit, transaction cost, liquidity, financing, settlement or dynamic arbitrage is modeled. The word "flag" describes a numerical inconsistency in this synthetic parameterization, not a real trading opportunity. No-flags is not called PASS or arbitrage-free by the UI.

## Reproduce

Python 3.10 or newer; standard-library runtime only:

```sh
python3 -m tenorwell
python3 -m tenorwell --scenario 2 --budget 1 --slice 14
make test
```

The CLI prints complete finite JSON, including all candidates and audit cells. Invalid arguments fail with an argparse error and no JSON. Import API:

```python
from tenorwell import analyze, settings

cfg = settings()
cfg["scenario"] = 2
cfg["budget"] = 1
result = analyze(cfg)
print(result["summary"]["density_flags"])
```

Python `analyze()` and `analyze(None)` use defaults. Otherwise the API needs a plain built-in dictionary with exactly `scenario`, `budget`, `slice` and built-in integers in the documented ranges. Booleans, strings, float-valued integers, nonfinite numbers and extra keys are invalid. JavaScript `analyze()` uses defaults; explicit `null` is invalid. JavaScript requires a plain object and safe integers. Inputs are not modified. General arbitrary-data fitting, subclass/proxy/getter inputs, concurrent mutation and helper APIs outside their fixed internal domains are not supported.

Run the independent static browser implementation:

```sh
python3 -m http.server 8377 --directory docs --bind 127.0.0.1
# Open http://127.0.0.1:8377/
```

No build step or runtime JavaScript packages. Development checks use Node 22 and the locked test package:

```sh
npm ci --ignore-scripts
npm test
npx playwright install chromium
npm run test:browser
```

Native tests verify all 2,532 conditional candidates using an independent Gram-Schmidt QR oracle, independently rank accepted objectives, check a known raw-SVI fixture, compare derivatives with finite differences, and compare g with independent Black-call price convexity using `math.erfc`. They also verify anchor interpolation, nested candidate grids, every audit count and location, display-only slice selection, strict inputs and CLI behavior. The price formula is a test oracle only, not a runtime feature or option-price product.

JavaScript tests compare six complete Python results, 90 selected slices and finite-difference diagnostics. Real Chromium tests exercise five widths, all six scenario/grid combinations, anchor and intermediate selections, every fitted parameter, all 28 node rows, all candidates, all 915 surface rows, all 854 calendar rows, heatmap markers, stale/invalid/reset handling and unwanted requests. Other browsers and assistive technologies are not certified.

## Scope and security

All arithmetic is floating point on a bounded synthetic domain. This is not a robust general-purpose optimizer, continuous-arbitrage proof, SSVI reproducer, global wing extrapolator or live volatility-calibration service. No claim of prediction, neural-network modeling, investment advice, profit or true risk reduction is made.

The app has no uploads, private data, accounts, credentials, APIs, network calls after same-origin assets, analytics, cookies, local/session storage, persistence, service workers, broker integration, trades or payments. Reading/source links navigate away only on click. The host may keep ordinary access logs. Browser session restore may retain form values; reset is not secure erasure.

The document has a restrictive meta content-security policy disabling runtime connections, objects, base changes and form actions. Response headers, framing policy and host caches are not controlled or guaranteed by that meta policy. Python runtime performs bounded local math and emits JSON. Test harnesses invoke Python and a loopback server. These are engineering safeguards, not a security certification.

## Conceptual references

No external implementation, datasets, graphics or fitted parameters are bundled. The code and interface are original.

- [Gatheral and Jacquier, Arbitrage-free SVI volatility surfaces](https://arxiv.org/html/1204.0646): raw SVI, total variance, fixed-k calendar condition and density-sign diagnostic. Tenorwell does not claim the paper's no-arbitrage calibration guarantee.
- [Le Floch, Arbitrages in the Volatility Surface Interpolation and Extrapolation](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2175001): the fetched abstract warns that linear variance interpolation can introduce intermediate-slice arbitrage.
- [SciPy, 1-D interpolation](https://docs.scipy.org/doc/scipy/tutorial/interpolate/1D.html): linear interpolation and boundary behavior; SciPy is not a dependency.
- [StatLect, linear regression model](https://www.statlect.com/fundamentals-of-statistics/linear-regression): OLS terminology.
- [CME, understanding implied volatility and skew](https://www.cmegroup.com/education/articles-and-reports/implied-volatility): option-volatility terminology, not evidence for any market claim made by this synthetic lab.
- [Marzio Sala, the Surface SVI model](https://marziosala.github.io/ssvi/): SSVI background and notation, a different model class from the raw-SVI finite search used here.

Built by Aditya Kulkarni. MIT licensed. Education only, not financial advice.
