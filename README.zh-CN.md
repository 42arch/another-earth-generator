# 另一个地球生成器 (Another Earth Generator)

[English](./README.md) | [简体中文](./README.zh-CN.md)

![Demo](./demo.png)

一个在浏览器中生成过程化虚拟星球的实验性项目。相同的种子和参数决定了球面网格、构造板块、大陆、地形、季节气候、河网和生物群系；同一份球面结果可以同时在 3D 地球和 2D 地图上查看。

## 当前功能

- 调整种子、网格细节、构造板块与大陆参数、地形强度、地轴倾角以及温带/降水参数来重新生成世界。
- 在地球和地图视图之间切换，以查看卫星图像、地形、高程、构造板块、几何流向、逐月气温与降水、风场、洋流、柯本气候分类和生物群系。
- 叠加显示河流、云层和经纬网等元素，并点击区域查看对应的高程、气候和生态信息。

生成结果是一个用于可视化和过程生成的近似模型，而非地球系统的定量预测。洋流强度是一个相对值；湖泊、聚落和社会系统目前还没有生成阶段。

## 本地运行

需要 Node.js 和 pnpm。在项目根目录下运行：

```bash
pnpm install
pnpm dev
```

打开终端中提供的本地地址。使用 `pnpm test` 运行现有测试，使用 `pnpm build` 创建生产构建。

## 从何读起

非开发者可以从 [Wiki 简介](docs/wiki/README.zh-CN.md) 开始，依次了解“球面网格 → 板块与陆地 → 地形 → 季节环流与气候 → 河流 → 生态 → 可视化”。每章首先解释现象，然后提供算法、数据字段和源码入口。

开发者可以首先查看 [系统架构](docs/wiki/01-system-architecture.zh-CN.md) 和 [Worker 流水线](src/core/simulation/worker/simulation.worker.ts)。核心代码位于 `src/core/`，用户界面位于 `src/ui/`。

技术栈：TypeScript、Vite、Svelte 5、Three.js、Tailwind CSS、Vitest。项目使用 pnpm 进行依赖管理。
