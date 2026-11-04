# M0.4 Generation Pipeline

`@another-earth/world-core` 现在提供 `StageRegistry`、`GenerationPipeline<TConfig>`、`StageCache`、`DeterministicRandom`、`meshStage` 和 `createMeshPipeline()`。M0.4 的唯一生产 Stage 是 Mesh；地质、气候等只在测试中作为 Mock DAG 出现。没有生成 WorldSnapshot 或修改 M0.3 数学算法。

```ts
import { createMeshPipeline } from '@another-earth/world-core'
import type { SphericalMesh } from '@another-earth/world-core'

const pipeline = createMeshPipeline()
const input = {
  seed: '42',
  config: {
    planet: { physicalRadiusKm: 6371 },
    mesh: { subdivisionLevel: 6, irregularity: 0.5 },
  },
}
const plan = pipeline.plan(input)
const result = await pipeline.execute(input, { onEvent: event => console.log(event) })
const mesh = result.getOutput<SphericalMesh>('mesh')
```

## DAG 与签名

Registry 拒绝重复 ID、缺失依赖和循环。Kahn 拓扑排序的 ready 集按 Stage ID 的 JS 字符编码顺序排序，注册顺序不影响调度。Stage 只能通过 `getDependency` 读取声明的上游，`getConfig` 和 `getContentSignature` 也只接受声明的键。Stage 输出是独立 Artifact，不要求中间 Stage 生成快照。

每 Stage 的输入签名是 FNV-1a 64，对 `[stageId, version, worldSeed, 已声明配置子集, 已声明内容指纹, 上游签名, Seed 派生版本, 随机 Profile, PRNG 版本]` 的规范序列化求值。对象键排序；缺失值有独立标记；NaN、Infinity、非 JSON 配置和循环结构被拒绝。Key 保留规范原文以消除缓存内哈希碰撞歧义。签名是确定性缓存标识，不是加密校验和。未声明的气候、文明、地图样式参数不会使 Mesh 失效。强制执行可用 `force: true` 或 Stage ID 列表；指定 Stage 的下游也强制重算。

`WorldGenerationConfig` 是本阶段的 Pipeline 输入：`planet.physicalRadiusKm`、`mesh.subdivisionLevel`、`mesh.irregularity`、可选 `mesh.seed`。M0.2 `WorldMetadata.generationConfig` 目前只记录行星、区域数和文明开关，尚不够描述所有生成参数。本阶段未更改快照 Schema；未来最终快照组装阶段必须记录完整的 Pipeline 输入和版本，不能用旧的精简元数据冒充完整存档。

## 随机与 Mesh 兼容

共享 PRNG 位于 `world-core/src/math/random.ts`，公开 `RandomSource`（`nextFloat`、`nextInt(minInclusive, maxExclusive)`、`fork(namespace)`）、`DeterministicRandom` 与 `AleaRandom`。默认 Stage 流用稳定 UTF-16 双字节 FNV-1a 64 哈希初始化 Mulberry32，由 World Seed、Stage ID、Stage Version 派生；`fork(namespace)` 以不可变流身份派生，不读取父流的当前状态。实体可以使用 `fork('region:123')` 形成独立子流。序列在 JS 整数运算语义内可复现；变更算法或 Seed 派生版本会使 Stage Cache 失效。

MeshStage 声明 `alea-direct-v1` 随机 Profile。Pipeline 用原始 World Seed 或显式 `mesh.seed` 创建新鲜 `AleaRandom`，注入 Mesh Builder；直接使用 Mesh Builder 时也会默认创建同一共享模块的 `AleaRandom`。Jitter 只消费注入的 `RandomSource`，不自行创建 PRNG；其取数顺序与 M0.3 一致，因此同参数的中心、三角面及 Voronoi 数据保持一致。其他 Stage 默认使用独立的派生流。World Seed 即使在规则网格下也进入缓存签名，允许保守失效。

## 所有权、取消和进度

Stage 创建输出时拥有数组；`execute` 返回并通过校验后，所有权交给 Pipeline。下游 Stage 通过零拷贝只读代理访问依赖；代理禁止普通属性写入、TypedArray 原地修改方法和 `.buffer` 访问。公开 `result.getOutput()` 是对缓存产物的**共享借用**，用于现有高密度查询和显示数组转换；调用者不得修改、detach 或 transfer 它的 Buffer，也不得保留 Stage 创建时的可写别名。若外部违规 detach，Cache 在下一次查找时检测并丢弃该条目；普通元素篡改无法无成本检测。Worker 传输只发送另行生成的显示数组。内存 Cache 默认 128 MiB，LRU 清理，`clear()` 手动清空；预算按主要 TypedArray Buffer 去重统计，不等于 JS 堆或 GPU 峰值。

生命周期事件包括 pipeline/stage 开始、Stage 进度/完成/命中/失败、Pipeline 完成/取消。事件含 runId、Stage ID、阶段和整体进度、适用时的耗时与错误摘要。事件订阅者异常不改变生成结果。AbortSignal 在 Stage 之间、执行前后检查；未完成输出不入缓存，已完成有效缓存保留。M0.3 Mesh Builder 是同步计算，无法在一次大型 Mesh 构建中间抢占，M0.5 的 Worker 管理负责后台响应性和强制终止。失败保留原始 `cause`，停止后续调度；不自动重试。

## 测量

运行 `pnpm --filter @another-earth/world-core bench:generation`，原始结果见 [M0.4-pipeline.json](benchmarks/M0.4-pipeline.json)。2026-11-03，Apple M3 Pro，Node v24.17.0，单次首次构建，100 次命中均摊；非跨设备保证：

| 参数 | 首次 Pipeline | Cache Hit | Cache 主要字节 |
| --- | ---: | ---: | ---: |
| L5, irregularity 0.5 | 228 ms | 0.083 ms | 2.70 MiB |
| L6, irregularity 0.5 | 562 ms | 0.087 ms | 10.78 MiB |
| L7, irregularity 0.5 | 2413 ms | 0.044 ms | 43.13 MiB |

空 Pipeline 1000 次均摊约 3.8 µs；L5/L6/L7 的 `plan()` 1000 次均摊约 48/25/21 µs，包含 JIT 和测量顺序影响。首次耗时包括 Mesh 完整拓扑校验；精确峰值内存未测量。
