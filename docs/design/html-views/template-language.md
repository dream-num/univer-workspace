# HTML 模板语言

[返回 Univer HTML Views 总览](README.md)

阶段：采用普通 HTML 加单元格绑定属性，以下为设计约定，待实现验证。

## 语法

模板是普通 HTML 文件，使用 HTML 和 CSS 描述页面，通过两个属性连接单元格：

| 属性 | 语法 | 用途 | 数据方向 |
| --- | --- | --- | --- |
| `data-univer-cell-text` | `data-univer-cell-text="<unitId>:<sheetId>:<cell address>"` | 展示单元格值 | 单元格 → 文本 |
| `data-univer-cell-model` | `data-univer-cell-model="<unitId>:<sheetId>:<cell address>"` | 编辑单元格值 | 单元格 ↔ 表单控件 |

`<unitId>` 为 Unit ID，`<sheetId>` 为 Sheet ID，`<cell address>` 为 A1 格式的单元格地址，
例如 `B7`。尖括号表示需要替换的占位符，实际属性值不包含尖括号。

## 示例

```html
<section class="cash-card">
  <h2>期末现金</h2>
  <strong data-univer-cell-text="finance:cash-model:B14">加载中</strong>
</section>

<label for="hires">新增招聘</label>
<input id="hires" type="range" min="0" max="40" step="1"
  data-univer-cell-model="finance:cash-model:B7">
<output for="hires" data-univer-cell-text="finance:cash-model:B7"></output>
```

示例中 `finance` 是 Unit ID，`cash-model` 是 Sheet ID。实际模板填入目标数据的真实 ID。
页面作者或 Agent 只需在展示元素和控件上声明引用，渲染器负责建立持续绑定。

## 渲染后的 HTML

假设 `B7` 为 `20`，`B14` 的公式为 `=100-B7*2`，渲染后的当前状态示意如下：

```html
<section class="cash-card">
  <h2>期末现金</h2>
  <strong data-univer-cell-text="finance:cash-model:B14">60</strong>
</section>

<label for="hires">新增招聘</label>
<input id="hires" type="range" min="0" max="40" step="1" value="20"
  data-univer-cell-model="finance:cash-model:B7">
<output for="hires" data-univer-cell-text="finance:cash-model:B7">20</output>
```

这里用 `value="20"` 表示控件当前值；运行时更新的是 DOM 的 `value` 属性。
页面挂载后，Binding 持续更新文本和控件，并将用户编辑写回单元格。

## 语法细节

### 单元格引用

属性值统一使用 `unitId:sheetId:A1`，三个部分直接确定一个单元格。

- `unitId` 和 `sheetId` 使用稳定 ID，保留大小写。
- 坐标采用单格 A1 写法，例如 `B7`；列名解析时统一为大写。
- ID 分别按 `encodeURIComponent` 规则编码，再用冒号连接。解析时先分割为三段，
  再分别解码 ID 一次，因此 ID 中的冒号和百分号不会与分隔符混淆。
- 缺少字段、编码错误或非法坐标，作为模板错误报告到对应元素和属性。

绑定指向固定坐标，结构变化后的行为沿用 [Binding 引擎](binding-engine.md)约定。

### 单向展示

`data-univer-cell-text` 首次读取值，并订阅后续变化；公式格展示计算结果。
值写入元素的 `textContent`，空单元格展示空文本。绑定属性应放在专门承载值的元素上，
因为更新会替换该元素的文本内容。

加载前可以保留模板中的占位文字。格式化能力后续按实际页面需求补充。

### 双向编辑

`data-univer-cell-model` 将单元格值同步到控件，并将用户输入写回同一单元格。
首版控件与值转换约定如下：

| 控件 | 读取与写入 |
| --- | --- |
| 文本输入、`textarea`、单选 `select` | 字符串 `value` |
| `input type="number"` | 有限数值 |
| `input type="range"` | 有限数值 |
| `input type="checkbox"` | 布尔值 `checked` |

`min`、`max`、`step` 等约束使用原生 HTML 属性。清空单元格的能力后续设计。
提交事件、写入节流、编辑草稿和错误处理见[模板解析与渲染](template-rendering.md)。

## 扩展方向

需要图表、自定义交互或动态样式时，再开放页面全局 API，复用同一套 Binding 的读取、
订阅、写入与释放语义。API 名称、接口和脚本执行方式在出现具体需求时设计。

Agent 的说明与示例围绕这两个属性编写：查明真实 Unit ID、Sheet ID 和单元格位置，
生成 HTML 和 CSS，再为展示与输入元素添加绑定。验收应覆盖生成结果、实际加载、
控件写回以及与协同表格的联动。
