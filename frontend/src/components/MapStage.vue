<template>
  <div class="map-stage">
    <div ref="chartRef" class="map-canvas" aria-label="广西3D地图"></div>

    <header class="stage-hud">
      <h1 class="stage-title">桂见<span class="accent">广西</span></h1>
      <p class="stage-sub">拖动旋转 · 滚轮缩放 · 点击城市任意区域或光柱进入</p>
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
import { welcomeOnce } from '@/composables/useVoice'

const MAP_NAME = 'guangxi'
const chartRef = ref(null)
const store = useAppStore()
const emit = defineEmits(['drill'])
let chart = null

/** 城市色压暗作为地图区域着色（保持数据驱动，不硬编码区域颜色） */
function darken(hex, ratio = 0.55) {
  const n = hex.replace('#', '')
  const f = (i) => Math.round(parseInt(n.slice(i, i + 2), 16) * (1 - ratio))
  return `rgb(${f(0)},${f(2)},${f(4)})`
}

/** 14 个地级市浮雕高度：四城略高并着城市色暗调，其余按固定伪随机起伏 */
function buildRegions(geojson, cities) {
  const cityMap = new Map(cities.map((c) => [c.fullName, c]))
  return geojson.features.map((f, i) => {
    const name = f.properties.name
    const city = cityMap.get(name)
    const region = {
      name,
      regionHeight: city ? 4.2 : 2 + ((i * 7) % 5) * 0.7,
    }
    if (city) region.itemStyle = { color: darken(city.color) }
    return region
  })
}

/** 四色光柱：竖直光束（双层辉光）+ 底部光晕 + 顶端可交互光球 */
function buildPillarLayers(cities) {
  const beams = []
  const glows = []
  const tips = []
  for (const c of cities) {
    const [lng, lat] = c.coord
    const h = c.pillarHeight ?? 2.5
    beams.push(
      { coords: [[lng, lat, 0], [lng, lat, h]], lineStyle: { color: c.color, width: 5, opacity: 0.85 } },
      { coords: [[lng, lat, 0], [lng, lat, h]], lineStyle: { color: '#ffffff', width: 1.2, opacity: 0.5 } }
    )
    glows.push({ name: c.name, value: [lng, lat, 0.05], itemStyle: { color: c.color, opacity: 0.22 } })
    tips.push({
      name: c.name,
      value: [lng, lat, h],
      itemStyle: { color: c.color },
      cityId: c.id,
      fullName: c.fullName,
    })
  }
  return { beams, glows, tips }
}

/**
 * 透明热区球阵：每城 3 个（中心+东西偏移）覆盖城市主要区域。
 * geo3D 组件的区域点击在 echarts-gl 中不分发事件（见提交 c1ba084），
 * 且 map3D 系列坐标系不对外、双 viewGL 相机无法同步，故用拾取球近似实现
 * "点击城市任意区域即下钻"。球透明不影响视觉，事件路径与光柱一致。
 */
function buildHotzones(cities) {
  const OFFSETS = [[0, 0], [-0.55, 0.22], [0.55, -0.18]]
  const zones = []
  for (const c of cities) {
    const [lng, lat] = c.coord
    for (const [dx, dy] of OFFSETS) {
      zones.push({
        name: c.name,
        value: [lng + dx, lat + dy, 0.25],
        itemStyle: { color: c.color, opacity: 0.01 },
        cityId: c.id,
      })
    }
  }
  return zones
}

function resolveCity(params) {
  // echarts 事件参数规则：series（含 scatter3D）的 params.componentType 恒为 'series'，
  // 真实类型在 params.seriesType。因此以 data.cityId 为可靠判据。
  const d = params.data
  if (d?.cityId) {
    return store.cities.find((c) => c.id === d.cityId)
  }
  return null
}

function onChartClick(params) {
  const city = resolveCity(params)
  if (!city) return
  store.selectCity(city)
  // 下钻转场本身就是视觉反馈；语音欢迎由 HomeView 在进入城市时触发
  emit('drill', city)
}

function onChartMouseOver(params) {
  // hover 光柱/城市区域的欢迎彩蛋：每会话每城只播一次
  welcomeOnce(resolveCity(params))
}

function buildOption(geojson, cities) {
  const { beams, glows, tips } = buildPillarLayers(cities)
  const hotzones = buildHotzones(cities)
  return {
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: 'rgba(7,19,31,0.92)',
      borderColor: 'rgba(125,211,252,0.35)',
      textStyle: { color: '#e8f1f8', fontSize: 13 },
      formatter: (p) => {
        const city = resolveCity(p)
        return city
          ? `<b style="font-size:14px">${city.fullName}</b><br/>${city.slogan}<br/><span style="opacity:.65">点击进入 →</span>`
          : ''
      },
    },
    geo3D: {
      map: MAP_NAME,
      regionHeight: 3,
      shading: 'realistic',
      realisticMaterial: { roughness: 0.7, metalness: 0.1 },
      postEffect: {
        enable: true,
        bloom: { enable: true, intensity: 0.15 },
        depthOfField: { enable: false },
      },
      light: {
        main: { intensity: 1.4, shadow: true, alpha: 42, beta: -32 },
        ambient: { intensity: 0.5 },
      },
      boxWidth: 82,
      groundPlane: { show: false },
      itemStyle: { color: '#0d2c47', borderColor: 'rgba(125,211,252,0.45)', borderWidth: 1 },
      regions: buildRegions(geojson, cities),
      emphasis: { itemStyle: { color: '#155e8f' } },
      selectedMode: false,
      viewControl: {
        alpha: 46,
        beta: 8,
        distance: 96,
        minDistance: 40,
        maxDistance: 200,
        autoRotate: true,
        autoRotateSpeed: 3,
        autoRotateAfterStill: 4,
      },
    },
    series: [
      { type: 'lines3D', coordinateSystem: 'geo3D', data: beams, blendMode: 'lighter', silent: true },
      { type: 'scatter3D', coordinateSystem: 'geo3D', data: glows, symbolSize: 20, silent: true },
      {
        type: 'scatter3D',
        coordinateSystem: 'geo3D',
        data: tips,
        symbolSize: 26,
        label: {
          show: true,
          position: 'top',
          distance: 6,
          formatter: (p) => p.name,
          color: '#ffffff',
          fontSize: 15,
          fontWeight: 600,
          textBorderColor: 'rgba(7,19,31,0.9)',
          textBorderWidth: 2,
        },
        emphasis: {
          label: { fontSize: 18 },
          itemStyle: { color: '#ffffff' },
        },
      },
      {
        // 透明热区球：贴地大半径，点击/悬停 = 进入该城市（覆盖光柱以外的区域）
        type: 'scatter3D',
        coordinateSystem: 'geo3D',
        data: hotzones,
        symbolSize: 48,
      },
    ],
  }
}

onMounted(async () => {
  if (!flags.map3D) return
  try {
    const [geojson, citiesJson] = await Promise.all([
      fetch('/geojson/guangxi.json').then((r) => r.json()),
      store.cities.length ? Promise.resolve({ cities: store.cities }) : fetch('/cities.json').then((r) => r.json()),
    ])
    store.setCities(citiesJson.cities)
    echarts.registerMap(MAP_NAME, geojson)

    chart = echarts.init(chartRef.value)
    chart.setOption(buildOption(geojson, store.cities))
    chart.on('click', onChartClick)
    chart.on('mouseover', onChartMouseOver)
    window.addEventListener('resize', handleResize)
    // dev 调试句柄：控制台可直接取实例诊断拾取/事件问题
    if (import.meta.env.DEV) window.__mapChart = chart
  } catch (err) {
    console.error('3D 地图加载失败', err)
    ElMessage.error('地图数据加载失败，请确认 content/geojson 资源可用')
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
.map-stage {
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
