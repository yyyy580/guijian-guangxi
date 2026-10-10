<template>
  <div class="city-map">
    <div ref="chartRef" class="map-canvas"></div>

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
      <p class="hint">点击景点标记查看故事</p>
    </header>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import 'echarts-gl'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import flags from '@/config/feature.flags'

const props = defineProps({
  city: { type: Object, required: true },
})
const store = useAppStore()
const chartRef = ref(null)
let chart = null

function darken(hex, ratio = 0.55) {
  const n = hex.replace('#', '')
  const f = (i) => Math.round(parseInt(n.slice(i, i + 2), 16) * (1 - ratio))
  return `rgb(${f(0)},${f(2)},${f(4)})`
}

function buildOption(geojson) {
  const spots = store.cityAttractions.map((a) => ({
    name: a.name,
    value: [a.coord[0], a.coord[1], 1.2],
    itemStyle: { color: props.city.color },
    attractionId: a.id,
  }))

  return {
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: 'rgba(7,19,31,0.92)',
      borderColor: 'rgba(125,211,252,0.35)',
      textStyle: { color: '#e8f1f8', fontSize: 13 },
      formatter: (p) => {
        const a = store.attractions[p.data?.attractionId]
        return a ? `<b>${a.name}</b><br/>${a.summary.slice(0, 42)}…<br/><span style="opacity:.65">点击查看故事 →</span>` : ''
      },
    },
    geo3D: {
      map: props.city.id,
      regionHeight: 2,
      shading: 'realistic',
      realisticMaterial: { roughness: 0.75, metalness: 0.05 },
      postEffect: { enable: true, bloom: { enable: true, intensity: 0.12 } },
      light: {
        main: { intensity: 1.3, shadow: true, alpha: 45, beta: -30 },
        ambient: { intensity: 0.55 },
      },
      boxWidth: 90,
      itemStyle: { color: darken(props.city.color, 0.75), borderColor: props.city.color, borderWidth: 1.2 },
      emphasis: { itemStyle: { color: darken(props.city.color, 0.45) } },
      viewControl: {
        alpha: 42,
        beta: 5,
        distance: 105,
        minDistance: 50,
        maxDistance: 180,
        autoRotate: true,
        autoRotateSpeed: 2,
        autoRotateAfterStill: 4,
      },
    },
    series: [
      {
        type: 'scatter3D',
        coordinateSystem: 'geo3D',
        data: spots,
        symbolSize: 18,
        label: {
          show: true,
          position: 'top',
          distance: 8,
          formatter: (p) => p.name,
          color: '#ffffff',
          fontSize: 14,
          fontWeight: 600,
          textBorderColor: 'rgba(7,19,31,0.9)',
          textBorderWidth: 2,
        },
        emphasis: { label: { fontSize: 16 }, itemStyle: { color: '#ffffff' } },
      },
    ],
  }
}

function onChartClick(params) {
  if (params.componentType === 'scatter3D' && params.data?.attractionId) {
    store.openAttraction(store.attractions[params.data.attractionId])
  }
}

onMounted(async () => {
  try {
    const geojson = await fetch(`/geojson/${props.city.id}.json`).then((r) => r.json())
    echarts.registerMap(props.city.id, geojson)
    chart = echarts.init(chartRef.value)
    chart.setOption(buildOption(geojson))
    chart.on('click', onChartClick)
    window.addEventListener('resize', handleResize)
    if (import.meta.env.DEV) window.__cityChart = chart
  } catch (err) {
    console.error('城市地图加载失败', err)
    ElMessage.error(`${props.city.fullName}地图数据加载失败`)
  }
})

function handleResize() {
  chart?.resize()
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chart?.dispose()
  chart = null
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
