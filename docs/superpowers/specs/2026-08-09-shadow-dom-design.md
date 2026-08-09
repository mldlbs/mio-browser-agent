# Shadow DOM 穿透完善 — 设计文档

日期：2026-08-09
范围：`content/snapshot.js`、`content/locator.js`、`content/executor.js`、新增 `content/shadow.js`、测试夹具与回归场景

## 背景与目标

mio 已有 open shadow root 穿透的骨架（快照递归 + shadowPath 定位），但存在三个局限：

1. **嵌套 shadow 定位失败**：`shadowPath` 用宿主 XPath（snapshot.js:235），`resolveShadowPath` 用 XPath `evaluate` 下钻（locator.js:19）；而 ShadowRoot 容器**没有 `evaluate` 方法**，shadow 套 shadow 的第二层即定位失败。
2. **shadowPath 不稳定**：宿主无 id 时是整条父链 tag 路径，动态页面易失效。
3. **动作层未覆盖 shadow**：`form_fill`（executor.js:314）、`extractPageText`（executor.js:424）、`waitForCondition`（executor.js:516）只扫 `document`，不进 open shadow root。

**目标场景**（用户确认，三项全选）：
- form_fill 穿透 shadow 表单（组件库注册/搜索表单批量填表）
- 嵌套 shadow 深层点击/输入
- 内容提取覆盖 shadow 文本

**明确不做**：closed shadow root 穿透（content script 无法访问 closed root 内部元素，技术上不可行）。保持跳过。

## 方案选择

- **方案 A（采用）**：shadowPath 改 cssPath 数组 + 统一 shadow 遍历工具。一次补齐三处局限，工具复用保证一致性。
- 方案 B（舍弃）：仅修 resolveShadowPath 用 querySelector 下钻，不动 form_fill/extract——不满足目标场景。
- 方案 C（舍弃）：composedPath 运行时自下而上穿透——对「收集所有控件」的批处理（form_fill）不适用，closed shadow 依旧无解。

## 设计

### 架构

新增独立模块 `content/shadow.js`，暴露统一工具：

```js
// 收集 document 下所有 open shadow root（含嵌套，visited 防重）
collectOpenShadowRoots() → ShadowRoot[]

// 对 doc + 每个 open shadow root 调用 visitFn(root)
walkShadowTree(doc, visitFn)

// 跨 shadow 找元素（含 form 控件收集、cssPath 定位）
findElementInShadows(selector, doc) → Element | null
```

三个消费方（snapshot / locator / executor）复用该工具，保证遍历语义一致。

### shadowPath 格式变更

| 项 | 旧 | 新 |
|---|---|---|
| 生成 | `buildXPath(host)`（snapshot.js:235） | `buildCssPath(host)` |
| 下钻 | `findByXPath`（XPath evaluate） | `findByCssPath`（querySelector） |
| 兼容性 | 快照每次动态生成，无持久化，无向后兼容问题 | 同上 |

`buildCssPath`（snapshot.js:153）已被刻意设计为「usable via querySelector on both documents and ShadowRoots」，是穿透定位的首选机制。cssPath 若以 `#id` 开头则 id 全局唯一，ShadowRoot 容器上 querySelector 仍有效。

### 数据流

```
快照:  scanRoot 递归 open shadow root（复用 collectOpenShadowRoots），元素带 cssPath 版 shadowPath
定位:  tools 按 index 取 target → bridge 按 frameId 路由 → locateElement
       → resolveTargetRoot（先 framePath 后 shadowPath，均 cssPath 语义）→ 真实节点
动作:  collectFormControls 用 shadow 工具收集控件（带 shadowPath 标记）
       extractPageText / waitForCondition 遍历 open shadow root
```

framePath 与 shadowPath 正交：`resolveFrameDoc` 先下钻 iframe，`resolveShadowPath` 再下钻 shadow，顺序固定互不影响。

### 各层改动

**content/shadow.js（新增）**
- `collectOpenShadowRoots(doc)`：遍历 `querySelectorAll("*")` 过滤 `shadowRoot.mode === "open"`，对每个 open root 递归，visited Set 防重
- `walkShadowTree(doc, visitFn)`：对 doc 及每个 open root 调用 visitFn
- `findElementInShadows(selector, doc)`：先查 doc，再查每个 open root 容器

**content/snapshot.js**
- scanRoot shadow 递归处（:235）`buildXPath(host)` → `buildCssPath(host)`
- shadow 递归收集改为复用 `collectOpenShadowRoots`
- 元素 `shadowPath` 字段名不变，值变为 cssPath 数组

**content/locator.js**
- `resolveShadowPath(root, shadowPath)`：`findByXPath` → `findByCssPath`，修复嵌套 shadow
- `findByName(role, name, doc)`、`findByRect(target, doc)`：从「只查 doc」扩展为「先查 doc，再查每个 open shadow root」——cssPath 定位失败后 fallback 到 role+name / rect 时，shadow 内元素仍可命中

**content/executor.js**
- `collectFormControls`：收集 document + 每个 open shadow root 内的控件，控件附带 `shadowPath`（所在 shadow 链 cssPath）
- `extractPageText`：追加收集每个 open shadow root 内文本（对齐现有 iframe 文本追加逻辑）
- `waitForCondition`：selector/text 匹配从 `document` 扩展到所有 open shadow root

### 错误处理与边界

- **closed shadow root**：有意跳过（快照与动作一致），content script 拿不到内部元素
- **嵌套 shadow（三层及以上）**：shadowPath 数组每层一个 cssPath，逐层下钻直到数组结束，层数不限
- **定位失败降级链**：cssPath → xpath（若存在）→ role+name（含 shadow 遍历）→ rect（含 shadow 遍历）
- **性能**：仅对含 shadow 的宿主遍历；visited 防重；extractPageText / waitForCondition 有 maxChars / timeout 封顶

### 测试

**单元测试（tests/test_agent.js）**
- `resolveShadowPath` 用 cssPath 下钻嵌套 shadow（新 mock DOM）
- `collectFormControls` 收集 shadow 内输入框
- `extractPageText` 含 shadow 文本
- shadow.js 工具（collectOpenShadowRoots / walkShadowTree / findElementInShadows）

**CDP 真机测试（tests/cdp/run-page-tests.js）**
- 嵌套 shadow 夹具：快照捕获 shadowPath.length === 2 且为 cssPath 数组
- locateElement 还原嵌套 shadow 内元素
- executeAction click/type 命中嵌套 shadow 元素
- formFill 在含 shadow 表单页一次填完字段并提交

**测试夹具（tests/test-page.html）**
- 现有 `#shadow-host` 保持不动
- 新增 `#nested-shadow-host`：open root 内按钮 → 内层 open root 含输入框（三层穿透）
- 新增 shadow 表单：open root 内含 form + username/password + checkbox + 提交按钮

**实机回归（docs/test-prompts.md）**
- 场景八 form_fill 新增「任务 4：shadow 表单」——真实站（MUI 组件库页面或任意含 open shadow 的注册/搜索表单）
- 验证点：form_fill 字段识别进 shadow、勾选同步、提交生效
- 回归速查表补 1 行

## 实现顺序（提交粒度）

1. `content/shadow.js` 新建 + 单测（先红后绿）
2. snapshot.js：shadowPath 改 cssPath + 复用 shadow 工具
3. locator.js：resolveShadowPath cssPath 下钻 + findByName/findByRect 遍历 shadow
4. executor.js：collectFormControls / extractPageText / waitForCondition 覆盖 shadow
5. test-page.html：嵌套 shadow + shadow 表单夹具
6. CDP 断言 + 单测补充（贯穿各步）
7. bump 版本 → 0.1.41（发布与否经用户确认）
8. 回归文档：test-prompts.md 场景八任务 4 + 速查表

每步一个 commit，全部测试通过后 bump。
