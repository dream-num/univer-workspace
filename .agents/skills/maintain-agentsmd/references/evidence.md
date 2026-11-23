# AGENTS.md 写作规则的证据

本文记录 `maintain-agentsmd` 各条规则的依据，调研时间为 2026-11-22。证据强度分三档：

- **实测**：有对照实验的研究。
- **厂商**：官方文档的建议，没有公开数据。
- **经验**：团队的经验报告，没有对照。

复审时逐条核对来源是否更新。来源结论变化时，先改本文，再改 `SKILL.md`。

## 结论与依据

| 规则                                         | 依据                                                                                                                                                                                                                                                                                 | 强度                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| 只写读代码得不到的内容，不写目录树和架构概览 | Gloaguen 等发现 repository overview 没有减少 agent 找到相关文件的步数。开发者手写文件 +2.4%（不显著），且只在不重复 README 时有效。删除仓库内其他文档后，LLM 生成的文件反而提升 2.7%，说明它们主要在重复已有文档。Claude Code `/doctor` 也删除可从代码推出的布局、依赖列表和架构概览 | 实测 + 厂商          |
| 每一行都有成本，过期的行会被执行             | Gloaguen 等发现，文件里提到 `uv` 时每个任务平均调用 1.6 次，不提时几乎为 0。加入 context file 后步数增加，成本上升约 20%                                                                                                                                                             | 实测                 |
| 必须成立的规则交给测试、lint、hook、CI       | McMillan 发现一条极简单的标记规则，遵循率只有 60% 到 68%，且在同一会话中逐步下降。Claude Code 文档说 CLAUDE.md 是 context，不是强制配置。Codex 和 Cursor 都建议把格式和 lint 交给工具                                                                                                | 实测 + 厂商          |
| 按目录作用域拆分，根文件只放全局规则         | Claude Code、Codex、Cursor、Copilot 都支持 nested AGENTS.md。Claude Code 说明 `@import` 不会降低 context 成本                                                                                                                                                                        | 厂商                 |
| 指针要写明何时读                             | Vercel 评测中，按需加载的 skill 有 56% 的运行从未被调用，常驻的精简索引得分最高                                                                                                                                                                                                      | 厂商评测，单一测试集 |
| 写明范围和原因，不用强调词                   | Claude Code best practices 指出新模型照普通措辞执行，叠加强调只会让模型过度执行。Fable 5.2 提示指南指出模型把含 "never" 的指令当作绝对规则，应把绝对规则改写成带范围和原因的规则。OpenAI GPT-5.6 指南要求 ALWAYS/NEVER 只用于真正的不变式                                            | 厂商                 |
| 消除矛盾                                     | Claude Code memory 文档指出两条指令矛盾时，Claude 可能任选一条。OpenAI 认为冲突的规则比缺失细节更不稳定                                                                                                                                                                              | 厂商                 |
| 删除为旧模型写的通用教导                     | Opus 5 提示指南指出显式的验证指令会导致过度验证。Claude Code best practices 指出 "keep going"、"don't be lazy" 更可能造成过度工作                                                                                                                                                    | 厂商                 |
| 长度只是信号，不是硬规则                     | McMillan 测得 25、100、250、500 行的遵循率差异不显著（Bayes factor 支持零效应）。Claude 建议每个文件 200 行以内、Cursor 建议 500 行以内，都是经验值。唯一的硬上限是 Codex 的 `project_doc_max_bytes`，默认 32 KiB，按整条链合计                                                      | 实测（零效应）+ 厂商 |
| 模型大版本发布后复审                         | Claude Code large-codebases 文档指出，为绕开旧模型局限写的指令，在新模型上会变成负担                                                                                                                                                                                                 | 厂商                 |
| 不用工具自动生成文件                         | Gloaguen 等发现 LLM 生成的文件使成功率略降（不显著），成本上升 20% 到 23%                                                                                                                                                                                                            | 实测                 |

## 来源

研究论文（全文已读，除非标明只读了摘要）：

- Gloaguen 等，"Evaluating AGENTS.md"，https://arxiv.org/abs/2602.11988 ，v3 2026-09-29。4 个 agent，SWE-bench Lite 与 CTXBench。局限：只测了 Python，单次采样，模型较旧。
- McMillan，https://arxiv.org/abs/2605.10039 ，2026-05-11。1,650 个 Claude Code 会话。局限：只测了一条标记规则，最长 500 行。
- Lulla 等，https://arxiv.org/abs/2601.20404 ，2026-01-28。Codex 在 124 个小 PR 上中位运行时间下降 28.64%，没有评估正确性。
- Khatri，https://arxiv.org/abs/2607.27250 ，2026-07-28，只读了摘要。正确性没有可测变化，失败主要来自实现能力。
- IFScale，https://arxiv.org/abs/2507.11538 ，2025-07。指令数超过约 150 条后遵循率下降。任务是合成的，模型是 2025 年的。
- Chroma，"Context Rot"，https://www.trychroma.com/research/context-rot ，2025-07-14。输入越长可靠性越低，无关内容会干扰模型。

厂商文档（Claude 页面逐字读取，其余经摘要工具读取，引文未逐字核对）：

- Claude Code memory：https://code.claude.com/docs/en/memory
- Claude Code best practices：https://code.claude.com/docs/en/best-practices
- Claude Code large codebases：https://code.claude.com/docs/en/large-codebases
- Codex AGENTS.md：https://developers.openai.com/codex/guides/agents-md
- Cursor rules：https://cursor.com/docs/context/rules
- GitHub Copilot repository instructions：https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
- agents.md standard：https://agents.md
- Anthropic prompting best practices（覆盖 Claude 4.6 到 Fable 5.2），在 platform.claude.com 文档中。

经验报告：

- OpenAI，"Harness engineering"，https://openai.com/blog/harness-engineering ，2026-02-11。用约 100 行的目录式 AGENTS.md 指向 `docs/`，配合结构测试和 doc-gardening agent。没有消融实验。
- Vercel，https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals ，2026-01-27。
- HumanLayer，https://www.humanlayer.com/blog/writing-a-good-claude-md ，2025-11-25。150 到 200 条指令的预算是从 IFScale 外推的。

## 本仓库的基线

2026-11-22 重写前，根 `AGENTS.md` 21.7 KB、288 行，约 40% 只在子目录有用，约 9 KB 与其他文档重复。重写后，根文件 12.5 KB、185 行，最长的 Codex 链 16.7 KB。

重写时发现的漂移如下，可作为复审时的样例。

- Redi `packageExtensions` 在 SDK 1.4.0 时已删除（afb46b36），文件仍要求维护它们。
- MCP 已有生产 OAuth、executor 和 renderer，文件仍写着阶段 A。
- `apps/workspace/AGENTS.md` 只写了 SQLite，PostgreSQL 后端已经存在。
- 独立版本的包在脚本里有 4 个，文件只列了 3 个。

`pnpm check:agents-md` 发现不了上面任何一条，因为它们都是内容过期，路径本身仍然存在。这一类只能靠复审第 2 步发现。
