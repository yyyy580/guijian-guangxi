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
let introGeojson = null     // 地图 GeoJSON 引用（finishIntro 全量重建用）
let introRegions = []       // 初始 regions（四城带 height 目标值）
let pillarLayers = null     // 光柱三层数据（动画结束回填最终态）

/** 城市色压暗作为地图区域着色（保持数据驱动，不硬编码区域颜色） */
function darken(hex, ratio = 0.55) {
  const n = hex.replace('#', '')
  const f = (i) => Math.round(parseInt(n.slice(i, i + 2), 16) * (1 - ratio))
  return `rgb(${f(0)},${f(2)},${f(4)})`
}

/** 14 个地级市浮雕高度：四城明确高一层（5）并着城市色暗调，其余继承组件级基准矮层（2.4）。
 * 注意 echarts-gl 字段名：区域级高度是 height（regionHeight 是 geo3D 组件级基准），
 * 此前误用 regionHeight 导致区域高度从未生效（见用户截图反馈）。 */
const CITY_REGION_HEIGHT = 5
const PLAIN_REGION_HEIGHT = 2.4

function buildRegions(geojson, cities) {
  const cityMap = new Map(cities.map((c) => [c.fullName, c]))
  return geojson.features.map((f) => {
    const name = f.properties.name
    const city = cityMap.get(name)
    const region = { name }
    if (city) {
      region.height = CITY_REGION_HEIGHT
      region.itemStyle = { color: darken(city.color) }
    }
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
  introGeojson = geojson
  introRegions = buildRegions(geojson, cities)
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
      regionHeight: PLAIN_REGION_HEIGHT,
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
 * 开场"开卷"动画：
 * 第一步（0~2.7s）整个地形从平地隆起到矮层，镜头同步自高空俯冲压低；
 * 第二步四城按指定顺序逐个拔起到高台：百色→桂林→南宁→北海，开始时刻间隔 2 秒，
 * 每城生长 0.9s，光柱随本城拔起同步生长点亮。
 * 每帧一次合并 setOption；regions 传全新对象数组（echarts 对同引用数组跳过 diff）。
 * 任何环节出错立即 finishIntro 全量重建，保证地图绝不残留在"平铺"状态。
 */
const INTRO_CITY_ORDER = ['baise', 'guilin', 'nanning', 'beihai']

function playIntro() {
  if (!chart) return
  try {
    const st = { base: 0.1, cam: 0, h: [0, 0, 0, 0] }
    const render = () => renderIntro(st)
    render()
    introTl = gsap.timeline({ onComplete: finishIntro })
    // 全体隆起 + 镜头俯冲
    introTl.to(st, { base: PLAIN_REGION_HEIGHT, duration: 2.7, ease: 'power1.inOut', onUpdate: render }, 0)
    introTl.to(st, { cam: 1, duration: 2.4, ease: 'power1.out', onUpdate: render }, 0)
    // 四城逐个拔起（开始时刻间隔 2 秒，生长 0.9s），光柱随本城同步生长
    INTRO_CITY_ORDER.forEach((id, i) => {
      introTl.to(
        st.h,
        { [i]: 1, duration: 0.9, ease: 'power2.out', onUpdate: render },
        2.7 + i * 2,
      )
    })
  } catch (err) {
    console.warn('开场动画失败，直接呈现完整地图', err)
    finishIntro()
  }
}

function renderIntro(st) {
  if (!chart) return
  const alpha = 78 - 32 * st.cam
  const distance = 140 - 44 * st.cam
  const patch = []
  const beamsData = []
  const glowsData = []
  const tipsData = []
  store.cities.forEach((c) => {
    const idx = INTRO_CITY_ORDER.indexOf(c.id)
    const p = idx >= 0 ? st.h[idx] : 0
    const [lng, lat] = c.coord
    const h = c.pillarHeight ?? 2.5
    patch.push({ name: c.fullName, height: st.base + (CITY_REGION_HEIGHT - st.base) * p })
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
      regionHeight: st.base,
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
  if (!chart || !pillarLayers || !introGeojson) return
  // 全量替换（notMerge）强制重建全部区域 mesh——四城高台一定呈现，
  // 不赌 region 级热更新是否生效；事件绑定在 chart 实例上不受影响
  chart.setOption(buildOption(introGeojson, store.cities), true)
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
