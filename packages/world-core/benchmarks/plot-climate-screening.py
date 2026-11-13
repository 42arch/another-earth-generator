"""Plot the annual climate and annual/seasonal vectors from a --spatial diagnosis."""

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import BoundaryNorm, ListedColormap

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("diagnosis", type=Path)
parser.add_argument("figure", type=Path)
args = parser.parse_args()
report = json.loads(args.diagnosis.read_text())
preview = report["spatialPreview"]
rows, columns = preview["rows"], preview["columns"]
cells = preview["cells"]
extent = (-180, 180, -90, 90)


def field(key):
    return np.array([cell[key] for cell in cells]).reshape(rows, columns)


land = field("land")
vectors = np.array([cell["vectors"] for cell in cells]).reshape(rows, columns, 4, 3)
step = preview["resolutionDegrees"]
longitude, latitude = np.meshgrid(np.arange(-180 + step / 2, 180, step),
                                  np.arange(-90 + step / 2, 90, step))
figure, axes = plt.subplots(4, 2, figsize=(12, 12), layout="constrained")


def raster(axis, values, title, **kwargs):
    image = axis.imshow(values, extent=extent, origin="lower", interpolation="nearest", **kwargs)
    axis.contour(longitude, latitude, land, levels=[0.5], colors="black", linewidths=0.35)
    axis.set(title=title, xlim=(-180, 180), ylim=(-90, 90),
             xticks=[-120, -60, 0, 60, 120], yticks=[-60, -30, 0, 30, 60])
    axis.tick_params(labelsize=7)
    return image


for axis, key, title, cmap in (
    (axes[0, 0], "temperatureC", "Annual air temperature (°C)", "coolwarm"),
    (axes[0, 1], "precipitationMm", "Annual precipitation (mm)", "YlGnBu"),
):
    figure.colorbar(raster(axis, field(key), title, cmap=cmap), ax=axis, shrink=0.77)

colors = list(plt.get_cmap("tab20").colors) + list(plt.get_cmap("tab20b").colors)
for axis, key, title in (
    (axes[1, 0], "koppen", "Köppen categories"),
    (axes[1, 1], "biome", "Potential biomes"),
):
    values = np.ma.masked_where(~land, field(key))
    count = int(values.max()) + 1
    raster(axis, values, title, cmap=ListedColormap(colors[:count]),
           norm=BoundaryNorm(np.arange(count + 1) - 0.5, count))

for axis, field_index, month, title in (
    (axes[2, 0], 0, 0, "Annual wind"),
    (axes[2, 1], 2, 0, "Annual surface current"),
    (axes[3, 0], 2, 1, "January surface current"),
    (axes[3, 1], 2, 2, "July surface current"),
):
    east, north = np.moveaxis(vectors[:, :, field_index:field_index + 2, month], 2, 0)
    speed = np.hypot(east, north)
    limit = np.quantile(np.abs(east), 0.95)
    east_shade = np.ma.masked_where(land, east) if field_index == 2 else east
    raster(axis, east_shade, title, cmap="RdBu_r", vmin=-limit, vmax=limit)
    direction = np.where(speed > 0, speed, np.nan)
    subsample = np.s_[2::5, 2::5]
    axis.quiver(longitude[subsample], latitude[subsample], (east / direction)[subsample],
                (north / direction)[subsample], scale=49, width=0.002, color="#252525")

figure.suptitle(f'Seed {report["seed"]} · {report["versions"]["climate"]} · blue westward, red eastward')
figure.savefig(args.figure, dpi=150)
