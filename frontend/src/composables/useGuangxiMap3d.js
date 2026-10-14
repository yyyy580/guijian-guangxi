/**
 * 首页省图 Three.js 渲染编排 —— 《桂见广西》广西浮雕地图（深蓝科技风·参考版）
 *
 * 对外交互契约（与旧 ECharts 版一致）：
 *   - 点击四城任意区域 → onDrill(city)；点击其余 10 市 → onPendingCity(name)
 *   - hover 城市 → onHover({ name, city, x, y } / null)
 * 视觉（对标参考截图逐项实现）：
 *   1. 顶面青绿地形纹理（Canvas 程序化卫星地貌贴图，四城叠城市暗色）
 *   2. 侧壁亮蓝发光渐变（shader 按高度过渡，顶部边缘增亮）
 *   3. 白色省名裸字标签贴顶面（CSS2D，四城加大）
 *   4. 大刻度弧环（雷达刻度圈 + 细圆环 + 旋转亮弧）+ 底座光晕
 *   5. 青色透视网格地面延展入雾
 *   6. 细长白亮光柱（底部城市色、顶端亮白 + 辉光）
 *   7. 粒子 / 倒影 / 南宁中心飞线 / UnrealBloom 辉光
 * 动画：开卷升起（地形隆起 → 四城依次拔起点亮，间隔 2s，返回直接终态）
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

const GEO_URL = '/geo/450000_full.json'
const MAP_SIZE = 100      // 地图平面尺寸（世界单位）
const DEPTH_PLAIN = 2.4   // 其余 10 市矮层厚度
const DEPTH_CITY = 5      // 四城高台厚度（层级语言与旧版一致：5 vs 2.4）
const INTRO_ORDER = ['百色', '桂林', '南宁', '北海'] // 开卷拔起顺序（用户定稿）
const INTRO_STEP = 2      // 每城间隔（秒）

// ---------- 画布纹理工厂（零外部资源） ----------

/** 程序化地形贴图：青绿基底 + 大块明暗地貌斑 + 细噪点，模拟卫星影像质感 */
function makeTerrainTexture() {
  const S = 512
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  g.fillStyle = '#0f4a44'
  g.fillRect(0, 0, S, S)
  // 大块地貌斑：暗色山地与亮色盆地交错
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    const r = 30 + Math.random() * 90
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    const dark = Math.random() > 0.45
    grad.addColorStop(0, dark ? 'rgba(5,42,40,0.4)' : 'rgba(38,122,102,0.32)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.beginPath()
    g.ellipse(x, y, r, r * (0.5 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  // 细噪点：地貌颗粒感
  for (let i = 0; i < 3200; i++) {
    const v = Math.random()
    g.fillStyle = v > 0.5 ? 'rgba(180,255,230,0.05)' : 'rgba(0,20,18,0.07)'
    g.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6)
  }
  // 山脊细纹：短弧线模拟等高走势
  g.strokeStyle = 'rgba(10,60,55,0.25)'
  g.lineWidth = 1
  for (let i = 0; i < 60; i++) {
    g.beginPath()
    const x = Math.random() * S
    const y = Math.random() * S
    g.arc(x, y, 8 + Math.random() * 26, Math.random() * 6, Math.random() * 6 + 1)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(0.02, 0.02) // ExtrudeGeometry 顶面 UV 即 shape 坐标（±50），缩放后约两个周期
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 径向发光贴图：光柱顶部辉光 / 粒子 / 底座光晕共用 */
function makeGlowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(235,255,255,1)')
  grad.addColorStop(0.3, 'rgba(140,235,255,0.5)')
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
    grad.addColorStop(0.5, 'rgba(200,250,255,0.9)')
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

/** 侧壁发光渐变材质：按挤出高度从深蓝过渡到亮青，顶部边缘增亮（冰蓝质感核心） */
function makeSideMaterial(depth) {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uDepth: { value: depth },
      cBottom: { value: new THREE.Color('#072d5c') },
      cTop: { value: new THREE.Color('#2fa8e8') },
    },
    vertexShader: /* glsl */`
      varying float vH;
      void main() {
        vH = position.z; // ExtrudeGeometry 侧壁顶点局部 z ∈ [0, depth]
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uDepth; uniform vec3 cBottom; uniform vec3 cTop;
      varying float vH;
      void main() {
        float t = clamp(vH / uDepth, 0.0, 1.0);
        vec3 col = mix(cBottom, cTop, pow(t, 0.75));
        col += vec3(0.3, 0.55, 0.65) * smoothstep(0.78, 1.0, t); // 顶部棱线增亮
        gl_FragColor = vec4(col, 0.97);
      }`,
  })
}

/** 城市色压暗（保持四城凸台品牌色语言，叠在地形纹理上） */
function darken(hex, ratio = 0.55) {
  const n = hex.replace('#', '')
  const f = (i) => Math.round(parseInt(n.slice(i, i + 2), 16) * (1 - ratio))
  return new THREE.Color(`rgb(${f(0)},${f(2)},${f(4)})`)
}

/**
 * 环绕向归一（关键修复）：本份数据的环绕向与 d3 球面几何约定相反，
 * d3 会把每个市解读成"除该市外的整个球面"（geoArea≈4π 实锤），
 * fitSize 随之按全世界定比例尺，全省坐标坍缩成中心一座 ~4 单位的小岛——
 * 地图不可见、14 市标签/光柱/飞线全部叠在同一个点。
 * 自愈式修复：逐要素检测球面面积，超过半球（2π）即反转该市全部环；
 * THREE.ShapeUtils 对形状/洞的绕向自适应，反转对挤出几何无副作用。
 */
function normalizeRingWinding(geojson) {
  for (const f of geojson.features) {
    const g = f.geometry
    if (!g) continue
    if (geoArea(f) <= Math.PI * 2) continue // 已是正常围合，不动
    if (g.type === 'MultiPolygon') {
      g.coordinates = g.coordinates.map((poly) => poly.map((ring) => ring.slice().reverse()))
    } else if (g.type === 'Polygon') {
      g.coordinates = g.coordinates.map((ring) => ring.slice().reverse())
    }
  }
  return geojson
}

export function useGuangxiMap3d() {
  let scene, camera, renderer, labelRenderer, composer, controls, rafId = 0
  let mapRoot = null
  const layers = {}          // { reflection, ringFx, beams, flights, particles }
  const flowTextures = []
  const rippleRings = []
  const spinLoops = []       // 旋转部件：刻度环 / 亮弧
  const cityPicks = []       // 射线拾取登记：{ mesh, name, city|null }
  const cityGroups = {}      // 开卷动画：按城市名索引凸台组
  const labelObjects = []    // CSS2D 省名标签
  let hoverMesh = null
  let hoverName = null       // hover 高亮按城市名整组切换（多 polygon 城市避免残留）
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

  // ---------- 14 市挤出凸台：地形纹理顶面 + 发光侧壁 + 亮青描边 ----------
  function buildMap(geojson, project, cities) {
    mapRoot = new THREE.Group()
    mapRoot.rotation.x = -Math.PI / 2 // 局部 z 轴 = 世界高度轴
    scene.add(mapRoot)

    const terrain = reg(makeTerrainTexture())
    const plainTop = reg(new THREE.MeshPhongMaterial({
      color: new THREE.Color('#c8e8dc'), // ×地形纹理 → 深青绿地貌
      map: terrain, shininess: 55, specular: new THREE.Color('#2ee6ff'),
    }))
    const sidePlain = reg(makeSideMaterial(DEPTH_PLAIN))
    const sideCity = reg(makeSideMaterial(DEPTH_CITY))

    geojson.features.forEach((f) => {
      const name = (f.properties.name || '').replace('市', '')
      const city = cities.find((c) => c.name.replace('市', '') === name) || null
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      const group = new THREE.Group()
      const isFour = !!city
      const depth = isFour ? DEPTH_CITY : DEPTH_PLAIN

      // 四城顶面：城市色压暗 × 地形纹理 → 品牌色地貌；其余市用统一青绿
      const topMat = isFour
        ? reg(new THREE.MeshPhongMaterial({
            color: darken(city.color, 0.35), map: terrain,
            shininess: 65, specular: new THREE.Color(city.color),
          }))
        : plainTop

      polys.forEach((poly) => {
        const geo = reg(new THREE.ExtrudeGeometry(polygonToShape(poly, project), {
          depth, bevelEnabled: false,
        }))
        const mesh = new THREE.Mesh(geo, [topMat, isFour ? sideCity : sidePlain])
        mesh.userData.pick = { name, city }
        group.add(mesh)
        cityPicks.push({ mesh, name, city })

        const edges = new THREE.LineSegments(
          reg(new THREE.EdgesGeometry(geo, 30)),
          reg(new THREE.LineBasicMaterial({ color: new THREE.Color('#bff4ff'), transparent: true, opacity: 0.85 })),
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
          color: new THREE.Color('#1587c9'), transparent: true, opacity: 0.16, depthWrite: false,
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

  // ---------- 地面装饰：大刻度弧环 + 细圆 + 旋转亮弧 + 底座光晕 ----------
  function buildGroundFx() {
    const group = new THREE.Group()

    // 刻度环：120 根切向短刻度线（雷达盘感）
    const tickPts = []
    const R1 = 62
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2
      const inner = R1 - (i % 10 === 0 ? 2.2 : 1.1)
      tickPts.push(new THREE.Vector3(Math.cos(a) * inner, Math.sin(a) * inner, 0))
      tickPts.push(new THREE.Vector3(Math.cos(a) * R1, Math.sin(a) * R1, 0))
    }
    const ticks = new THREE.LineSegments(
      reg(new THREE.BufferGeometry().setFromPoints(tickPts)),
      reg(new THREE.LineBasicMaterial({ color: new THREE.Color('#2fb6e8'), transparent: true, opacity: 0.5 })),
    )
    ticks.position.z = -1.6
    spinLoops.push({ obj: ticks, speed: 0.0011 })
    group.add(ticks)

    // 外圈细圆环
    const circlePts = new THREE.EllipseCurve(0, 0, 68, 68).getPoints(180)
    const circle = new THREE.Line(
      reg(new THREE.BufferGeometry().setFromPoints(circlePts)),
      reg(new THREE.LineBasicMaterial({ color: new THREE.Color('#1f7fd0'), transparent: true, opacity: 0.4 })),
    )
    circle.position.z = -1.6
    group.add(circle)

    // 旋转亮弧：90° 高亮弧段，反向快转
    const arcPts = new THREE.EllipseCurve(0, 0, 62, 62, 0, Math.PI * 0.5).getPoints(60)
    const arc = new THREE.Line(
      reg(new THREE.BufferGeometry().setFromPoints(arcPts)),
      reg(new THREE.LineBasicMaterial({ color: new THREE.Color('#5fe6ff'), transparent: true, opacity: 0.9 })),
    )
    arc.position.z = -1.4
    spinLoops.push({ obj: arc, speed: -0.004 })
    group.add(arc)

    // 底座光晕：地图正下方一团青蓝辉光（发光台面感）。
    // 尺寸/透明度克制：150→118、0.5→0.22——加色混合叠加 Bloom 会让光晕
    // 膨胀成铺满全屏的青色圆盘、把地形淹没成剪影（真机截图实锤）
    const glow = new THREE.Mesh(
      reg(new THREE.PlaneGeometry(118, 118)),
      reg(new THREE.MeshBasicMaterial({
        map: reg(makeGlowTexture()), transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })),
    )
    glow.position.z = -2.2
    group.add(glow)

    layers.ringFx = group
    mapRoot.add(group)

    // 波纹：三圈相位错开扩散（沿用）
    const rippleGroup = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        reg(new THREE.RingGeometry(1, 1.16, 96)),
        reg(new THREE.MeshBasicMaterial({
          color: new THREE.Color('#27d8ff'), transparent: true, opacity: 0.4,
          side: THREE.DoubleSide, depthWrite: false,
        })),
      )
      // RingGeometry 在 mapRoot 局部系天然朝上（局部 +Z = 世界高度轴），
      // 此前误加 rotation.x=π/2 使波纹竖立成正对镜头的垂直圆环，
      // 放大后铺满整屏形成"巨大青色同心光环"、淹没地图（真机截图实锤），已移除
      ring.position.z = -0.9
      ring.userData.phase = i / 3
      rippleRings.push(ring)
      rippleGroup.add(ring)
    }
    layers.ripple = rippleGroup
    mapRoot.add(rippleGroup)
  }

  // ---------- 四城光柱：细长白亮（底部城市色 → 顶端亮白 + 辉光） ----------
  function buildBeams(cities, project, geojson) {
    const group = new THREE.Group()
    const glowTex = reg(makeGlowTexture())
    const centerOf = {}
    geojson.features.forEach((f) => {
      centerOf[(f.properties.name || '').replace('市', '')] = f.properties.centroid || f.properties.center
    })

    cities.forEach((city, idx) => {
      const c = centerOf[city.name.replace('市', '')]
      if (!c) return
      const [x, y] = project(c)
      const beam = new THREE.Group()
      beam.position.set(x, y, 0)
      const cityColor = new THREE.Color(city.color)
      const h = 9 + idx * 0.7 // 轻微错落

      const mat = reg(new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: {
          cBottom: { value: cityColor.clone().multiplyScalar(0.4) },
          cTop: { value: new THREE.Color('#eaffff') },
        },
        vertexShader: /* glsl */`
          varying float vY;
          void main() { vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`
          uniform vec3 cBottom; uniform vec3 cTop; varying float vY;
          void main() { gl_FragColor = vec4(mix(cBottom, cTop, pow(vY, 0.7)), 0.16 + vY * 0.78); }`,
      }))
      const cylinder = new THREE.Mesh(reg(new THREE.CylinderGeometry(0.14, 0.3, h, 12, 1, true)), mat)
      cylinder.rotation.x = Math.PI / 2
      cylinder.position.z = h / 2
      beam.add(cylinder)

      const sprite = new THREE.Sprite(reg(new THREE.SpriteMaterial({
        map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })))
      sprite.scale.setScalar(2.8)
      sprite.position.z = h + 0.7
      sprite.material.opacity = 0
      beam.add(sprite)

      beam.userData = { sprite, cityKey: city.name.replace('市', '') } // 开卷生长动画引用
      group.add(beam)
    })
    layers.beams = group
    mapRoot.add(group)
  }

  // ---------- 飞线：南宁 → 另外三城 ----------
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
        reg(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, mid, to), 64, 0.11, 8, false)),
        reg(new THREE.MeshBasicMaterial({
          map: flowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85,
        })),
      )
      group.add(tube)
    })
    layers.flights = group
    mapRoot.add(group)
  }

  // ---------- 漂浮粒子（白色光点） ----------
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
      size: 1.1, map: reg(makeGlowTexture()),
      transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, color: new THREE.Color('#dff6ff'),
    })))
    layers.particles = points
    mapRoot.add(points)
  }

  // ---------- 14 市白色裸字标签贴顶面（四城加大） ----------
  function buildLabels(geojson, project, cities, labelEl) {
    geojson.features.forEach((f) => {
      const name = (f.properties.name || '').replace('市', '')
      const c = f.properties.centroid || f.properties.center
      if (!c || !labelEl) return
      const city = cities.find((c2) => c2.name.replace('市', '') === name)
      const el = document.createElement('div')
      el.className = 'gx-map-label' + (city ? ' four' : '')
      el.textContent = name
      const [x, y] = project(c)
      const obj = new CSS2DObject(el)
      obj.position.set(x, y, (city ? DEPTH_CITY : DEPTH_PLAIN) + 0.25)
      labelObjects.push(obj)
      mapRoot.add(obj)
    })
    labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(labelEl.clientWidth || window.innerWidth, labelEl.clientHeight || window.innerHeight)
    labelRenderer.domElement.className = 'gx-label-layer'
    labelEl.appendChild(labelRenderer.domElement)
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
      // hover 高亮：按城市名整组提亮/熄灭（多 polygon 城市一并生效、切出无残留）
      const name = info?.name ?? null
      if (name !== hoverName) {
        cityPicks.forEach((p) => {
          if (p.name === hoverName) p.mesh.material[0].emissive?.setScalar(0)
        })
        if (name) {
          cityPicks.forEach((p) => {
            if (p.name === name) p.mesh.material[0].emissive?.copy(p.mesh.material[0].color).multiplyScalar(0.35)
          })
        }
        hoverName = name
      }
      hoverMesh = info ? cityPicks.find((p) => p.name === name)?.mesh ?? null : null
      onHover(info ? { name: info.name, city: info.city, x: e.clientX, y: e.clientY } : null)
    })
  }

  // ---------- 开卷动画（仅首次）：地形升起 → 四城依次拔起点亮 ----------
  function playIntro() {
    // 四城凸台先压到矮层，开卷时依次拔起；其余市保持终态
    Object.values(cityGroups).forEach((g) => { g.scale.z = DEPTH_PLAIN / DEPTH_CITY })
    const tl = gsap.timeline()
    tl.from(mapRoot.scale, { x: 0.55, y: 0.55, z: 0.55, duration: 2.2, ease: 'power2.out' }, 0)
    tl.from(camera.position, { y: 150, z: 185, duration: 2.6, ease: 'power3.out' }, 0)
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
  }

  // ---------- 渲染循环 ----------
  function animate(clock) {
    const t = clock.getElapsedTime()
    spinLoops.forEach(({ obj, speed }) => { obj.rotation.z += speed })
    rippleRings.forEach((r) => {
      const p = (t * 0.45 + r.userData.phase) % 1
      r.scale.setScalar(14 + p * 34)
      r.material.opacity = 0.38 * (1 - p)
    })
    flowTextures.forEach((tex) => { tex.offset.x -= 0.011 })
    if (layers.particles) layers.particles.rotation.z = t * 0.03
    controls.update()
    composer.render()
    labelRenderer?.render(scene, camera)
    rafId = requestAnimationFrame(() => animate(clock))
  }

  // ---------- 初始化 ----------
  async function init(container, labelEl, handlers) {
    const cities = handlers.cities
    let geojson
    try {
      const resp = await fetch(GEO_URL)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      geojson = normalizeRingWinding(await resp.json())
      if (!geojson.features?.length) throw new Error('features 为空')
    } catch (err) {
      throw new Error(`广西地图数据加载失败（${GEO_URL}）：${err.message}`)
    }
    const project = makeProjector(geojson)
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight

    scene = new THREE.Scene()
    scene.background = new THREE.Color('#03101e')
    scene.fog = new THREE.Fog('#03101e', 150, 340)

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

    scene.add(new THREE.AmbientLight('#8ab8d8', 1.15))
    const sun = new THREE.DirectionalLight('#cfeaff', 1.5)
    sun.position.set(60, 90, 40)
    scene.add(sun)
    const fill = new THREE.DirectionalLight('#1e6f9f', 0.8)
    fill.position.set(-70, 40, -50)
    scene.add(fill)

    // 青色透视网格地面：延展入雾（参考图氛围核心）
    const grid = new THREE.GridHelper(460, 46, new THREE.Color('#1a5f7a'), new THREE.Color('#0e3d54'))
    grid.position.y = -7
    grid.material.transparent = true
    grid.material.opacity = 0.32
    scene.add(grid)

    buildMap(geojson, project, cities)
    buildReflection()
    buildGroundFx()
    buildBeams(cities, project, geojson)
    buildFlights(cities, project, geojson)
    buildParticles()
    buildLabels(geojson, project, cities, labelEl)

    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    // 阈值 0.3：只让光柱/描边/亮弧等高亮元素泛光，中低亮度的地形不再集体辉光
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.4, 0.3))
    composer.addPass(new OutputPass())

    bindPicking(renderer.domElement, handlers)

    // 无头调试探针（仅 dev 构建注入，生产自动剔除）：暴露相机/控制器/地图根节点
    // 与世界坐标投影函数，供测试脚本取现场证据
    if (import.meta.env.DEV) {
      window.__gxDebug = {
        camera,
        controls,
        mapRoot,
        projectWorld: (x, y, z) => {
          const v = new THREE.Vector3(x, y, z).project(camera)
          return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, z: v.z }
        },
      }
    }

    const onResize = () => {
      const nw = container.clientWidth || window.innerWidth
      const nh = container.clientHeight || window.innerHeight
      if (!nw || !nh) return
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
      composer.setSize(nw, nh)
      labelRenderer?.setSize(nw, nh)
    }
    window.addEventListener('resize', onResize)
    container.__gxOnResize = onResize

    animate(new THREE.Clock())
    if (!handlers.skipIntro) return playIntro()
    finishIntroNow()
    return null
  }

  /** 完整销毁（几何/材质/贴图/渲染器/DOM/补间） */
  function dispose(container, labelEl) {
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
    labelEl && (labelEl.innerHTML = '')
    if (container?.__gxOnResize) {
      window.removeEventListener('resize', container.__gxOnResize)
      delete container.__gxOnResize
    }
    scene = camera = renderer = composer = controls = labelRenderer = mapRoot = null
    if (typeof window !== 'undefined' && window.__gxDebug) delete window.__gxDebug
    Object.keys(layers).forEach((k) => delete layers[k])
    cityPicks.length = 0
    Object.keys(cityGroups).forEach((k) => delete cityGroups[k])
    labelObjects.length = 0
    flowTextures.length = 0
    rippleRings.length = 0
    spinLoops.length = 0
    hoverMesh = null
    hoverName = null
  }

  return { init, dispose }
}
