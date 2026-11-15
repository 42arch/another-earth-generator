"""Read NOAA PSL 1991–2020 NetCDF normals and summarize Earth climate by area."""

import argparse
import json
from pathlib import Path

import numpy as np
from netCDF4 import Dataset


FILES = {
    "precipitation": (
        "https://psl.noaa.gov/thredds/fileServer/Datasets/gpcp/precip.mon.ltm.1991-2020.nc",
        "precip",
    ),
    "wind": (
        "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface_gauss/uwnd.10m.mon.ltm.1991-2020.nc",
        "uwnd",
    ),
    "temperature": (
        "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface_gauss/air.2m.mon.ltm.1991-2020.nc",
        "air",
    ),
    "landMask": (
        "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis/surface_gauss/land.sfc.gauss.nc",
        "land",
    ),
}
DRIFTER_URL = (
    "https://erddap.aoml.noaa.gov/gdp/erddap/griddap/drifter_monthlymeans.nc"
    "?U[0:1:11][0:4:1439][0:4:631],V[0:1:11][0:4:1439][0:4:631]"
)


def read(directory, name):
    url, field = FILES[name]
    with Dataset(directory / url.rsplit("/", 1)[1]) as dataset:
        return (
            np.asarray(dataset["lat"][:]),
            np.asarray(dataset["lon"][:]),
            np.ma.asarray(dataset[field][:], dtype=np.float64).filled(np.nan),
        )


def weighted(field, weight, selected):
    weights = np.where(selected, np.broadcast_to(weight, selected.shape), 0)
    area = np.sum(weights * np.isfinite(field), axis=(1, 2))
    return (np.nansum(field * weights, axis=(1, 2)) / area).tolist()


def bands(field, latitude, weight, land):
    return {
        f"{start}..{start + 15}/{name}": weighted(
            field,
            weight,
            (latitude[:, None] >= start)
            & (latitude[:, None] < start + 15)
            & domain,
        )
        for start in range(-90, 90, 15)
        for name, domain in (("land", land), ("ocean", ~land))
        if ((latitude[:, None] >= start) & (latitude[:, None] < start + 15) & domain).any()
    }


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("directory", type=Path, help="Directory with the four NOAA PSL files")
parser.add_argument("--drifters", type=Path, help="Optional NOAA/AOML monthly drifter NetCDF subset")
args = parser.parse_args()

mask_lat, mask_lon, mask = read(args.directory, "landMask")
wind_lat, wind_lon, wind = read(args.directory, "wind")
temp_lat, temp_lon, temp = read(args.directory, "temperature")
rain_lat, rain_lon, rain_rate = read(args.directory, "precipitation")
for latitude, longitude in ((wind_lat, wind_lon), (temp_lat, temp_lon)):
    if not np.array_equal(latitude, mask_lat) or not np.array_equal(longitude, mask_lon):
        raise ValueError("NCEP climate normals and land mask must share the Gaussian grid")
nodes, weights = np.polynomial.legendre.leggauss(len(mask_lat))
if not np.allclose(np.sin(np.deg2rad(mask_lat)), nodes[::-1], atol=1e-5):
    raise ValueError("Expected descending Gaussian latitudes")
gaussian_weight = weights[::-1, None]
land = mask[0] >= 0.5
rain_y = np.argmin(np.abs(rain_lat[:, None] - mask_lat), axis=1)
lon_delta = (rain_lon[:, None] - mask_lon + 180) % 360 - 180
rain_x = np.argmin(np.abs(lon_delta), axis=1)
rain_land = land[np.ix_(rain_y, rain_x)]
rain_weight = np.cos(np.deg2rad(rain_lat))[:, None]
rain = rain_rate * (365.25 / 12)
temp = temp - 273.15
tropical_ocean = (np.abs(rain_lat[:, None]) < 20) & ~rain_land

report = {
    "period": "1991–2020",
    "sources": {key: url for key, (url, _) in FILES.items()},
    "methods": "NOAA PSL NCEP/NCAR R1 Gaussian grid and GPCP v2.3 regular grid. GPCP land mask is nearest NCEP cell. Precipitation rates are converted to 365.25/12-day months.",
    "monthlyEastwardWindMps": bands(wind, wind_lat, gaussian_weight, land),
    "monthlyTemperatureC": bands(temp, temp_lat, gaussian_weight, land),
    "monthlyPrecipitationMm": bands(rain, rain_lat, rain_weight, rain_land),
    "annualMeanTemperatureC": {
        name: float(np.mean(weighted(temp, gaussian_weight, domain)))
        for name, domain in (("global", np.ones_like(land)), ("land", land), ("ocean", ~land))
    },
    "annualPrecipitationMm": {
        name: sum(weighted(rain, rain_weight, domain))
        for name, domain in (("global", np.ones_like(rain_land)), ("land", rain_land), ("ocean", ~rain_land))
    },
    "tropicalOceanRainCentroidDegrees": (
        np.array(weighted(rain * rain_lat[None, :, None], rain_weight, tropical_ocean))
        / weighted(rain, rain_weight, tropical_ocean)
    ).tolist(),
}

if args.drifters:
    with Dataset(args.drifters) as data:
        current_lat = np.asarray(data["latitude"][:])
        current_east = np.ma.asarray(data["U"][:]).filled(np.nan).transpose(0, 2, 1)
        current_north = np.ma.asarray(data["V"][:]).filled(np.nan).transpose(0, 2, 1)
    complete = np.isfinite(current_east).all(axis=0) & np.isfinite(current_north).all(axis=0)
    current_weight = np.broadcast_to(np.cos(np.deg2rad(current_lat))[:, None], complete.shape)
    current_annual = np.mean(current_east, axis=0)
    report["drifterCurrentClimatology"] = {
        "source": DRIFTER_URL,
        "citation": "https://doi.org/10.1016/j.dsr.2017.04.009",
        "method": "One degree stride. Cells with all 12 months of U and V. Latitude coverage is 72.875 S to 84.125 N.",
        "bands": {
            f"{start}..{start + width}": {
                "monthlyEastMps": weighted(current_east, current_weight, selected),
                "monthlyNorthMps": weighted(current_north, current_weight, selected),
                "annualEastwardAreaShare": float(current_weight[selected & (current_annual > 0)].sum()
                                                 / current_weight[selected].sum()),
            }
            for width, starts in ((15, range(-75, 75, 15)), (5, range(-15, 15, 5)))
            for start in starts
            if (selected := complete & (current_lat[:, None] >= start)
                & (current_lat[:, None] < start + width)).any()
        },
    }

print(json.dumps(report, indent=2, allow_nan=False))
