# Changelog

## 1.1.0 - 2026-10-28

### Fixed

- 自检命令 `node --test tests/` 在 Windows / Node 22 下因目录形式被当模块路径而必挂；改为 `node --test "tests/*.test.mjs"`（引号 glob），实测 config 6 + scripts 5 共 11 项全过。

### Added

- SKILL.md「何时运行同步脚本」明确双清单分工：`gateway-models.json`（网关 `/models` 实时拉取，实际调用面权威，仅需网关凭证）vs `models.json`（静态基线 + SDK 同步，选型与参数参考）。

### Changed

- frontmatter version 由滞后的 0.2.0 对齐到 1.1.0（CHANGELOG 自 1.0.0 起未回写版本号）。
- 模型清单例行刷新：gateway-models.json 实时同步至 2026-10-28（11 模型：doubao-seed-2-0 pro/lite/mini、glm-4-7、seedream-5-0、seedance-2-0 等）。

## 1.0.0 - 2026-09-10

- 首个公开发布：LLM / 生图 / 生视频 / TTS / ASR / Embedding 六域参考指南
- 模型清单快照（`references/models.json`）+ 网关刷新脚本（`scripts/update_models.mjs`）
- 沙箱 SDK / 本地 OpenAI 兼容双路径调用
