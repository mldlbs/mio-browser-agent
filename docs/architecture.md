# ⚙️ mio-browser-agent 架构设计（冻结版）

> Contract-Driven Agent Runtime — 浏览器是第一个 Provider，而非架构核心。Runtime 不依赖任何具体平台、LLM 或工具。

> 📄 本文档冻结自 DeepSeek 架构评审（2026-08），含现状差距分析与分阶段落地路线。代码改造按路线执行，当前为参考规范。

---

## 🎯 项目定位

| 维度 | 结论 |
|------|------|
| 定位 | Contract-Driven Agent Runtime |
| 当前阶段 | 浏览器为唯一 Provider |
| 演进方向 | desktop / api Provider 可插拔 |
| 核心资产 | 契约 + Runtime，非浏览器适配 |

---

## 🧠 架构原则

1. **契约优先**：所有模块依赖 Schema，不依赖具体实现
2. **事件驱动**：模块间经 EventBus 通信，RPC 仅用于 Capability 的 `act()`
3. **平台无关**：Runtime 不引用 `chrome.*` / `fs` / `http` 等平台 API
4. **模型无关**：Planner 经 Contract 与 LLM 交互，不绑定 OpenAI / Claude / Gemini
5. **可观测性内建**：所有关键节点发布 Event，供 Metrics / Tracing / Replay
6. **唯一依赖是契约**：Runtime 永远不依赖具体平台、LLM、工具

---

## 📦 七个核心对象

| 对象 | 职责 | 平台相关 |
|------|------|----------|
| **Task** | 用户目标与约束 | 否 |
| **Action** | 可执行动作序列（Planner 输出） | 否 |
| **Observation** | 环境事实（统一 Schema） | 否 |
| **Expectation** | 成功/失败判定（声明式） | 否 |
| **EvaluationResult** | 统一返回值 | 否 |
| **Capability** | 平台交互（`observe()` / `act()`） | **是** |
| **Memory** | 策略、状态、Checkpoint、置信度衰减 | 否 |

> 💡 Intent 作为 Metadata 存于 ExecutionPlan，供 Trace / Metrics / Procedural Memory 使用，Runtime 不解析。

---

## 🗂️ 目录结构

```text
mio-browser-agent/
├── contracts/                      # 唯一真相
│   └── v1/
│       ├── planner.schema.json
│       ├── observation.schema.json
│       ├── expectation.schema.json
│       ├── evaluation.schema.json
│       ├── capability.schema.json
│       ├── recovery.schema.json
│       └── event.schema.json
│
├── runtime/
│   ├── scheduler/                  # 队列/超时/优先级/取消
│   ├── executor/                   # 执行 Action + 调用 Capability
│   ├── expectation_evaluator/      # 纯函数：Observation → EvaluationResult
│   ├── recovery/                   # EvaluationResult → 修正动作
│   ├── memory/                     # Checkpoint / Procedural / 置信度衰减
│   └── event_bus/                  # 模块间通信
│
├── providers/
│   └── interaction/
│       ├── browser/                # BrowserProvider（首个实现）
│       ├── desktop/                # 未来
│       └── api/                    # 未来
│
├── planner/                        # LLM 交互层，产出 ExecutionPlan
│   ├── prompts/
│   └── adapters/                   # OpenAI/Claude/Gemini 适配器
│
├── tools/                          # 辅助工具（独立于 Runtime）
│   ├── schema_gen/                 # JSON Schema → TS Type / Prompt / Doc
│   ├── trace_viewer/
│   └── replay/
│
└── tests/
    ├── unit/
    ├── integration/
    └── contracts/                  # Schema 合规测试
```

---

## 🔌 核心接口定义（Schema 驱动）

### Planner Contract（唯一入口）

```typescript
interface ExecutionPlan {
  id: string;
  taskId: string;
  intent?: string;                  // Metadata，Runtime 忽略
  actions: Action[];
  expectations: Expectation[];
  metadata: Record<string, unknown>;
  version: "v1";
}

interface Action {
  id: string;
  type: "click" | "type" | "scroll" | "navigate" | "wait" | "extract" | "paste" | "tab";
  arguments: Record<string, unknown>;
  dependsOn?: string[];
}
```

### Observation Schema（统一且稳定）

```typescript
interface Observation {
  page: { url: string; title: string; readyState: "loading" | "interactive" | "complete" };
  dom: {
    elements: ElementSnapshot[];    // 可交互元素（Role/Text/BBox/Selector）
    semanticIndex?: SemanticIndex;  // 可选，加速后续定位
  };
  network: {
    pendingRequests: number;
    recentResponses: ResponseSummary[];
  };
  visual?: {
    screenshot?: string;            // Base64，仅 Vision 场景
    ocr?: string[];
  };
  dialogs: {
    open: boolean;
    type?: "alert" | "confirm" | "prompt";
    message?: string;
  };
  storage: {
    cookies: Record<string, string>;        // 关键 Cookie 摘要
    localStorage: Record<string, string>;   // 仅指定 keys
  };
  metadata: { timestamp: number; tabId?: string; frameId?: string };
}
```

### Expectation Schema（声明式）

```typescript
interface Expectation {
  id: string;
  type: "success" | "failure";
  condition: Condition;
  timeoutMs?: number;
  weight?: number;                  // 多条件加权
}

type Condition =
  | { signal: "url_changed"; pattern?: string }
  | { signal: "element_visible"; selector: string; timeoutMs?: number }
  | { signal: "element_hidden"; selector: string }
  | { signal: "toast"; text?: string; timeoutMs?: number }
  | { signal: "network_idle"; timeoutMs?: number }
  | { signal: "dialog"; type?: "alert" | "confirm" | "prompt"; message?: string }
  | { signal: "navigation"; url?: string }
  | { signal: "custom"; evaluator: string };  // 注册表引用
```

### Capability Interface（平台唯一接口）

```typescript
interface Capability {
  observe(): Promise<Observation>;
  act(action: Action): Promise<ActionResult>;
}

interface ActionResult {
  success: boolean;
  error?: string;
  data?: unknown;
}
```

### EvaluationResult（Runtime 统一返回值）

```typescript
interface EvaluationResult {
  success: boolean;
  confidence: number;              // 0-100
  observations: Observation[];
  matchedExpectations: string[];    // Expectation IDs
  failedExpectations: string[];
  diagnostics: Diagnostic[];
  requiredActions?: Action[];       // Recovery 输出
}
```

### Event Schema（EventBus 通信）

```typescript
type RuntimeEvent =
  | { type: "task_started"; taskId: string }
  | { type: "task_finished"; taskId: string; result: EvaluationResult }
  | { type: "action_started"; actionId: string }
  | { type: "action_finished"; actionId: string; result: ActionResult }
  | { type: "expectation_evaluated"; expectationId: string; result: EvaluationResult }
  | { type: "recovery_triggered"; actionId: string; reason: string }
  | { type: "observation_updated"; observation: Observation };
```

---

## 🧩 Runtime 模块职责

| 模块 | 输入 | 输出 | 依赖 |
|------|------|------|------|
| **Scheduler** | Task, ExecutionPlan | Action 执行顺序 | EventBus |
| **Executor** | Action, Capability | ActionResult | Capability, EventBus |
| **ExpectationEvaluator** | Observation, Expectation | EvaluationResult | EventBus, Registry |
| **Recovery** | EvaluationResult | Action[]（修正动作） | Memory, EventBus |
| **Memory** | Checkpoint/策略/置信度 | 读写接口 | 无 |
| **EventBus** | Event | 异步分发 | 无 |

---

## 🔄 关键流程

### 主执行循环

```text
Task → Planner → ExecutionPlan → Scheduler
  │
  ├─→ Executor.act() → Capability.act() → ActionResult
  │
  ├─→ Capability.observe() → Observation → EventBus
  │
  ├─→ ExpectationEvaluator.evaluate(Observation, Expectation) → EvaluationResult
  │
  ├─→ 成功 → 继续下一个 Action
  │
  └─→ 失败 → Recovery.recover(EvaluationResult) → 修正 Action → 重试 / 放弃
```

### Recovery 策略（分层预算）

| 层级 | 触发条件 | 动作 |
|------|----------|------|
| L1（轻量） | 定位失败（Element Not Found） | 重新快照 + 语义定位 |
| L2（滚动） | 元素不在视口 | 滚动到目标附近 + 重试 |
| L3（语义） | 定位器漂移 | 更新指纹 + 语义匹配 |
| L4（Vision） | 以上全部失败 | 截图 + 视觉 LLM 确认可见性 |
| L5（放弃） | 预算耗尽 | 标记任务失败，触发重新规划 |

### 置信度衰减（Procedural Memory）

```text
策略存储：
  key: intent + pageFingerprint
  value: {
    actions: Action[],
    confidence: number,          // 初始 0.5
    history: number[]            // 最近 10 次执行结果（0/1）
  }

更新：
  新置信度 = 0.7 * 旧置信度 + 0.3 * 最近执行结果
  若置信度 < 0.3 → 删除策略
  若置信度 > 0.9 → 直接复用，跳过 Planner
```

---

## 🛠️ 工具集（独立于 Runtime）

| 工具 | 职责 |
|------|------|
| `click` | 点击元素 |
| `type` | 输入文本 |
| `scroll` | 滚动到目标 |
| `navigate` | 跳转 URL |
| `wait` | 等待指定时间或条件 |
| `extract_text` | 提取页面文本 |
| `paste` | 粘贴剪贴板内容 |
| `tab` | 切换/管理标签页 |

---

## 🧊 协议冻结策略

| 协议 | 位置 | 冻结说明 |
|------|------|----------|
| Planner Contract | `contracts/v1/planner.schema.json` | 新增字段放 metadata |
| Observation Schema | `contracts/v1/observation.schema.json` | 可选字段，缺失置空 |
| Expectation Schema | `contracts/v1/expectation.schema.json` | 新 Signal 经注册表注册 |
| Evaluation Result | `contracts/v1/evaluation.schema.json` | 新增字段放 diagnostics |
| Recovery Contract | `contracts/v1/recovery.schema.json` | 输入 EvaluationResult，输出 Action[] |
| Capability Interface | `contracts/v1/capability.schema.json` | observe/act 仅此两方法 |
| Event Schema | `contracts/v1/event.schema.json` | 新增事件经扩展，不改已定义 |

---

## 🔄 兼容性策略

- 版本管理：`contracts/v1/`、`contracts/v2/` 并存
- Runtime 主版本号与 Contract 主版本号绑定
- 适配器：仅在引入 v2 且 v1 有实际使用者时实现
- 废弃周期：v1 支持至少 6 个月后进入维护模式

---

## 📊 现状差距分析（当前代码 vs 冻结架构）

> 结论：核心概念已隐含存在，但均未 Schema 化、未解耦平台、无事件分发。

### 已隐含对齐

| 规范对象 | 现状代码 | 差距 |
|----------|----------|------|
| Action | `sidepanel/executor.js` 8 工具（click/type/scroll/navigate/wait/extract_text/paste/tab） | 工具名对齐，无 `dependsOn`/`id` 契约 |
| Observation | `content/snapshot.js`（url/title/elements） | 缺 readyState/network/dialogs/storage/semanticIndex 统一 Schema |
| Recovery 分层 | `sidepanel/recovery-policy.js` L1-L5 | 已对齐 §Recovery 分层，未 Schema 化 |
| EvaluationResult | `sidepanel/recovery-result.js`（success/confidence/actions） | 字段对齐，含 `requiredActions` 形态 |
| Task/Planner | `sidepanel/planner.js` + `turn-handler.js` | 契约内嵌在 prompt，非 Schema 驱动 |

### 真实缺口（需新建）

| 缺口 | 现状 | 目标 |
|------|------|------|
| `contracts/v1/*.schema.json` | 无任何 JSON Schema、无 RFC/版本化 | 7 个契约文件 + 合规测试 |
| Capability 边界 | `sidepanel/bridge.js` + `content/*` 直接耦合 chrome 消息协议 | 独立 `providers/interaction/browser`，Runtime 只依赖接口 |
| EventBus | 同步 turn-loop（`turn-handler.js`） | 异步事件分发 |
| Memory | `memory.js` 仅上下文记忆 | 加 Checkpoint / Procedural / 置信度衰减 |
| Scheduler | 顺序 turn 循环 | 超时 / 优先级 / 取消 |
| `tools/schema_gen` | 无 | JSON Schema → TS Type / Prompt / Doc |

---

## 🚀 落地路线（按收益/工作量排序）

| 阶段 | 模块 | 收益 | 工作量 | 风险 | 状态 |
|------|------|------|--------|------|------|
| **Phase A** | 冻结 Planner Contract + Observation Schema | 极高 | 1-2 周 | 低 | ⏳ 待启动 |
| **Phase A** | Runtime 与 Browser 解耦（Capability 接口） | 极高 | 2-3 周 | 中 | 待启动 |
| **Phase B** | 引入 Expectation + Evaluator | 极高 | 2-3 周 | 低 | 待启动 |
| **Phase B** | EventBus + 事件驱动重构 | 高 | 2-3 周 | 中 | 待启动 |
| **Phase C** | Procedural Memory（策略缓存 + 置信度衰减） | 高 | 1-2 周 | 中 | 待启动 |
| **Phase C** | Scheduler（超时/取消/优先级） | 高 | 2 周 | 中 | 待启动 |
| — | Semantic Index 增量更新 | 中 | 2-3 周 | 高 | 延后 |
| — | Vision 再增强 | 中 | 2-3 周 | 低 | 延后 |
| — | Compatibility Layer | 低 | 2 周 | 低（非必要） | 延后 |

### Phase A 说明（先启动，零回归）

> 💡 只新增 `contracts/v1/` Schema + 合规测试，把现有 `planner.js` prompt 输出、`snapshot.js` 快照结构、`recovery-result.js` 返回值**显式绑定**到 Schema，不改运行时行为。

1. 新建 `contracts/v1/` 下 7 个 JSON Schema
2. `tests/contracts/` 编写合规测试：prompt 示例 / 真实快照 / recovery 返回值逐一校验 Schema
3. 输出 `tools/schema_gen` 最小版：JSON Schema → JSDoc/TS 类型，消除 prompt 与代码间的类型漂移

---

## 🏁 最终架构图

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                         Task（用户目标）                                 │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    Planner（LLM 交互层）                                 │
│                   输出 ExecutionPlan（Action + Expectation + Intent）     │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         Runtime Core                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  Scheduler  │→│  Executor   │→│  Recovery   │  │   Memory    │   │
│  │ 超时/队列    │  │ 执行 Action │  │ 失败恢复    │  │ 策略/状态   │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
│         │               │                │               │              │
│         └───────────────┼────────────────┴───────────────┘              │
│                         │                                               │
│                  ┌──────▼──────┐        ┌──────────────────────────┐   │
│                  │  EventBus   │────────│ ExpectationEvaluator    │   │
│                  │  异步通信    │        │ 声明式断言引擎           │   │
│                  └──────┬──────┘        └──────────────────────────┘   │
└─────────────────────────┼────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    Capability Interface（唯一平台边界）                    │
│                       observe() / act()                                  │
└──────────────────────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  BrowserProvider │ │ DesktopProvider │ │   APIProvider   │
│  (当前实现)       │ │  (未来)          │ │  (未来)          │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## ✅ 结论

冻结协议、Schema 驱动、事件架构是最高优先级的基础设施债务。浏览器已成为插件，Runtime 才是真正的产品。

**先启动 Phase A**：冻结 Planner Contract + Observation Schema，零回归收益最高。
