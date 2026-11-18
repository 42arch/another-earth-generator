# Another Earth — 当前进度

> 历史快照：原始进度文档在 2026-11-18 精简前的完整副本。仅供追溯；当前能力与待办以 [PROGRESS.md](PROGRESS.md) 和源码为准。

> 更新：2026-11-18。记录当前工作区能力、验收状态与下一步，不作为逐轮调参日志。目标范围为 M0–M4；产品规则见 [PRD](PRD.md)。

2026-11-18 `world-data` 提供六份独立、自包含的社会内容 JSON：民族／种族与文化通用架空候选，以及 20 组中英文配对的国家形态候选。每份文件包含语言身份、包名、直接本地化名称和描述及显式依赖，不含 `translations`；包 ID 与条目 ID 带语言后缀，因此六个包可同时进入 Catalog。适配器在运行时从这些名称生成 ContentPack 翻译表，描述保留在定义本身并进入内容哈希。Society 作者 schema 与 ContentPack 均维持 schemaVersion 1，支持 `peoples`、`cultures`、`states`；state 记录政治形态、政府组织形式、国家元首／政府首脑／立法机关称谓、继任方式和权重。未发布的旧 v1–v3 哈希投影和 `namePoolId` 文化结构已移除；既有 `GovernmentArchetype` / `governments` 仍留在当前通用契约中。调试阶段内容变化只重算哈希，不递增 schemaVersion。民族与幻想种族在内容候选层共用 `PeopleArchetype`；“文明”继续使用文化原型。国家候选不是已生成的 Polity，现有 `Polity.governmentArchetypeId` 到 state 原型的映射及国家生成留待 M2。文化包显式依赖对应语言命名档案。六个语言包只进入完整内置 Catalog，当前自然生成目录及其世界内容签名不变。已编写针对当前 v1 哈希、验证、双语 ID 和 Society 往返的用例；本次未运行 test、typecheck、lint、build 或浏览器验证。已完成 JSON 解析及配对 ID/必填字段静态检查和 `git diff --check`。浏览器文件 UI 与自动获取跨包依赖仍未实现；M2 仍需确定候选到世界物种／族群及实际国家事实的映射、文化与人口分布和生成规则。

2026-11-18 Web 默认大陆、大洋命名接入中文 `NamingStyle` 和 `naming-v1` 模板生成，地名阶段升级至 `geographic-names-v3`；中文风格的大陆和大洋词库均改为现代音译专名，例如“阿维亚大陆”“诺维尔大陆”“阿维伦洋”“塞维尔洋”，替换神话感较强和城镇感较强的旧候选；两类候选各从 24 个增至 48 个。默认内容包现在明确采用西式构词传统和中文转写，尚未接入文明实体生成。命名配置现显式区分 `style` 与 BCP 47 `language`，作为风格-语言档案整体发布；“阿维亚大陆”属于 `western-zh-CN` 档案。NamingStyle JSON Schema 升至 v2，档案 ID 与签名都包含风格和语言；内置档案为 `western-zh-CN` / `western-en`，Web 继续使用中文语言档案。同类冲突仍追加中文序号，海仍无名。世界快照记录所用风格 ID 和风格签名，并从已记录内容包校验签名。按开发阶段决策，已移除旧 `geography` / `geography-zh` 内置包、历史档案专用 Catalog、旧名称来源字段与 v1/v2 阶段恢复兼容；快照校验要求地名阶段为 v3。当前 v3 档案仍可导出并恢复。由于算法和随机身份改变，同 Seed 新生成名称可能不同，未运行固定 Seed 对照；已保存名称不会重新抽取。风格选择、JSON 文件操作和自定义 Worker 内容仍未实现。兼容清理后 world-data 43/43、world-core 195/195、Web 29/29、cartography 22/22 定向测试通过；未运行 typecheck、lint、build 或浏览器验证。

2026-11-18 名称配置增加独立 JSON 格式 v1：`world-data` 提供 unknown/JSON 解析、字段路径错误、稳定导出、风格生成签名和当时的 ContentPack v2 适配；该未发布契约之后合并为 ContentPack schemaVersion 1。多份风格通过原 Catalog 并存，重复 ID 报错；v2 文化通过 `namingStyleId` 引用本包或直接精确版本依赖中的风格，多个文化可共用。新增可选的中式/西式小型 JSON 示例。`world-core` 增加 `naming-v1` 模板解释器，按 Seed、对象 ID、所选风格和规则建立独立随机流，支持完整候选、姓名顺序、固定文本和词根后缀组合。该轮保留 v1 包哈希投影与当时的内置自然世界加载路径，地图当时仍用 `geographic-names-v2`；后续地名接入见上一条。文化绑定仅是内容契约，尚未接入文明实体或地图命名。浏览器文件 UI、Worker 自定义内容传递、档案内嵌配置与分享复现仍待完成。已编写解析、组合、模板与跨包公开 API 用例，包括 v1 哈希格式回归；本次未运行 test、typecheck、lint、build 或浏览器验证，没有将新增用例记为通过。格式与边界见 [世界数据契约](WORLD_DATA_CONTRACTS_REFERENCE.md#名称配置与模板生成2026-11-18)。

2026-11-18 3D 自转改为绕极轴向东转动地球，相机、星空和太阳方向保持不动，晨昏线不再跟着画面转。默认转速与原先相机自转相同，为每秒 0.6°；开启自转后可在设置中调到 0.1–30°/秒。点击查询、地名朝向和 3D/2D 视角对齐按当前转角换回地理坐标。经纬网格、Cell 边界网格和自转开关都在侧栏设置中，自转仅 3D 可用。大气光晕、昼夜效果和两极冰盖仍留在图层辅助显示；换风格只重设大气光晕和昼夜效果。`planet-spin` 定向用例 2/2 通过。未运行全仓 test、typecheck、lint、build 或浏览器验证。

2026-11-18 温度偏移热端从 +40°C 放到 +60°C，冷端仍是 −40°C。+60°C 能把大约 7 km 山峰在偏移前接近 −25°C 的气温抬过冰点，热带则停在 60°C 月温上限。卫星地表的高山积雪改为跟着最暖月：最暖月高于 2°C 不再因为海拔另铺一层白。默认值仍是 0°C，月温公式和 `climate-c0-v21` 没有改。`climate.test.ts` 与 `monthly-temperature-generator.test.ts` 共 13/13 通过，`satellite-shader.test.ts` 与 `compiler.test.ts` 共 10/10 通过。参数面板滑块已是 −40–60°C、当前值 0。未用 +60°C 重新生成地图，未运行全仓 test、typecheck、lint 或 build。

2026-11-18 仿真卫星底色改用地表着色。渲染器在 `paint` 没有 `raster-mode` 时读取 `layout`，因此已有的 `satellite` 模式生效。陆地按年均温、年降水和干湿度在裸地和植被之间混合，高处混入裸岩和季节积雪，海洋按水深上色；冰盖、海冰晕渲和水面高光仍盖在上面。图例不再把高程色带当成地表颜色。`satellite-shader` 与 `compiler` 定向用例 10/10 通过。浏览器里看过默认种子：大陆出现绿色植被、土黄色裸地和山地积雪，不再是一条从绿到白的高程色带。未运行全仓 test、typecheck、lint 或 build。

2026-11-18 仿真卫星把海平面那一档晕渲叠到海冰上，强度随海冰覆盖度变化。开阔水面不加这层阴影。海冰内部的晕渲仍然平，因为那里的高度就是海平面；坡向阴影出现在冰面贴着陆地抬升的地方。`satellite-shader` 定向用例 6/6 通过。浏览器里看过默认种子的北极冰盖：内部仍然平，薄边还在。未用 −40°C 看全冻星球，未运行全仓 test、typecheck、lint 或 build。

2026-11-18 仿真卫星的海洋高光随海冰覆盖度淡出。盖满的海冰不再叠蓝色水体和太阳反光，底下露出与陆地相同的冰色；薄冰边按覆盖度变淡；没结冰的海和关掉「两极冰盖」后的海仍保留原来的水面。陆地起伏晕渲还在，所以封冻后大陆仍能看出地形。`satellite-shader` 定向用例 5/5 通过。浏览器里看过默认种子的北极：实心海冰上没有太阳反光，反光留在南边的开阔水面。未用 −40°C 重新生成全冻星球，未运行全仓 test、typecheck、lint 或 build。

2026-11-18 温度偏移的允许范围从 −20–20°C 扩到 −40–40°C。负端把约 28°C 的热带海平面基线，连同大约 7°C 的洋流增暖，压到海水冰点以下；正端把热带顶到现有 60°C 月温上限，并把大约 −10°C 的极地最暖月抬到冰点以上。默认值仍是 0°C，月温公式和 `climate-c0-v21` 没有改，旧缓存仍然有效。参数面板、C0 校验、阶段入口和分享链接使用同一组边界。`climate.test.ts` 与 `monthly-temperature-generator.test.ts` 共 13/13 通过，覆盖两端的接受与拒绝，以及热带封冻、热带触顶和极地夏天解冻。未运行全仓 test、typecheck、lint 或 build。参数面板里滑块范围已是 −40–40°C；尚未用这两个端点重新生成地图。

2026-11-17 仿真卫星的海冰改成只看最暖月。最暖月低于海水冰点 −1.8°C 仍是实心冰盖；升到 0°C 的过程中只留一圈透出水色的薄边；最暖月高于 0°C 的海洋不再画冰，即使冬天远低于冰点。这样海冰收在陆地冰盖内侧，不再铺到仍是绿色的海岸外面。定向着色用例 4/4 通过。浏览器里看过默认种子的北极：60° 以低的海洋保持水深颜色，实心海冰收到约 70° 以上，边缘只剩很窄的一圈，并停在高纬海岸内侧；高纬山地积雪还在。未运行全仓 test、typecheck、lint 或 build。

2026-11-17 仿真卫星的海冰不再按结冰月数分圈。每个月对冰盖的贡献随气温连续变化，常年冰盖再平滑过渡到季节海冰，极地海洋不再出现一圈圈同心台阶。图层辅助显示增加「两极冰盖」开关，默认打开，只在仿真卫星风格下可切换，关闭后陆地冰盖和海冰一起隐藏。定向着色用例 4/4 通过。浏览器里看过默认种子的北极：海冰从实心冰盖连续淡出到开阔水面，不再分圈；关掉「两极冰盖」后极地海洋回到水深颜色，山地积雪还在；其他风格下这个开关禁用。未运行全仓 test、typecheck、lint 或 build。

2026-11-17 仿真卫星在现有地表配色上按已发布的 12 个月气温加两极冰盖，不新增世界字段或温度参数。陆地最暖月不超过 0°C 为近满覆盖的冷色冰盖，高于约 2°C 不再覆盖，其间平滑过渡。海洋以海水冰点约 −1.8°C 计：最暖月仍低于冰点画常年海冰，外圈随月温连续变薄，直到最暖月明显高于冰点。高程降温和温度偏移已经在月温里，所以高原更容易结冰，偏移会一起推动陆冰和海冰。海冰不改陆海、河流或湖泊。这是显示效果，E0 冰盖分类和 I0 一年积雪都没有改。`satellite-shader` 定向用例 4/4 通过。浏览器里用默认种子看过南北两极：极地海洋是实心冷色冰盖，外圈淡出到开阔水面，中纬度平原保持绿色，高纬陆地和山地积雪仍在。温度偏移没有重新生成验证。未运行全仓 test、typecheck、lint 或 build。

2026-11-17 拆开 `world-core` 对 `world-data` 的编译期依赖。`@another-earth/world-core` 不再依赖、也不再导入 `@another-earth/world-data`，并删除 `loadBuiltinContentPacks()`。调用方通过 `ContentPort` 与 `GenerationInput.content` / `contentSignatures` 注入内容。`geographic-names` 的阶段版本改为纯 `geographic-names-v2`，词库走内容键 `geographic-name-pools`；新产物记 `namePoolIds`，只在该字段存在且阶段版本非空时校验词库 ID，旧档案没有该字段仍然有效。`ecology-e0` 仍为 `ecology-e0-v3`，分类代码留在 world-core，词表由内容键 `ecology-classes` 注入，签名必须等于 `ecologyVocabularySignature`。`WorldStore` 构造时接收 `ContentPort`；`assembleNaturalWorld`、`validateWorldSnapshot`、`encodeWorldArchive`、`decodeWorldArchive` 增加该参数。`apps/web` 在 `src/lib/generation/builtin-content.ts` 组装并注入内置生成目录。`cartography` 仍是独立包，生产代码只依赖 `world-core`；其 `sources.test.ts` 改为开发依赖直接读取 `world-data`。该集成测试里，当前种子下河道面要素可以为空、合成内陆海不再断言内孔数量、河道面积只要求为正而不要求随流量严格单调；汇流间隙检查保留。尚未证明这三条是拆包引入的行为变化还是原有地形/水文结果。为让 `svelte: true` 的 ESLint 配置不再交互询问，根目录开发依赖补上 `eslint-plugin-svelte` 与 `svelte-eslint-parser`。拆包涉及文件的 ESLint 已通过；全包 lint 仍有本次未改文件的既有问题，未整包标为通过。本次续作重跑三个包的 test 并通过：world-core 30 文件 / 167 项，web 4 文件 / 25 项，cartography 4 文件 / 12 项。未重跑 typecheck，也未运行 build 或浏览器生成。

2026-11-17 `apps/web` 加入 PWA 支持：使用 `vite-plugin-pwa` 生成 Web App Manifest 与 Service Worker，采用 prompt 更新策略；Service Worker 预缓存应用静态资源，更新提示可忽略或立即刷新。复用现有应用图标。未运行 build、typecheck、test、lint 或浏览器/PWA 安装验证。

2026-11-17 图层面板默认打开：工作台初始 `appState.layerDrawerOpen` 设为 `true`，使图层抽屉在加载时直接展开；关闭、切换和互斥面板逻辑保持不变，仍允许后续通过侧栏或顶栏手动收起。已运行 `bun run typecheck`，在当前仓库配置下全工作区 0 错误。未在浏览器中做视觉确认。

2026-11-17 概览面板新增默认关闭的「开发调试信息」开关，控制生成管线与网格、制图性能部分的显示；行星自然概览不受该开关影响。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-17 修复辅助显示中的昼夜效果开关：重新将 `showDayNight` 按钮加入图层抽屉的辅助显示区，默认继承当前风格的 `defaultGlobeEffects.dayNight`，在 3D 星球模式下可切换，2D 下保持禁用。已运行 `bun run typecheck`，当前仓库全工作区 0 错误。未在浏览器中做视觉确认。

2026-11-17 T0 升为 `terrain-v27`、静态湖泊升为 `static-lakes-l1-v10`：`TerrainFinalizer.repairSeaConnectivity` 在末端把小块低于海平面的封闭水体抬成陆地后，沿最低溢流路径向公海下切破口并补齐顺坡，不再留下近岸死坑，也不触碰无关内陆盆地；低海拔平原保持原有平缓起伏，靠 L1 的 1 m 薄膜门槛保留宽浅湖盆，L1 同步移除闭合抬升面高程特判。默认 Seed 1024、L7、降水倍率 1.8 下，闭合抬升面死坑从 51 个降到 0 个，发布湖泊 85 个（湖底低于 500 m 的 35 个、500 m–1 km 的 16 个、1 km 以上的 34 个，离海两格内剩 5 个天然近岸湖）；Seed 1024/42/7/2026 的 L6 诊断同样无残留闭合死坑。T0 与 L1 定向用例 21/21 通过。未运行全仓 test、typecheck、lint、build，也未在浏览器里重新生成地图。旧 T0 及下游缓存失效。

2026-11-17 静态湖泊改为 `static-lakes-l1-v9`：平均水深门槛从 25 m 降到 1 m。闭合深度随周围起伏变浅，低地湖盆中位只有几米，25 m 会把这一档整类去掉。1 m 只排除不足一米的填洼薄膜。默认 Seed 1024、L7、降水倍率 1.8 下，湖泊从 36 个增到 90 个；湖底低于 500 m 的从 3 个增到 40 个，高于 1 km 的仍是 34 个。冰原、荒漠、降水不足和海岸闭合抬升面的规则不变。L1 定向用例 10/10 通过。未运行全仓 test、typecheck、lint、build，也未在浏览器里重新生成地图。旧 L1 缓存失效。

2026-11-17 静态湖泊改为 `static-lakes-l1-v8`：湖底落在海岸闭合抬升面上的洼地不再画成湖。闭合仍把小块低于海平面的水体抬成约 9 m 的陆地，地形不改。默认 Seed 1024、L7、降水倍率 1.8 下，湖泊从 50 个降到 36 个，抬升面上的湖为 0；离海两个网格以内还剩 2 个，湖底不是这条抬升面。L1 与海岸闭合定向用例 10/10 通过。未运行全仓 test、typecheck、lint、build，也未在浏览器里重新生成地图。

2026-11-17 静态湖泊改为 `static-lakes-l1-v7`。平均水深不足 25 m 的 Priority Flood 洼地不再成湖；最暖月低于 0°C 的面积达到一半（冰原）、Köppen BW 面积达到一半（荒漠）的洼地直接排除；其余湖面还要年降水大于与 E0 相同的温度指数潜在蒸散。土壤蒸散系数退出 L1 签名。工作台默认 Seed 1024、L7、扰动 0.75、降水倍率 1.8 下，湖泊从 165 个降到 50 个，其中荒漠 0、全年封冻 0；留下的 19 个半干旱草原湖都是降水大于蒸发的深盆，另有 10 个苔原湖。L1 定向用例 8/8 通过。未运行全仓 test、typecheck、lint、build，也未在浏览器里重新生成地图。旧 L1 缓存失效。

2026-11-17 参数、图层、概览、侦测面板改为互斥显示；概览移至左侧，侦测位于左下角。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-17 工作台视口底部新增地图导航控制条，提供缩放和重置视角；侧边栏设置卡片可开关控制条，原侧栏重置视角入口已移除。控制条默认关闭，缩放步进为 0.5 并使用 180 ms 缓动过渡。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-16 分享链接只在一次生成成功后更新，并写入地址栏。链接记录这次实际用于生成的参数，不跟着尚未生成的滑块变化。打开带 `#w=9.` 的地址时，先还原参数再生成。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-16 参数链接不再卡在空框：压缩流改为边写边读，默认参数也会得到 `#w=9.` 链接，内容是空的差值列表。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-16 分享弹窗顶部增加参数链接和复制按钮。链接沿用旧版 `#w=<版本>.<deflate-raw + base64url>`，只写入相对工作台默认值有变化的生成参数，当前版本为 9，字段是当前面板的种子、网格、地质、地形、气候和水文参数。打开带该哈希的地址会先还原参数再生成。旧版 v2–v8 字段布局不同，不还原。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-16 工作台工具条新增分享弹窗，位于重置视角上方。弹窗目前只提供「导出图片」：把当前 WebGL 视口画成 PNG 并下载，文件名带当前种子。界面面板不进入图片。渲染器开启 `preserveDrawingBuffer`，否则读回的是空画面。导入、导出世界档案和其他分享方式尚未实现。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-16 工作台工具条背景透明度改为与图层面板相同的 `bg-[#1e1e20]/85`，仍保留毛玻璃模糊。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-16 气温与降水各保留一个专题按钮：「气温 (°C)」「降水量」。点选默认打开年统计（`annual-temperature` / `annual-precipitation`）。图例卡片顶部增加「按月显示」开关，打开后改用月统计专题并显示月份滑块；积雪、风速、洋流仍始终显示月份滑块。年、月专题 id、样式和统计未改。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-16 图层面板的「气候与水文月份」改用 `Slider`，并从专题按钮上方移到图例卡片顶部。没有专题统计时只显示月份；有统计时月份在图例上方，同一张卡片内。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-16 视图选择卡不再被工具条裁切：去掉侧栏的 `overflow-hidden`，弹层可以伸到栏外。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-16 工作台顶栏改为贴左浮动工具条（`Sidebar`，宽 3rem，距视口左上 0.75rem）。条高随图标内容，不再拉满整屏，四角与其他面板一致为 `rounded-xl`。最上方是随机，不再显示种子；其下依次为视图、参数、图层、概览、侦测，底部为重置视角。各项均为图标，悬停显示名称。视图图标在右侧弹出选择卡，分 3D（星球）与 2D（Equal Earth、等距圆柱、墨卡托）两组；选 2D 项时切到地图视图并设定投影。参数面板和侦测面板贴在工具条右侧。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-16 分类面专题（陆海分区、气候带、生物群系、自然覆盖、板块）改按 Voronoi 单元直接构面，跨分类边界沿用与海岸线相同的三岔口锁定角点与边中点松弛，内部共享未松弛对偶边，消除 Gnomonic 平面耳切造成的内部细缝与边缘锯齿。标准地图、极简明亮、极简暗色与羊皮纸去掉重复的底图 `land-areas` 填充，底图完全由海陆栅格绘制。浏览器验证见本条更新。未运行 test、typecheck、lint、build。

2026-11-16 专题显示名调整：`continents` 改为「陆海分区」，`elevation` 改为「高程 (km)」。图例与统计标题同步为「陆海分区」和「高程」。图层 id 未变。

2026-11-16 地表固定为最底层。`slot: 'base'` 的渲染顺序低于专题和覆盖层；专题栅格与陆地填充都在地表外侧，河湖、线和注记再向外。专题未覆盖的海洋仍显示地表。浏览器确认：仿真卫星下 Köppen 盖住陆地、海洋仍是卫星水面，河网和地名留在上面；海拔色阶盖住卫星地表。极简明亮下 Köppen 与海拔同样盖住浅色陆地，3D 和 2D 都如此。未运行 test、typecheck、lint、build。

2026-11-16 自然地理风格的默认图层改为地表、河网和湖泊，不再自动打开海岸线。浏览器确认切到自然地理后海岸线未勾选，河网和湖泊仍勾选。未运行 test、typecheck、lint、build。

2026-11-16 切换地图风格时，大气光晕和昼夜光照跟随风格默认值：仿真卫星打开，其余五套关闭。自转、经纬网和 Cell 边界保持用户当前选择。浏览器确认：极简明亮关闭大气光晕和昼夜光照，仿真卫星重新打开，经纬网和自转保持原状。未运行 test、typecheck、lint、build。

2026-11-16 「地表」改为与专题相同的图层按钮，点选切换显隐，不再使用勾选开关。可与专题同时选中。浏览器确认：仿真卫星下按钮默认点亮，再点取消；切到极简明亮后按钮重新点亮，河网、湖泊和地名取消。未运行 test、typecheck、lint、build。

2026-11-15 图层列表新增可开关的「地表」（`world-surface`）。专题不再隐藏地表；地表关闭时只留风格垫底色。六套风格各自声明 `defaultEnabledLayerIds`，切换风格时专题、地表和覆盖层按该名单重新勾选。浏览器抽查：仿真卫星默认勾选地表、河网、湖泊、地名；极简明亮只留地表；羊皮纸勾选地表、海岸线、地名；Köppen 与地表可同时显示，海洋仍是当前风格的表面。未运行 test、typecheck、lint、build。

2026-11-15 调整工作台面板：图层抽屉分为风格、图层（专题、覆盖与注记）和辅助显示（经纬网、Cell 边界、自转、大气光晕、昼夜光照）。行星自然概览、生成管线和网格性能移到顶栏「概览」面板，替换原来的「显示」菜单。河网与湖泊只保留在图层开关中。已在浏览器确认面板开关、专题切换、经纬网开关，以及 2D 下自转、大气光晕和昼夜光照不可用。未运行 test、typecheck、lint 或 build。

2026-11-15 为六套内置地图风格各增加不透明 `tokens.background`。专题开启时底图槽位仍隐藏；3D 在半径 `0.996` 的同源 Voronoi 壳体上绘制该颜色并写入深度，2D 投影剪影垫底改读同一颜色。栅格专题不透明度改为 `1`，避免半透明栅格不写深度时透出另一侧河湖。未运行 test、typecheck、lint、build 或浏览器验证。

2026-11-15 删除过时的制图测试 `packages/cartography/src/rendering/slice3.test.ts` 与 `slice4.test.ts`。二者仍按旧的 `assembleNaturalWorld` 参数组装世界，且与当前图层接口不一致。`sources.test.ts` 仍保留，并继续通过 `loadBuiltinContentPacks()` 读取内置内容包。未运行 test、typecheck、lint 或 build。

2026-11-15 修正 `slice3.test.ts` 中 `SymbolLayer.updateStyle` 的调用：第二参数改为样式缩放 `2.5`。未传投影时图层仍按球面渲染。已确认该文件类型检查不再报告此参数错误。未运行 test 或 build。

2026-11-15 制图测试不再直接导入 `@another-earth/world-data`。`world-core` 新增 `loadBuiltinContentPacks()`，返回生成用的 `core`、`earthlike`、`geography-zh`。`slice3.test.ts`、`slice4.test.ts` 与 `sources.test.ts` 改为使用该导出。已对这些文件运行 ESLint，并确认制图包类型检查不再报告找不到 `world-data`。未运行 test 或 build。

2026-11-15 将大陆与大洋显示名的汉字结尾判断从 `㐀-鿿` 改为 `\u3400-\u9FFF`，判定范围不变。已对 `area-sources.ts` 运行 ESLint。未运行 test、typecheck 或 build。

2026-11-15 将 `world-core` 的 7 个 Vitest 基准配置合并为 `vitest.bench.config.ts`。各 `bench:*` 脚本通过 `--project` 仍只运行原来的入口，超时保持 120s / 300s / 600s / 900s。已用 `vitest list` 确认项目与文件对应关系。未运行基准、test、typecheck、lint 或 build。

2026-11-15 拆开 `WorldStore.field` 中地理分区与环流字段的单行多语句：缺环流时仍抛出原错误，缺地理分区时仍落到原有的区域不可用错误。`world-store.ts` 的 ESLint 通过，`tsc --noEmit` 未报告该文件错误。未运行 test 或 build，也未把整包 typecheck 记为通过。

2026-11-15 ESLint 忽略 `**/benchmarks/**`、`vitest.*-perf.config.ts` 与 `vitest.ecology-legacy.config.ts`；`world-core` 的 `lint` / `lint:fix` 只检查 `src`。已用 ESLint 确认这些基准文件被忽略。未运行 test、typecheck 或 build。

2026-11-15 为 `world-data`、`world-core`、`cartography` 与 `apps/web` 补上 `lint:fix`，检查范围与各自的 `lint` 相同并附加 ESLint `--fix`。根目录 `pnpm lint:fix` 因此可以递归执行。未实际运行修复，也未运行 test、typecheck 或 build。

2026-11-15 修复内置地图样式预设的类型错误：底图图层先按 `MapStyleLayer` 收窄，再与共享专题层、覆盖层拼接，避免 `type` 被推断为 `string`。`@another-earth/cartography` 的 `tsc --noEmit` 已确认 `styles/presets/index.ts` 不再报错；该包其余既有类型错误仍在，本次未运行 test、lint、build 或浏览器验证。

2026-11-15 修复 **3D 卫星视图的昼夜光照关闭选项**：关闭后不再启用卫星栅格的固定方向直射光，也会隐藏随太阳方向变化的海面高光层；卫星地表保留底图颜色与地形晕渲。未运行测试、类型检查、lint、build 或浏览器验证。

2026-11-15 **整体降低默认河网密度**：`riverDensityMultiplier` 默认值从 1 调至 0.5，使 H0 有效汇水面积门槛翻倍；地图河道面与中心线统一只显示 Strahler 级序 ≥2 的河段，隐藏一级支流。旧 Schema 3 档案缺少该参数时仍补历史值 1，不重解释已保存河流。新默认下的河段/河道区域数量尚未复测；未运行测试、类型检查、lint、build 或浏览器检查。

2026-11-15 修复**专题图层下昼夜光照开关被禁用**：开关不再依赖当前是否为卫星底图，在 3D 星球的所有底图和专题样式下都可操作；2D 地图仍禁用昼夜光照。未运行测试、类型检查、lint、build 或浏览器验证。

2026-11-15 移除“地壳类型”和“地形坡度”两个专题地图图层：从图层选择项、内置样式和专题统计中删除，当前可选专题为 15 项。坡度与地壳类型领域数据仍保留，供区域检查器和地质生成逻辑读取。未运行测试、类型检查、lint、build 或浏览器验证。

2026-11-15 修复移除专题图层后的前端启动错误：保留“自然地表覆盖”仍在使用的 `Layers` 图标导入。未运行测试、类型检查、lint、build 或浏览器验证。

2026-11-15 修复 **3D 地球生成尺度、深度缓冲干涉圆纹、白昼亮度、2D 地图禁用昼夜、河网粗细密度、“大陆、大洋与海”专题报错、3D 球面贴合文字标签、自定义字体 SDF 渲染与四类分类专题矢量面（GeoJSON + `FillLayer`）保拓扑平滑渲染**：（1）移除 `apps/web/src/world-view/WorldView.svelte` 中误传的 `reference: { subdivisionLevel: 2 }`（162 单元参考网格导致 100 板块将陆地切碎），恢复默认的 L6 参考网格（40,962 单元），同时将卫星图默认开启覆盖层调整为 `['rivers', 'lakes', 'labels']`；（2）修复 `GlobeView` 中 48×48 经纬球 `oceanBackdrop` / `oceanSpecular` 与对偶 Voronoi 平面三角形因 `polygonOffset` 产生的周期性深度缓冲穿透圆斑：`oceanBackdrop` 半径保持 `0.985` 且设为 `depthWrite: false`，`oceanSpecular` 改为仅在海洋单元（`landMask === 0`）上构建与地表完全共形的 Voronoi 扇形网格并复刻旧版 `MeshPhongMaterial`（`#0c3a6e`、不透明度 `0.55`、`shininess: 120`、`#4488bb`）Blinn-Phong + Schlick Fresnel 着色；（3）修复 WebGL2 下 `DataTexture` 设置 `SRGBColorSpace` 触发 `SRGB8_ALPHA8` 硬件 `texelFetch` 自动线性化（`c^2.2`）而 Fragment Shader 直接输出导致的全局约 2.2 Gamma 档过暗问题：`RasterLayer` 与 `FillLayer` 的 `colorTexture` 保持 `RGBA8` 原生字节采样，在 Shader 中显式执行 `srgbToLinear` → 线性空间 Lambert 辐照度乘算（昼夜模式直射光强度 `4.0` + 环境光 `1.1`；卫星无昼夜模式复刻旧版环境光 `#aabbcc` 强度 `3.5` + 直射光 `#fff8ee` 强度 `1.5`）→ `linearToSrgb` 输出；（4）`AtlasView.syncVisualState` 强制对 2D 栅格与填充图层关闭昼夜光照（`setLighting(false, ...)`），确保 2D 地图始终全图均匀照亮；（5）调整 `hydrography-buffer.ts` 与 `styles/presets/index.ts` 中的河网宽度与远景显示密度：收窄河道多边形半宽曲线（`0.008 + 0.068 * share^1.65`，源头河段前 2.5 个网格宽度内按 `smoothstep` 渐增）并跳过孤立单格内流短河段，同时在 `overlay-river-centerlines` 中过滤 `strahlerOrder >= 2` 且下调屏幕像素线宽与不透明度；（6）修复 `layer-statistics.ts` 与 `WorldView.svelte` 在切换到“大陆、大洋与海”专题或选中单元时误读不存在的 `geo.continentByRegion` / `oceanByRegion` / `seaByRegion` 属性导致的 `TypeError: Cannot read properties of undefined (reading '0')`，统一改为通过 `reader.field('continentIndex')`、`reader.field('oceanIndex')`、`reader.field('seaIndex')` 权威字段视图读取；（7）修复大陆与大洋中文名称标签不显示及 3D 视图下文字悬浮感问题：`SymbolLayer` 支持求值 `compiledLayer.layout['text-field']` 并回退读取 `feature.properties.displayName ?? feature.properties.name`（同时 `buildGeographicLabelsSource` 补齐 `name: displayName`）；将 3D `GlobeView` 中 `SymbolLayer` 的球面半径偏移从 `0.005` 下调至 `0.0005`（消除旋转视差高度感），并将 Vertex Shader 升级为**球面切平面贴地展开模式**（每个字符沿球面局部切线 $T$ 与副切线 $B = N \times T$ 在单位球面上展开并归一化贴合球壳，同时在地平线边缘执行 `smoothstep(0.14, 0.34, dot(N, V))` 透视淡出，彻底消除屏幕 Billboard 公告板造成的悬浮感）；`sampleSpineGlyphAnchors` 支持传入随相机高度自适应的字符角步长 `glyphStepRad`；（8）为 `SymbolLayer` 与样式契约新增**自定义字体加载（`FontFace` API）与 2D 欧氏距离变换 SDF 字形图集**：`MapStyleDocument` 新增可选 `fonts?: readonly MapFontFaceDescriptor[]`（由 `StyleCompiler` 静态校验并随 `CompiledMapStyle.fonts` 暴露），`SymbolLayer` 新增 `loadMapFontFaces`、`registerCustomMapFont`、`normalizeFontFaceSource`、`computeGlyphSdf`（Felzenszwalb & Huttenlocher 线性时间二维欧氏距离变换生成 8-bit SDF 字形纹理，Fragment Shader 使用 `fwidth(sdf)` 解析抗锯齿与动态 `text-halo-width` 描边），支持 `layout['text-font']` 与 `layout['text-weight']` 样式表达式及 `session.loadFonts(fonts)` 热加载刷新（`historical-parchment` 预设默认配置霞鹜文楷/楷体衬线字体栈），并在 `slice3.test.ts` 补充自定义字体注册、样式校验、字体切换与 SDF 距离场单调性单测；（9）按方案 A 实现**“大陆、大洋与海”（`continent-areas`）、“Köppen 气候带”（`koppen-areas`）、“潜在生物群系”（`biome-areas`）、“自然地表覆盖”（`land-cover-areas`）四类专题图层的 GeoJSON 矢量面数据源平滑与 `FillLayer` 渲染**：针对超半球/环极大多边形在 2D 绕向与立方体切面 Earcut 剖分下产生放射状破面的问题，在 `area-sources.ts` 中新增 `buildTiledSmoothedGroupPolygons`（将每个分类区域按 `24° × 20°` 球面分块拆分为同一 `MultiPolygon` 要素下的局部良态子多边形，并通过 `buildSmoothedSharedBoundaryRings` 的 `smoothEdgeMask` 掩码仅对跨不同分类的真实边界边插入球面四点样条中点与度为 2 角点松弛，锁定三岔口与内部分块接缝角点，使同一分类内部接缝保持直边共享顶点 100% 严丝合缝，外边界与 `coastlines` 海岸线 100% 顶点重合）；修复 `buildBiomeAreasSource` 读取 `reader.field('potentialBiomeIndex')` 权威字段名并写入 `properties.biomeIndex`，以及 `buildContinentAreasSource` 对可选 `hasSeaClassification` 的安全检查；在 `styles/presets/index.ts` 中将 `thematic-continents`、`thematic-koppen`、`thematic-biomes`、`thematic-land-cover` 全部配置为 `type: 'fill'`（`fill-opacity: 1`，开启专题时自动隐藏底图 `slot === 'base'` 图层），由 `FillLayer` 直接基于局部 Gnomonic 切平面精确剖分渲染；（10）修复 **2D 地图视图（`AtlasView`）下 `FillLayer` 在 `±180°` 反经线处产生的水平横穿全图拉伸伪影**：当曲折平滑后的分类边界在 `±180°` 日界线附近多次往返进出时，传统平面 Sutherland-Hodgman 裁剪（`clipRingToGeographicBox`）会将多个进出段沿 `x = ±180°` 用竖直桥接边强行连成单个退化环，导致 2D `earcut` 或跨反经线顶点对角线横穿整张地图；现一方面将 `triangulateAtlasPolygon` 统一改为直接复用无经度奇点的 3D 球面 Gnomonic 剖分微元三角形（`<= 0.036 rad`），以每个球面小三角形的 3D 质心经度为基准解卷绕并按 `[-180, 180] × [-maxLat, maxLat]` 凸裁剪投影，另一方面升级 `seam-clipper.ts` 中的 `clipPolygonAtAntimeridian` 在 `±180°` 边界按进出事件配对拆分为独立闭合简单环，从根源上杜绝 2D 视图下的水平拉伸条带。按仓库规范本次未运行 `test`、`typecheck`、`lint`、`build` 或自动化测试。

2026-11-14 完成 **M3 Cartography Slice 5（`apps/web` 单轨收口、UI 升级与旧调试渲染代码清理）**：全仓完成 M3 Cartography 五个切片的完整闭环：（1）`apps/web` 的 `WorldView.svelte` 彻底移除早期 6 个单阶段调试生成选择器（仅网格/板块/地形/气候/水文/生态），统一围绕已校验的完整自然世界快照 `WorldSnapshot` → `controller.candidateMapReader(snapshotId)` → `session.prepareWorld(...)` → 原子提交 `controller.commitWorld(snapshotId)` & `session.activateWorld(prepared)` 单轨运行；生成取消或异常时自动清理候选临时 GPU 对象并保留上一个已发布世界；（2）升级 `TopBanner.svelte`、`AppUI.svelte`、`layer-presentation.ts` 与 `WorldView.svelte`：顶栏新增 **3D 星球 / 2D 地图** 视图模式一键切换、2D 模式下 **Equal Earth / 等距圆柱 / 墨卡托** 投影切换按钮组、重置视角按钮以及经纬网、Cell 边界网格（新增 `cell-wireframe` 数据源与覆盖层）、自转、大气光晕、昼夜光照、河网、湖泊快捷开关；图层抽屉重构为 **1. 地图风格（6 套内置预设卡片）**、**2. 科学专题图层（4 大分组共 17 个专题 + 1–12 月滑块 + 动态色带/分类图例与一键复制统计）**、**3. 矢量覆盖层与注记（河网水系、静态湖泊、海岸线、板块边界、风向箭头、洋流箭头、大陆与大洋中文地名）** 三层结构；右侧 `RegionInspector` 全面切换至 `controller.queryWorldRegion(regionId, climateMonth)` 及关联 `basin`/`river`/`lake` 权威查询，同时展示拾取命中的矢量要素 ID；（3）重构 `apps/web/src/world-view/layer-statistics.ts` 直接基于 `WorldMapReader` 与 `LegendDescriptor` 计算面积加权统计，彻底删除旧调试渲染文件 `world-scene.ts`、`map-render-data.ts`、`map-theme-data.ts`、`map-overlay-data.ts` 及旧单测 `map-render.test.ts`、`map-theme.test.ts`，新增 `slice5.test.ts` 验证候选预备、原子提交、17 类专题统计与切换风格/专题/月份/2D↔3D 零 Worker 重算不变量。按仓库规范本次未运行 `test`、`typecheck`、`lint`、`build` 或浏览器检查。

2026-11-14 完成 **M3 Cartography Slice 4（2D `AtlasView` 多投影、反经线裁切与 3D ↔ 2D 无缝切换）**：`@another-earth/cartography` 完成 2D 地图集视图与双视口对齐闭环（`projections/map-projections.ts`、`projections/seam-clipper.ts`、`rendering/atlas-view.ts` 及 5 类图层/拾取/会话扩展）：（1）实现 `EQUIRECTANGULAR_PROJECTION`（等距圆柱）、`EQUAL_EARTH_PROJECTION`（Equal Earth 等面积自然地球，12 步牛顿迭代逆投影精度 `< 1e-11`）、`MERCATOR_PROJECTION`（墨卡托，纬度截断 `±85.05112878°`）三套正逆投影及统一对数缩放标尺 `computeAtlasStyleZoom` / `computeAtlasVisibleWorldHeight`；（2）实现 `clipPolylineAtAntimeridian`、`clipPolygonAtAntimeridian` 与 `clipRingToGeographicBox`：在 `±180°` 反经线与极区边界处精确裁切多边形（保持内洞拓扑）、河道面与折线，彻底消除横穿全图的拉扯线段，并在折线跨日界线断开处继承前半段累计球面弧长以保持虚线相位连续；（3）扩展 `RasterLayer`（按 `(meshId, projectionId)` 缓存反经线与极冠裁切平面网格 `acquireAtlasCellGeometry`）、`FillLayer`（`triangulateAtlasPolygon`）、`LineLayer`、`CircleLayer`、`SymbolLayer`（2D 平面切线排版与跨日界线脊线退化保护）及 `SelectionLayer` 同时支持 3D 与 2D 投影渲染；（4）实现 `AtlasView` 正交相机平移/滚轮缩放、圆柱投影左右水平无缝环绕副本（`[-worldWidth, +worldWidth]` 共享 Geometry/Material）与越界自动回绕，打通 `WorldViewport` / `CartographySession` 在 `globe` ↔ `atlas` 及不同 2D 投影间切换时自动保持中心 `(lon, lat)` 与 `styleZoom`，并在 `MapPicker.pickAtlas` 中实现逆投影 + 环绕副本矢量与 `locateRegion` 统一拾取。已新增 `slice4.test.ts` 覆盖三套投影正逆往返误差 `< 1e-6`、跨 `±180°` 多边形/折线裁切无横穿伪影与虚线弧长连续、3D ↔ 2D 视角同步及同一地理点 3D/2D 拾取 `regionId`/`featureId` 一致性单测；按仓库规范本次未运行 `test`、`typecheck`、`lint`、`build` 或浏览器检查。下一步实施 Slice 5（`apps/web` 单轨收口、UI 升级与旧调试渲染代码清理）。

2026-11-14 完成 **M3 Cartography Slice 3（3D `GlobeView` + 5 类 GPU 批处理渲染器、统一拾取、`SelectionLayer` 与 `CartographySession` 原子生命周期）**：`@another-earth/cartography` 新增 3D 渲染与交互闭环（`rendering/`、`picking/`、`session.ts`）：（1）`RasterLayer` 按 `meshId` 全生命周期共享构建一次对偶 Voronoi 单元扇形索引几何，将 `raster-color`、`raster-opacity`、晕渲与 `satellite` 多通道仿真地表求值写入 `THREE.DataTexture` 并通过 Shader `texelFetch` 查表着色；（2）`FillLayer` 实现球面局部 Gnomonic 切平面投影（跨半球大面自动按立方体六面分块裁切）、带孔三角剖分与最大边角距 `0.06 rad` 递归球面中点细分，全层合并为单 `BufferGeometry` + `DataTexture` 颜色表，水体层（`lake-polygons`、`river-polygons`）采用不透明深度写入彻底消除河湖交接与支流汇流重叠变暗；（3）`LineLayer` 将连续折线扩展为携带 `aPrevPosition`/`aNextPosition`/`aSide`/`aLineDistance`/`aFeatureIndex` 的单 `BufferGeometry` 丝带，Vertex Shader 执行屏幕像素空间 Miter/Bevel 扩边（`miterLimit = 2.5`），Fragment Shader 实现 `fwidth` 解析抗锯齿与连续相位虚线 `line-dasharray`；（4）`CircleLayer` 使用单 4 顶点 `InstancedBufferGeometry` 实现圆、双环、五角星、菱形、正三角 5 类解析 SDF 符号并支持 3D 地球背面自动剔除与地平线边缘平滑淡出；（5）`SymbolLayer` 基于实例合批字形图集支持 `'point'` 与 `'spine'`（PCA 版图脊线弯曲排版）双模式、从左向右中文正读方向反转、背面剔除（`dot(normal, cameraDir) <= 0.12`）与 `32px × 32px` 空间哈希 `CollisionGrid` 优先级避让（由于工作区未安装外部 `troika-three-text` 包，采用零外部依赖的内置 Canvas2D/程序化 SDF 字形图集与 `InstancedBufferGeometry` 合批实现，同时兼容浏览器与 Node/Vitest 环境）；（6）落地 `SelectionLayer`（选中区域对偶环与矢量要素高亮）、`MapPicker`（逆序图层矢量容差命中 + 单位球射线 `locateRegion` 兜底）、`GlobeView`（星空、背面大气光晕、高光海面、季节太阳光照、统一对数 `styleZoom`）、`WorldViewport` 及 `CartographySession`（`prepareWorld` / `activateWorld` / `setViewState` / `resetCamera` / `dispose`、`AbortSignal` 取消与异常隔离、确定性 `GpuResourceTracker` 释放与 `webglcontextlost`/`webglcontextrestored` 恢复）。已补充 `slice3.test.ts` 覆盖 Gnomonic 带孔细分无退化/翻转三角形、连续折线 Miter 与虚线距离连续性、`CollisionGrid` 避让/背面剔除/中文正读方向、3D 拾取及 `prepareWorld` 取消/异常不破旧图与 GPU 资源计数归零单测；按仓库规范本次未运行 `test`、`typecheck`、`lint`、`build` 或浏览器检查。下一步实施 Slice 4（2D `AtlasView` 多投影、反经线裁切与 3D ↔ 2D 无缝切换）。

2026-11-14 完成 **M3 Cartography Slice 2（Source 体系、水系面化、PCA 脊线与 `StyleCompiler`）**：`@another-earth/cartography` 新增实例级 `MapSourceRegistry` 与全套 13 个自然数据源适配器（`world-surface`、`climate-monthly`、`land-areas`、`continent-areas`、`plate-areas`、`lake-polygons`、`river-polygons`、`river-centerlines`、`coastlines`、`plate-boundaries`、`graticule`、`circulation-vectors`、`geographic-labels`），严格按 `${snapshotId}:${adapterVersion}:${sourceId}` 与 `:m${month}` 缓存并区分缺源状态 `SourceUnavailable`。落地对偶边外环/内孔追踪与绕向修正（`ring-tracer.ts`）、球面三岔口锁定的 Chaikin / Catmull-Rom 保拓扑平滑（`spherical-smooth.ts`）、随累积流量单调递增的变宽河道偏移多边形与汇流圆片衔接（`hydrography-buffer.ts`），以及面积加权球面切平面 PCA 版图脊线样条提取与从左向右字符采样（`territory-spine.ts`，延伸度 `>= 1.35` 时输出样条控制点，否则回退内部极点锚点）。同时实现 `StyleCompiler`（静态图层/数据源几何兼容性校验、`constant`/`feature`/`zoom`/`zoom-feature` 四级依赖分析与预编译闭包、结构化 `LegendDescriptor` 自动提取）与 6 套内置 JSON 样式预设（`satellite`、`standard-atlas`、`physical-relief`、`minimal-light`、`minimal-dark`、`historical-parchment`）。已补充 Polygon 外环逆时针/内孔顺时针与闭合性、河道面积随流量单调性与汇流衔接、PCA 脊线与正读方向、缓存与月份局部失效、非法算子/缺源/几何错配拦截及 6 套内置预设编译单测；按仓库规范本次未运行 `test`、`typecheck`、`lint`、`build` 或浏览器检查。下一步实施 Slice 3（3D `GlobeView` + 5 类 GPU 批处理渲染器、统一拾取与 `CartographySession`）。

2026-11-13 确认 [M3 Cartography 制图系统技术设计规范](Cartography-System-Design.md) 并完成 **Slice 1（Core 数据闭环与 `WorldMapReader`）**：`ClimateState` 新增向后兼容的 Schema 3 可选字段 `circulation`（保存输出网格月度标定风速分量 `windEastMps`/`windNorthMps`、洋流分量 `oceanEastMps`/`oceanNorthMps`、寒暖流代理 `oceanWarmth` 与有效掩码 `oceanAvailable`），`assembleNaturalWorld` 自动组装并纳入 `validateWorldSnapshot` 完整校验，旧无环流存档继续合法读取且标记 `hasCirculation === false`。`@another-earth/world-core` 新增 `createWorldMapReader` 与 `WorldStore.mapReader()`（同时将 `WorldStore.pick` 切换为邻域贪心爬山定位），从 `WorldSnapshot.mesh` 确定性惰性恢复球面对偶 Voronoi 外心角点、逆时针边界环与共享对偶边，并惰性派生坡度 `slopeDeg`、地形晕渲 `hillshade` 及基于快照 Seed 的多尺度球面 Simplex 表面细节 `surfaceDetail`，全程零可变 TypedArray / ArrayBuffer 泄漏。Web `GenerationController` 新增 `candidateMapReader(snapshotId)`、`publishedMapReader()` 与 `restoreWorldArchive(archive)`。已补充对偶边界等价性、1,000 点 `locateRegion` 精度、环流档案往返/旧档兼容及 Controller 候选读取单测；按仓库规范本次未运行 `test`、`typecheck`、`lint`、`build` 或浏览器检查。下一步实施 Slice 2（`MapSourceRegistry`、变宽河道面化、PCA 脊线与 `StyleCompiler`）。

2026-11-13 大陆与大洋名称已接入地图表面标注：`cartography` 从已命名分区和 Mesh 选取位于所属区域内的面积加权代表网格，公开 `buildGeographicLabelAnchors`；Web 在“大陆、洋与海”专题图层上绘制中文文字，随相机旋转、缩放和视口尺寸投影，隐藏背面、超出视口或相互重叠的标签。海仍不命名、不绘制标签；其他专题图层不显示地理名称。标签位置与避让只属于显示层，不写入快照或生成缓存。新增锚点归属/确定性/输入不匹配的定向用例；本次未运行 test、build、lint、typecheck 或浏览器目视检查。每个区域当前仅一个锚点，跨球面的大区域在其锚点位于背面时不会显示；默认 Seed 的实际排版与高等级性能待验收，手动改名仍待办。

2026-11-13 按中文名称需求，将当前大陆与大洋词库切换到新增的 `geography-zh` 1.0.0 内容包：各提供 24 个中文专名，生成时直接将中文名称写入快照，图例和区域检查器显示为“苍岚大陆”“沧溟洋”一类完整中文称呼；同类重名以中文序号消歧。命名算法升至 `geographic-names-v2`，只使名称阶段缓存失效，海仍不命名。保留原 `geography` 1.0.0 拉丁词库供已有档案解析，新世界只记录 `core`、`earthlike` 与 `geography-zh` 三个实际使用的内容包；旧档案中的名称不会自动改写。已更新词库/图例/确定性用例；本次未运行 test、build、lint、typecheck 或浏览器检查，默认 Seed 的实际选名效果待验收。

2026-11-13 大陆与大洋名称初版已接入：`world-data` 新增独立 `geography` 1.0.0 内容包，提供两类名称词库；独立 `geographic-names-v1` Stage 读取最终大陆/大洋稳定 ID、Seed 和词库内容签名，确定性选择名称并处理同类重名，名称变化不使地形与海域划分重算。完整自然快照存储大陆/大洋实际名称和命名内容签名，WorldStore 查询、地图图例与区域检查器显示名称；海仍用编号。新世界的内容包元数据与 Worker 发布链路使用相同内置词库，旧 Schema 3 无名称档案继续按原事实读取。新增名称确定性、去重、快照签名与图例定向用例；当轮未运行 test、build、lint、typecheck 或浏览器检查。当时地图表面文字标签、中文译名、手动改名及自定义词库尚未实现，名称风格与默认 Seed 显示效果待验收。

2026-11-13 修复 `geographic-regions-v3` 洋区重编号时遗漏 `map` 回调索引导致的运行时 `ReferenceError`，该错误会使生成停在 `geographic-regions` 阶段。恢复使用回调索引读取各洋面积；现有双海盆定向用例覆盖此路径，但本次按仓库规范未运行 test、build、lint、typecheck 或浏览器检查。默认 Seed 的大洋数量、边界及性能仍待实测。

2026-11-13 针对 v2 在默认地图上只有一个大洋的问题，实现 `geographic-regions-v3`：保留大陆及洋/海等级，进一步在每个宽阔洋区内寻找离岸距离局部峰值；只有峰值至少达到该洋区最高值的 45%，且两峰间最宽通路的最窄处低于新峰离岸距离的 55%，才独立成洋。多源海水最短路径划分洋区；面积不足原洋区 8% 的碎区并回较大洋区。宽阔通道相连的水域仍可归为同一洋，陆地形成明显收窄处的海盆可成为不同大洋。新增两个远海盆仍连通的定向夹具；Stage v3 使旧地理分区缓存失效，气候、水文及生态不重算。旧 v1/v2 Schema 3 档案可按原事实读取。未运行 test、build、lint、typecheck 或浏览器验收；默认 Seed 的实际大洋数与边界、L7/L8 耗时仍待实测，峰值及面积阈值是明示的初步规则。

2026-11-13 根据默认参数地图反馈，将海域划分改为 `geographic-regions-v2`：大陆归属规则沿用 v1；海水先按到最终海岸的球面路径距离分布识别宽阔水域核心，海峡收窄后仍相连的核心形成同一海域，沿岸水格沿海水路径归入最近核心。核心至少远离海岸 `max(2 × 平均网格宽度, 0.03 × 行星半径)`；最大连通水体的最大核心归洋，其他核心需同时达到全球最大离岸距离 50% 和核心总面积 8% 才归洋，其余归海。全水世界归一个洋；无宽阔核心的水体归海。新增 `seaIndex` / `seas` 及 `seaId`、`sea(id)` 查询，Web 图层改为“大陆、洋与海”，生成统计显示三类数量。旧 v1 Schema 3 档案的海域字段继续可读，不凭空补海。v2 版本仅使此阶段缓存失效；未运行 test、build、lint、typecheck 或浏览器检查。阈值为明示的初步形态规则，默认 Seed 分区、L4/L8 尺度敏感性与性能待验证；海与湖的进一步语义边界也待完善。

2026-11-13 大陆与大洋初步划分已接入 `geographic-regions-v1`：在最终 T0 海陆掩码上识别陆地连通块，按面积占优的候选大陆来源归并陆块；最大连通水体视为开放海洋，按海水路径到最近两块大陆的距离组合划分连续大洋区，其余独立水体单列。分类产物通过 Worker 传输，新生成的完整自然世界将归属表和区域索引保存在 Schema 3 可选字段中；旧档案没有该字段时仍可读取。Web 以“大陆与大洋”图层替代“候选大陆归属”，图例和区域检查使用最终归属，暂以编号显示，名称尚未生成。新增核心划分及图层定向用例并调整阶段缓存预期；本次未运行 test、build、lint、typecheck 或浏览器检查。海盆分界是几何近似，可能产生面积很小的区，L7/L8 性能和固定 Seed 地图形态待验证。

2026-11-13 水文生成控件已接入参数面板：河网密度倍率默认 1，以 `max(基准汇水面积, 16 × 平均网格面积) / 倍率` 调节门槛；基准汇水面积和最小湖泊面积改用 0–10,000,000 km² 对数刻度 Slider。最小湖泊面积默认 0，仅过滤小于阈值的候选，仍保留至少两个区域的底线。生成统计显示河段数、有效汇水门槛、河道网格面积占陆地比例、湖泊数、总面积和中位面积。H0/L1 更新为 v4/v6，参数进入对应缓存签名；旧 Schema 3 档案缺少新增参数时由解码器补默认值。河流/湖泊显示开关仍只影响显示。本轮未运行测试、类型检查或浏览器验收；密度档位的实际数量响应和大网格统计性能待验证。水文气候筛选仍是年尺度近似，不模拟季节河流或湖泊动态水量。

2026-11-13 按气候反馈将 H0/L1 更新为 `hydrology-h0-v3` / `static-lakes-l1-v5`：Köppen BW 沙漠区的河道仅保留累计来水中非沙漠气候源贡献占多数的区域，允许湿润/半干旱上游供水的干流穿越沙漠，BS 半干旱草原仍按气候驱动的产流保留河道；Köppen B 干旱气候占多数的地形湖候选需满足年入流大于使用 H0 同一温度指数系数估算的湖面蒸发。L1 现在直接依赖 C0，蒸散系数/公转周期进入其签名；旧 H0/L1 缓存失效。本轮未运行测试、类型检查或浏览器验收；筛选规则及湖泊数量变化尚未实测，且这仍不是动态湖泊水量平衡模型。

2026-11-13 河网控制已加入 Header「显示」菜单，可与静态湖泊显示开关独立叠加到当前地图主题上；湖泊和河流现合并为同一张不透明水面网格，统一使用 `#6C9FB5`，河带连续穿过湖区，保持统一颜色而不产生透明叠色；若 L1 有显式溢流且下游已有河网，显示层补上湖口至下游河道的连接段。湖泊按静态湖群边界提取轮廓并经球面 Catmull–Rom 插值平滑。河流中心线同样平滑，真实源头从小幅可见的底宽开始渐增，多支流汇流处有接缝补片，入海端连接至海陆共享 Voronoi 边中点。默认生成完整自然世界，河网和湖泊开关均默认开启。本轮未运行自动化检查或浏览器目视验证。

## 当前结论

2026-11-12 **M1 已按用户决定收尾**：自然生成值沿用 T0 `terrain-v25` / C0 `climate-c0-v21` / I0/H0/L1 / E0 `ecology-e0-v3` 基线。2026-11-13 的 T0 `terrain-v26` 仅把已生成的表面纹理数组纳入 Artifact，不改变高程/海陆结果；对应视觉和 Worker 传输检查尚未运行。全量性能矩阵、T0 地形自动化矩阵、C0 雨影专项和 L7/L8 峰值内存仍延期，不记为已通过。

2026-11-13 卫星地球视图效果按 `docs/old-src/core/rendering/globe/` 对齐：大气层使用参考项目的背面边缘 smoothstep 与相机距离淡入，海水层使用海洋单元几何及半透明 Phong 材质，星点数量/尺寸按参考尺度缩放；昼夜照明沿用参考项目的月中日序、轴倾角和太阳方向，暗面增加蓝灰环境补光以保留表面可读性。卫星表面使用 Lambert 材质与径向法线；卫星配色加入参考卫星地图中的固定方向地形阴影调制，让高地雪/岩区域的明暗层次更明显。按视觉需求，浅海颜色过渡水深从 0.45 km 扩至 0.6 km，地形阴影梯度尺度从参考值 12 微调至 14，均为显示参数，不改变地形事实。T0 `terrain-v26` 捕获并校验参考渲染使用的五个表面纹理字段，Web 保持参考的配色、纹理权重和岩石/积雪混合顺序。顶栏“显示”选项现提供大气光晕和昼夜效果开关；昼夜效果仅在卫星图层启用。纹理仅供渲染，不进入 WorldSnapshot、区域事实查询或生成算法值。Stage 版本变化会使旧 T0 及依赖缓存失效，L7 Artifact/Worker 传输额外约 3.1 MiB。本次未运行 test、build、lint、typecheck，也未打开浏览器目视检查；视觉结果和大网格 GPU 成本仍待检查。

2026-11-12 M1.5/M1.6 快速收尾验证：Core 自然快照/档案与发布用例 19/19、Web Controller/Transfer/Worker 用例 24/24、C0 温度/降水/Köppen 用例 11/11 通过；Core 与 Web typecheck 通过。真实 Chrome 下完整自然世界发布、Worker 缓存/硬取消恢复、阶段失败保留旧世界 3/3 通过。关键生成/失败恢复路径有浏览器证据；全量性能矩阵、T0 v25 自动化矩阵及 C0 雨影专项未完成，按用户决定延期。

2026-11-12 C0 东岸草原/季风雨量再平衡至 `climate-c0-v21`：按东岸暴露度平方小幅增加夏季迎风降雨，不改 Köppen 阈值。四 Seed 的半干旱草原均下降 **0.09–0.35 个百分点**，Cwa 均上升 **0.23–0.34 个百分点**；Dwa 在三个 Seed 小幅增加，在一个 Seed 下降 0.01 个百分点。默认 Seed Dwa **0.266%→0.291%**、Cwa **1.986%→2.323%**、BS **23.553%→23.259%**、BW **9.811%→9.755%**，陆地年雨量增加 2.77 mm/年。说明减少的草原会依据月温和季节降雨条件转入多种气候类，不会全部变成 Dwa。默认 I0/H0/E0 诊断生成成功，年均径流 359.85 mm、河段数 1096。四 Seed 气候诊断和默认下游筛查已运行；本次未运行 test、build、lint、typecheck、L1、完整自然快照或 Worker 浏览器检查。版本升级使旧 C0 缓存与下游依赖失效。详见 [v21 对照](benchmarks/M1.2-Dwa-v21-steppe-adjustment.md)。

2026-11-12 C0 东岸冬干大陆性气候调整至 `climate-c0-v20`：继续受限于 v19 的 Dwa 偏少，本轮将东岸季风区附加季节温差振幅上限调至 5°C，东岸冬季离岸气流降雨抑制按暴露度平方增强，并把东岸信号的陆向传播距离从 850 km 扩至 1100 km。四个固定 Seed 的 Dwa 均上升：默认 Seed 1024/L7 **0.081%→0.266%**，其余三个 Seed/L6 为 **0.086%–0.169%**。默认 Dwa 最热月均值 25.6°C、最冷月均值 −3.3°C，主要位于东岸低地。默认 Csa/Csb 仅分别变化约 +0.01/+0.00 个百分点，BW 9.86%→9.81%、BS 23.16%→23.55%，陆地年雨量 658.61→659.63 mm。提高温差至 10°C 的试验虽使 Dwa 达 0.45%，但最热月均值约 30°C，故未采用。默认 I0/H0/E0 诊断生成成功，年均径流 355.89 mm、河段数 1094。`Dfd/Dwd/Dsd` 仍为 0，分类阈值不变。四 Seed 气候诊断和默认下游筛查已运行；本次未运行 test、build、lint、typecheck、L1、完整自然快照或 Worker 浏览器检查。版本升级使旧 C0 缓存与下游依赖失效。详见 [v20 对照](benchmarks/M1.2-Dwa-v20-adjustment.md)。

2026-11-12 C0 东岸季节温差校准至 `climate-c0-v19`：四个固定 Seed 的 Dwa 原均为 0；在东岸中纬季风暴露陆地对强暴露区增加有界的季节振幅后，默认 Seed 1024/L7 的 Dwa 为 **0.081%** 陆地面积，另三 Seed/L6 为 **0.023%–0.089%**。默认新增 Dwa 位于约 42°–50° 的东岸低地，最冷月平均 −2.1°C、最热月平均 23.8°C，冬干比值平均 0.049；Köppen 阈值及降雨公式不变。默认 Csa 4.63%→4.67%、Csb 1.95%→1.92%、BW 9.82%→9.86%、BS 22.78%→23.16%，年雨量 659.29→658.61 mm；I0/H0/E0 诊断生成成功，年均径流 357.75→356.79 mm。`Dfd/Dwd/Dsd` 仍为 0：现有高纬低地中距岸至少 1000 km 的面积仅占陆地 0.098%，不对分类设面积配额。新增定向温差和稀有亚型可达性回归用例；本次未运行 test、build、lint、typecheck、L1、完整自然快照或浏览器 Worker 检查。v19 使旧 C0 缓存与下游依赖失效；空间形态和区域月温的同尺度观测验收仍待进行。详见 [v19 对照](benchmarks/M1.2-Dwa-v19-adjustment.md)。

2026-11-12 C0 西岸海洋性年温差校准至 `climate-c0-v18`：v17 默认 Csa 仍占陆地 6.06%、Csb 仅 0.56%。v18 在绝对纬度约 22°–52° 的副热带西岸按模型西岸暴露度混合陆地和海洋季节气温振幅，不改变年均温基线公式及 Köppen 阈值；未显式模拟沿岸上涌。默认 Seed 1024/L7 Csa **6.06%→4.63%**、Csb **0.56%→1.95%**；另三 Seed/L6 的 Csa 从 3.51%–6.17% 降至 **2.53%–5.14%**，Csb 从 0.41%–0.85% 升至 **1.35%–1.93%**。默认 Csb 的 78.7% 位于强西岸暴露区，98.0% 位于 30°–50°。默认 Dfb 10.57%→10.08%、EF 3.88%→3.95%，BW 9.76%→9.82%，BS 22.95%→22.78%；陆地年雨量 658.59→659.29 mm，年均径流 357.93→357.75 mm。默认 I0/H0/E0 诊断完成；L1、完整自然快照、Worker 浏览器链路及 test/build/lint/typecheck 本次未运行，新温度回归用例尚未执行。Cfb 上升与沿岸绝对月温仍待观测核对；版本升级使旧缓存及下游签名失效。详见 [v18 对照](benchmarks/M1.2-Csa-Csb-v18-adjustment.md)。

2026-11-12 C0 西岸干夏范围校准至 `climate-c0-v17`：四 Seed 消融表明 v13 的西岸夏季锋面抑制是 Csa 扩张的主要可控贡献。本轮将西岸季节降水项集中到暴露度较强的区域，夏季锋面抑制幅度减半；默认 Seed 1024/L7 Csa **7.70% → 6.06%**，另三 Seed/L6 从 4.23%–7.69% 降至 **3.51%–6.17%**。默认强西岸暴露区的 Csa 面积仅降 5.1%，弱/中暴露区收缩较明显；陆地年雨量 649.9→658.6 mm，BW 9.84%→9.76%，BS 23.22%→22.95%，Cfa 8.68%→10.43%，Csb 1.01%→0.56%。默认 I0/H0/E0 诊断完成，年均径流 352.8→357.9 mm，河段数仍 1,095；L1、完整自然快照、Worker 浏览器链路及 test/build/lint/typecheck 本次未运行。已添加弱/强暴露季节雨回归用例但未执行。Köppen 阈值与字段结构不变，版本升级使旧缓存和下游签名失效；未按地球面积硬配额。详见 [v17 固定 Seed 对照](benchmarks/M1.2-Csa-v17-adjustment.md)。

2026-11-12 默认 Köppen `Csa` 面积及成因复核：当时 v16、Seed 1024/L7 占陆地 7.70%（约 1174 万 km²），其余三 Seed/L6 为 4.23%–7.69%；海陆分布不同，地球约 2% 仅为参考而非配额。默认 Csa 的 98.8% 位于南北纬 30°–50°，90.5% 按参考网格近似位于距岸 500 km 内；西岸暴露度 ≥0.5 占 39.5%，恰为 0 占 9.4%。夏季最干月中位数 17.4 mm、最暖月 25.0°C；夏半年雨量整体加 20% 后仍有 80.0% 留在 Csa。v12→v13 西岸夏雨抑制使默认 Csa 5.35%→7.99%，当时 v16 为 7.70%。据此判断值得校准干夏作用范围，不改 Köppen 阈值或按地球面积硬调；该轮未修改算法，仅运行固定 Seed 诊断，未运行 test、build、lint、typecheck 或浏览器检查。详见 [Csa 评估与方案](benchmarks/M1.2-Csa-v16-assessment.md)。

2026-11-12 M1.5 完整自然快照代码已接入并完成本轮定向验收：`createNaturalPipeline` 在同一 DAG 生成 T0/C0/I0/H0/L1/E0；`assembleNaturalWorld` 将五类自然状态、空文明、完整配置与各 Stage 来源组装为 Schema 3 候选并做完整领域校验。`WorldStore` 复制、校验后原子发布，提供无可写数组的区域/字段/流域/河流/湖泊查询及版本化 JSON 档案往返。Web Worker 新增“完整自然世界”请求，Controller 先持有已校验候选，场景安装成功后才提交；失败和取消保留最后有效世界。旧 Schema 1/2 档案明确拒绝，不伪造缺失自然事实；档案 envelope 仍为 M0 JSON v1。Core/Web 定向用例、Core/Web typecheck 与真实 Chrome 完整自然世界发布链路通过；性能与 L7/L8 峰值内存未测，完整性能回归按用户决定延期。

2026-11-12 M1 收尾的前两项完成：确定本轮候选自然链为 T0 `terrain-v25` / C0 `climate-c0-v16` / I0/H0/L1 / E0 `ecology-e0-v3`，T1/C1/H1 与更细水分/生态模型转入后续演进。E0 专项核对发现 v2 错将 Mesh Z 轴当纬度；v3 改用与 C0 一致的 Y 轴并使旧缓存失效。四 Seed 固定地形/气候对照中，逐格变化占全部区域 0.92%–1.92%；现雨林平均绝对纬度 6.1°–7.8°，荒漠占陆地 8.34%–13.09%，海陆/自然覆盖映射错误均为 0。Core E0 定向 5/5、Web 定向 17/17、当时 v25/v16/v3 同输入旧分类器回放 1/1、真实 Chrome 定向 2/2 已通过；Core/Web 包级 typecheck 通过，新 E0 文件定向 lint 通过。E0 分类和展示链路按本轮初步模型范围验收；真实植被空间标定未做。以上是 M1.5 快速验证之前的历史状态；M1.5 后续定向验收通过，M1 按用户决定收尾，未完成的全链检查延期。详见 [E0 收尾记录](benchmarks/M1.4-E0-closeout.md)。本次未运行全仓 test、build、lint、typecheck 或完整浏览器回归；扩大到受影响文件的 ESLint 仍报告既有格式问题。

2026-11-12 C0 升级至 `climate-c0-v16`。第二轮降水用初估年降水／潜在蒸散量约束陆地水汽再循环，海洋供给继续按原气温与暖度计算。四个固定 Seed 的沙漠增 2.22–4.10 个百分点、半干旱草原减 1.74–3.76 个百分点，新增沙漠的 98.3%–100% 来自草原。默认 BW 7.25% → 9.84%，BS 25.21% → 23.22%，Af 约 5.42%，陆地年雨量 660.9 → 649.9 mm。完成四 Seed 逐格与连片对照、默认气候及 I0/H0/L1/E0 诊断，补充供水限制回归用例。该限制使用年尺度近似，未模拟逐月土壤蓄水。未运行 test、build、lint、typecheck 或浏览器检查。 [陆地水汽再循环对照](benchmarks/M1.2-land-water-limited-recycling.md)

2026-11-12 C0 升级至 `climate-c0-v15`。寒冷陆地的水汽随陆上输送时间衰减，暖干地区的背风下坡输送增加干燥；直接海洋入流保留基础衰减。四个固定 Seed 的 Dfb 均下降、热冷沙漠均扩大。默认 Dfb 11.57% → 10.24%，BW 6.20% → 7.25%，其中中纬距海 300–900 km 的低地 Dfb 42.89% → 33.72%；陆地年雨量 688.8 → 660.9 mm，Dfc 5.78% → 4.18%。已复算四个固定 Seed、默认逐格分类迁移和 I0/H0/L1/E0 生成，新增冷季弱风和背风坡回归用例。区域绝对雨量仍缺观测验收，本次未运行 test、build、lint、typecheck 或浏览器检查。 [大陆冬季与背风干燥对照](benchmarks/M1.2-continental-dryness.md)

2026-11-12 C0 副热带沙漠修正已完成，版本升级至 `climate-c0-v14`。干空气混合损失沿陆地到陆地的输送边累积，直接上岸的海洋水汽保留基础损失。四个固定 Seed 的 BW 沙漠增加 1.51–2.36 个百分点，新增沙漠近乎全部来自半干旱草原，最大连片沙漠在四个样本中均扩大。默认 BW 4.69% → 6.20%，全球年雨量 985.3 → 977.2 mm、陆地 716.0 → 688.8 mm、Af 5.83% → 5.53%。已复算固定 Seed 与默认 I0/H0/L1/E0，并补充定向回归断言。未运行 test、build、lint、typecheck 或浏览器检查。 [副热带沙漠对照](benchmarks/M1.2-subtropical-desert.md)

2026-11-12 C0 西岸夏雨与副热带内陆输送修正已完成，版本升级至 `climate-c0-v13`。西岸锋面雨受夏季副热带高压抑制，暖干内陆水汽随弱风传播时间增加而多衰减。四个固定 Seed 的同地形对照中，原西岸 Cfa 的夏雨减少 95–103 mm，约 44%–53% 转为 Csa；东岸对应区域少 11–15 mm，深内陆年雨量少 4–15 mm。默认世界全球年雨量 990 → 985 mm、陆地 731 → 716 mm，Cfa 13.73% → 10.65%，Csa 5.35% → 7.99%，BW 4.34% → 4.69%。默认风流分带统计一致，I0/H0/L1 与 E0 生成完成。区域绝对雨量的观测验收尚未执行。已补夏季锋面与弱风输送回归用例，本次未运行 test、build、lint、typecheck 或浏览器检查。 [四 Seed 对照与验证](benchmarks/M1.2-west-coast-inland-rainfall.md)

2026-11-12 环流速度显示已接入。Core 区域查询新增估算的 `windSpeedMps` 和 `oceanSpeedMps`，Web 提供两个按月切换的 m/s 速度专题、图例与区域吹向／流向读数。陆地和缺测海域的流速显示为无数据，有效静水为 0；暖度代理保留独立图层。速度在查询时从原有向量派生，C0 生成、输热、快照和缓存签名沿用原版本。本次生成默认及三个独立 Seed 的环流诊断并实际完成分带拟合与复验。观测原始文件下载的自动权限审核超时，风速使用归档的海域东西向风初步标定，流速使用归档的海域月平均流向量标定。逐格、近岸和陆地速度待复核。已补 Core、Web 和 Chrome Worker 用例，未运行 test、build、lint、typecheck 或浏览器检查。 [环流速度标定](benchmarks/M1.2-circulation-speed.md)

2026-11-12 C0 温雨与环流校准：`climate-c0-v12` 修复海洋气温直减率与最终海岸洋流采样，收窄海洋风带季移，恢复宽洋盆的赤道逆流并增加有界沿流向热输送，重分配热带/中纬降水及恢复陆地极干尾部。默认 1024/L7 年均温 17.03 → 15.20 °C，陆地年雨 646 → 731 mm，全球年雨 973 → 990 mm，陆地最低年雨 49 → 11 mm，陆地非零洋流从 2.63% 降至 0。保持 12 个等时长月与参考分类规则，逐格复验 Köppen/E0 和 I0/H0。全仓 180 项单测、typecheck、build、真实 Chrome Worker 10/10、Core 气候定向 lint 和默认 Seed L6–L8 缓存/复算基准通过。Web 全包 lint 仍有既有格式问题。NCEP/GPCP 与 NOAA 漂流浮标用于观测对照，三个独立 Seed 复验和空间图已归档；赤道逆流纬度、南半球热带海雨及闭合洋盆流线仍有差异。证据见[校准报告](benchmarks/M1.2-climate-calibration.md)。

2026-11-12 年度/月度环流诊断：新增 Seed 1024/L7 默认配置风场与洋流的面积加权诊断脚本、[分析](benchmarks/M1.2-circulation-default-diagnosis.md)与[原始数据](benchmarks/M1.2-circulation-default-diagnosis.json)，本次实际运行诊断命令。12 个等时长月沿用 C0 四季锚点插值，年度向量是诊断统计而非新增快照字段；向量均为模型相对值，不可与 m/s 直接比较。信风/西风/极地东风及低纬西向/中纬东向洋流的年方向大体符合类地球一级分带，但赤道南北各 5° 的年度洋流东向海域占比均为 0%，未形成稳定赤道逆流；30–45°N/S 海洋风东西分量在一年内反号的面积占各带 70.7%/60.8%，需与观测月风场同尺度对照。最终海陆与参考网格掩码错位占全球面积 1.56%，导致 2.63% 最终陆地面积至少一月读到非零洋流、1.10% 最终海洋面积全年近零。后续先修输出海岸采样边界，再验证 ITCZ/风带季移和洋盆环流；本次未修改 C0 生成算法、Stage 版本或公开契约，未运行 test、build、lint、typecheck 或浏览器检查；多 Seed、流线和同尺度观测对照未完成。

2026-11-12 月度气候补充诊断：在默认 Seed 1024/L7 面积加权报告中新增南北半球/15° 纬度带的逐月温度降水和逐区域最干/最湿月、最冷/最暖月、季节幅度与分类阈值面积统计；本次实际重新运行了诊断脚本，原始数据与分析仍见[气候诊断](benchmarks/M1.2-climate-default-diagnosis.md)。北半球陆地 1/7 月均温 6.7/24.4 °C、南半球 21.5/2.1 °C，全陆地月平均的 13.6–14.3 °C 小幅变化是半球抵消；陆地最干月最小仍有 1.53 mm。全年温暖陆地占 18.93%，其中 16.68% 满足 Köppen `Af` 最干月 ≥60 mm，得到 `Af` 占陆地 3.16%；E0 雨林占 3.97%。最暖月低于 0 °C 的陆地 2.49%，与 `EF`/E0 冰原占比一致。月度分类阈值链路已定位，但与地球观测月场的同尺度对照、多 Seed、雨影及公式分量验证仍未完成；未修改生成算法或公开契约，未运行 test、build、lint、typecheck 或浏览器检查。

2026-11-12 默认气候与群系诊断：新增可复现的 Seed 1024/L7 默认配置面积加权报告，原始数据和暂定类地球比较范围见[气候诊断](benchmarks/M1.2-climate-default-diagnosis.md)及[JSON](benchmarks/M1.2-climate-default-diagnosis.json)。本次实际运行诊断脚本，得到全域/陆地/海洋年均温 17.03/13.99/18.33 °C、年降水 972.53/645.69/1111.94 mm；陆地极干尾部缺失，E0 冰原面积仅占陆地 2.49%。定位到 C0 投影对海底深度误用气温直减率，可使局地海洋年均温达到 40.74 °C；该项全球净影响很小。另发现默认世界极高纬陆地偏少、陆地水汽补给有正下限；陆地偏暖与降水海陆错配的完整因果尚未拆尽。下一步先修复海洋局地投影错误，再分解高纬地形/同纬热力偏差、海陆水汽分配，最后复验 Köppen/E0；不直接改全域温度偏移或降水倍率。本次未修改生成算法或公开契约，未运行 test、build、lint、typecheck 或浏览器检查；多 Seed、同尺度观测分位数和空间形态仍待验证。

2026-11-12 年度气候专题：`/mesh-debug` 图层面板新增“年平均气温（°C）”和“年总降水（mm/年）”，直接读取 C0 已有逐区域年值；着色、图例分档、区域检查和可复制统计均已接入。统计展示全域及陆地面积加权均值、陆地数值范围；分档表仍按区域数计算总比例和陆地比例，并明确标注口径。两个年图层不随月份选择变化，未修改生成算法、缓存签名或公开数据契约。已补 Web 单元和真实 Worker 浏览器用例，但本次未运行 test、build、lint、typecheck 或浏览器检查；气候数值与空间形态仍需独立校准。

2026-11-12 默认 T0 高程统计校准：按用户要求重开地形算法，海底骨架升级为 `terrain-skeleton-v10`，后处理及物理高程映射升级为 `terrain-v25`；收窄陆架、加深海盆，并采用按地球面积分带校准的陆地单调映射与少量海沟深度尾部。默认 Seed 1024/L7 面积加权得到陆地 29.90%、陆地低于 1 km 75.34%、高于 2.5 km 7.75%、平均海深 3.49 km、最深约 10.31 km；另 3 个 Seed/L6 的陆地高于 2.5 km 为 7.00–7.83%、平均海深 3.54–3.61 km；Seed 1024/L8 高地占比 7.53%、平均海深 3.46 km。L4/L5 的高地占比升至 13.17%/9.70%，说明粗网格仍有尺度偏差。历史默认 T0 v24 对照为陆地 31.34%、低于 1 km 54.09%、高于 2.5 km 21.71%、平均海深 1.47 km。原始多 Seed 数据见[高程统计诊断](benchmarks/M1.1B-terrain-hypsometry-v25.json)。本次运行了面积加权诊断生成和曲线单调/接点诊断；Seed 1024/L7 的 C0→E0 诊断生成成功（26 个 Köppen 类、15 个群系类），Seed 1024/L6 的 H0/L1 诊断生成成功（223 个河段、38 个静态湖）。还做了单张地形图的粗略视觉抽查，未发现明显环状断带；这不构成空间形态验收。新增定向测试断言但未运行 test、build、lint、typecheck 或浏览器检查。全球高程分布接近参考区间；本条记录早于本轮 M1 收尾，尚未完成的空间形态、T0 自动化和下游全链复验按用户决定延期。

2026-11-11 图层面板去重：移除与“专题面与可用数据”重复的“底层地表（单选）”下拉区域，现由专题按钮作为唯一的分类图层入口；月份控件移入该区域，保留月度气候/冰雪切换。后续区块序号调整为 2–4；浏览器回归用例同步改为点击专题按钮，并增加旧下拉框已移除的断言。无生成逻辑、图层事实或公开契约变化。本次未运行 test、build、lint、typecheck 或浏览器检查。

2026-11-11 分类图层语义收口：保留当前行星年 12 个等时长分箱。图层面板将参考项目对应的 `koppen` 明确命名为“Köppen 气候分类”，将 E0 的 `biomes` 显示为“生物群系分类”；`land-cover` 单列为“自然覆盖（群系归并）”，不将自然覆盖当作第二套气候或群系标准。图例与区域检查增加对应说明，E0 使用初步 C0/T0、空间形态待验收的限制仍明确显示。新增针对雨林群系、森林自然覆盖与配色/名称区分的 Web 用例。本次未运行 test、build、lint、typecheck 或浏览器检查；图层判断仍读取原有 C0/E0 产物，无生成算法或公开契约变化。

2026-11-11 图层补齐（历史路径 `/mesh-debug`）：当时增加 Köppen 气候分类专题，直接读取 C0 的稳定类别 ID，使用 `feat-society` 的 32 类中文名称和线性 RGB 调色板；区域检查、独立图例及面板统计均可查看类别。已有生物群系专题继续读取 E0 的稳定类别 ID、旧项目群系颜色和分类规则。两类图层均为只读显示，不改动生成阶段或缓存签名。旧项目按日历月长加权，当前 C0 使用 12 个等时长分箱；分类阈值与分支顺序一致，但跨项目相同 Seed 不保证逐格类别相同。当时专题使用网格区域着色，旧项目正式制图的平滑面尚未迁入。本次新增 Web 定向回归用例；未运行 test、build、lint、typecheck 或浏览器检查。

**2026-11-10 UI 迁移已完成，M1 仍按用户决定封版**：Web 已接入参考项目的 Svelte 5、Vite、Bits UI、Tailwind CSS 技术栈，并按参考源码的 `ui/components`、`ui/hud`、`ui/state` 目录组织；顶部 HUD、参数面板、图层面板、区域检查器、底部工具栏和基础配色已迁入并连接当前 Mesh/Worker 工作台。现在首次打开自动生成当前可用的自然链，默认 Seed 1024、L7（163,842 区域）、扰动 0.75；UI 气候默认倾角/降水倍率为旧项目的 23.5°/1.8。自动生成采用仍属实验的 E0，保留当前 Core 约定的物理半径 6,371 km。参考 UI 文件保持在 `docs/old-src` 未修改。完整自然快照和 M1 全阶段收口条件尚未达成；下一步以 `feat-society` 为基线重开 M1 算法与生成流程迁移，不把 UI 迁移视为 M1 技术验收。

2026-11-10 UI 反馈补充：Cell 网格边线默认为关闭，开关位于图层面板“环境与辅助”。当前专题图例与分布统计合并显示，逐类列出区域数、占总区域比例和占陆地区域比例，按陆地比例降序（同值按总区域比例降序），并显示最终陆地区域（或仅有地质数据时的候选陆地区域）总体占比；可复制统计文本。河网和湖泊专题同时显示段/湖数量及面积摘要。统计为只读显示计算，不写入快照、不触发生成或缓存失效。本次未新增测试，也未运行 test、build、lint、typecheck 或浏览器检查。

M1.2 初步气候 C0 的实现、代码和 Worker 链路验收通过：实现基于 feat-society 参考算法迁入四季风场、洋流代理、季风、月度三轮温度／两轮降水求解和 Köppen 亚型分类，并适配参考网格面积聚合、12 个等时长分箱、三源海陆感知投影及逐月全局降水体积修正。实际检查、Worker 浏览器回归和 3 Seed × L4/L5/L6 基准均通过，证据见下方及[气候验收基准](benchmarks/M1.2-climate-c0-acceptance.json)。按 M1 通用气候形态标准，地形雨影仍缺专门合成夹具验证，因此形态验收保留一项待补。

按用户调整，当前工作区在 M1.2 基线上恢复 T0 塑形阶段的基础水力与冰川侵蚀：`terrain-v24` 在高程转物理 km 前调用迁移的 `TerrainErosionProcessor`，参数默认 0.5/0.5；水力参数在处理器入口统一乘以 0.5，冰川强度不变。完成侵蚀、山脊锐化和土壤蠕动后，按最终负高程连通分量清理小于 4 个 L5 网格等效面积的水体，将其抬至海平面以上并记入拓扑诊断；较大的湖盆或海域保留，之后重建排水和最终海陆掩码。T0 不读取气候/降雨，也没有后续追加侵蚀。Seed 42/314159/8675309 × L4/L5/L6 基准中，最终封闭水体均无小于门槛的残留，海洋连通分量为 1–3。

M1.3A 已实现并完成 Core/Web 自动化与包级检查：I0 以显式温度阈值、融雪系数生成月末雪水当量/降雪/融雪；H0 以蒸散系数和液态降水/融雪生成月径流、年径流深/体积、Priority Flood 填洼路由、下游关系、汇水面积、流域摘要及河流段/Strahler 级序。当前 `hydrology-h0-v2` 把河道面积底线从 8×调整至 16×平均网格面积，调试河网按 Strahler 级序淡化低级支流。温度指数蒸散/融雪仅为近似，积雪只模拟一个周期，不计算多年冰川体积。真实 Chrome 可见页面通过 L4/L6 Worker 生成、区域查询和缓存失效检查；Playwright 自动回归因受管环境无法启动 headless Chrome（进程 SIGABRT）而未通过。Core/Web tests、typecheck、lint、build 均通过；Core 125/125，Web 32/32。

M1.3B 静态湖泊已实现并按当前范围验收：`static-lakes-l1-v4` 从 T0 地形与 H0 Priority Flood 溢流面识别低于溢流面的连通洼地，过滤单网格组件（至少两个区域才计为湖）；保存成员区域、面积、静态溢流水位、H0 流域 ID 和溢流区。湖泊独立于海陆掩码和 H0 汇水分区，不修改地形或 WorldSnapshot Schema。3 Seed × L4/L5/L6 基准见[静态湖泊基准](benchmarks/M1.3B-static-lakes.json)：9/9 强制重算结果稳定，L4 每组 0–2 个、L5 为 3–7 个、L6 为 33–39 个。真实 Chrome Worker 在 L8 生成并显示 1,063 个湖泊组件。该算法按静态填洼洼地分类，无法区分真实湖盆与河谷/泛滥平原型狭长积水区；这是当前明确限制，不代表气候水量平衡。

M1.4 E0 已按**当前 T0/C0 初步输入范围验收**：`ecology-e0-v3` 只读取 C0 的 12 个等时长月气候和年度统计、T0 高程与海陆掩码；所有陆地区域均参与分类，H0 河网及 L1 湖泊成员不作为分类输入或覆盖掩码。E0 Stage 直接依赖 Mesh/T0/C0，不依赖 I0/H0/L1；水文参数变化不应使 E0 失效。Köppen 气候分类本身位于 C0 阶段。当前四 Seed 纬度/温雨/面积/连片核对和 v3 的旧分类器同输入回放已完成，定向 Core/Web 与真实 Chrome Worker 回归通过；结果见 [E0 收尾记录](benchmarks/M1.4-E0-closeout.md)。真实植被分布标定、土壤账本及多年冰盖不属于这轮已实现能力；完整自然快照代码、发布流程及本轮快速验证见顶部 M1.5 收尾记录。

初版 `hydrology-h0-v1` Seed 42/314159/8675309 × L4/L5/L6 基准见[初始基准](benchmarks/M1.3A-hydrology-acceptance.json)。河网减密后 v2 的 9 组结果见[密度校准基准](benchmarks/M1.3A-river-density-calibration.json)：L6 从 1,627–1,874 个河道区域降至 912–1,138 个（减少 39–44%），河段从 534–541 降至 221–245。L5 减少约 46–59%。L4 更稀，Seed 314159 此样本只有 2 个河道区域；若 L4 是主要展示尺度，需单独校准粗网格阈值。

M1.2 的历史记录：新增核心月值／边界、等时长 forcing、Köppen、Worker 缓存与 Transfer、Controller 缺失结果回归；历史 core 测试 121/121、Web 测试 30/30，core/Web lint、typecheck 和 build 均通过。真实 Chrome Worker 浏览器回归 6/6 通过，涵盖 Mesh、Geology、Terrain、L8 与 C0 气候。该记录仅属于 M1.2 基线，不覆盖本轮 M1.3A 改动。

`pnpm --filter @another-earth/world-core bench:climate` 已完成 Seed 42/314159/8675309 × L4/L5/L6 的 9 组样本。每组强制重算的温度／降水哈希稳定；冷生成约 1.63–2.29 s、缓存命中约 0.15–0.52 ms、变更重算约 1.26–1.51 s，缓存占用约 24.3/30.7/56.5 MiB（L4/L5/L6）。机器、配置、完整哈希与数据见[基准记录](benchmarks/M1.2-climate-c0-acceptance.json)。

M0 工程基础和 M1.1 地质/基础地形 terrain-v20 已完成历史验收。当前基础地形算法升为 `terrain-v27`，在 `terrain-v25` 高程标定和 `terrain-v26` 渲染纹理基础上对末端小水体闭合产生的近岸封闭洼地做破口排海；T0 侵蚀与末端小水体清理的 M1.3A L4/L5/L6 多 Seed 基准属于 v24 历史记录，v25 已完成高程统计诊断但尚未复跑该验收矩阵。terrain-v20 的 core/Web 单测、全仓类型检查与构建、lint、真实 Worker 浏览器回归，以及 L4/L6/L8 多 Seed 和参数样本历史通过。StageCache 默认预算为 512 MiB；旧 L8 基准留存约 430.5 MiB，峰值 RSS 未测。

当前 T0（`terrain-v27`）在地形塑形阶段执行基础冰川与水力侵蚀，默认参数 0.5/0.5；水力实际强度为参数的一半，冰川强度不变。参数进入 T0 缓存签名，UI 可分别调整。侵蚀在 km 映射前执行；侵蚀后的末端连通修复清理小于 4 个 L5 网格等效面积的负高程水体，并对由此产生的封闭近岸洼地破口排海，不读取气候、降雨或冰雪阶段产物，也不执行气候驱动追加侵蚀。

## 已实现能力

| 范围 | 当前状态 |
| --- | --- |
| 工程与内容 | Workspace 四包、公开 exports、内容定义/Catalog/签名、core/earthlike、内置 `western-zh-CN` 与 `western-en` 风格-语言 NamingStyle JSON，以及仅供未来生成选择的六份语言独立民族／文化／state JSON 候选包；统一的 ContentPack v1 包含 states、peoples 与 namingStyles；旧 geography 名称包已移除 |
| 世界契约 | Schema 3 完整自然状态（含向后兼容的可选月度环流 `climate.circulation`）、Dense Field/实体、WorldStore 受控发布与只读查询、`WorldMapReader`（对偶 Voronoi 拓扑恢复、邻域爬山定位、坡度/晕渲/卫星微纹理确定性派生）、完整校验、人口约束、版本化 JSON 档案编解码；M1.5 历史定向测试、typecheck 与真实 Chrome 发布路径通过，Slice 1 新增代码本次未运行自动化检查，全量性能回归延期 |
| Mesh | L0–L8 规则/扰动 Icosphere、Delaunay/Voronoi、CSR、物理面积、校验、最近站点查询 |
| 生成 | Stage DAG、声明输入、命名随机流、LRU 缓存、阶段事件和取消/失败边界 |
| Worker | Mesh/Geology/Terrain/C0/I0/H0/L1/E0 及完整自然世界 Worker 链路已实现；2026-11-10 阶段调试 10/10 通过，2026-11-12 完整自然世界发布、缓存/硬取消恢复和阶段失败保留旧世界的真实 Chrome 检查 3/3 通过 |
| 地质 | L6 参考网格、100 基础细分、主/微板块、候选大陆、地壳与普通/地质投影 |
| 地形 T0 | 动力学、构造骨架、山脊/火山、纹理/Warp/整形/平滑、基础水力/冰川侵蚀、锐化/土壤蠕动；物理 km 高程、海陆、坡度与统计 |
| 大陆、洋与海 | 最终海陆上的大陆归属、宽阔洋区与受围海域两级划分；大陆与大洋已有确定性中文名称并进入快照/查询/图例，在本专题地图表面显示文字标签；海仍显示编号且无标签；手动改名与尺度校准待办，本次未运行自动化及浏览器验证 |
| Cartography 数据源、样式与 3D/2D 渲染（Slice 1–Slice 5） | `@another-earth/cartography` 已实现实例级 `MapSourceRegistry`、14 个自然数据源适配器（栅格场、带孔平滑陆地/大陆/板块/湖泊多边形、变宽河道面与中心线、海岸线/板块边界/经纬网/Cell 边界网/环流箭头、PCA 脊线中文地名源）、`StyleCompiler` 预编译与静态校验、6 套内置 JSON 样式预设及 `LegendDescriptor` 自动导出；已完成 3D `GlobeView` 与 2D `AtlasView`（Equirectangular / Equal Earth / Mercator 三套投影、`±180°` 反经线裁切、水平无缝环绕副本）、5 类 GPU 批处理图层（`RasterLayer`、`FillLayer`、`LineLayer`、`CircleLayer`、`SymbolLayer`）、`SelectionLayer`、`MapPicker` 3D/2D 统一拾取、`WorldViewport`（3D ↔ 2D 视角同步）与 `CartographySession` 原子预备/激活/回收生命周期；`apps/web` 已完成单轨收口并清理旧阶段调试渲染模块，本次未运行自动化检查 |
| Web UI | 已接入 M3 `CartographySession` 双视图工作台（贴左窄图标栏承载面板入口、重置视角、随机生成与分享弹窗；分享目前导出当前视口 PNG，并提供可复制的参数链接；视图以右侧弹出卡分 3D 星球与 3 套 2D 投影；6 套底图风格预设、科学专题图层、矢量覆盖层开关、动态图例统计与 `WorldStore` 权威区域/实体侦测面板）；文明工作流待 M2 接入 |
| 世界视图 | Mesh/Geology/Terrain/C0/I0/H0/L1/E0 专题、月度及年度气温/降水图层、Köppen 气候分类、生物群系图层、月份切换、区域查询和 Worker 状态由主应用 HUD 显示；E0 使用初步 C0/T0 输入，当前分类链路已专项验收 |
| 初步气候 C0（M1.2 实现与链路已验收；雨影专项待验证） | climate-c0 Stage、四季风场／洋流代理、12 月耦合温度/降水、年统计与 Köppen 亚型、Worker 传输、月度/年度气温与降水专题及区域查询；非最终气候 C1 |
| 初步冰雪与水文 I0/H0/L1（M1.3A/B 已实现） | 月度雪水当量/降雪/融雪，气候驱动的水量指数近似、可配置河网密度和最小湖泊面积、沙漠河道来水来源筛选、干旱区静态湖泊入流/蒸发筛选、生成统计、Priority Flood、下游无环验证、面积汇流、流域与阈值河段、Stage 缓存、Worker 传输和区域查询；不含动态水位/追加侵蚀 |
| 生态与自然覆盖 E0（本轮初步模型范围已验收） | C0/T0 → 潜在生物群系与无文明自然覆盖；含稳定类别字典、区域查询、Worker 与主应用专题图层；当前四 Seed 形态、定向自动化、旧分类器回放与真实 Chrome E0 链路已验证；单独 E0 请求不发布快照 |

关键规则：内部地形统一塑形坐标，末端一次转 km；粗糙度 0–0.5、默认 0.4，强度相对默认为 `(roughness/0.4)³`；低地与中高段映射、字段兼容性见 [数据契约](WORLD_DATA_CONTRACTS.md)和 [技术设计](TECHNICAL_DESIGN.md)。当前高程用颜色表达，没有正式地形位移或完整 3D/2D 地图；完整自然世界仅在显式选择“完整自然世界（无文明）”后生成，默认自动生成仍为 E0 生成产物。

## M1.1 历史验收摘要

1. M1.1 历史版本验收完成。检查曾覆盖 core/Web 单元测试、全仓类型检查与构建、lint、真实 Worker 生成/缓存/取消/失败恢复；这些结果不覆盖当前 terrain-v26 Artifact 的渲染纹理传输。
2. 固定 Seed 矩阵覆盖 3 Seed × L4/L6/L8；另在 L6 验证粗糙度 0.1/0.4/0.5 与海平面基准 ±0.5 km。每组强制重算并比较高程和海陆哈希，统计海陆比例、高程范围与连通分量见[验收基准](benchmarks/M1.1B-terrain-v20-acceptance.json)。
3. 浏览器地形预览和查询通过，无明显孤立尖峰或海陆不一致。高程模型仍是程序生成基线，不代表全球 DEM 标定。
4. M1.2 C0 的实现与链路验收通过；若按 M1 通用气候形态条件收口，还需补地形雨影专项夹具或可复核证据。用户决定先在 T0 恢复基础水力/冰川侵蚀，不实现气候驱动追加侵蚀；后续 M1.3 可在 T0/C0 上建立初步径流/冰雪并另行设计最终气候水文。

2026-11-12 用户决定将本轮 M1 收尾，接受 T0 `terrain-v25` / C0 `climate-c0-v21` / I0/H0/L1 / E0 `ecology-e0-v3` 作为自然链基线。M1.5 快速验证结果见本文顶部；全量性能矩阵、T0 v25 自动化矩阵、C0 雨影专项与 L7/L8 峰值内存延期，未记为通过。T1/C1/H1、水文收支细化及生态气候学标定属于后续自然模型演进；M2 初始文明、正式 Cartography 和 M4 浏览器存储/导入导出仍未交付。

## 已知限制与待决事项

- C0 基于旧版启发式算法并已升级至 `climate-c0-v21`；当前已完成四 Seed 诊断、定向气候用例及默认下游筛查，未完成全量集成验收或全球气候学标定。月度气候仍是 T0 的阶段产物，不可单独发布为完整世界；未完成项按用户决定延期。
- C0 类地参数限定物理半径 6371 km、自转周期 24 小时、倾角 0–45°、公转周期 300–430 地球日、温度偏移 −40–60°C 和降水倍率 0–3；超出明确拒绝。−40°C 足以让最暖的热带海面降到海水冰点以下，+60°C 把热带推到 60°C 月温上限，并把大约 7 km 山峰在偏移前接近 −25°C 的气温抬过冰点。月温本身仍限制在 −90–60°C。仿真卫星的高山积雪只保留在最暖月不超过 2°C 的格子上。风和洋流已有按 m/s 估算速度的专题图层与查询，暖度代理独立；尚无矢量箭头层。
- C0 v12 历史校准已补雨影合成夹具；v13–v21 另有定向回归样例和四 Seed 诊断，v21 定向气候用例与完整自然世界 Chrome 路径已通过；当前版本完整全链矩阵与 C0 雨影专项仍待执行。区域绝对雨量、沿岸月温与空间形态仍缺同尺度观测验收。
- 参考 L6 与输出 L8 的两个 12N Float32 字段约 60 MiB，仅是数组容量估算；气候 L4/L5/L6 core 缓存字节已实测，但气候 L8 与浏览器端峰值内存/性能尚未测量。
- T0 v25 已依据地球海陆高程面积分带校准默认参数，诊断覆盖 Seed 1024/L4/L5/L7/L8 与另 3 个 Seed/L6。L4/L5 的高地面积仍偏大，不能将 L7 统计精度外推到粗网格。它不是 DEM 地形复制；山脉、海沟、海岸空间形态及其他 Seed/尺度未作系统验收，v25 自动化/Worker 矩阵按用户决定延期。当前 E0 已完成 v16 输入的四 Seed 专项与真实 Chrome 链路复验；完整 v21 自然链回归未完成，作为 M1 收尾后的延期事项。
- T0 前置侵蚀复用参考项目按汇水格数与角格距调参的启发式算法；当前恢复的是基础形态塑造，不是地球侵蚀速率标定。T0 不读取气候/冰雪，降雨驱动的追加侵蚀尚未实现。
- L1 湖面水位仍是 Priority Flood 溢流高度，不是逐月储水。近岸小水体闭合死坑已在 T0 `terrain-v27` 破口排海；`static-lakes-l1-v10` 只排除平均水深不足 1 m 的填洼薄膜，以及冰原、荒漠和降水不抵蒸发的洼地，低地数米深的闭合可以成湖。高地单位面积上的封闭洼地仍然更多，未按海拔配额删减。`endorheic` 仍沿用 H0 内流终止盆地语义。半干旱草原上降水足以抵消蒸发的洼地可以保留。
- L1 v4 曾把所有至少两个区域的连通 Priority Flood 洼地当作静态湖泊，L8 Seed 42 得到 1,063 个组件。该数量不代表 v7。v7 仍没有形状判据，狭长深盆可能继续看起来像宽河谷。
- 同步长计算需硬取消兜底，Worker 重建会丢缓存；重新成功生成前禁用拾取。显示数组准备仍可能阻塞主线程。
- 部分区域诊断为兼容零/一数组，其含义不是世界事实。后续移除字段必须同步查询、Worker、校验与消费者。
- L8 单次 terrain artifact 约 31.25 MiB；全链路缓存实测约 399–430.5 MiB，StageCache 默认预算为 512 MiB。core 基准与真实 Chrome Worker 第二次请求均确认全链路缓存命中。峰值 RSS 仍未测，设备端长期内存压力需后续验证；预算试验见[验收基准](benchmarks/M1.1B-terrain-v20-acceptance.json)。
- CPU/GPU 峰值 RSS、长期浏览器资源压力和远端 CI 未核实；基准记录的缓存/数组字节不是进程峰值。
- M1.5 的 Worker 同时传输独立快照和中间阶段产物，主线程发布时再复制并校验候选；L7/L8 峰值内存与当前链路耗时未测（中间阶段产物传输将在 M3 Slice 5 单轨收口时清理）。`WorldStore.pick` 现已委托给 `WorldMapReader.mesh.locateRegion` 邻域贪心爬山定位，L7/L8 实测耗时待运行基准验证。Web 目前提供生成和查询入口，未提供档案导入后重建地图的 M4 项目流程。
- Schema 3 新生成的完整自然世界现将标定后的月度风场、洋流速度分量、寒暖流代理及 `oceanAvailable` 掩码保存在可选 `nature.climate.circulation` 中；旧 Schema 3 档案不含该字段时仍可正常恢复，`WorldMapReader.capabilities.hasCirculation` 为 `false`。M3 Cartography Slice 1–Slice 5（`WorldMapReader`、`MapSourceRegistry`、水系面化、PCA 脊线、`StyleCompiler`、6 套预设、3D `GlobeView`、2D `AtlasView` 多投影、统一拾取、`CartographySession` 及 `apps/web` 单轨接入）已全部完成代码与单测落地，待授权后运行全仓自动化测试与浏览器实测验收。

## 验证证据与历史基准

2026-11-08 M1.3B v1：Core 129/129、Web 33/33；Core/Web typecheck、lint、Web build 与 `git diff --check` 通过。`bench:hydrology` 以 Seed 42/314159/8675309 × L4/L5/L6 完成 9/9，强制重算的 H0 与完整 L1 湖泊属性/成员哈希稳定，参数变化仅重算 H0 和其下游 L1；每组识别 2–10 个静态湖泊。手动真实 Chrome Worker 生成页面显示 4 个湖泊，专题选项可见并可切换。Playwright 定向 E2E 已加入，但本机 headless Chrome 启动时 SIGABRT，未能执行页面自动化；区域归属查询由 Core 测试覆盖，浏览器点选回归仍待自动化环境补跑。Web build 仍提示世界视图 chunk 超过 500 kB。

2026-11-08 M1.3 收尾：Core 130/130、Web 33/33；Core/Web typecheck 与 lint 通过，Web build 通过（MeshDebug chunk 594.78 kB 的既有警告）。Hydrology benchmark 3 Seed × L4/L5/L6 完成 9/9，强制重算和湖泊稳定哈希通过；数量见基准文件。可见 Chrome Worker 页面已在 L8 生成并展示 1,063 个静态湖泊，专题和区域查询可用。Playwright 定向 E2E 因本机 headless Chrome SIGABRT 未能启动。形态检查发现静态 Priority Flood 洼地里存在狭长组件，现无领域依据校准的形状阈值，按阶段边界记录为限制；不宣称全部组件都是气候意义上的湖泊。`git diff --check` 通过。

2026-11-08 M1.3A 代码、Core/Web 自动化和包级验证已完成；固定 Seed 多分辨率水文/T0 指标已归档。随后按视觉反馈将 H0 升为 v2 并把 L6 河道区域数减少 39–44%，Chrome 可见页面确认减密结果。Playwright headless E2E 因 Chrome 进程 SIGABRT 未能执行。基准仅证明算法确定性和约束检查，非全球水文气候学标定。

2026-11-04/05 的历史记录曾包含全仓检查通过、core 89/Web 28 项及 Chrome 4/4 回归、L8 规则/扰动生成拾取等。terrain-v20 历史基线不代表 terrain-v24 或当前 terrain-v25 逐值一致；terrain-v24 检查证据见 M1.3A 基准文件，v25 本次仅有高程统计诊断。

2026-11-06 曾进行 Seed 42/L8/扰动 0.75 的逐步生成及单项对照：低地在骨架时已存在，Finalizer 在该样本中提高中位数，关闭侵蚀对目标区域视觉改善有限。这些诊断促成后续映射修订，不是物理正确性、当前性能或多 Seed 验收。

仅保留有实测值的历史原始文件；其中机器、配置、版本、哈希和测量范围以文件为准：

| 原始记录 | 用途/限制 |
| --- | --- |
| [规则 Mesh](benchmarks/M0.3-mesh.json) | 原始几何/拓扑/查询采样 |
| [扰动 Mesh](benchmarks/M0.3-irregular-mesh.json) | Delaunay 与规则/扰动配置对照 |
| [Mesh Pipeline](benchmarks/M0.4-pipeline.json) | 首次生成与缓存命中，不是完整自然链 |
| [地质](benchmarks/M1.1A-geology.json) | 旧版本参考/输出投影采样 |
| [地形](benchmarks/M1.1B-terrain.json) | 旧算法的地形分布与生成采样 |
| [依赖读取性能修复](benchmarks/M1.1B-terrain-performance-fix.json) | 旧版本 L7 的工作副本与数组哈希对照 |
| [L8 距离精度修复](benchmarks/M1.1B-l8-distance-fix.json) | 距离代价 Float32 统一后的规则/扰动 L8 及浏览器采样 |

数组字节与阶段后 RSS 采样都不是峰值内存；不将历史秒数外推为当前配置保证。

## 本次修复与验证

### 2026-11-13：风场、洋流、河网与图层图例统计

- 风场专题改为按估算风速着色，并叠加稀疏方向箭头；洋流专题以流速渐变着色，叠加蓝—白—红冷暖箭头。箭头从当前月份环流场采样，随月份切换更新；保持显示层只读，不更改气候产物。
- 河网专题改为从水文河道段构建球面河道带，按累积流量调整宽度、按 Strahler 级序着色，并保留海陆底图；河道仍沿 mesh 区域中心近似，没有参考实现的地形高程贴合、GIS 线数据与材质模板。
- 图层面板恢复“图例统计”卡片，显示当前专题各分级的颜色、单元数、占比与可用面积，并显示专题摘要；月气候和循环专题随当前月份更新。统计现覆盖当前可选专题；影像专题按海陆汇总，连续场按分级汇总。
- 本次未运行 test、build、lint、typecheck，也未做浏览器目视或帧率检查；高细分等级下矢量/河道覆盖几何开销尚未实测。

### 2026-11-13：参数提示与经纬网格显示

- 参数面板中的生成选择、网格、地质、地形、气候和水文参数均加入问号图标 tooltip；自由输入的随机种子和最小河道汇水面积使用相同提示样式。提示按当前实现描述目标数、范围及模型近似限制。
- 从生成选项、参数分组、就绪状态和相关说明中移除 T0/C0/I0/H0/E0 阶段缩写，保留面向用户的自然语言名称；同步调整现有浏览器用例中的文案选择器，未运行这些用例。
- 顶栏“显示”新增“经纬网格”开关，绘制 15° 间隔的球面经纬线，使用独立可见图层，不改变世界数据。此次未运行 test、build、lint、typecheck，也未进行浏览器目视检查。

### 2026-11-12：主界面 HUD 精简

- 从主视图移除专题图例与要素分布统计面板、底部操作提示、重置视角按钮、移动端横屏提示、未接入的 2D/分享占位项和应用品牌/GitHub 底栏；参数、图层、区域检查、生成状态与生成操作仍保留。侧边面板现在延伸至距视口底边 1rem 的位置。
- 清理了重置按钮和图例统计面板对应的 `AppUI`/`WorldView` 参数及事件连接，并移除主视图中 debug 命名。当前未运行测试、构建、lint 或 typecheck。
- “生成内容”使用项目内置 `Select.svelte`；细分等级改为范围 L4–L8、step=1 的滑块，当前固定 Voronoi 渲染。
- 参数面板已移除“可视化模式”和“海平面基准”控件（固定使用 Voronoi 与 0 km 基准）；Header 下方的生成状态文字已移除。WebGL 渲染改为完整使用 `window.devicePixelRatio`，高等级不再降采样；未运行测试、构建、lint 或 typecheck。
- 顶栏“随机”现在生成新 Seed 后立即执行生成；本次未运行测试、构建、lint 或 typecheck。
- 新增“卫星影像”底图专题，沿用参考项目的连续干湿/温度、海水深浅、雪线与裸岩配色；生成 T0 后默认显示该层。参考项目的地形纹理与阴影字段当前 T0 artifact 未提供，因此此版不生成对应纹理和地形阴影；未运行测试、构建、lint 或 typecheck。

### 2026-11-12：主应用正式命名

- 将 `src/debug/` 迁移为 `src/world-view/`，入口组件改名为 `WorldView.svelte`，渲染/专题模块及类型移除 `Debug` 命名；Web 主路由和浏览器用例统一使用根路径 `/`。
- 本次只调整应用入口、命名和文案，不改变渲染算法、数据契约或 Cartography 包状态；正式地图样式仍未接入。未运行测试、构建、lint 或 typecheck。

### 2026-11-10：参考 UI 迁移

- 按参考项目技术栈和目录接入 `apps/web/src/ui/{components,hud,state}`、`AppUI.svelte` 与主题样式；保留参考项目的 HUD/面板结构、配色、控件和图标风格，将参数生成、图层选择、进度/取消、区域检查与当前 WorldView/Worker 状态连接。`docs/old-src` 仅作只读参考。
- Web 根入口改为始终挂载迁移后的工作台；`WorldView.svelte` 作为现有网格、生成流程和专题渲染宿主。没有实现底层尚未提供的正式制图样式、文明生成或分享功能，相关入口仍禁用或明确标记未迁移。
- 修复 Checkbox 多实例 ID 重复；Loading 接收工作台真实状态与取消回调；阶段缓存输出保留可读分隔。`ecology.ts` 仅增加显式 Map 类型标注以通过严格类型检查，不改变算法行为。
- 完整 Playwright 真实 Chrome 回归：10/10 通过（首次打开默认自动生成、Worker 生成/缓存/取消/失败恢复、Geology、Terrain、C0、I0/H0、L1、E0 解耦、L8）。Web 单测 33/33，Core 单测 130/130；全仓 typecheck/build、Web lint 及 `git diff --check` 均通过。默认值回归实际生成 L7/163,842 区域，确认 Seed 1024、扰动 0.75、倾角 23.5°、降水倍率 1.8。浏览器测试使用安装的 Chrome。
- 全仓 `pnpm typecheck`、`pnpm build` 通过。全仓 `pnpm lint` 当前未通过，Core 报 32 项既有格式问题，涉及生态基准脚本、`ecology.ts` 和 Core 出口；通过对照 HEAD 确认 `ecology.ts` 的 9 项 lint 问题在本轮之前已存在。未对算法代码作批量格式化；本次受影响的 Web lint 通过。
- Web build 仍有约 883 kB minified 主 JS chunk 超过 500 kB 提示；本轮未拆包或做内存/帧率基准。UI 已完成迁入和当前工作台集成，不代表 M1 算法、E0 形态、正式 Atlas 或浏览器项目存档完成。`?autogenerate=0` 保留给手动 Worker 回归使用。

### 2026-11-08：M1.4 E0 实现与旧分类器对照（整体验收未完成）

- 新增 `world-data` 自然生物群系与土地覆盖稳定 ID 定义；`world-core` 的 `ecology-e0-v2` 生成潜在群系、自然覆盖、干旱指数与生长季，直接依赖 Mesh/T0/C0。移除 L1 湖泊输入和 Freshwater 分类；全部陆地网格（包括湖泊成员与河道区）均按气候/地形分类。C0/Köppen 在上游生成，不读取 H0/L1。
- Web 协议、Worker 独立副本传输、Controller 验证和主应用专题/区域查询已接入；专题仍沿用旧版 `BIOME_COLORS`，自然覆盖使用相应群系色的合并/代表色。E0 请求不生成或返回 I0/H0/L1；河网和湖泊保留水文请求的独立专题。页面标注 E0 实验状态及水文分类边界。
- 专项基准 `pnpm --filter @another-earth/world-core bench:ecology-legacy` 已完成 Seed 42/L6 同输入回放：比较旧版日历日加权分类器和 `ecology-e0-v2`，覆盖全部 12,607 个陆地区域，类别差异为 0；生成计划不含 I0/H0/L1（`hydrologyStagesPlanned: false`）。年均温（当前等时长分箱减旧日历日加权）差值均值 -0.00082°C、范围 -0.0756–0.0869°C；PET 相对差值（当前减旧）均值 -0.0183%、范围 -1.81%–2.30%；年降水总量完全相同。结果见[旧分类器对照](benchmarks/M1.4-E0-legacy-comparison.json)。该对照不运行旧版气候生成器，不比较旧/新 C0 场差异，也不能证明空间分类形态正确。
- 专项回放通过；当时未运行 Core/Web 单元测试、浏览器验证、lint、typecheck、build 或 `git diff --check`。该历史状态已由 2026-11-10 记录的当前回归覆盖，但不表示 E0 算法与最终输入已完成验收。
- E0 使用初步 C0/T0，未实现最终 C1、完整自然快照、Schema 变化或档案发布；不因图形反馈调整分类阈值或配色。后续需在固定 Seed 下比较旧/新气候场，再判断剩余空间纹理差异；不宣称完整 M1.4 验收完成。

2026-11-06：修正 `world-core` 的 package subpath imports，使跨包 TypeScript 解析指向明确的 `.ts` 文件及目录 `index.ts`；修正 terrain finalizer 测试桩的显式类型断言，更新 Worker 浏览器用例以检查当前实际提供的专题，并清理受影响源码、测试及基准脚本的 lint 问题。随后将 StageCache 默认值从 128 MiB 提高至 512 MiB，并加入 L8 Worker 缓存回归。未修改地形算法、公开世界契约或生成 Stage 版本。

本轮实测：core 113/113、Web 28/28 单测通过；全仓 `pnpm typecheck`、`pnpm build`、`pnpm lint` 通过；真实 Chrome Worker 回归 5/5 通过，新增 L8 首次生成后第二次请求 `Cache Hit`（浏览器回归在受限环境外完成）；`git diff --check` 通过。Web 构建仍提示 `MeshDebug` chunk 大于 500 kB，尚无性能结论。

terrain-v20 验收基准：L4/L6/L8 × Seed 42/314159/8675309 均通过强制重算哈希一致性；L6 在 roughness 0.1/0.4/0.5 与 seaLevelDatumKm -0.5/+0.5 样本也通过，粗糙度变化只重算 terrain。海平面提高时陆地比例下降，降低时上升。L8 在 3 个 Seed 中海陆覆盖为 31.6%–32.5%，高程范围约 -4.6–6.5 km。512 MiB StageCache 使 L8 11/11 Stage 全部命中，粗糙度变化仅重算 terrain。所有详情、哈希和耗时见[验收基准](benchmarks/M1.1B-terrain-v20-acceptance.json)。基准没有测峰值 RSS，设备端长期内存压力需后续验证。

## 先前代码整理与重构

2026-11-06：
- 将标量数学工具函数（`clamp`、`smoothstep`、`gaussian`）由私有路径 `packages/world-core/src/nature/geology/math.ts` 迁移至通用数学模块 `packages/world-core/src/math/math.ts`，并在 `packages/world-core/src/index.ts` 统一重导出。
- 为三个核心子包（`world-core`、`world-data`、`cartography`）配置 Subpath Imports 路径别名。`world-core` 的初始 `"#*": "./src/*"` 映射在跨包类型检查中无法解析无扩展名目标，本轮已改为 `.ts` 目标及四个目录入口的显式映射；其余两包当前无 `#` 内部导入。
- 按照方案二重构 `@nature` 目录代码结构，保持零业务逻辑与计算结果变更：
  - 新建 `nature/common/`，将共用的算法网格桥接（`algorithm-mesh.ts`）、球面距离场（`distance-field.ts`）与优先队列（`priority-queue.ts`）抽离至公共基建层，并提供 `common/index.ts` 聚合出口，彻底消除 `geography` 反向借用 `geology` 底层实现的架构异味。
  - `nature/geology/` 分层划分：板块模拟与动力学收敛至 `plates/`；地壳、构造动力与高程骨架收敛至 `tectonics/`；根目录保留产物契约与校验，建立 `geology/index.ts`。
  - `nature/geography/` 分层划分：表面纹理、后处理编排与整形收敛至 `terrain/`；根目录保留高程物理单位与产物契约，建立 `geography/index.ts`。
- 将所有生成相关代码收敛至 `packages/world-core/src/generation/` 统一管理，并按形式二解耦管线调度引擎与具体阶段：
  - `generation/pipeline/`：纯粹的流水线调度引擎与基础工具（核心调度引擎直接作为 `index.ts`，配合 `copy-dependency.ts`、`errors.ts` 及各测试，不设立无业务逻辑的重导出中间层）。
  - 新增 `generation/stages/`：具体生成阶段实现与集成封装（`mesh-stage.ts`、`geology-stage.ts`、`terrain-stage.ts` 及相应测试，各 Stage 按需直引，不设立冗余的重导出出口）。
  - 将 `src/nature/` 移动至 `src/generation/nature/`，将 `src/civilization/` 移动至 `src/generation/civilization/`。
  - 规范 `package.json` 与 `tsconfig.json` 的别名配置；生成模块使用 `#generation/pipeline`、`#generation/stages/*`、`#generation/nature/*` 与 `#generation/civilization/*` 等内部导入。当前 `world-core` 的实际 `package.json` 映射以本轮修复为准。
  - 同步更新下游消费者导入、`src/index.ts` 导出以及 [技术设计](TECHNICAL_DESIGN.md) 目录树与章节说明。
- 为通用数学工具补充针对性单元测试 `packages/world-core/src/math/math.test.ts`，覆盖区间截断、退化 Hermite 插值与高斯衰减边界。
- 当轮验证状态：只执行 `git status` 与 `git diff` 核对修改范围；当时未运行 `build`、`lint`、`test`、`typecheck` 或浏览器验证。本轮授权后的检查结果见上文。

### 2026-11-07：M1.2 C0 验收

- `pnpm --filter @another-earth/world-core test`：18 个测试文件通过，121/121 项通过；`pnpm --filter @another-earth/web test`：30/30 项通过。
- core/Web lint、typecheck 与 build 均通过。Web build 成功，同时提示 `MeshDebug` chunk 压缩前约 587 KiB，超过 500 KiB 建议阈值。
- 真实 Chrome `pnpm --filter @another-earth/web test:browser`：6/6 通过，包括 C0 月气候/环流/缓存、失败保留有效 Mesh、取消恢复、Geology、Terrain 与 L8 Worker 缓存。
- 气候性能矩阵 9/9 通过并保存于[基准记录](benchmarks/M1.2-climate-c0-acceptance.json)；基准包含算法哈希、冷/命中/变更/强制生成耗时和缓存字节。未测进程峰值 RSS。
- `git diff --check` 通过。当前验收未包含视觉形态人工审阅或地球气候学标定；C0 不替代 M1.3 水文/冰雪、侵蚀后的 C1 或完整 WorldSnapshot。

## 历史文档整理记录

保留 PRD、技术设计、世界数据契约、生成管线、当前进度和 M1 实施计划六份主文档。合并网格/调试器/地质地形接口和当前决策，删除小阶段流水、被取代 ADR、空测量基线及过期临时诊断文件。参考源码 docs/old-src 保持只读。有实测数据的历史基准保留；旧轮次未运行的检查没有被改写成通过。

本次仅整理文档与文档引用，不修改生成行为。已检查 57 个本地 Markdown 链接及其章节锚点，无失效项；`git diff --check` 通过。PRD 与参考源码未修改。本次未运行 build/lint/test/typecheck 或浏览器验证。
