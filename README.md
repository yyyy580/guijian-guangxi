# 桂见广西（暂定名）

> 一座让人隔着屏幕就想动身的广西——3D 地图漫游四城九景，AI 替风景开口说话。

第九届传智杯 · AI Web 网页开发挑战赛参赛作品（大学B组）。

## 项目简介

- **核心体验**：广西 3D 浮雕地图 → 点击四色城市光柱（百色红 / 南宁绿 / 北海蓝 / 桂林青）→ 下钻城市地图 → 沉浸式景点卡片
- **AI 四层能力**：多模态识景 + RAG 知识问答 + AIGC 图生视频（"唤醒风景"）+ TTS 语音讲解
- **内容基线**：四城九景 + 四重叙事（地理科普 / 民间传说 / 历史人事 / 风物延伸）

## 技术架构

```
guijian-guangxi/
├─ frontend/    Vue3 + Vite + Pinia + Element Plus + ECharts GL + GSAP
├─ backend/     Spring Boot（LLM / RAG / TTS 适配器）
├─ content/     内容数据层（JSON 数据驱动，改景点零代码）
└─ docs/        方案书与架构文档
```

详细设计见 [docs/开发计划方案-v0.1.md](docs/开发计划方案-v0.1.md)。

## 运行指南

```bash
# 前端
cd frontend
npm install
npm run dev

# 后端
cd backend
./mvnw spring-boot:run
```

环境变量：复制 `.env.example` 并填入自己的 Key（**真实密钥严禁提交入库**）。

## 团队信息

- 团队名：小白菜（暂定）
- 赛道：AI Web 网页开发挑战赛 · 大学B组

## License

仅供比赛评审与学习交流使用。
