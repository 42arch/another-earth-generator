# 制图样式

数据源实现位于 [`core/data-source`](../data-source/README.md)。样式文档声明 `sources` 和有序 `layers`；图层用 `source` ID、`renderer`、`views`、`baseMaps`、缩放范围、筛选表达式、`layout` 与 `paint` 描述绘制。整体数据流见[系统架构](../../../docs/architecture.md)。

内置 Light、Standard、Dark 位于 `presets.ts`。`registerMapStyleDocument` 可注册自定义样式；自定义 GeoJSON 数据源应先调用 `importGeoJsonSource`，再注册引用它的样式。`validateMapStyleDocument` 检查源与渲染器兼容性。`get` 表达式读取要素属性或当前 cell 字段，`step`／`interpolate`／`match` 可配置分级颜色和缩放变化。

点、普通线、面和文字分别由 `StyledPointLayer`、`StyledLineLayer`、`StyledFillLayer`、`StyledSymbolLayer` 在 2D 与 3D 视图复用。普通线使用屏幕像素宽度的带状网格；`line-width` 可按要素变化，`line-dasharray` 接受 `[实线长度, 间隔长度]`，两个长度都是线宽的倍数，`[0, 0]` 表示实线。虚线距离沿整条路径累计，投影接缝裁切后仍保持相位。河流从 `river-network` GeoJSON 线源生成宽度可变的 ribbon。`MapView` 和 `GlobeView` 的 `pickGeoJsonFeature` 返回样式图层 ID、源 ID、要素 ID，供编辑器定位原始数据。
