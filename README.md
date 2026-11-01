# PLATO 软件工厂 Runtime 插件

把自然语言需求转换为 UML 活动图，交付 PlantUML 源码与 PNG，并保留分析过程。实际工具 ID 为 `sf_plato_activity`。仅提供后端插件，复用 DSH 的聊天、Runtime 与可选 WebUI；无需启动 PLATO 原有网页或 FastAPI 服务。

## 1. 接入范围与限制

- 保留 PLATO 的活动识别、结构分解、信息整合、生成与修复流程及原提示词/示例。源码基线 bf36c90fa1ebebe762ebe6046006fa739c153218；复制文件清单及 SHA256 在源码包的 python/source-manifest.json 中。
- 本版本固定活动图；可选 fastcoref/CoreNLP 关闭，不等于论文完整环境。原有层数、重试与终止规则保留；达到分解上限会告警，不能据此声称需求完整。
- 模型只通过 `execution.model.call()` 调用。SDK 0.1.0 的 ModelRequest 仅有 messages，无法逐次传 temperature；使用 DSH 采样配置，与原代码各阶段温度不完全一致，每次任务都会告警。没有虚构温度接口。
- 模型/API 错误、空响应、无效 UML、渲染失败均失败退出，不把错误文本当正常产物。
- 当前只验证 Windows、Python 3.12.7、Node.js 24.22.1 和模拟模型。真实模型效果、Linux/macOS 和浏览器下载点击尚未验证。

## 2. 服务端环境

| 依赖 | 要求 |
|---|---|
| DSH | 0.2.1-alpha.2；不绕过宿主版本检查安装到 rc.5 |
| Runtime | @software-factory/runtime 0.1.0，已启用 |
| Node.js | 24+ |
| Python | 已验证 3.12.7，使用独立虚拟环境 |
| Python 库 | python/requirements.txt 的 httpx、PyYAML |
| Java / PlantUML | 单独准备兼容的 Java 与 PlantUML JAR，配置绝对路径；本机验证 Java 8 + plantuml-java8-1.2026.9.jar |
| DSH 原生服务 | tools、sfRuntime、subprocess；本机已有 subprocess-local |
| 模型 | DSH 中配置可用的文本模型；开发者无需获取或转交 API Key |

Python/JAR 都运行在 DSH 服务端。浏览器电脑的文件路径不能代替服务端路径。JAR 可按 [PlantUML 官方说明](https://plantuml.com/download) 获取兼容版本；不要跨电脑复制 `.venv`。

## 3. 新电脑安装

1. 下载 `software-factory-plato-0.1.0.zip`，解压到长期保留目录。安装目录内应有 package.json、lib、python 和 cordis.patch.yml。也提供 TGZ，内容相同。
2. 在该目录准备 Python 环境（以下为 Windows 示例）：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r python/requirements.txt
```

3. 在 DSH 插件管理添加这个包含 package.json 的本地目录。SDK 已随包内嵌，不用另装 SDK 服务；宿主安装器仍可能下载/解析 peer 依赖，不承诺离线安装。
4. 先启用 Runtime，再启用 PLATO 组合包和 `sf-plato` 条目。在 PLATO 配置中填写：

```yaml
pythonPath: D:\DSH-Plugins\plato\.venv\Scripts\python.exe
javaPath: java
plantumlJarPath: D:\Tools\PlantUML\plantuml.jar
startupTimeoutMs: 30000
```

这些路径是示例，必须换成服务端实际文件。pythonPath 和 javaPath 可使用 PATH 中的命令名，生产环境推荐绝对路径。plantumlJarPath 必须是绝对路径；它是必填配置。

5. 按宿主提示重启。刷新网页不能替代重启后端；保留本地安装目录。选择一个真实工作区并建立会话，配置实际文本模型。

## 4. 实际调用

先让模型调用 `sf_runtime_get_tool_contract`：

```json
{"toolId":"sf_plato_activity"}
```

确认返回 requirement_text 后，通过 `sf_runtime_run_tool` 启动：

```json
{
  "toolId": "sf_plato_activity",
  "input": {
    "requirement_text": "Check inventory. If in stock, ship the order. Otherwise notify the customer."
  }
}
```

输入是对象；requirement_text 必须是非空字符串，不接受 diagram_type、输出目录、API Key 等额外参数。首个响应是 queued 和 runId，不是最终图片。使用 `sf_runtime_get_run` 或 `sf_runtime_wait_run` 查询，最终状态应为 completed。

模型可继承来源会话；也可在启动请求顶层指定 `model: {provider, model}`，使用 DSH 目录里的真实 ID，不放入 input。真实调用可能消耗模型额度。

不要直接调用 sf_plato_activity 绕过 Run：SDK 会拒绝缺少真实 Run 上下文的执行。

## 5. 进度、结果和取消

真实阶段依次为准备、识别活动、分析控制结构、整合信息、生成 PlantUML、渲染 PNG。未知准确百分比时只报阶段，不伪造进度。

```text
<workspace>/outputs/runs/<runId>/
├── input/request.json                 # Runtime 保存的输入
├── input/plato-request.json           # 算法实际输入
├── intermediate/identification.json   # 活动列表
├── intermediate/decomposition.txt    # 结构分解
├── intermediate/integration.txt      # 信息整合
├── snapshots/model-*-request.json    # 原模型消息及原始温度记录
├── snapshots/model-*-response.json   # 回答及用量（若模型提供）
├── final/activity.puml
├── final/activity.png
└── run.json                          # Runtime 权威状态与日志
```

文件实际生成后通过 addArtifact 登记，最终返回本任务的 artifactId。使用 `sf_runtime_get_artifact` 的 `{runId,artifactId}` 获取认证下载引用；配套 WebUI 可显示下载入口。链接需要登录与工作区授权。不要把本地路径当下载 URL。

取消调用 `sf_runtime_cancel_run`，传 `{runId}`。DSH 受管进程接口停止本次 Python/Java 进程范围，清理回调等待退出；失败和取消保留已产生的材料，只完成的任务有最终结果。插件停用也会撤销入口并停止相关任务。不提供暂停或断点恢复。

此插件是可信后端：检查任务路径并使用 DSH 进程托管，但未额外施加操作系统文件沙箱；托管进程不等于任意 Python 代码的文件隔离。未提权，也未更改系统 ACL。

## 6. 开发与调试

源码含 TS 适配层、Python worker、原算法副本、SDK TGZ、配置和登记资料。

安装包仅包含运行文件与正式交付资料，不包含 .d.ts、SDK 教程/示例、SDK TGZ、开发脚本或源码散列清单。SDK 执行代码保持原字节内嵌；源码包保留完整 SDK TGZ 和开发依赖资料。以下命令在源码包目录执行。

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run debug -- --python <Python解释器绝对路径> --jar <PlantUML-JAR绝对路径>
npm.cmd run pack:plugin
```

debug 使用官方 DSH Agent 测试工具，走真实 Tool → Runtime → SDK → Python → Java 链，仅模型为本地合成响应，不访问付费服务。结果保存在 test-results/validation.json。测试专用 Runtime TGZ 位于源码的 test-runtime-cache，不进入运行安装包。

src/index.ts 登记工具；src/business.ts 实现 SDK 业务入口；src/python-bridge.ts 托管进程并转发 JSONL；python/worker.py 调用原算法并保存材料。lib 是编译输出。

`npm run prepare:python` 仅在需要同步算法副本时执行；默认读取相邻 PLATO，可通过 PLATO_SOURCE_ROOT 指定。同步会生成新的文件散列，应审阅算法差异。正常构建不依赖相邻 PLATO。

## 7. 常见错误

| 报错 | 处理 |
|---|---|
| 插件不兼容 | 核对 DSH alpha.2；不要把 peer 版本改成 rc.5 伪装兼容 |
| sfRuntime/subprocess 未就绪 | 启用 Runtime 和本地 subprocess 服务；核对安装 profile |
| PLATO_CONFIG_REQUIRED / 找不到解释器 | 配置服务端绝对路径，确认解释器环境已装 requirements |
| PLATO_STARTUP_TIMEOUT | 查看 Runtime 错误，确认 Python 能在本次工作区任务目录写入 |
| PLATO_MODEL_FAILED / MODEL_REQUIRED | 配置真实模型和凭据；模型返回错误不会静默换成 mock |
| PLATO_INVALID_UML / PLATO_RENDER_FAILED | 检查保留的源码、模型回答、Java/JAR 兼容性 |
| 取消后未结束 | 查看清理错误；只有受管范围退出才算清理完成 |

## 8. Agent 入库资料与交付

agent-registration.json 是给平台管理员的“工具介绍表”，说明 PLATO 的名称、用途、输入输出、运行条件和实际调用名。导师可用它在能力树目录中登记 PLATO，并把目录项对应到真实工具 sf_plato_activity。它不参与生成图，也不会自动写数据库。SDK README 第 8、10 节要求提供这类资料，建议单独保存 JSON。

agent-registration.json 按 SDK 的 agent / agentVersion.properties 格式提供。agent:plato-activity 是新 Agent 的建议标识，导师入库前应确认是否已有 PLATO 身份；不覆盖已有 Agent，不伪造数据库顶点 ID。业务版本与插件包版本独立。

SDK 登记入口不会自动写能力树。平台审核后保存资料，AgentVersion.dsh_ref 必须保持 sf_plato_activity。input_schema/output_schema 和 *_json 在写 HugeGraph TEXT 前由平台逐属性序列化。人员、治理启用状态、运行代价、效果和优选指标未知，均省略。当前证据只是合成集成测试，不是论文指标或真实模型准确率。

升级时保留业务 Tool 名称，先确认无活动任务，再更新安装包、按要求重启。

## 9. 验证记录

验证日期：2026-10-31。环境为 Windows、DSH 0.2.1-alpha.2、Runtime/SDK 0.1.0、Node.js 24.22.1、Python 3.12.7、Java 8 与兼容 PlantUML JAR。

使用官方 dsh-agent-loop-testkit 创建真实 Agent/Session 和工作区，通过 sf_runtime_run_tool 执行插件；未用直接调用业务函数代替正常 Run 链。以下检查已通过：

- Runtime 能发现 sf_plato_activity，取得真实输入规格；绕过 Run 直接调用会被 SDK 拒绝。
- 全空白输入在启动 Python 前失败。
- 实际运行 PLATO 的 Python 流程与 Java 渲染，生成有效的 PlantUML 和 PNG。
- 实际阶段、日志、分析材料及模型请求/回答快照可保存和查询；模型会话与主聊天隔离。
- 返回两个已登记的最终文件 ID，通过 getArtifact 取得认证下载引用。
- 模型错误使任务失败，不伪装为成功；取消时停止模型请求，并等待受管 Python 进程范围退出，保留已有材料。
- 停用插件后撤销入口。
- 精简 TGZ 在新目录安装后，完整集成检查再次通过；另通过 pnpm 安装及模块加载检查。
- 本机实际 web profile 已验证 Runtime、subprocess 服务与 PLATO 工具登记就绪。

**模型回答使用本地固定模拟数据，没有调用付费模型；Python、Java、任务管理和文件生成是真实执行。** 尚未验证真实模型效果、不同需求的语义正确性、浏览器点击下载、Linux/macOS 或论文指标。正式使用前应在目标宿主和真实模型上做一次小输入验收。

复现命令见第 6 节。本地机器可读记录为 test-results/validation.json，宿主登记检查记录为 test-results/profile-smoke.json；测试数据不进入交付包。

已知 SDK/宿主限制：模型请求不能逐次指定 temperature，任务会上报警告；Tool 参数规格不支持 minLength/pattern，非空白要求由业务函数落实；通用 Python 通信桥由本插件实现。可选 NLP 关闭。原算法修复后仍不合法的图源码会保留并使任务失败，这是新增的交付校验。

## 10. 第三方来源

- PLATO 算法和资源来自 [Ekay47/PLATO](https://github.com/Ekay47/PLATO)，保留其 MIT 许可于 python/plato/LICENSE；本地复制清单在源码包中。
- Runtime SDK 0.1.0 由平台维护者提供。安装包保留原始 SDK 执行代码；源码包 vendor 中保留完整原包。原包未声明 license 标识，公开再发布前应向维护者确认许可。
- DSH/Cordis/Schemastery 使用宿主提供的依赖。Python、Java、PlantUML JAR 及 Python 库按各自许可单独安装；交付包不包含虚拟环境、JAR 或凭据。
