/**
 * 广西壮族自治区 3D 数据可视化大屏 —— Three.js 场景编排
 *
 * 结构：本 composable 负责全部 Three.js 生命周期，Vue 组件只关心 UI 开关。
 *   1. 场景初始化：透视相机 + OrbitControls + 环境光/平行光 + 深空蓝背景
 *   2. 地图渲染：d3-geo 投影 GeoJSON → Shape → ExtrudeGeometry（顶面深青/侧面深蓝）
 *      + EdgesGeometry 亮青描边 + 底部倒影（克隆 Y 翻转渐隐）+ 旋转虚线光圈
 *   3. 数据特效：青蓝渐变光柱（顶部辉光贴图）、漂浮粒子、南宁中心抛物线飞线
 *   4. 标注：CSS2DRenderer 渲染 HTML 城市标签（如"南宁 · 874万"）
 *   5. 后期：EffectComposer + UnrealBloomPass 全局辉光
 *   6. dispose：onUnmounted 时几何体/材质/贴图/渲染器全量销毁，防内存泄漏
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { geoMercator, geoArea } from 'd3-geo'
import gsap from 'gsap'

/** 14 市常住人口（2020 七普，万人）——光柱高度与标签数字的数据源 */
export const CITY_POPULATION = {
  南宁市: 874, 玉林市: 580, 桂林市: 493, 贵港市: 432, 柳州市: 416,
  百色市: 357, 河池市: 342, 钦州市: 330, 梧州市: 282, 崇左市: 209,
  来宾市: 207, 贺州市: 201, 北海市: 185, 防城港市: 105,
}

const GEO_URL = '/geo/450000_full.json' // 广西 14 市 GeoJSON（DatV 数据，已本地化防演示断网）
const MAP_SIZE = 100                    // 地图投影后的平面尺寸（世界单位）
const DEPTH = 2.2                       // 挤出厚度

// ---------- 画布纹理工厂（光晕/粒子/流光都靠 Canvas 贴图，零外部资源） ----------

/** 径向发光贴图：中心白亮 → 边缘透明（光柱顶辉光 / 粒子共用） */
function makeGlowTexture(inner = 'rgba(190,255,255,1)', outer = 'rgba(0,180,255,0)') {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, inner)
  grad.addColorStop(0.35, 'rgba(110,231,255,0.55)')
  grad.addColorStop(1, outer)
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 流光贴图：横向两段"暗→亮→暗"，RepeatWrapping 靠 offset 动画实现流动 */
function makeFlowTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 16
  const g = c.getContext('2d')
  for (let i = 0; i < 2; i++) {
    const grad = g.createLinearGradient(i * 128, 0, i * 128 + 128, 0)
    grad.addColorStop(0, 'rgba(0,229,255,0)')
    grad.addColorStop(0.5, 'rgba(190,255,255,0.95)')
    grad.addColorStop(1, 'rgba(0,229,255,0)')
    g.fillStyle = grad
    g.fillRect(i * 128, 0, 128, 16)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.repeat.x = 2
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function useGuangxiScreen() {
  // Three 核心对象句柄（init 后填充）
  let scene, camera, renderer, labelRenderer, composer, controls, rafId = 0
  let mapRoot = null                 // 整个地图根组（局部 xy=平面，z=高度轴）
  const layers = {}                  // 特效分层：{ beams, flights, particles, reflection, ripple, outline }
  const labelObjects = []            // CSS2D 城市标牌
  const cityMeshes = []              // 各市顶面网格（"刷色图"开关在此切换）
  const flowTextures = []            // 飞线流光贴图（每帧推进 offset）
  const rippleRings = []             // 波纹圆环（相位动画）
  const dashLoops = []               // 虚线光圈（旋转动画）
  const disposables = new Set()      // 统一登记 geometry/material/texture，销毁时全量释放

  const reg = (x) => (disposables.add(x), x)

  /** 环绕向归一：数据绕向与 d3 球面约定相反时，d3 把每市当成"除该市外的
   * 整个球面"（geoArea≈4π），fitSize 按全世界定标尺、坐标全部坍缩。
   * 逐要素检测球面面积，超过半球（2π）即反转该市全部环（自愈，不挑数据源） */
  function normalizeRingWinding(geojson) {
    for (const f of geojson.features) {
      const g = f.geometry
      if (!g) continue
      if (geoArea(f) <= Math.PI * 2) continue
      if (g.type === 'MultiPolygon') {
        g.coordinates = g.coordinates.map((poly) => poly.map((ring) => ring.slice().reverse()))
      } else if (g.type === 'Polygon') {
        g.coordinates = g.coordinates.map((ring) => ring.slice().reverse())
      }
    }
    return geojson
  }

  /** d3-geo 墨卡托投影：GeoJSON 经纬度 → 地图平面坐标（居中，y 已翻转适配 Three） */
  function makeProjector(geojson) {
    const proj = geoMercator().fitSize([MAP_SIZE, MAP_SIZE], geojson)
    return ([lon, lat]) => {
      const [x, y] = proj([lon, lat])
      return [x - MAP_SIZE / 2, MAP_SIZE / 2 - y] // 平移到原点 + 屏幕系 y 翻转为数学系
    }
  }

  /** GeoJSON 多边形（含洞）→ THREE.Shape */
  function polygonToShape(ring, projector) {
    const shape = new THREE.Shape()
    ring[0].forEach(([lon, lat], i) => {
      const [x, y] = projector([lon, lat])
      i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)
    })
    for (let h = 1; h < ring.length; h++) {
      const hole = new THREE.Path()
      ring[h].forEach(([lon, lat], i) => {
        const [x, y] = projector([lon, lat])
        i === 0 ? hole.moveTo(x, y) : hole.lineTo(x, y)
      })
      shape.holes.push(hole)
    }
    return shape
  }

  // ---------- 地图主体：挤出板块 + 描边 + 刷色 ----------
  function buildMap(geojson, project) {
    mapRoot = new THREE.Group()
    mapRoot.rotation.x = -Math.PI / 2 // 局部 z 轴竖起为世界高度轴
    scene.add(mapRoot)

    const topUniform = reg(new THREE.MeshPhongMaterial({
      color: new THREE.Color('#0e4a5e'), shininess: 70, specular: new THREE.Color('#2ee6ff'),
    })) // "刷色图"关闭时的统一顶面
    const sideMat = reg(new THREE.MeshPhongMaterial({ color: new THREE.Color('#0a2547') }))

    geojson.features.forEach((f, idx) => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      const group = new THREE.Group()
      const name = f.properties.name
      const center = f.properties.centroid || f.properties.center

      polys.forEach((poly) => {
        const shape = polygonToShape(poly, project)
        const geo = reg(new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false }))
        const mesh = new THREE.Mesh(geo, [topUniform, sideMat])
        group.add(mesh)

        // 亮青描边：EdgesGeometry 按夹角过滤共面三角边，只留结构棱线
        const edges = new THREE.LineSegments(
          reg(new THREE.EdgesGeometry(geo, 30)),
          reg(new THREE.LineBasicMaterial({ color: new THREE.Color('#35e0ff'), transparent: true, opacity: 0.75 })),
        )
        group.add(edges)
      })

      // "刷色图"：每市顶面独立材质，按索引在青绿-深青间刷色；关闭时回到统一色
      if (center) {
        const tinted = reg(new THREE.MeshPhongMaterial({
          color: new THREE.Color().setHSL(0.5 + (idx % 5) * 0.022, 0.75, 0.2 + (idx % 4) * 0.035),
          shininess: 70, specular: new THREE.Color('#2ee6ff'),
        }))
        tinted.userData.plain = topUniform
        cityMeshes.push({ group, tinted, name })
        group.children.forEach((ch) => ch.isMesh && (ch.material = [tinted, sideMat]))
      }
      mapRoot.add(group)
    })
  }

  // ---------- 倒影：克隆地图 z 镜像（浅而淡，无需渐隐遮罩） ----------
  function buildReflection() {
    const refl = mapRoot.clone(true)
    refl.scale.z = -1 // 局部 z 即高度轴，镜像即倒影
    refl.traverse((o) => {
      if (o.isMesh) {
        o.material = reg(new THREE.MeshBasicMaterial({
          color: new THREE.Color('#0fb8d4'), transparent: true, opacity: 0.14, depthWrite: false,
        }))
      } else if (o.isLine) o.visible = false // 倒影不描边，更镜面
    })
    const group = new THREE.Group()
    group.add(refl)
    // 渐隐遮罩已删：倒影仅镜像挤出厚度（2.2 单位深）且透明度极低，
    // 原遮罩 170×34 误加 rotation.x=π/2 立成竖板、position.y 又误用平面轴，
    // 横亘在画面下部形成长方形阴影（用户在首页红圈实锤，大屏同款一并移除）
    layers.reflection = group
    mapRoot.add(group)
  }

  // ---------- 旋转虚线光圈（地图底部装饰） ----------
  function buildDashLoops() {
    const group = new THREE.Group()
    ;[46, 56].forEach((r, i) => {
      const pts = new THREE.EllipseCurve(0, 0, r, r * 0.96).getPoints(160)
      const geo = reg(new THREE.BufferGeometry().setFromPoints(pts))
      const mat = reg(new THREE.LineDashedMaterial({
        color: new THREE.Color('#2ee6ff'), dashSize: 3.2, gapSize: 2.2,
        transparent: true, opacity: 0.5 - i * 0.15,
      }))
      const loop = new THREE.Line(geo, mat)
      loop.computeLineDistances() // 虚线必需
      loop.position.z = -1.2 - i * 0.6
      dashLoops.push(loop)
      group.add(loop)
    })
    layers.ring = group
    mapRoot.add(group)
  }

  // ---------- 波纹：三圈相位错开的扩散圆环 ----------
  function buildRipple() {
    const group = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        reg(new THREE.RingGeometry(1, 1.18, 96)),
        reg(new THREE.MeshBasicMaterial({
          color: new THREE.Color('#27d8ff'), transparent: true, opacity: 0.55,
          side: THREE.DoubleSide, depthWrite: false,
        })),
      )
      ring.rotation.x = Math.PI / 2
      ring.position.z = -0.8
      ring.userData.phase = i / 3 // 三环相位均分，形成连绵扩散
      rippleRings.push(ring)
      group.add(ring)
    }
    layers.ripple = group
    mapRoot.add(group)
  }

  // ---------- 光柱：各市垂直渐变柱体 + 顶部辉光 ----------
  function buildBeams(geojson, project) {
    const group = new THREE.Group()
    const glowTex = reg(makeGlowTexture())

    geojson.features.forEach((f) => {
      const c = f.properties.centroid || f.properties.center
      if (!c) return
      const [x, y] = project(c)
      const pop = CITY_POPULATION[f.properties.name] || 100
      const h = 4 + (pop / 874) * 15 // 人口映射柱高：南宁最高约 19

      const beam = new THREE.Group()
      beam.position.set(x, y, 0)

      // 青蓝渐变柱：ShaderMaterial 按柱体 uv.y 从深蓝过渡到亮青，顶亮底透
      const geo = reg(new THREE.CylinderGeometry(0.32, 0.55, h, 18, 1, true))
      const mat = reg(new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: {
          cBottom: { value: new THREE.Color('#0a5f8a') },
          cTop: { value: new THREE.Color('#8ffaff') },
        },
        vertexShader: /* glsl */`
          varying float vY;
          void main() { vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`
          uniform vec3 cBottom; uniform vec3 cTop; varying float vY;
          void main() {
            vec3 col = mix(cBottom, cTop, vY);
            gl_FragColor = vec4(col, 0.18 + vY * 0.72); // 底部通透、顶部凝实
          }`,
      }))
      const cylinder = new THREE.Mesh(geo, mat)
      cylinder.rotation.x = Math.PI / 2 // 柱体沿局部 z（高度轴）竖起
      cylinder.position.z = h / 2
      beam.add(cylinder)

      // 顶部发光贴图：加色混合的辉光精灵
      const sprite = new THREE.Sprite(reg(new THREE.SpriteMaterial({
        map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })))
      sprite.scale.setScalar(3.4)
      sprite.position.z = h + 0.9
      beam.add(sprite)

      group.add(beam)
    })
    layers.beams = group
    mapRoot.add(group)
  }

  // ---------- 飞线：南宁 → 13 市抛物线 + 流光动画 ----------
  function buildFlights(geojson, project) {
    const group = new THREE.Group()
    const flowTex = reg(makeFlowTexture())
    flowTextures.push(flowTex)
    const centers = geojson.features.map((f) => ({
      name: f.properties.name,
      c: f.properties.centroid || f.properties.center,
    }))
    const hub = centers.find((c) => c.name === '南宁市')
    if (!hub) return
    const toLocal = ([lon, lat]) => { const [x, y] = project([lon, lat]); return new THREE.Vector3(x, y, DEPTH) }

    centers.forEach(({ name, c }) => {
      if (!c || name === hub.name) return
      const from = toLocal(hub.c)
      const to = toLocal(c)
      const mid = from.clone().add(to).multiplyScalar(0.5)
      mid.z += from.distanceTo(to) * 0.32 // 抛物线抬升：距离越远拱越高
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to)
      const tube = new THREE.Mesh(
        reg(new THREE.TubeGeometry(curve, 72, 0.14, 8, false)),
        reg(new THREE.MeshBasicMaterial({
          map: flowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        })),
      )
      group.add(tube)
      // 落点小光环，强化"抵达感"
      const ring = new THREE.Mesh(
        reg(new THREE.RingGeometry(0.5, 0.72, 32)),
        reg(new THREE.MeshBasicMaterial({
          color: new THREE.Color('#66f2ff'), transparent: true, opacity: 0.6,
          side: THREE.DoubleSide, depthWrite: false,
        })),
      )
      ring.position.copy(to)
      group.add(ring)
    })
    layers.flights = group
    mapRoot.add(group)
  }

  // ---------- 漂浮粒子 ----------
  function buildParticles() {
    const N = 620
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * MAP_SIZE * 1.5
      pos[i * 3 + 1] = (Math.random() - 0.5) * MAP_SIZE * 1.3
      pos[i * 3 + 2] = 2 + Math.random() * 16 // 悬浮在地图上空
    }
    const geo = reg(new THREE.BufferGeometry())
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const points = new THREE.Points(geo, reg(new THREE.PointsMaterial({
      size: 0.85, map: reg(makeGlowTexture('rgba(210,255,255,1)')),
      transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, color: new THREE.Color('#7fe9ff'),
    })))
    layers.particles = points
    mapRoot.add(points)
  }

  // ---------- CSS2D 城市标牌 ----------
  function buildLabels(geojson, project) {
    geojson.features.forEach((f) => {
      const c = f.properties.centroid || f.properties.center
      if (!c) return
      const [x, y] = project(c)
      const pop = CITY_POPULATION[f.properties.name]
      const el = document.createElement('div')
      el.className = 'gx-label'
      el.innerHTML = `<b>${f.properties.name.replace('市', '')}</b><span>${pop}万</span>`
      const obj = new CSS2DObject(el)
      obj.position.set(x, y, DEPTH + 3)
      labelObjects.push(obj)
      mapRoot.add(obj)
    })
  }

  // ---------- 动画循环：时钟统一驱动所有动态 ----------
  function animate(clock, bloomPass) {
    const t = clock.getElapsedTime()
    dashLoops.forEach((l, i) => { l.rotation.z += (i % 2 ? -1 : 1) * 0.0016 }) // 虚线光圈正反旋转
    rippleRings.forEach((r) => { // 波纹：0.55→1.9 扩散，透明度随之衰减，循环
      const p = (t * 0.45 + r.userData.phase) % 1
      r.scale.setScalar(14 + p * 34)
      r.material.opacity = 0.5 * (1 - p)
    })
    flowTextures.forEach((tex) => { tex.offset.x -= 0.011 }) // 飞线流光
    if (layers.particles) layers.particles.rotation.z = t * 0.03 // 粒子层缓旋
    controls.update()
    composer.render()
    labelRenderer.render(scene, camera)
    rafId = requestAnimationFrame(() => animate(clock, bloomPass))
  }

  // ---------- 初始化入口 ----------
  async function init(container, labelContainer) {
    // GeoJSON 位于内容层（vite publicDir=../content），加载失败时给出可定位的中文提示
    let geojson
    try {
      const resp = await fetch(GEO_URL)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      geojson = normalizeRingWinding(await resp.json())
      if (!geojson.features?.length) throw new Error('features 为空')
    } catch (err) {
      throw new Error(`广西地图数据加载失败（${GEO_URL}）：${err.message}，请确认 content/geo/450000_full.json 存在`)
    }
    const project = makeProjector(geojson)
    const w = container.clientWidth
    const h = container.clientHeight

    // 场景与深空蓝背景
    scene = new THREE.Scene()
    scene.background = new THREE.Color('#030b1a')
    scene.fog = new THREE.Fog('#030b1a', 160, 340)

    camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 1000)
    camera.position.set(0, 78, 96)

    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    container.appendChild(renderer.domElement)

    // CSS2D 标签层：独立 DOM 覆盖在 canvas 上，不参与 Bloom
    labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(w, h)
    labelRenderer.domElement.className = 'gx-label-layer'
    labelContainer.appendChild(labelRenderer.domElement)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 40
    controls.maxDistance = 220
    controls.maxPolarAngle = 1.35 // 不允许翻到地图底下
    controls.target.set(0, 0, 0)

    // 灯光：环境光打底 + 平行光塑形（青色调补光增强科技感）
    scene.add(new THREE.AmbientLight('#8ab8d8', 1.1))
    const sun = new THREE.DirectionalLight('#cfeaff', 1.6)
    sun.position.set(60, 90, 40)
    scene.add(sun)
    const fill = new THREE.DirectionalLight('#1e6f9f', 0.8)
    fill.position.set(-70, 40, -50)
    scene.add(fill)

    // 建造全部分层
    buildMap(geojson, project)
    buildReflection()
    buildDashLoops()
    buildRipple()
    buildBeams(geojson, project)
    buildFlights(geojson, project)
    buildParticles()
    buildLabels(geojson, project)

    // 后期：Bloom 全局辉光（OutputPass 负责 sRGB 输出，缺了画面会发灰）
    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 1.15, 0.55, 0.08)
    composer.addPass(bloomPass)
    composer.addPass(new OutputPass())

    // 入场：相机高空俯冲 + 地图自转（gsap 驱动，OrbitControls damping 共存）
    gsap.from(camera.position, { y: 170, z: 190, duration: 1.8, ease: 'power3.out' })
    gsap.from(mapRoot.scale, { x: 0.6, y: 0.6, z: 0.6, duration: 1.6, ease: 'power2.out' })

    // 自适应容器尺寸
    const onResize = () => {
      const nw = container.clientWidth
      const nh = container.clientHeight
      if (!nw || !nh) return
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
      composer.setSize(nw, nh)
      labelRenderer.setSize(nw, nh)
    }
    window.addEventListener('resize', onResize)
    container.__gxOnResize = onResize

    animate(new THREE.Clock(), bloomPass)
    return { setLayerVisible, setColorMode }
  }

  /** 开关同步：面板 ref → 对应 Three 对象 visible（标牌走 CSS2DObject） */
  function setLayerVisible(key, visible) {
    if (key === 'labels') {
      labelObjects.forEach((o) => (o.visible = visible))
      return
    }
    if (key === 'blocks') return // 刷色图是颜色模式，不在这处理
    layers[key] && (layers[key].visible = visible)
  }

  /** 刷色图开关：true=各市彩色刷色，false=统一深青 */
  function setColorMode(colorful) {
    cityMeshes.forEach(({ group, tinted, name }) => {
      const mat = colorful ? tinted : tinted.userData.plain
      group.children.forEach((ch) => ch.isMesh && (ch.material = [mat, ch.material[1]]))
      void name
    })
  }

  // ---------- 完整销毁：几何/材质/贴图/渲染器/DOM/GSAP，防内存泄漏 ----------
  function dispose(container, labelContainer) {
    cancelAnimationFrame(rafId)
    rafId = 0
    gsap.killTweensOf(camera?.position ?? {})
    gsap.killTweensOf(mapRoot?.scale ?? {})
    controls?.dispose()
    scene?.traverse((o) => {
      o.geometry?.dispose?.()
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      mats.forEach((m) => {
        if (!m) return
        m.map?.dispose?.()
        m.dispose?.()
      })
    })
    disposables.forEach((d) => d.dispose?.())
    disposables.clear()
    composer?.dispose()
    renderer?.dispose()
    renderer?.forceContextLoss?.()
    container?.removeChild?.(renderer?.domElement)
    labelContainer && (labelContainer.innerHTML = '')
    if (container?.__gxOnResize) {
      window.removeEventListener('resize', container.__gxOnResize)
      delete container.__gxOnResize
    }
    scene = camera = renderer = composer = controls = labelRenderer = mapRoot = null
    Object.keys(layers).forEach((k) => delete layers[k])
    labelObjects.length = 0
    cityMeshes.length = 0
    flowTextures.length = 0
    rippleRings.length = 0
    dashLoops.length = 0
  }

  return { init, dispose, setLayerVisible, setColorMode }
}
