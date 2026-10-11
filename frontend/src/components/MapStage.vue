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
import gsap from 'gsap'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import flags from '@/config/feature.flags'
import { welcomeOnce } from '@/composables/useVoice'

const MAP_NAME = 'guangxi'
const chartRef = ref(null)
const store = useAppStore()
const emit = defineEmits(['drill'])
let chart = null
let introTl = null          // 开场"开卷"动画时间线
let introRegions = []       // 初始 regions 数组引用（目标高度来源）
let regionTargets = []      // 各市目标浮雕高度（finishIntro 恢复用）
let cityHeights = new Map() // 四城 fullName → 目标高度（动画 patch 用）
let pillarLayers = null     // 光柱三层数据（动画结束回填最终态）

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
 * 透明热区球阵：覆盖全省 14 市。四城各 3 球（中心+东西偏移）点击即下钻；
 * 其余城市各 2 球（中心+小偏移），点击轻提示"敬请期待"——避免"点了没反应"。
 * geo3D 组件的区域点击在 echarts-gl 中不分发事件（见提交 c1ba084），
 * 故用拾取球近似实现区域交互。球透明不影响视觉，事件路径与光柱一致。
 */
const CITY_ZONE_OFFSETS = [[0, 0], [-0.55, 0.22], [0.55, -0.18]]

/** GeoJSON 要素近似质心（外环顶点均值，足够热区定位用） */
function featureCenter(f) {
  const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]
  let sx = 0
  let sy = 0
  for (const [x, y] of ring) {
    sx += x
    sy += y
  }
  return [sx / ring.length, sy / ring.length]
}

function buildHotzones(geojson, cities) {
  const cityMap = new Map(cities.map((c) => [c.fullName, c]))
  const zones = []
  for (const f of geojson.features) {
    const name = f.properties.name
    const city = cityMap.get(name)
    if (city) {
      const [lng, lat] = city.coord
      for (const [dx, dy] of CITY_ZONE_OFFSETS) {
        zones.push({
          name: city.name,
          value: [lng + dx, lat + dy, 0.25],
          itemStyle: { color: city.color, opacity: 0.01 },
          cityId: city.id,
        })
      }
    } else {
      const [cx, cy] = featureCenter(f)
      for (const [dx, dy] of [[0, 0], [0.35, 0.12]]) {
        zones.push({
          name,
          value: [cx + dx, cy + dy, 0.25],
          itemStyle: { color: '#143a5c', opacity: 0.01 },
          pendingName: name,
        })
      }
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
  // 非四城区域：轻提示，避免"点了没反应"
  if (params.data?.pendingName) {
    ElMessage.info(`${params.data.pendingName}·更多城市，敬请期待`)
    return
  }
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
  pillarLayers = buildPillarLayers(cities)
  const { beams, glows, tips } = pillarLayers
  const hotzones = buildHotzones(geojson, cities)
  introRegions = buildRegions(geojson, cities)
  regionTargets = introRegions.map((r) => r.regionHeight)
  cityHeights = new Map(introRegions.map((r) => [r.name, r.regionHeight]))
  return {
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: 'rgba(7,19,31,0.92)',
      borderColor: 'rgba(125,211,252,0.35)',
      textStyle: { color: '#e8f1f8', fontSize: 13 },
      formatter: (p) => {
        if (p.data?.pendingName) {
          return `<b style="font-size:14px">${p.data.pendingName}</b><br/><span style="opacity:.65">更多城市，敬请期待</span>`
        }
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
      regions: introRegions,
      emphasis: { itemStyle: { color: '#155e8f' } },
      selectedMode: false,
      temporalSuperSampling: { enable: true },
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
    playIntro()
    // dev 调试句柄：控制台可直接取实例诊断拾取/事件问题
    if (import.meta.env.DEV) window.__mapChart = chart
  } catch (err) {
    console.error('3D 地图加载失败', err)
    ElMessage.error('地图数据加载失败，请确认 content/geojson 资源可用')
  }
})

/**
 * 开场"开卷"动画：整个地形从平地隆起，镜头自高空俯冲压低，四色光柱随后依次生长。
 * GSAP 驱动统一进度 t∈[0,1]，每帧一次合并 setOption。
 * 关键：regions 必须传全新对象数组——echarts diff 对同引用数组会跳过更新
 * （首版地形不动即此因）；全局 regionHeight 走组件级补间带动整块浮雕。
 * 任何环节出错立即回填最终态，保证地图绝不残留在"平铺"状态。
 */
function playIntro() {
  if (!chart) return
  try {
    applyIntro(0)
    const proxy = { t: 0 }
    introTl = gsap.timeline({ onComplete: finishIntro })
    introTl.to(proxy, {
      t: 1,
      duration: 4.2,
      ease: 'power1.inOut',
      onUpdate: () => applyIntro(proxy.t),
    })
  } catch (err) {
    console.warn('开场动画失败，直接呈现完整地图', err)
    finishIntro()
  }
}

function applyIntro(t) {
  if (!chart) return
  // 前 65% 进度：地形整体隆起（全局基准 0.1→3）；镜头同步高空俯冲压低
  const hScale = Math.min(t / 0.65, 1)
  const camScale = Math.min(t / 0.6, 1)
  const base = 0.1 + 2.9 * hScale
  const alpha = 78 - 32 * camScale
  const distance = 140 - 44 * camScale
  // 四城在后段（55%~90%）从基准继续长到各自目标高度
  const cityScale = Math.min(Math.max((t - 0.55) / 0.35, 0), 1)
  const patch = []
  for (const c of store.cities) {
    const target = cityHeights.get(c.fullName)
    if (target == null) continue
    patch.push({ name: c.fullName, regionHeight: base + (target - base) * cityScale })
  }
  const beamsData = []
  const glowsData = []
  const tipsData = []
  store.cities.forEach((c, i) => {
    const p = Math.min(Math.max((t - 0.5 - i * 0.07) / 0.28, 0), 1)
    const [lng, lat] = c.coord
    const h = c.pillarHeight ?? 2.5
    beamsData.push(
      { coords: [[lng, lat, 0], [lng, lat, h * p]], lineStyle: { color: c.color, width: 5, opacity: 0.85 * p } },
      { coords: [[lng, lat, 0], [lng, lat, h * p]], lineStyle: { color: '#ffffff', width: 1.2, opacity: 0.5 * p } },
    )
    glowsData.push({ name: c.name, value: [lng, lat, 0.05], itemStyle: { color: c.color, opacity: 0.22 * p } })
    tipsData.push({
      name: c.name,
      value: [lng, lat, h * p],
      itemStyle: { color: c.color, opacity: p },
      label: { opacity: p },
      cityId: c.id,
      fullName: c.fullName,
    })
  })
  chart.setOption({
    geo3D: {
      regionHeight: base,
      regions: patch,
      viewControl: { alpha, distance },
    },
    series: [
      { data: beamsData },
      { data: glowsData },
      { data: tipsData },
    ],
  })
}

function finishIntro() {
  introTl?.kill()
  introTl = null
  if (!chart || !pillarLayers) return
  introRegions.forEach((r, i) => {
    r.regionHeight = regionTargets[i]
  })
  chart.setOption({
    geo3D: {
      regionHeight: 3,
      viewControl: { alpha: 46, distance: 96 },
      regions: introRegions.map((r) => ({ ...r })),
    },
    series: [
      { data: pillarLayers.beams },
      { data: pillarLayers.glows },
      { data: pillarLayers.tips },
    ],
  })
}

function handleResize() {
  chart?.resize()
}

onBeforeUnmount(() => {
  introTl?.kill()
  introTl = null
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
