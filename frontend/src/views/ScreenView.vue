<template>
  <div class="screen-root">
    <!-- 3D 画布与 CSS2D 标签容器 -->
    <div ref="canvasEl" class="stage"></div>
    <div ref="labelEl" class="label-holder"></div>

    <!-- 数据加载失败提示 -->
    <div v-if="loadError" class="load-error">{{ loadError }}</div>

    <!-- 顶部标题 -->
    <header class="hd">
      <div class="hd-line"></div>
      <h1>广西壮族自治区 · 3D 数据可视化大屏</h1>
      <div class="hd-line"></div>
    </header>

    <!-- 返回文旅首页 -->
    <button class="back" @click="$router.push('/')">‹ 返回首页</button>

    <!-- 右侧悬浮控制面板：开关与 Three.js 对象 visible 双向同步 -->
    <aside class="panel">
      <h2>图层控制</h2>
      <label v-for="item in switchItems" :key="item.key" class="row">
        <span class="row-name">{{ item.name }}</span>
        <button
          class="switch"
          :class="{ on: toggles[item.key] }"
          role="switch"
          :aria-checked="toggles[item.key]"
          @click="toggle(item.key)"
        >
          <i class="knob"></i>
        </button>
      </label>
      <p class="panel-tip">数据：2020 第七次全国人口普查</p>
    </aside>

    <!-- 底部状态条 -->
    <footer class="ft">
      <span>14 地级市</span><i></i><span>飞线中心：南宁</span><i></i><span>Three.js · Vue3 · BLOOM</span>
    </footer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue'
import { useGuangxiScreen } from '@/composables/useGuangxiScreen'

const canvasEl = ref(null)
const labelEl = ref(null)
const { init, dispose, setLayerVisible, setColorMode } = useGuangxiScreen()

/** 图层开关状态：watch 后同步到 Three.js 对象 visible */
const toggles = reactive({
  blocks: true,     // 刷色图：各市分区着色
  beams: true,      // 光柱
  flights: true,    // 飞线
  labels: true,     // 标牌（CSS2D）
  particles: true,  // 粒子
  reflection: true, // 倒影
  ripple: true,     // 波纹
  ring: true,       // 虚线光圈
})

const switchItems = [
  { key: 'blocks', name: '刷色图' },
  { key: 'beams', name: '光柱' },
  { key: 'flights', name: '飞线' },
  { key: 'labels', name: '标牌' },
  { key: 'particles', name: '粒子' },
  { key: 'reflection', name: '倒影' },
  { key: 'ripple', name: '波纹' },
  { key: 'ring', name: '光圈' },
]

function toggle(key) {
  toggles[key] = !toggles[key]
}

watch(toggles, (val) => {
  Object.entries(val).forEach(([key, visible]) => {
    key === 'blocks' ? setColorMode(visible) : setLayerVisible(key, visible)
  })
})

let ready = false
const loadError = ref('')
onMounted(async () => {
  try {
    await init(canvasEl.value, labelEl.value)
    ready = true
  } catch (err) {
    loadError.value = err?.message || '3D 场景初始化失败'
  }
})

onUnmounted(() => {
  if (ready) dispose(canvasEl.value, labelEl.value)
})
</script>

<style>
/* —— 3D 标牌（CSS2DRenderer 动态插入 DOM，须用全局样式）—— */
.gx-label-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.gx-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 5px 12px;
  background: rgba(5, 25, 48, 0.78);
  border: 1px solid rgba(46, 230, 255, 0.55);
  border-radius: 4px;
  box-shadow: 0 0 14px rgba(46, 230, 255, 0.35);
  transform: translateY(-14px);
  white-space: nowrap;
  backdrop-filter: blur(2px);
}

.gx-label b {
  color: #bdf3ff;
  font-size: 13px;
  letter-spacing: 2px;
}

.gx-label span {
  color: #2ee6ff;
  font-size: 11px;
  font-family: Consolas, monospace;
}
</style>

<style scoped>
.screen-root {
  position: fixed;
  inset: 0;
  background: #030b1a;
  overflow: hidden;
  font-family: system-ui, 'Microsoft YaHei', sans-serif;
}

.stage {
  position: absolute;
  inset: 0;
}

.label-holder {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.load-error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 20;
  max-width: 70%;
  padding: 18px 26px;
  border: 1px solid rgba(255, 110, 110, 0.6);
  border-radius: 8px;
  background: rgba(40, 8, 12, 0.9);
  color: #ffb3b3;
  font-size: 14px;
  line-height: 1.8;
}

/* —— 顶部标题 —— */
.hd {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 16px;
  z-index: 10;
  white-space: nowrap;
}

.hd h1 {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 6px;
  color: #d8f6ff;
  text-shadow: 0 0 18px rgba(46, 230, 255, 0.8), 0 0 42px rgba(46, 230, 255, 0.4);
}

.hd-line {
  width: 180px;
  height: 2px;
  background: linear-gradient(90deg, transparent, #2ee6ff);
}

.hd-line:last-child {
  transform: scaleX(-1);
}

/* —— 返回按钮 —— */
.back {
  position: absolute;
  top: 22px;
  left: 24px;
  z-index: 10;
  padding: 8px 18px;
  border: 1px solid rgba(46, 230, 255, 0.5);
  border-radius: 999px;
  background: rgba(5, 25, 48, 0.7);
  color: #9fe8ff;
  font-size: 13px;
  letter-spacing: 2px;
  cursor: pointer;
  transition: all 0.2s;
}

.back:hover {
  color: #fff;
  border-color: #2ee6ff;
  box-shadow: 0 0 16px rgba(46, 230, 255, 0.45);
}

/* —— 右侧控制面板 —— */
.panel {
  position: absolute;
  top: 90px;
  right: 24px;
  z-index: 10;
  width: 190px;
  padding: 16px 16px 10px;
  background: linear-gradient(160deg, rgba(6, 28, 54, 0.88), rgba(4, 16, 34, 0.88));
  border: 1px solid rgba(46, 230, 255, 0.35);
  border-radius: 10px;
  box-shadow: 0 0 26px rgba(20, 120, 200, 0.25), inset 0 0 24px rgba(20, 120, 200, 0.12);
}

.panel::before,
.panel::after {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid #2ee6ff;
}

.panel::before {
  top: -1px;
  left: -1px;
  border-right: none;
  border-bottom: none;
}

.panel::after {
  bottom: -1px;
  right: -1px;
  border-left: none;
  border-top: none;
}

.panel h2 {
  margin-bottom: 12px;
  font-size: 14px;
  letter-spacing: 4px;
  color: #7fdcff;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  cursor: pointer;
}

.row-name {
  font-size: 13px;
  color: #cfeefc;
  letter-spacing: 2px;
}

/* 赛博风开关 */
.switch {
  position: relative;
  width: 38px;
  height: 20px;
  border: 1px solid rgba(46, 230, 255, 0.5);
  border-radius: 999px;
  background: rgba(10, 30, 58, 0.9);
  cursor: pointer;
  transition: all 0.25s;
}

.switch .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #3d5f80;
  transition: all 0.25s;
}

.switch.on {
  background: rgba(46, 230, 255, 0.22);
  box-shadow: 0 0 10px rgba(46, 230, 255, 0.5);
}

.switch.on .knob {
  left: 20px;
  background: #6ff3ff;
  box-shadow: 0 0 8px #2ee6ff;
}

.panel-tip {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed rgba(46, 230, 255, 0.25);
  font-size: 11px;
  color: rgba(159, 232, 255, 0.55);
}

/* —— 底部状态条 —— */
.ft {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 7px 22px;
  border: 1px solid rgba(46, 230, 255, 0.3);
  border-radius: 999px;
  background: rgba(5, 22, 44, 0.7);
  font-size: 12px;
  letter-spacing: 2px;
  color: #8fd8f2;
}

.ft i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #2ee6ff;
  box-shadow: 0 0 6px #2ee6ff;
}
</style>
