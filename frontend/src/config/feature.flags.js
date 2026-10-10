/**
 * 全站功能开关——一眼看清所有功能的启停状态。
 * 演示翻车保险：任何做不完/不稳定的功能，置 false 即从界面消失，作品照样完整。
 * 规则：只增不删；关闭的功能代码保留，不删除。
 */
export default {
  // --- P0 地图 ---
  map3D: true,          // 3D 浮雕地图（ECharts GL）
  map2DFallback: true,  // 2D SVG 降级地图（答辩无 WebGL 时切换）

  // --- P1 骨肉 ---
  voiceWelcome: true,   // hover/进入城市时欢迎语音"XX欢迎您"（speechSynthesis 本地方案）
  cityDrilldown: true,  // 城市下钻转场动画

  // --- P2 智能 ---
  awakenVideo: true,    // "唤醒风景"：静照切 AI 图生视频（九景素材已预生成，点击懒加载+失败回退）
  ragChat: true,        // RAG 知识问答（stub 演示模式可用，配 Key 后走真实大模型）
  ttsNarrator: true,    // AI 讲解员：流式讲解词字幕 + speechSynthesis 朗读
}
