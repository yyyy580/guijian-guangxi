<template>
  <div class="map-stage">
    <!-- 夜空氛围层：四色光雾 + 星尘 + 底部悬浮辉光（纯装饰，垫在地图底下，不拦截交互） -->
    <div class="nebula" aria-hidden="true"></div>
    <div class="starfield" aria-hidden="true">
      <span v-for="(s, i) in stars" :key="i" class="star" :style="s"></span>
      <span class="meteor"></span>
    </div>
    <div class="map-glow" aria-hidden="true"></div>

    <div ref="chartRef" class="map-canvas" aria-label="广西3D地图"></div>

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

    <!-- 右上数据徽标：一眼看到作品结构（右下被问答浮窗占据，放右上与标题对角平衡） -->
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
// 注意不能用 <script setup> 里的 let——setup 函数体每个组件实例都会重新执行，
// 组件随下钻/返回反复销毁重建时标志会被重置，动画就会重播
let introPlayed = false
// 应用层自转共享状态：echarts-gl 内置 autoRotate 的内部循环会被开卷动画期间
// 的每帧 setOption 搅死后不再恢复，故改由 GSAP 无限 tween 驱动 beta，跨实例常驻
const rotateState = { beta: 8 }
let rotateTl = null
let stillTimer = null
// 活实例的 OrbitControl 引用：自转的唯一写入点（相机直驱）+ 清残余拖拽速度用。
// notMerge 重建会换新 control，每次 finishIntro 后必须重新捕获
let rotateCtl = null
// 活实例 chart 的模块级引用：组件下钻/返回销毁重建后旧实例 chart 置 null，
// 闭包若捕获死引用就会写给已 dispose 的实例。所有跨实例写入必须走这两个模块级变量
let liveChart = null
</script>

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

/** 图例条下钻：与地图点击同一条路（selectCity + drill 事件由 HomeView 触发欢迎语） */
function drillTo(city) {
  if (!flags.cityDrilldown) return
  store.selectCity(city)
  emit('drill', city)
}

/** 星尘背景：实例化时随机撒一次（位置/大小/闪烁节奏），纯装饰不参与交互 */
const stars = Array.from({ length: 130 }, () => ({
  left: `${(Math.random() * 100).toFixed(2)}%`,
  top: `${(Math.random() * 100).toFixed(2)}%`,
  width: `${(Math.random() * 1.6 + 0.7).toFixed(2)}px`,
  height: `${(Math.random() * 1.6 + 0.7).toFixed(2)}px`,
  animationDelay: `${(Math.random() * 6).toFixed(2)}s`,
  animationDuration: `${(Math.random() * 3 + 3).toFixed(2)}s`,
}))

/** 城市色压暗作为地图区域着色（保持数据驱动，不硬编码区域颜色） */
function darken(hex, ratio = 0.55) {
  const n = hex.replace('#', '')
  const f = (i) => Math.round(parseInt(n.slice(i, i + 2), 16) * (1 - ratio))
  return `rgb(${f(0)},${f(2)},${f(4)})`
}

/** 区域色覆盖插值：t=0 与普通城市同为深蓝底色，t=1 覆盖为城市暗色（供逐城染色动画） */
function mixCityColor(hex, t) {
  const c = parseInt(hex.slice(1), 16)
  const base = 0x0d2c47
  const ch = (sh) => Math.round(((base >> sh) & 255) * (1 - t) + ((c >> sh) & 255) * 0.55 * t)
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
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
        beta: rotateState.beta,
        distance: 96,
        minDistance: 40,
        maxDistance: 200,
        // 关键①：echarts-gl 给 geo3D 的 viewControl 默认 minBeta/-maxBeta = ±80，
        // OrbitControl.setBeta 会把超限写入永久钳平——自转 3°/s 约 24s 撞墙后
        // "连转都不转"（模型经 echo 回写也被钉在 80，与 16db795 的"转一半停住"同根）。
        // 显式解除限位，自转/拖拽才能全向连续
        minBeta: -Infinity,
        maxBeta: Infinity,
        // 关键②：echarts-gl 每次渲染都会 setFromViewControlModel；animation 开着（全局默认
        // true + 300ms）时相机不直接落位而是 animateTo——每秒堆 60 个相机补间动画器互相
        // 覆盖且 _isAnimating 恒真挡掉拖拽。关掉后模型值直接落位，GSAP 驱动才真正生效
        animation: false,
        autoRotate: false, // 内置自转已弃用（会被动画 setOption 搅死），改由 ensureRotate 的 GSAP tween 驱动
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
    liveChart = chart
    chart.setOption(buildOption(geojson, store.cities))
    chart.on('click', onChartClick)
    chart.on('mouseover', onChartMouseOver)
    window.addEventListener('resize', handleResize)
    if (introPlayed) {
      finishIntro() // 二次进入（返回省图）：跳过开卷动画，直接全量呈现终态
    } else {
      introPlayed = true
      playIntro()
    }
    startAutoRotateWithInteraction()
    // dev 调试句柄：控制台可直接取实例诊断拾取/事件问题
    if (import.meta.env.DEV) {
      window.__mapChart = chart
      // 自转诊断：state=tween 活值 / chart()=活实例 / isPaused()=tween 暂停态
      window.__rotDiag = { state: rotateState, chart: () => chart, isPaused: () => !!rotateTl?.paused() }
    }
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

/**
 * 应用层自转：GSAP 无限 tween 匀速推进 beta（120s 一圈，同原 autoRotateSpeed 3），
 * onUpdate 相机直驱（见 onUpdate 注释）。与开卷动画控制的 alpha/distance 字段互不覆盖，可并行。
 * repeatRefresh 让每圈从当前值重新解析 '+=360'，避免 repeat 回跳。
 * tween 模块级常驻，组件销毁重建（rotateCtl 置空时 onUpdate 空转）后 resume 即无缝续转。
 */
function ensureRotate() {
  if (!chart) return
  if (rotateTl) {
    syncRotateFromCamera()
    rotateTl.resume()
    return
  }
  rotateTl = gsap.to(rotateState, {
    beta: '+=360',
    duration: 120,
    ease: 'none',
    repeat: -1,
    repeatRefresh: true,
    onUpdate: () => {
      if (!rotateCtl) return
      // 自转激活期间拖拽必然处于暂停态（tween 已 pause），此刻控制里任何残余
      // 拖拽速度都是非法状态（幻影事件/松手残量）。不清零的话其内部循环每帧
      // 会把速度再积分回 beta，和直驱写入互相打架
      rotateCtl._rotateVelocity?.set?.(0, 0)
      // 相机直驱：setBeta 只落 _phi + _needsUpdate，zr 帧循环里 control._update
      // 负责 _updateTransform 摆相机并 trigger('update')，由 echarts 把相机值回写模型。
      // 不走 setOption→模型→render 管线——实测该管线会被静默卡死（连手动 setOption
      // 的合并都被吞、内部标志全健康），一旦卡死模型与相机永久冻结在 80。直驱后
      // option 管线的死活不再影响自转
      rotateCtl.setBeta(rotateState.beta)
      // 旋转帧保持 zr 帧循环唤醒（Animation.start 有 _running 重入守卫，零开销）；
      // zr 静止 10 帧会自休眠，不唤醒的话 control._update 没有舞台，相机不会动
      rotateCtl.zr?.wakeUp?.()
    },
  })
}

/** 把 tween 的基准角对齐到相机真实朝向：用户拖拽后 rotateState 已过期，不同步会在恢复自转瞬间跳回旧角度 */
function syncRotateFromCamera() {
  const b = rotateCtl ? rotateCtl.getBeta() : liveChart?.getOption()?.geo3D?.[0]?.viewControl?.beta
  if (typeof b === 'number' && Number.isFinite(b)) rotateState.beta = b
}

/** 用户开始拖拽/缩放：暂停自转并清掉恢复计时 */
function pauseRotate() {
  rotateTl?.pause()
  clearTimeout(stillTimer)
}

/** 用户松手后静止 4 秒，从相机当前朝向恢复自转 */
function resumeRotateLater() {
  clearTimeout(stillTimer)
  stillTimer = setTimeout(() => {
    if (!rotateTl) return
    // 清掉 OrbitControl 残余拖拽速度：其内部循环每帧会把 _rotateVelocity 再积分回
    // beta 并 setView 回写模型，速度未衰减完时会和 tween 的写入互相打架
    rotateCtl?._rotateVelocity?.set?.(0, 0)
    syncRotateFromCamera()
    rotateTl.resume()
  }, 4000)
}

/** 挂接交互与自转：zrender 监听随 chart.dispose 自动释放 */
function startAutoRotateWithInteraction() {
  ensureRotate()
  captureControl()
  const zr = chart.getZr()
  zr.on('mousedown', pauseRotate)
  zr.on('mousewheel', pauseRotate)
  zr.on('mouseup', resumeRotateLater)
  // 鼠标拖出画布外才松开时 zrender 收不到 mouseup，globalout 兜底恢复计时
  // （与 echarts-gl OrbitControl 自身的 globalout 处理同一思路）
  zr.on('globalout', resumeRotateLater)
}

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
    // 拔起前与普通城市同为深蓝；高度长到七成后开始染色，到位时城市色刚好覆盖完成
    const colorP = Math.min(Math.max((p - 0.7) / 0.3, 0), 1)
    patch.push({
      name: c.fullName,
      height: st.base + (CITY_REGION_HEIGHT - st.base) * p,
      itemStyle: { color: mixCityColor(c.color, colorP) },
    })
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
  captureControl() // notMerge 重建换新 control，重捕获后 tween 直驱才落在活相机上
}

/** 捕获活实例的 OrbitControl：组件模型重建后 view/control 都是新的（自动 id 变更），
 * 引用必须随重建刷新，否则 tween 会写给已 dispose 的旧相机 */
function captureControl() {
  rotateCtl = chart?._componentsViews?.find?.((v) => v?.type === 'geo3D')?._control ?? null
}

function handleResize() {
  chart?.resize()
}

onBeforeUnmount(() => {
  introTl?.kill()
  introTl = null
  clearTimeout(stillTimer)
  rotateCtl = null
  liveChart = null
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
  overflow: hidden; /* 光雾/流星出界不产生滚动 */
}

/* ---------- 夜空氛围层 ---------- */
/* 四色光雾：取自四城主题色（桂林青/北海蓝/百色红/南宁绿），把四角死黑变成深邃夜空 */
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

/* 流星：长周期循环，只在前 7% 时间划过，其余时间隐身 */
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
  2% {
    opacity: 0.9;
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

/* 底部悬浮辉光：让 3D 地图像浮在发光海面上 */
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

/* 口号默认收起，hover 展开形成小惊喜 */
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
