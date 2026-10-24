# AGENTS.md — marketing-quiz 專案規則

## 專案定位
行銷管理期中考（Ch1–Ch5 共 24 個主題）純靜態刷題網站（`index.html` + `data/questions.json` + `assets/`），部署於 GitHub Pages。

## 建置與測試
- 重新解析題庫：`python3 tools/parse_md.py --all`（同時更新 `data/questions.json`、`assets/` 與 `index.html` 內嵌備援題庫）
- 單元測試：`node tests/similarity.test.mjs`

## 敏感性與邊界
- 純學習刷題靜態網站，無 API key 或 `.env`。
- 遵循 `~/Desktop/AgentWorkspace/README.md` 與 `~/Desktop/AgentWorkspace/AGENTS.md` 的分支 + PR Review 規則（分支前綴 `codex/<主題>`、標記 `[codex]`）。
