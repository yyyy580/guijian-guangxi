<template>
  <div class="city-map">
    <!-- Three.js 画布容器：区县挤出浮雕 + 景点光柱 + 氛围件（视觉与首页省图一致） -->
    <div ref="stageRef" class="map-canvas" :aria-label="`${city.name}3D地图`"></div>

    <!-- CSS2D 标签层容器：景点名标签（pointer-events none，不挡拖拽/点击） -->
    <div ref="labelEl" class="label-holder" aria-hidden="true"></div>

    <!-- 景点 hover 跟随提示 -->
    <div
      v-show="tooltip.show"
      class="spot-tip"
      :style="{ left: tooltip.x + 14 + 'px', top: tooltip.y + 14 + 'px' }"
    >
      <b>{{ tooltip.name }}</b>
      <span>{{ tooltip.summary }}</span>
      <i>点击查看故事 →</i>
    </div>

    <!-- 景点清单：信息展示 + 100% 可靠的卡片入口（不依赖 3D 拾取） -->
    <aside class="spot-list">
      <h3>{{ city.name }}景点</h3>
      <button
        v-for="a in store.cityAttractions"
        :key="a.id"
        class="spot-item"
        :style="{ '--city-color': city.color }"
        @click="store.openAttraction(a)"
      >
        <i class="dot" :style="{ background: city.color, boxShadow: `0 0 8px ${city.color}` }"></i>
        <span class="name">{{ a.name }}</span>
        <span class="tags">{{ a.tags.join(' / ') }}</span>
      </button>
    </aside>

    <header class="city-hud">
      <button class="back-btn" @click="store.backToProvince()">
        <span class="arrow">←</span> 返回广西
      </button>
      <div class="city-head">
        <h2 :style="{ color: city.color }">{{ city.fullName }}</h2>
        <p>{{ city.slogan }}</p>
      </div>
      <p class="hint">拖动旋转 · 点击景点光柱，查看它的故事</p>
    </header>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { useCityMap3d } from '@/composables/useCityMap3d'

const props = defineProps({
  city: { type: Object, required: true },
})
const store = useAppStore()
const stageRef = ref(null)
const labelEl = ref(null)
let api = null
const tooltip = reactive({ show: false, name: '', summary: '', x: 0, y: 0 })

onMounted(async () => {
  api = useCityMap3d()
  try {
    await api.init(stageRef.value, labelEl.value, {
      city: props.city,
      attractions: store.cityAttractions,
      onPick: (a) => store.openAttraction(a),
      onHoverSpot: (info) => {
        tooltip.show = !!info
        if (info) {
          tooltip.name = info.attraction.name
          tooltip.summary = info.attraction.summary.slice(0, 42) + '…'
          tooltip.x = info.x
          tooltip.y = info.y
        }
      },
    })
  } catch (err) {
    console.error('城市地图加载失败', err)
    ElMessage.error(err?.message || `${props.city.fullName}地图加载失败`)
  }
})

onBeforeUnmount(() => {
  api?.dispose(stageRef.value, labelEl.value)
  api = null
})
</script>

<style scoped>
.city-map {
  position: relative;
  width: 100%;
  height: 100%;
  background: radial-gradient(ellipse at 50% 30%, #0c2136 0%, var(--bg-deep) 70%);
}

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

/* ---------- 景点 hover 提示 ---------- */
.spot-tip {
  position: fixed;
  z-index: 20;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 260px;
  padding: 9px 14px;
  border-radius: 8px;
  border: 1px solid rgba(125, 211, 252, 0.4);
  background: rgba(7, 19, 31, 0.9);
  color: #e8f1f8;
  font-size: 13px;
  backdrop-filter: blur(4px);
}

.spot-tip b {
  color: var(--city-color, #7dd3fc);
  letter-spacing: 1px;
}

.spot-tip span {
  font-size: 12px;
  color: rgba(232, 241, 248, 0.72);
  line-height: 1.5;
}

.spot-tip i {
  font-style: normal;
  font-size: 11px;
  color: rgba(125, 211, 252, 0.8);
}

.city-hud {
  position: absolute;
  top: 28px;
  left: 36px;
  user-select: none;
}

.back-btn {
  pointer-events: auto;
  background: var(--bg-panel);
  color: var(--text-main);
  border: 1px solid rgba(125, 211, 252, 0.35);
  border-radius: 999px;
  padding: 8px 18px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.25s ease;
}

.back-btn:hover {
  border-color: var(--accent);
  background: rgba(56, 189, 248, 0.12);
}

.back-btn .arrow {
  margin-right: 4px;
}

.city-head {
  margin-top: 18px;
}

.city-head h2 {
  font-size: 40px;
  font-weight: 700;
  letter-spacing: 8px;
}

.city-head p {
  margin-top: 6px;
  color: var(--text-dim);
  font-size: 14px;
  letter-spacing: 2px;
}

.hint {
  margin-top: 14px;
  font-size: 12px;
  color: var(--text-dim);
  opacity: 0.8;
}

.spot-list {
  position: absolute;
  left: 36px;
  bottom: 36px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 240px;
}

.spot-list h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  letter-spacing: 3px;
  margin-bottom: 2px;
}

.spot-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: var(--bg-panel);
  border: 1px solid rgba(125, 211, 252, 0.18);
  border-radius: 12px;
  color: var(--text-main);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.25s ease;
  text-align: left;
}

.spot-item:hover {
  border-color: var(--city-color, var(--accent));
  transform: translateX(4px);
  background: rgba(56, 189, 248, 0.08);
}

.spot-item .dot {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.spot-item .name {
  font-weight: 600;
  letter-spacing: 1px;
}

.spot-item .tags {
  font-size: 11px;
  color: var(--text-dim);
  margin-left: auto;
}
</style>

<style>
/* CSS2D 景点标签（JS 动态创建，scoped 不生效，必须全局）：
   白字 + 城市色辉光（--spot-color 由 composable 按城市注入） */
.gx-spot-label {
  color: #ffffff;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 2px;
  white-space: nowrap;
  text-shadow:
    0 0 8px var(--spot-color, rgba(46, 230, 255, 0.9)),
    0 0 16px rgba(0, 180, 255, 0.5),
    0 1px 3px rgba(0, 0, 0, 0.65);
}
</style>
