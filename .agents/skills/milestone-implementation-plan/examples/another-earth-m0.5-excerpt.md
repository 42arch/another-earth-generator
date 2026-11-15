# 示例：Another Earth M0.5 任务书写作粒度（节选）

这是用于理解输出粒度的**示例片段**，不是完整 M0.5 指令，也不代表当前仓库已完成前序阶段。

## 项目特定前提

- 新工程：`apps/web`、`packages/world-core`、`packages/world-data`、`packages/cartography`。
- 旧实现：`docs/old-src/`（只读）。
- 规划：Icosphere →（可选 Jitter + Delaunator）→ Spherical Voronoi；Mesh、Pipeline、RandomSource、MeshStage。
- 执行前必须核实这些模块在**实际源码**中的存在和 API，而不是照抄上一轮对话。

## 示例目标

让现有 Mesh Debug Viewer 通过浏览器 Web Worker 调用现有 Generation Pipeline，生成并展示真实的 SphericalMesh。主线程保持可交互，支持进度、重复生成、缓存命中与取消。

## 示例接口约束

- Worker 请求/响应使用携带 `requestId` 的 Discriminated Union。
- `apps/web` 管理 Worker 和 Controller；`world-core` 不依赖 DOM、Svelte、Three.js 或 Worker 全局 API。
- 主线程恢复 DTO 时，不能假设结构化克隆保留自定义 Class 原型。
- 不允许把缓存中的原始 Mesh ArrayBuffer 直接 Transfer 给主线程造成 Detach。

## 示例故障测试

| 情形 | 可验证结果 |
|---|---|
| 连续触发两次 Generate | Latest Request Wins，旧响应不能覆盖新结果 |
| 同一配置执行两次 | 第二次命中 Stage Cache；Worker 缓存 Buffer 保持有效 |
| 同步 Mesh 构建期间取消 | `worker.terminate()` 可以终止，Controller 重建 Worker 后可再次生成 |
| 大分辨率切换 | 旧 GPU 资源释放，页面无持续增长的无效渲染对象 |
| 非规则 Mesh | 与同 Seed 的直接调用结果匹配，拓扑仍有效 |

## 示例验收入口

在 Web App 中输入 Seed、Subdivision Level 和 Irregularity，点击 Generate；Web Worker 返回真实 Mesh 并更新 Viewer；点击 Cancel 后状态一致且可再次生成；展示真实 Stage 耗时和 Cache Hit / Rebuilt，而不是仅凭 UI 配置推断。

## 示例非目标

不实现新的地形、气候、文明生成；不添加 Worker Pool；不引入共享内存持久化缓存；不重构 Icosphere/Delaunator/Voronoi 数学算法。
