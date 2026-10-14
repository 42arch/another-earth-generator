# 另一个地球生成器 (Another Earth Generator)

[English](./README.md) | [简体中文](./README.zh-CN.md)

![Demo](./demo.png)

一个在浏览器中生成过程化虚拟星球的实验性项目。相同的种子和参数决定了球面网格、构造板块、大陆、地形、季节气候、河网、生物群系与人文系统；同一份球面结果可以同时在 3D 地球和 2D 地图上查看。

## 当前功能

- 调整种子、网格细节、构造板块与大陆参数、地形强度、地轴倾角以及温带/降水参数来重新生成世界。
- 在地球和地图视图之间切换，以查看卫星图像、地形、高程、构造板块、几何流向、逐月气温与降水、风场、洋流、柯本气候分类和生物群系。
- 查看人口、市场可达性、民族、语言、国家与宗教分布，叠加聚落、道路、航线、河流等要素，并点击区域查看详情。

生成结果是一个用于可视化和过程生成的近似模型，而非地球系统的定量预测。洋流强度是一个相对值；当前水文阶段尚未生成可见湖泊，人文系统是静态世界快照。

## 本地运行

需要 Node.js 和 pnpm。在项目根目录下运行：

```bash
pnpm install
pnpm dev
```

打开终端中提供的本地地址。使用 `pnpm test` 运行现有测试，使用 `pnpm build` 创建生产构建。

## 从何读起

从[文档入口](docs/README.md)开始，再读[系统架构](docs/architecture.md)与[数据契约](docs/data-contracts.md)。文档先解释生成过程和字段含义，再链接到实现源码。

核心代码按职责分为 [`simulation`](src/core/simulation/)（生成流水线及自然、人文领域模型）、[`data-source`](src/core/data-source/README.md)（raster／GeoJSON 数据源）、[`styles`](src/core/styles/README.md)（声明式制图样式）、[`rendering`](src/core/rendering/)（2D／3D 渲染器）。共用的球面网格保留在 [`mesh`](src/core/mesh/)。

人文生成已接入人口与聚落、交通与市场、民族与语言、国家与行政、宗教与信仰阶段；实际执行顺序见 [Worker 流水线](src/core/simulation/worker/simulation.worker.ts)。

技术栈：TypeScript、Vite、Svelte 5、Three.js、Tailwind CSS、Vitest。项目使用 pnpm 进行依赖管理。
