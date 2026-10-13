# 地理数据源 (Data Sources)

完整设计见 [`docs/rendering-data-sources.zh-CN.md`](../../../docs/rendering-data-sources.zh-CN.md)。本模块作为**地理抽象总线**，管理两种运行时数据源：`raster`（球面 cell 字段）和 `geojson`（点、线、面要素）。

## 目录结构与职能分工

```text
src/core/data-source/
├── adapters/                     # 要素派生适配器层（纯函数：从 SimulationState 提取要素）
│   ├── area-adapter.ts          # 面要素：板块/大陆/气候带/国家/民族/宗教区域与陆地拓扑
│   ├── line-adapter.ts          # 线要素：断裂带/国界线/道路网/海上航线
│   ├── river-adapter.ts         # 水系要素：D8 汇流树转 LineString 与流量河宽
│   ├── point-adapter.ts         # 点要素：聚落/圣地点标记
│   └── symbol-adapter.ts        # 注记要素：地名与图标排版
│
├── runtime/                      # 运行时总线与生命周期管理
│   ├── source-registry.ts       # 地图样式内置源清单与元数据定义
│   ├── geojson-cache.ts         # WeakMap 惰性缓存与生成型 GeoJSON 分发中心
│   └── data-source-manager.ts   # 导入型数据源 CRUD、版本修订号与变更事件订阅
│
├── utils/                        # 物理场辅助提取函数
│   └── raster-field-extractors.ts # 提取风速、洋流温差等物理场数组
│
├── geojson.ts                   # 标准 GeoJSON 类型定义与合法性校验
└── index.ts                     # 根目录统一门面导出出口 (100% 向后兼容)
```

## 设计准则

1. **统一出口**：优先通过 `@/core/data-source` 导入所需的类型与方法。
2. **读写解耦**：底层物理模拟的 `TypedArray` 是权威真源；适配器负责派生为 GeoJSON，并通过 `WeakMap` 进行惰性缓存，不随每一帧重建。
3. **样式与数据解耦**：数据源只表达“有什么要素和属性”，具体颜色、线宽、图标尺寸及文字注记碰撞由 [`core/styles`](../styles/README.md) 样式文档与渲染层控制。
