# 桂见广西

> 一座让人隔着屏幕就想动身的广西——3D 地图漫游四城九景，AI 替风景开口说话。

第九届传智杯 · AI Web 网页开发挑战赛参赛作品（大学B组）。

## 作品简介

**核心体验**：广西 3D 浮雕地图 → 左键点击四色城市光柱（百色红 / 南宁绿 / 北海蓝 / 桂林青）→ 下钻城市地图 → 点击景点光柱 → 沉浸式景点卡片；首页右上「▦ 数据大屏」可切换可视化大屏视图。

**AI 四层能力**：

| 能力 | 说明 | 模型 |
|---|---|---|
| RAG 知识问答 | 九景内容自动构建向量知识库，只依据资料回答并附参考来源，拒绝编造 | glm-4-flash + embedding-3 |
| AI 讲解员 | 依据景点全量资料生成口播讲解词，流式字幕 + 逐句语音朗读 | glm-4-flash |
| 多模态识景 | 上传旅行照片，AI 描述风景与氛围并给出旅行建议 | glm-4v-flash |
| 唤醒风景 | 静照无缝切换 AI 图生视频（即梦/可灵生成，前端懒加载+失败回退） | 图生视频 |

**内容四重叙事**：每个景点含「地理科普 / 民间传说 / 历史人事 / 风物延伸」四个篇章，内容层 JSON 数据驱动——改景点零代码，后端启动自动重建 RAG 索引。

## 技术架构

```
guijian-guangxi/
├─ frontend/    Vue3 + Vite + Pinia + Element Plus + Three.js + GSAP
│               ├─ 三级整页下钻：广西浮雕省图 → 城市区县地图（区县凸台/景点光柱）→ 景点详情
│               ├─ 数据大屏 /screen（挤出地图 + 人口光柱 + 飞线 + CSS2D 标牌）
│               ├─ SSE 流式问答与讲解（字幕只增不减，语音逐句投喂）
│               └─ feature.flags 功能开关（任何不稳定功能一键隐藏，作品照样完整）
├─ backend/     Spring Boot 3 + Java 虚拟线程
│               ├─ AI 适配器模式：provider=stub/zhipu 环境变量一键切换，供应商可整体替换
│               ├─ 简化版 RAG：内容 JSON 自动分块，向量检索优先、关键词兜底，当前景点加权
│               └─ SSE 统一 JSON 消息协议（sources / delta / done / error）
├─ content/     内容数据层（城市 / 景点 / 美食 / GeoJSON，全部 JSON）
└─ docs/        方案书与架构文档
```

详细设计见 [docs/技术文档.md](docs/技术文档.md) 与 [docs/开发计划方案-v0.1.md](docs/开发计划方案-v0.1.md)。

## 运行指南

### 前端（端口 5173）

```bash
cd frontend
npm install
npm run dev
```

### 后端（端口 8080）

首选（Windows 双击即可，交互式粘贴 Key）：

```bash
cd backend
./启动后端.bat
```

或 PowerShell 脚本 / 手动方式：

```bash
cd backend
./start-backend.ps1    # 或直接: mvn spring-boot:run
```

### 接入真实 AI（智谱开放平台）

1. 注册 [智谱开放平台](https://open.bigmodel.cn)，控制台「API 密钥」创建 Key（GLM-4-Flash / GLM-4V-Flash 为免费档，embedding-3 新用户有赠送额度，演示成本约等于零）
2. 启动后端时按脚本提示粘贴 Key；或手动设置环境变量：

```powershell
$env:LLM_PROVIDER = "zhipu"
$env:LLM_API_KEY  = "你的Key"
mvn spring-boot:run
```

3. **未配置 Key 也能跑**：自动进入 stub 演示模式，问答/讲解以占位内容流式输出，全链路界面照常可演示

环境变量模板见 [.env.example](.env.example)。**真实密钥严禁提交入库**（`.gitignore` 已排除 `.env`，推荐环境变量方式注入）。

## 团队信息

- 团队名：绿水千山
- 团队编号：40996
- 赛道：AI Web 网页开发挑战赛 · 大学B组
- 学校：百色学院

## License

仅供比赛评审与学习交流使用。
