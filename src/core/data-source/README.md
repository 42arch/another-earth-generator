# 地理数据源

完整设计见 [`docs/rendering-data-sources.zh-CN.md`](../../../docs/rendering-data-sources.zh-CN.md)。这里管理两种运行时数据源：`raster`（球面 cell 字段）和 `geojson`（点、线、面要素）。

- `data-sources.ts` 管理导入型数据、网格标识、修订号、编辑和变更通知；`geojson.ts` 定义要素格式及校验。
- `geojson-source-runtime.ts` 缓存由模拟结果派生的 GeoJSON，并支持注册自定义提供者。
- `geojson-area-sources.ts`、`geojson-line-sources.ts`、`point-source-adapters.ts`、`symbol-source-adapters.ts` 和 `river-geojson.ts` 将模拟结果转换为地理要素。
- `source-registry.ts` 描述内置数据源，供制图样式引用和校验。

统一入口为 `index.ts`。样式规则和预设仍位于 [`rendering/styles`](../rendering/styles/README.md)；屏幕空间拾取和 GPU 几何编译仍属于渲染层。
