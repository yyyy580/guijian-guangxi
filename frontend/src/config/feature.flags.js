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
  voiceWelcome: false,  // hover 城市欢迎语音"XX欢迎您"
  cityDrilldown: false, // 城市下钻转场动画

  // --- P2 智能 ---
  awakenVideo: false,   // "唤醒风景"：静照切 AI 图生视频
  ragChat: false,       // RAG 知识问答
  ttsNarrator: false,   // AI 讲解员语音解说
}
