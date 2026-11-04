# Mesh Debug Viewer

运行 `pnpm dev`，打开 `/mesh-debug`。页面按需加载 Three.js，用户点击 Generate 后才启动网格任务。

## M0.5 执行链路

`MeshDebug.svelte` 使用 `GenerationController` 创建原生 module Worker。Worker 的 `GenerationWorkerRuntime` 保留一个 `createMeshPipeline()`，通过真实 MeshStage 生成完整 `SphericalMesh`。请求和响应使用带 `requestId` 的 discriminated union。进度来自 Pipeline 事件。重复参数可以命中同一 Worker 的 Stage Cache；修改无关显示参数只重新准备显示数组。

Worker 缓存拥有原始 Mesh TypedArray。每次返回结果时，`transferSnapshot` 对 Mesh 做一次受控 `structuredClone`，只转移副本的去重 ArrayBuffer。缓存原件不会 detach。主线程 `hydrateMesh` 检查所有主要 TypedArray 类型与长度，然后把完整 Mesh 交给现有 Voronoi/Icosphere 显示数据转换及 Renderer。选择区域仍由 Worker 的 `SphericalSpatialIndex` 处理。

Controller 默认执行 latest request wins。Hard Cancel 终止 Worker 并启动新 Worker，因此会丢失旧 Worker 缓存。Cooperative Cancel 使用 `CANCEL` 和 Pipeline 的 AbortSignal，但同步 MeshStage 计算期间无法立即处理消息。页面销毁时终止 Worker。新的显示数据安装前，Renderer 释放旧 Geometry 和 Material；页面销毁也释放 WebGL 资源。

L6/L7 默认关闭线框和自动旋转，并限制像素比为 1。L7 Mesh 原始数组约 43 MiB，传输副本也约 43 MiB；Voronoi 显示数组约 79 MiB，还需考虑浏览器结构化克隆、GPU 上传和短暂的切换峰值。Stage Cache 预算为 128 MiB。显示数组转换仍在主线程，L7 可能产生短暂卡顿；生成计算本身在 Worker 中，UI 可响应并可强制取消。

## 浏览器验证

2026-11-04，Codex in-app browser，Vite 本地开发服务器（`/mesh-debug`）再次手动验证真实 module Worker 链路：L2 规则网格首次生成显示 `Rebuilt`，重复参数显示 `Cache Hit`；irregularity 0.5 重新生成并显示 162 个区域及 Euler 特征 2；L7 任务可硬取消，页面保留旧网格供查看，随后 L2 可在新 Worker 中再次生成；点击球面返回区域、面积和邻接信息，WebGL 场景可见。浏览器错误日志为空。此验证不代替自动化浏览器回归测试，也未测量峰值内存或 GPU 上传耗时。

调试 Viewer 现在在开始新生成、取消、切换显示模式和销毁时使旧拾取回调失效，并将拾取结果绑定到发起查询时的 Mesh。取消或失败后如果仍显示旧网格，它仅供查看；再次生成成功后才恢复区域选择。

2026-11-04，Chrome，Apple M3 Pro，本机 Vite 开发服务器：

| 网格 | Pipeline | 副本复制 | postMessage | 主线程校验 | 请求往返 | Mesh 数组 | 显示准备 | 显示数组 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| L5 规则 | 40.6 ms | 2.1 ms | 0.1 ms | 0.1 ms | 44.1 ms | 2.7 MiB | 6.6 ms | 4.9 MiB |
| L6 规则 | 714.7 ms | 27.5 ms | 0.2 ms | 0.0 ms | 743.1 ms | 10.8 MiB | 91.2 ms | 19.7 MiB |
| L7 规则 | 2054.7 ms | 74.4 ms | 0.5 ms | 3.2 ms | 2135.2 ms | 43.1 MiB | 274.4 ms | 78.8 MiB |
| L7 扰动 0.5 | 2705.9 ms | 102.2 ms | 未单独记录 | 未单独记录 | 2825.9 ms | 43.1 MiB | 461.1 ms | 78.9 MiB |

本表的 `postMessage` 仅测同步入队耗时；请求往返包括 Pipeline、复制和消息交付，不代表纯传输耗时。首次 Worker 初始化约 648 ms；强制取消后新 Worker 初始化约 315 ms。重复 L2 参数观察到 Cache Hit（Pipeline 1.4 ms）。L7 生成期间点击 Cancel 后显示取消状态，随后以新 Worker 成功生成 L2 扰动网格。L5–L7 显示的 V−E+F 均为 2；切换后 GPU 几何体计数回到 L2 的 3 或高等级的 2。数据仅为单机观察，未测峰值内存和长期 GPU 压力。
