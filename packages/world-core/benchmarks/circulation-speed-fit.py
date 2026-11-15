"""Fit velocity display scales from archived ocean latitude-band observations."""

import argparse
import json
from math import hypot, radians, sin, sqrt
from pathlib import Path


def samples(report, observations, kind):
    for lower in range(-60, 60, 15):
        upper = lower + 15
        band = f"{lower}..{upper}"
        weight = sin(radians(upper)) - sin(radians(lower))
        for month in range(12):
            key = f"{month + 1}/{band}/ocean"
            if kind == "wind":
                model = abs(report["monthlyWind"][key]["meanEast"])
                observed = abs(observations["monthlyEastwardWindMps"][f"{band}/ocean"][month])
            else:
                model = report["monthlyCurrent"][key]["spatialMeanVectorSpeed"]
                band_observations = observations["drifterCurrentClimatology"]["bands"][band]
                observed = hypot(
                    band_observations["monthlyEastMps"][month],
                    band_observations["monthlyNorthMps"][month],
                )
            yield model, observed, weight


def fit_scale(rows):
    return sum(weight * model * observed for model, observed, weight in rows) / sum(
        weight * model**2 for model, _, weight in rows
    )


def rmse(rows, scale):
    return sqrt(
        sum(weight * (scale * model - observed) ** 2 for model, observed, weight in rows)
        / sum(weight for _, _, weight in rows)
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("observations", type=Path, help="Archived M1.2 climate calibration JSON")
    parser.add_argument("default", type=Path, help="Default world circulation diagnosis JSON")
    parser.add_argument("holdouts", type=Path, nargs="*", help="Independent world diagnosis files")
    args = parser.parse_args()
    observations = json.loads(args.observations.read_text())["observations"]
    default = json.loads(args.default.read_text())
    holdouts = [json.loads(path.read_text()) for path in args.holdouts]

    for kind in ("wind", "ocean"):
        rows = list(samples(default, observations, kind))
        fitted = fit_scale(rows)
        scale = round(fitted, 3)
        print(f"{kind}: fitted={fitted:.6f}, display scale={scale:.3f}, groups={len(rows)}")
        for report in (default, *holdouts):
            world_rows = list(samples(report, observations, kind))
            print(
                f"  Seed {report['seed']}: RMSE={rmse(world_rows, scale):.3f} m/s, "
                f"independent fit={fit_scale(world_rows):.6f}"
            )


if __name__ == "__main__":
    main()
