<template>
  <div class="map-stage">
    <!-- 夜空氛围层：四色光雾 + 星尘 + 底部悬浮辉光（纯装饰，垫在 3D 画布底下） -->
    <div class="nebula" aria-hidden="true"></div>
    <div class="starfield" aria-hidden="true">
      <span v-for="(s, i) in stars" :key="i" class="star" :style="s"></span>
      <span class="meteor"></span>
    </div>
    <div class="map-glow" aria-hidden="true"></div>

    <!-- Three.js 画布容器：广西浮雕挤出地图 + 四城光柱 + 飞线/粒子/倒影/光圈 -->
    <div ref="stageRef" class="map-canvas" aria-label="广西3D地图"></div>

    <!-- CSS2D 标签层容器：14 市白色裸字标签（pointer-events none，不挡地图拖拽/点击） -->
    <div ref="labelEl" class="label-holder" aria-hidden="true"></div>

    <!-- 城市 hover 跟随提示 -->
    <div
      v-show="tooltip.show"
      class="city-tip"
      :class="{ four: tooltip.isFour }"
      :style="{ left: tooltip.x + 14 + 'px', top: tooltip.y + 14 + 'px' }"
    >
      {{ tooltip.name }}{{ tooltip.isFour ? ' · 点击进入' : '' }}
    </div>

    <header class="stage-hud">
      <h1 class="stage-title">桂见<span class="accent">广西</span></h1>
      <p class="stage-sub">拖动旋转 · 滚轮缩放 · 点击城市任意区域或光柱进入</p>
    </header>

    <!-- 左下四城图例条：点击直接下钻（与地图点击同路）；hover 展开城市口号 -->
    <nav class="legend-bar" aria-label="四城快速入口">
      <button
        v-for="c in store.cities"
        :key="c.id"
        class="legend-item"
        type="button"
        @click="drillTo(c)"
      >
        <span class="legend-dot" :style="{ background: c.color, boxShadow: `0 0 8px ${c.color}` }"></span>
        <span class="legend-name">{{ c.name }}</span>
        <span class="legend-slogan">{{ c.slogan }}</span>
      </button>
    </nav>

    <!-- 右上数据徽标 -->
    <aside class="stat-badge" aria-hidden="true">
      <span><b>4</b> 城市</span>
      <i></i>
      <span><b>9</b> 景区</span>
      <i></i>
      <span><b>4</b> 层 AI 能力</span>
    </aside>
  </div>
</template>

<script>
// 模块级单例：开卷动画只在首次进页面播一次，返回省图直接呈现终态。
// <script setup> 里的 let 每组件实例都会重新执行，跨实例状态必须放这里
let introPlayed = false
</script>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import flags from '@/config/feature.flags'
import { useGuangxiMap3d } from '@/composables/useGuangxiMap3d'

const stageRef = ref(null)
const labelEl = ref(null)
const store = useAppStore()
const emit = defineEmits(['drill'])
const tooltip = reactive({ show: false, name: '', x: 0, y: 0, isFour: false })
let api = null
let introTl = null

/** 图例条下钻：与地图点击同一条路（selectCity + drill 事件由 HomeView 触发欢迎语） */
function drillTo(city) {
  if (!flags.cityDrilldown) return
  store.selectCity(city)
  emit('drill', city)
}

/** 星尘背景：实例化时随机撒一次，纯装饰不参与交互 */
const stars = Array.from({ length: 130 }, () => ({
  left: `${(Math.random() * 100).toFixed(2)}%`,
  top: `${(Math.random() * 100).toFixed(2)}%`,
  width: `${(Math.random() * 1.6 + 0.7).toFixed(2)}px`,
  height: `${(Math.random() * 1.6 + 0.7).toFixed(2)}px`,
  animationDelay: `${(Math.random() * 6).toFixed(2)}s`,
  animationDuration: `${(Math.random() * 3 + 3).toFixed(2)}s`,
}))

onMounted(async () => {
  api = useGuangxiMap3d()
  try {
    introTl = await api.init(stageRef.value, labelEl.value, {
      cities: store.cities,
      skipIntro: introPlayed, // 返回省图：跳过开卷动画直接终态
      onDrill: drillTo,
      onPending: (name) => ElMessage(`${name}·更多城市，敬请期待`),
      onHover: (info) => {
        tooltip.show = !!info
        if (info) {
          tooltip.name = info.name
          tooltip.isFour = !!info.city
          tooltip.x = info.x
          tooltip.y = info.y
        }
      },
    })
    introPlayed = true
  } catch (err) {
    ElMessage.error(err?.message || '3D 地图初始化失败')
  }
})

onBeforeUnmount(() => {
  introTl?.kill()
  introTl = null
  api?.dispose(stageRef.value, labelEl.value)
  api = null
})
</script>

<style scoped>
.map-stage {
  position: relative;
  width: 100%;
  height: 100%;
  background: radial-gradient(ellipse at 50% 30%, #0c2136 0%, var(--bg-deep) 70%);
  overflow: hidden; /* 光雾/流星出界不产生滚动 */
}

/* ---------- 夜空氛围层 ---------- */
.nebula {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(46% 60% at 8% 10%, rgba(38, 198, 218, 0.17) 0%, rgba(38, 198, 218, 0.04) 52%, transparent 74%),
    radial-gradient(44% 55% at 92% 6%, rgba(58, 134, 255, 0.17) 0%, rgba(58, 134, 255, 0.04) 52%, transparent 74%),
    radial-gradient(48% 58% at 5% 90%, rgba(230, 57, 70, 0.15) 0%, rgba(230, 57, 70, 0.04) 52%, transparent 74%),
    radial-gradient(46% 56% at 95% 92%, rgba(76, 175, 80, 0.15) 0%, rgba(76, 175, 80, 0.04) 52%, transparent 74%);
  animation: nebula-breathe 18s ease-in-out infinite;
}

@keyframes nebula-breathe {
  0%,
  100% {
    opacity: 0.85;
  }
  50% {
    opacity: 1;
  }
}

.starfield {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.star {
  position: absolute;
  border-radius: 50%;
  background: #e8f1f8;
  animation: star-twinkle 4s ease-in-out infinite;
}

@keyframes star-twinkle {
  0%,
  100% {
    opacity: 0.12;
  }
  50% {
    opacity: 0.85;
  }
}

.meteor {
  position: absolute;
  top: 14%;
  left: 72%;
  width: 130px;
  height: 1.5px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(232, 241, 248, 0.95), transparent);
  opacity: 0;
  transform: rotate(26deg);
  animation: meteor-fall 11s ease-in 5s infinite;
}

@keyframes meteor-fall {
  0% {
    opacity: 0;
    transform: translate(0, 0) rotate(26deg);
  }
  7% {
    opacity: 0;
    transform: translate(-300px, 146px) rotate(26deg);
  }
  100% {
    opacity: 0;
    transform: translate(-300px, 146px) rotate(26deg);
  }
}

.map-glow {
  position: absolute;
  left: 50%;
  bottom: -8%;
  width: 74%;
  height: 28%;
  transform: translateX(-50%);
  pointer-events: none;
  background: radial-gradient(
    50% 50% at 50% 50%,
    rgba(56, 189, 248, 0.16) 0%,
    rgba(56, 189, 248, 0.05) 45%,
    transparent 72%
  );
}

/* ---------- Three.js 画布 ---------- */
.map-canvas {
  width: 100%;
  height: 100%;
  cursor: grab;
}

.map-canvas:active {
  cursor: grabbing;
}

/* CSS2D 标签层宿主：整面覆盖画布但不拦截交互 */
.label-holder {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

/* ---------- 城市 hover 提示 ---------- */
.city-tip {
  position: fixed;
  z-index: 20;
  pointer-events: none;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid rgba(125, 211, 252, 0.4);
  background: rgba(7, 19, 31, 0.88);
  color: #e8f1f8;
  font-size: 13px;
  letter-spacing: 2px;
  backdrop-filter: blur(4px);
}

.city-tip.four {
  border-color: rgba(46, 230, 255, 0.75);
  color: #9feaff;
  box-shadow: 0 0 14px rgba(46, 230, 255, 0.35);
}

/* ---------- 左下四城图例条 ---------- */
.legend-bar {
  position: absolute;
  left: 36px;
  bottom: 30px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(125, 211, 252, 0.16);
  background: rgba(7, 19, 31, 0.55);
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.25s ease;
}

.legend-item:hover {
  border-color: rgba(125, 211, 252, 0.5);
  background: rgba(12, 33, 54, 0.82);
  transform: translateY(-2px);
}

.legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-name {
  color: #e8f1f8;
  letter-spacing: 2px;
}

.legend-slogan {
  max-width: 0;
  opacity: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-dim);
  transition: all 0.3s ease;
}

.legend-item:hover .legend-slogan {
  max-width: 200px;
  opacity: 1;
}

/* ---------- 右上数据徽标 ---------- */
.stat-badge {
  position: absolute;
  top: 34px;
  right: 36px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
  letter-spacing: 2px;
  color: rgba(232, 241, 248, 0.55);
  pointer-events: none;
  user-select: none;
}

.stat-badge b {
  color: var(--accent);
  font-weight: 600;
  font-size: 15px;
  margin-right: 2px;
}

.stat-badge i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(125, 211, 252, 0.45);
}

/* ---------- HUD ---------- */
.stage-hud {
  position: absolute;
  top: 28px;
  left: 36px;
  pointer-events: none;
  user-select: none;
}

.stage-title {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 6px;
}

.stage-title .accent {
  background: linear-gradient(120deg, var(--accent), #7dd3fc);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.stage-sub {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-dim);
  letter-spacing: 1px;
}
</style>

<style>
/* CSS2D 标签（JS 动态创建，scoped 样式不生效，必须全局）：
   白色裸字贴顶面，四城加大加重，青蓝辉光描边 */
.gx-label-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.gx-map-label {
  color: #eaf6ff;
  font-size: 12px;
  letter-spacing: 2px;
  white-space: nowrap;
  text-shadow:
    0 0 6px rgba(46, 230, 255, 0.9),
    0 0 14px rgba(0, 180, 255, 0.5),
    0 1px 3px rgba(0, 0, 0, 0.65);
}

.gx-map-label.four {
  font-size: 14.5px;
  font-weight: 600;
  color: #ffffff;
  letter-spacing: 3px;
}
</style>
