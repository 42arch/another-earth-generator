# Generation Pipeline 与 Worker

> 更新：2026-11-06。记录当前执行与缓存契约，不表示完整 M1 已完成。字段见 [世界数据契约](WORLD_DATA_CONTRACTS.md)，算法与后续设计见 [技术设计](TECHNICAL_DESIGN.md)和 [M1 实施计划](M1_IMPLEMENTATION_PLAN.md)。

## 公开入口

`@another-earth/world-core` 提供 `StageRegistry`、`GenerationPipeline`、`StageCache`、`createMeshPipeline`、`createGeologyPipeline`、`createTerrainPipeline` 和工作区新增的 `createClimatePipeline`。后者生成 T0 上的初步月气候 C0；本次未运行检查，未验收。没有完整自然快照发布。

```ts
import { createTerrainPipeline, DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS,
} from '@another-earth/world-core'
import type { TerrainArtifact } from '@another-earth/world-core'

const pipeline = createTerrainPipeline()
const input = { seed: '42', config: {
  planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
  mesh: { subdivisionLevel: 4, irregularity: 0.75 },
  geology: DEFAULT_GEOLOGY_PARAMETERS,
  landforms: DEFAULT_LANDFORM_PARAMETERS,
  terrain: DEFAULT_TERRAIN_PARAMETERS,
} }
const plan = pipeline.plan(input)
const result = await pipeline.execute(input)
const terrain = result.getOutput<TerrainArtifact>('terrain') // 共享借用，不可修改或 Transfer
```

## 当前 Stage 与直接依赖

| Stage | 版本 | 直接依赖 |
| --- | --- | --- |
| mesh | 1 | 无 |
| reference-mesh | geology-v2 | 无 |
| reference-subdivisions | geology-v2 | reference-mesh |
| plate-topology | geology-v2 | reference-mesh、reference-subdivisions |
| continental-crust | geology-v2 | reference-mesh、plate-topology |
| geological-mapping | geology-v2 | mesh、reference-mesh |
| geology | geology-v2 | mesh、reference-mesh、geological-mapping、plate-topology、continental-crust |
| plate-dynamics | terrain-v2 | reference-mesh、plate-topology、continental-crust |
| tectonics | terrain-v2 | mesh、geology、plate-topology、continental-crust、plate-dynamics |
| tectonic-elevation | terrain-skeleton-v9 | mesh、geology、tectonics |
| terrain | terrain-v20 | mesh、geology、tectonics、tectonic-elevation |
| climate-c0 | climate-c0-v2 | mesh、reference-mesh、geology、terrain |

前七项组成地质 Pipeline；Mesh Pipeline 只有 mesh；Terrain Pipeline 复用地质 Registry 再追加四项。Climate Pipeline 再追加 C0；水文、生态和发布 Stage 尚未注册。

配置按源码 configKeys 声明：Mesh 读等级、扰动、可选 Mesh Seed、物理半径；参考 Mesh 另读参考等级（默认 L6，显式 L2–L6）；板块读主/微板块数和板块面积差异；大陆读大陆数、面积差异与候选覆盖率；骨架读三项 landforms；terrain 读四项地形参数、islandDensity 和海平面基准。其余信息由声明的上游获得。

## 配置与局部失效

| 配置 | 当前默认/范围 | 重算边界 |
| --- | --- | --- |
| 输出 Mesh | 核心 L0–L8，扰动 [0,1]；UI L4–L8 | 输出 Mesh、映射及输出地质/构造/地形 |
| 参考 Mesh | 默认 L6，显式 L2–L6 | 参考地质与全部消费者 |
| 主/微板块 | 默认 10/14，实际数受连通性约束 | 板块拓扑及消费者 |
| 板块/大陆面积差异 | 默认 0.8/0.35 | 各自 Stage 及消费者 |
| 候选大陆数/覆盖率 | 默认 7/0.3 | 地壳、投影及后续，不重算板块拓扑 |
| islandArcCount/islandDensity/hotspotCount | 默认 6/0.65/5 | 骨架及 terrain；islandDensity 也是 terrain 直接输入 |
| roughness | [0,0.5]，默认 0.4 | terrain |
| terrainWarp/smoothing/ridgeSharpening | [0,1]，默认 0.75/0.1/0.5 | terrain |
| seaLevelDatumKm | 默认 0，须满足物理径向约束 | terrain |
| 相机、配色、专题、线框 | ViewState | 不生成 |

roughness 可调纹理强度按 `(roughness/0.4)³` 响应。旧 continentalUpliftKm/glacialErosion/hydraulicErosion 配置即便为零也在计划/执行前报错，包括全缓存命中；M1.1 没有侵蚀参数或运行期侵蚀开关。

## DAG、签名与随机流

Registry 拒绝重复 ID、空声明、缺失依赖和循环。Kahn 排序的 ready 集按 Stage ID 的 JS 字符顺序排序，注册顺序不决定结果。getDependency/getConfig/getContentSignature 只能读已声明输入。

签名对 Stage ID/版本、World Seed、声明配置（含缺失标记）、内容签名、上游签名、Seed 派生版本、随机 Profile 和 PRNG 版本规范序列化后做 FNV-1a 64。对象键排序；非法非有限值、循环或非 JSON 配置拒绝。Cache Key 同时保留规范原文避免缓存内短哈希碰撞歧义；它不是密码学哈希。未知显示状态不参与生成签名。

`force: true` 重跑全部，Stage ID 列表强制该节点及下游。plan 是当前缓存的预测，执行时会再次确认可命中。

默认 Stage 随机流由 World Seed、Stage ID、版本派生 Mulberry32，稳定 fork 只依赖不可变流身份，不依赖父流当前取数位置。Mesh 用 `alea-direct-v1` 保留旧几何取数兼容，可由 mesh.seed 覆盖 World Seed；规则网格几何可不受 Seed 影响，Pipeline 仍保守包含 World Seed。

骨架/terrain 显式固定 `terrain-skeleton-v5`/`terrain-v7` 的随机派生版本，同时使用当前 Stage 版本失效缓存。这样输出曲线调整不会顺带换一套噪声；同版本确定性仍须按固定 Seed 验收，不承诺跨版本或与参考项目逐字节一致。

## 所有权与执行

1. Stage 拥有新建工作数组，返回后经 validate 才进入 Pipeline/Cache；校验失败或取消不提交该阶段产物。
2. getDependency 返回零拷贝只读 Proxy，禁止属性写入、原地方法与 .buffer 访问。热循环由内部 copyDependency 按消费字段生成原生 TypedArray 工作副本；不能绕过输入声明或改写上游。
3. getOutput 返回共享借用，不是不可变深副本。调用者不得修改、detach、Transfer 或保留构建时可写别名；普通元素篡改不能无成本侦测。
4. StageCache 默认 512 MiB LRU，以容纳 L8 地形完整阶段链（core 实测约 430.5 MiB，Worker 实测约 399.3 MiB）。预算统计包含 Buffer 去重后的主要产物字节，不等于进程/GPU峰值；过大条目不缓存。查到 Buffer 已 detach 时丢弃条目，clear 可手动清空。
5. Stage 顺序执行；AbortSignal 在阶段前后和主动检查点生效。同步长循环不能接收同线程新消息来即时中断，强制终止由 Worker 负责。

事件含 runId、stageId、进度、适用时耗时和错误；订阅者异常不改变结果。失败保留 cause 并停止下游，不自动重试；有效的已完成缓存仍可保留。Pipeline 成功不等于完整 WorldSnapshot 发布。

## Web Worker 与显示

Web Controller/Runtime 原有三种生成任务；C0 第四种已接入但未运行验证。Worker 原数组归缓存，每次发送前结构化克隆独立产物并去重转移 Buffer；主线程核对请求种类、Mesh 身份、dtype、长度、诊断和海陆一致性。不能在只收到 Mesh 时完成请求过的 Terrain 或 C0 任务。

只接收最新 requestId 的生成/拾取响应。硬取消终止重建 Worker，旧显示保留但缓存丢失；重新成功生成前禁用区域查询，防止旧画面和新 Worker 事实身份错配。失败、取消和传输错误不覆盖最后有效显示。页面销毁终止 Worker 并释放场景资源。

当前调试页面用单位球和颜色表达高程，不是正式世界查询/地图发布协议。月份、风格与图层的未来显示缓存也不得进入生成签名。

## 未来的气候、水文与侵蚀

采用有限顺序 `T0 → C0/H0/I0 → T1 → C1/H1 → 河流湖泊最终事实 → 生态 → 快照发布`。C0 已有待验证的代码切片；径流、冰雪及 C1 尚未实现。基础气候、径流和冰雪是侵蚀输入，侵蚀后重新计算最终气候水文；T0/T1 和前后轮状态使用不同产物身份，不能在同一个 Stage ID 上构造依赖循环。

当前 C0 使用输出面积聚合到参考 Mesh，空参考格退回最近输出格；在参考格计算四季风／洋流代理、月温和月降水，以三个邻近参考格优先同海陆插值回输出，并按物理面积修正全球月降水体积。`climate-c0-v2` 直接读取 climate 的自转、倾角、公转周期、温度偏移、降水倍率；物理半径来自 Mesh 上游签名。月份选择属于显示状态。旧算法的随机输入已改用 Stage fork，日历改为 12 个等时长分箱，距离使用实际物理半径；结果与性能尚待对照验收。

参考侵蚀算法现保留在源码，但没有被 M1.1 调用，也没有预建未来 Stage/空接口。后续接入应重新确定面积、距离、时间和流量单位，统一路由辅助面与地形事实的边界。

## 证据与复跑

历史实测文件、对应机器/版本和当前待验收项集中在 [PROGRESS](PROGRESS.md)。已有 bench:mesh、bench:generation、bench:geology、bench:terrain；前两者不能作为完整自然链的性能证据。列出命令不代表授权执行，仍按 AGENTS.md 获用户明确授权后运行。缓存命中耗时、数组字节、RSS 阶段采样与真实峰值必须分开报告。
