/**
 * 首页省图 Three.js 渲染编排 —— 《桂见广西》广西浮雕地图（深蓝科技风）
 *
 * 取代原 ECharts GL 版 MapStage 的渲染层，对外交互契约不变：
 *   - 点击四城任意区域 → 回调 onDrill(city)（组件里走 store.selectCity + emit('drill')）
 *   - 点击其余 10 市 → 回调 onPendingCity(name)（组件里弹"敬请期待"）
 *   - hover 城市 → 回调 onHover({ name, city, x, y } / null)（组件里驱动 tooltip）
 * 视觉：d3-geo 投影 → ExtrudeGeometry 挤出（四城高台着城市暗色、其余深青）+
 * EdgesGeometry 亮青描边 + 底部倒影 + 虚线光圈 + 波纹 + 四城城市色光柱 +
 * 漂浮粒子 + 南宁中心飞线 + UnrealBloom 辉光 + 开卷升起动画（四城依次拔起点亮）
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { geoMercator } from 'd3-geo'
import gsap from 'gsap'

const GEO_URL = '/geo/450000_full.json'
const MAP_SIZE = 100      // 地图平面尺寸（世界单位）
const DEPTH_PLAIN = 2.4   // 其余 10 市矮层厚度
const DEPTH_CITY = 5      // 四城高台厚度（层级语言与原 ECharts 版一致：5 vs 2.4）
const INTRO_ORDER = ['百色', '桂林', '南宁', '北海'] // 开卷拔起顺序（用户定稿）
const INTRO_STEP = 2      // 每城间隔（秒）

// ---------- 画布纹理工厂（零外部资源） ----------

/** 径向发光贴图：光柱顶部辉光 / 粒子共用 */
function makeGlowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(220,255,255,1)')
  grad.addColorStop(0.35, 'rgba(120,235,255,0.5)')
  grad.addColorStop(1, 'rgba(0,180,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 流光贴图：横向暗→亮→暗 两段，RepeatWrapping 靠 offset 动画流动 */
function makeFlowTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 16
  const g = c.getContext('2d')
  for (let i = 0; i < 2; i++) {
    const grad = g.createLinearGradient(i * 128, 0, i * 128 + 128, 0)
    grad.addColorStop(0, 'rgba(0,229,255,0)')
    grad.addColorStop(0.5, 'rgba(190,255,255,0.9)')
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

/** 垂直渐隐遮罩：盖住倒影末端，使其融入背景 */
function makeFadeTexture() {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 128
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 0, 128)
  grad.addColorStop(0, 'rgba(3,11,26,0)')
  grad.addColorStop(1, 'rgba(3,11,26,1)')
  g.fillStyle = grad
  g.fillRect(0, 0, 4, 128)
  return new THREE.CanvasTexture(c)
}

/** 城市色压暗（与原 MapStage 的 darken 同参，保持四城凸台色语言） */
function darken(hex, ratio = 0.55) {
  const n = hex.replace('#', '')
  const f = (i) => Math.round(parseInt(n.slice(i, i + 2), 16) * (1 - ratio))
  return new THREE.Color(`rgb(${f(0)},${f(2)},${f(4)})`)
}

export function useGuangxiMap3d() {
  let scene, camera, renderer, composer, controls, rafId = 0
  let mapRoot = null
  const layers = {}          // { reflection, ring, ripple, beams, flights, particles }
  const flowTextures = []
  const rippleRings = []
  const dashLoops = []
  const cityPicks = []       // 射线拾取登记：{ mesh, name, city|null }
  const cityGroups = {}      // 开卷动画用：按城市名索引凸台组
  const beamTweens = []      // 光柱生长 tween（二次进入需 kill）
  let hoverMesh = null       // 当前 hover 的高亮凸台
  const disposables = new Set()
  const reg = (x) => (disposables.add(x), x)

  /** 墨卡托投影：经纬度 → 居中平面坐标（y 翻转为数学系） */
  function makeProjector(geojson) {
    const proj = geoMercator().fitSize([MAP_SIZE, MAP_SIZE], geojson)
    return ([lon, lat]) => {
      const [x, y] = proj([lon, lat])
      return [x - MAP_SIZE / 2, MAP_SIZE / 2 - y]
    }
  }

  /** 多边形（含洞）→ THREE.Shape */
  function polygonToShape(ring, project) {
    const shape = new THREE.Shape()
    ring[0].forEach(([lon, lat], i) => {
      const [x, y] = project([lon, lat])
      i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)
    })
    for (let h = 1; h < ring.length; h++) {
      const hole = new THREE.Path()
      ring[h].forEach(([lon, lat], i) => {
        const [x, y] = project([lon, lat])
        i === 0 ? hole.moveTo(x, y) : hole.lineTo(x, y)
      })
      shape.holes.push(hole)
    }
    return shape
  }

  // ---------- 14 市挤出凸台 + 描边 ----------
  function buildMap(geojson, project, cities) {
    mapRoot = new THREE.Group()
    mapRoot.rotation.x = -Math.PI / 2 // 局部 z 轴 = 世界高度轴
    scene.add(mapRoot)

    const plainTop = reg(new THREE.MeshPhongMaterial({
      color: new THREE.Color('#0d3550'), shininess: 60, specular: new THREE.Color('#2ee6ff'),
    }))
    const sideMat = reg(new THREE.MeshPhongMaterial({ color: new THREE.Color('#09203f') }))

    geojson.features.forEach((f) => {
      const name = (f.properties.name || '').replace('市', '')
      const city = cities.find((c) => c.name.replace('市', '') === name) || null
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      const group = new THREE.Group()
      const isFour = !!city
      const depth = isFour ? DEPTH_CITY : DEPTH_PLAIN

      // 凸台顶面：四城用城市色压暗（品牌层级语言），其余统一深青
      const topMat = isFour
        ? reg(new THREE.MeshPhongMaterial({ color: darken(city.color, 0.62), shininess: 70, specular: new THREE.Color(city.color) }))
        : plainTop

      polys.forEach((poly) => {
        const geo = reg(new THREE.ExtrudeGeometry(polygonToShape(poly, project), {
          depth, bevelEnabled: false,
        }))
        const mesh = new THREE.Mesh(geo, [topMat, sideMat])
        mesh.userData.pick = { name, city }
        group.add(mesh)
        cityPicks.push({ mesh, name, city })

        const edges = new THREE.LineSegments(
          reg(new THREE.EdgesGeometry(geo, 30)),
          reg(new THREE.LineBasicMaterial({ color: new THREE.Color(isFour ? city.color : '#35e0ff'), transparent: true, opacity: isFour ? 0.95 : 0.65 })),
        )
        group.add(edges)
      })

      if (isFour) cityGroups[name] = group // 开卷动画按城市名索引凸台组
      mapRoot.add(group)
    })
  }

  // ---------- 倒影（克隆 + 局部 z 镜像 + 渐隐遮罩） ----------
  function buildReflection() {
    const refl = mapRoot.clone(true)
    refl.scale.z = -1
    refl.traverse((o) => {
      if (o.isMesh) {
        o.material = reg(new THREE.MeshBasicMaterial({
          color: new THREE.Color('#0fb8d4'), transparent: true, opacity: 0.13, depthWrite: false,
        }))
      } else if (o.isLine) o.visible = false
    })
    const group = new THREE.Group()
    group.add(refl)
    const mask = new THREE.Mesh(
      reg(new THREE.PlaneGeometry(MAP_SIZE * 1.7, 30)),
      reg(new THREE.MeshBasicMaterial({ map: reg(makeFadeTexture()), transparent: true, depthWrite: false })),
    )
    mask.rotation.x = Math.PI / 2
    mask.position.y = -15 - DEPTH_CITY
    group.add(mask)
    layers.reflection = group
    mapRoot.add(group)
  }

  // ---------- 虚线光圈 + 波纹 ----------
  function buildGroundFx() {
    const ringGroup = new THREE.Group()
    ;[46, 56].forEach((r, i) => {
      const pts = new THREE.EllipseCurve(0, 0, r, r * 0.96).getPoints(160)
      const loop = new THREE.Line(
        reg(new THREE.BufferGeometry().setFromPoints(pts)),
        reg(new THREE.LineDashedMaterial({
          color: new THREE.Color('#2ee6ff'), dashSize: 3.2, gapSize: 2.2,
          transparent: true, opacity: 0.45 - i * 0.12,
        })),
      )
      loop.computeLineDistances()
      loop.position.z = -1.2 - i * 0.6
      dashLoops.push(loop)
      ringGroup.add(loop)
    })
    layers.ring = ringGroup
    mapRoot.add(ringGroup)

    const rippleGroup = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        reg(new THREE.RingGeometry(1, 1.18, 96)),
        reg(new THREE.MeshBasicMaterial({
          color: new THREE.Color('#27d8ff'), transparent: true, opacity: 0.5,
          side: THREE.DoubleSide, depthWrite: false,
        })),
      )
      ring.rotation.x = Math.PI / 2
      ring.position.z = -0.8
      ring.userData.phase = i / 3
      rippleRings.push(ring)
      rippleGroup.add(ring)
    }
    layers.ripple = rippleGroup
    mapRoot.add(rippleGroup)
  }

  // ---------- 四城光柱：城市色渐变 + 顶部辉光（开卷时依次生长） ----------
  function buildBeams(cities, project, geojson) {
    const group = new THREE.Group()
    const glowTex = reg(makeGlowTexture())
    const centerOf = {}
    geojson.features.forEach((f) => {
      centerOf[(f.properties.name || '').replace('市', '')] = f.properties.centroid || f.properties.center
    })

    cities.forEach((city) => {
      const c = centerOf[city.name.replace('市', '')]
      if (!c) return
      const [x, y] = project(c)
      const beam = new THREE.Group()
      beam.position.set(x, y, 0)
      const color = new THREE.Color(city.color)

      // 城市色光柱：底部深、顶部亮出城市色（shader 按 uv.y 渐变）
      const h = 9
      const mat = reg(new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: {
          cBottom: { value: color.clone().multiplyScalar(0.25) },
          cTop: { value: color.clone().lerp(new THREE.Color('#ffffff'), 0.35) },
        },
        vertexShader: /* glsl */`
          varying float vY;
          void main() { vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`
          uniform vec3 cBottom; uniform vec3 cTop; varying float vY;
          void main() { gl_FragColor = vec4(mix(cBottom, cTop, vY), 0.22 + vY * 0.7); }`,
      }))
      const cylinder = new THREE.Mesh(reg(new THREE.CylinderGeometry(0.42, 0.72, h, 18, 1, true)), mat)
      cylinder.rotation.x = Math.PI / 2
      cylinder.position.z = h / 2
      beam.add(cylinder)

      const sprite = new THREE.Sprite(reg(new THREE.SpriteMaterial({
        map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })))
      sprite.scale.setScalar(4)
      sprite.position.z = h + 1
      sprite.material.opacity = 0
      beam.add(sprite)

      beam.userData = { cylinder, sprite, h, color, cityKey: city.name.replace('市', '') } // 开卷生长动画引用
      group.add(beam)
    })
    layers.beams = group
    mapRoot.add(group)
  }

  // ---------- 飞线：南宁 → 另外三城（品牌内动线，不喧宾夺主） ----------
  function buildFlights(cities, project, geojson) {
    const group = new THREE.Group()
    const flowTex = reg(makeFlowTexture())
    flowTextures.push(flowTex)
    const centerOf = {}
    geojson.features.forEach((f) => {
      centerOf[(f.properties.name || '').replace('市', '')] = f.properties.centroid || f.properties.center
    })
    const hub = cities.find((c) => c.name.replace('市', '') === '南宁')
    if (!hub || !centerOf['南宁']) return
    const toV = (c) => { const [x, y] = project(centerOf[c.name.replace('市', '')]); return new THREE.Vector3(x, y, DEPTH_CITY) }
    const from = toV(hub)

    cities.forEach((city) => {
      if (city.name === hub.name || !centerOf[city.name.replace('市', '')]) return
      const to = toV(city)
      const mid = from.clone().add(to).multiplyScalar(0.5)
      mid.z += from.distanceTo(to) * 0.38
      const tube = new THREE.Mesh(
        reg(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, mid, to), 64, 0.13, 8, false)),
        reg(new THREE.MeshBasicMaterial({
          map: flowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85,
        })),
      )
      group.add(tube)
    })
    layers.flights = group
    mapRoot.add(group)
  }

  // ---------- 漂浮粒子 ----------
  function buildParticles() {
    const N = 500
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * MAP_SIZE * 1.4
      pos[i * 3 + 1] = (Math.random() - 0.5) * MAP_SIZE * 1.2
      pos[i * 3 + 2] = 2 + Math.random() * 14
    }
    const geo = reg(new THREE.BufferGeometry())
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const points = new THREE.Points(geo, reg(new THREE.PointsMaterial({
      size: 0.8, map: reg(makeGlowTexture()),
      transparent: true, opacity: 0.75, depthWrite: false,
      blending: THREE.AdditiveBlending, color: new THREE.Color('#7fe9ff'),
    })))
    layers.particles = points
    mapRoot.add(points)
  }

  // ---------- 交互：射线拾取（Three 纯数学拾取，无头环境也可验证） ----------
  function bindPicking(dom, { onDrill, onPending, onHover }) {
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let downPos = null

    const pick = (ev) => {
      const r = dom.getBoundingClientRect()
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObjects(cityPicks.map((p) => p.mesh), false)[0]
      return hit ? hit.object.userData.pick : null
    }

    dom.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY] })
    dom.addEventListener('pointerup', (e) => {
      // 拖拽旋转结束不触发下钻：位移小于阈值才算"点击"
      if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 6) return
      const info = pick(e)
      if (!info) return
      info.city ? onDrill(info.city) : onPending(info.name)
    })
    dom.addEventListener('pointermove', (e) => {
      const info = pick(e)
      dom.style.cursor = info ? 'pointer' : 'grab'
      // hover 高亮：提亮命中城市的全部凸台顶面（多 polygon 城市一并生效）
      const targetMeshes = info ? cityPicks.filter((p) => p.name === info.name).map((p) => p.mesh) : []
      if (hoverMesh && !targetMeshes.includes(hoverMesh)) hoverMesh.material[0].emissive?.setScalar(0)
      targetMeshes.forEach((m) => {
        if (m !== hoverMesh) m.material[0].emissive?.copy(m.material[0].color).multiplyScalar(0.35)
      })
      hoverMesh = targetMeshes[0] ?? null
      onHover(info ? { name: info.name, city: info.city, x: e.clientX, y: e.clientY } : null)
    })
  }

  // ---------- 开卷动画（仅首次）：地形升起 → 四城依次拔起点亮 ----------
  function playIntro() {
    // 四城凸台先压到矮层（0.48），开卷时依次拔起到高台；其余市保持终态
    Object.values(cityGroups).forEach((g) => { g.scale.z = DEPTH_PLAIN / DEPTH_CITY })
    const tl = gsap.timeline()
    tl.from(mapRoot.scale, { x: 0.55, y: 0.55, z: 0.55, duration: 2.2, ease: 'power2.out' }, 0)
    tl.from(camera.position, { y: 150, z: 185, duration: 2.6, ease: 'power3.out' }, 0)
    // 四城依次拔起 + 本城光柱生长 + 顶部辉光点亮（顺序与节奏沿用用户定稿：间隔 2 秒）
    INTRO_ORDER.forEach((name, i) => {
      const grp = cityGroups[name]
      const at = 2.2 + i * INTRO_STEP
      if (grp) tl.to(grp.scale, { z: 1, duration: 0.9, ease: 'power2.inOut' }, at)
      const beam = layers.beams?.children.find((b) => b.userData.cityKey === name)
      if (beam) {
        tl.fromTo(beam.scale, { z: 0.01 }, { z: 1, duration: 0.9, ease: 'power2.out' }, at + 0.15)
        tl.to(beam.userData.sprite.material, { opacity: 1, duration: 0.5 }, at + 0.6)
      }
    })
    return tl
  }

  /** 二次进入：跳过动画直接终态（四城满高、光柱全亮） */
  function finishIntroNow() {
    Object.values(cityGroups).forEach((g) => { g.scale.z = 1 })
    layers.beams?.children.forEach((b) => {
      b.scale.z = 1
      b.userData.sprite.material.opacity = 1
    })
    beamTweens.forEach((t) => t.kill())
    beamTweens.length = 0
  }

  // ---------- 渲染循环 ----------
  function animate(clock) {
    const t = clock.getElapsedTime()
    dashLoops.forEach((l, i) => { l.rotation.z += (i % 2 ? -1 : 1) * 0.0016 })
    rippleRings.forEach((r) => {
      const p = (t * 0.45 + r.userData.phase) % 1
      r.scale.setScalar(14 + p * 34)
      r.material.opacity = 0.45 * (1 - p)
    })
    flowTextures.forEach((tex) => { tex.offset.x -= 0.011 })
    if (layers.particles) layers.particles.rotation.z = t * 0.03
    controls.update()
    composer.render()
    rafId = requestAnimationFrame(() => animate(clock))
  }

  // ---------- 初始化 ----------
  async function init(container, handlers) {
    const cities = handlers.cities
    let geojson
    try {
      const resp = await fetch(GEO_URL)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      geojson = await resp.json()
      if (!geojson.features?.length) throw new Error('features 为空')
    } catch (err) {
      throw new Error(`广西地图数据加载失败（${GEO_URL}）：${err.message}`)
    }
    const project = makeProjector(geojson)
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight

    scene = new THREE.Scene()
    scene.background = new THREE.Color('#030b1a')
    scene.fog = new THREE.Fog('#030b1a', 170, 360)

    camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 1000)
    camera.position.set(0, 74, 92)

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    container.appendChild(renderer.domElement)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 40
    controls.maxDistance = 220
    controls.maxPolarAngle = 1.35
    controls.target.set(0, 0, 0)

    scene.add(new THREE.AmbientLight('#8ab8d8', 1.1))
    const sun = new THREE.DirectionalLight('#cfeaff', 1.6)
    sun.position.set(60, 90, 40)
    scene.add(sun)
    const fill = new THREE.DirectionalLight('#1e6f9f', 0.8)
    fill.position.set(-70, 40, -50)
    scene.add(fill)

    buildMap(geojson, project, cities)
    buildReflection()
    buildGroundFx()
    buildBeams(cities, project, geojson)
    buildFlights(cities, project, geojson)
    buildParticles()

    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 1.0, 0.5, 0.08))
    composer.addPass(new OutputPass())

    bindPicking(renderer.domElement, handlers)

    const onResize = () => {
      const nw = container.clientWidth || window.innerWidth
      const nh = container.clientHeight || window.innerHeight
      if (!nw || !nh) return
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
      composer.setSize(nw, nh)
    }
    window.addEventListener('resize', onResize)
    container.__gxOnResize = onResize

    animate(new THREE.Clock())
    if (!handlers.skipIntro) return playIntro()
    finishIntroNow()
    return null
  }

  /** 完整销毁（几何/材质/贴图/渲染器/DOM/补间） */
  function dispose(container) {
    cancelAnimationFrame(rafId)
    rafId = 0
    gsap.killTweensOf(camera?.position ?? {})
    gsap.killTweensOf(mapRoot?.scale ?? {})
    beamTweens.forEach((t) => t.kill())
    beamTweens.length = 0
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
    if (container?.__gxOnResize) {
      window.removeEventListener('resize', container.__gxOnResize)
      delete container.__gxOnResize
    }
    scene = camera = renderer = composer = controls = mapRoot = null
    Object.keys(layers).forEach((k) => delete layers[k])
    cityPicks.length = 0
    cityGroupsClear()
    flowTextures.length = 0
    rippleRings.length = 0
    dashLoops.length = 0
    hoverMesh = null
  }

  function cityGroupsClear() {
    Object.keys(cityGroups).forEach((k) => delete cityGroups[k])
  }

  return { init, dispose }
}
