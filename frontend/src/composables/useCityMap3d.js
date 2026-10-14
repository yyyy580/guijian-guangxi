/**
 * 城市三维地图 —— Three.js 版（视觉语言与首页省图完全一致）
 *
 * 结构：本 composable 负责全部 Three.js 生命周期，CityMap.vue 只管 HUD/景点清单 UI。
 *   1. 区县板块：d3-geo 投影 → 挤出凸台（顶面城市暗色 × 地形纹理、明度微错落）
 *      + 发光侧壁 shader（深底 → 城市色渐变）+ EdgesGeometry 城市色亮边
 *   2. 景点：细光柱（城市色 → 亮白）+ 顶端辉光 + 透明拾取球 + CSS2D 名称标签
 *   3. 氛围：青色透视网格地面、刻度弧环 + 旋转亮弧、底座光晕（城市色）、
 *      扩散波纹、漂浮粒子、倒影
 *   4. 交互：射线拾取——光柱/拾取球点击 → onPick(attraction)；区县 hover 整块提亮
 *   5. 后期：UnrealBloom 0.35/0.4/0.38（与首页同一收敛档）
 * 数据：/geojson/<city.id>.json（区县级，与省图数据同源——同样需过 normalizeRingWinding）
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { geoMercator } from 'd3-geo'
import { makeTerrainTexture, makeGlowTexture, makeSideMaterial, normalizeRingWinding } from './useGuangxiMap3d'

const MAP_SIZE = 100 // 城市边界 fitSize 后的平面尺寸（各市归一化，密度一致）
const DEPTH = 2.2    // 区县凸台厚度

export function useCityMap3d() {
  let scene, camera, renderer, labelRenderer, composer, controls, rafId = 0
  let mapRoot = null
  const layers = {}        // { reflection, ringFx, ripple, beams, particles }
  const flowTextures = []
  const rippleRings = []
  const spinLoops = []     // 旋转部件：刻度环 / 亮弧
  const districtPicks = [] // 区县拾取登记：hover 提亮
  const spotPicks = []     // 景点拾取登记：{ mesh, attraction }
  const labelObjects = []  // CSS2D 景点名标签
  let hoverDistrict = null
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

  // ---------- 区县板块：城市暗色顶面 × 地形纹理 + 城市色发光侧壁 + 亮边 ----------
  function buildDistricts(geojson, project, city) {
    const terrain = reg(makeTerrainTexture())
    const cityColor = new THREE.Color(city.color)
    // 侧壁：很深的城市色底 → 城市色亮顶，棱线用城市色增亮
    const sideMat = reg(makeSideMaterial(DEPTH, {
      cBottom: `#${cityColor.clone().multiplyScalar(0.18).getHexString()}`,
      cTop: `#${cityColor.clone().lerp(new THREE.Color('#eafcff'), 0.35).getHexString()}`,
      cEdge: cityColor.clone().lerp(new THREE.Color('#ffffff'), 0.4),
    }))
    const edgeColor = `#${cityColor.clone().lerp(new THREE.Color('#bff4ff'), 0.55).getHexString()}`

    geojson.features.forEach((f, idx) => {
      const name = f.properties.name || ''
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      const group = new THREE.Group()

      // 顶面：保留城市色相，但 S 封顶、L 统一压进暗色区间——
      // 直接按比例压暗会让不同城市色明度两极分化（北海蓝黑成一片、
      // 百色红亮得刺眼，首版真机截图实锤），纹理对单通道色的调制
      // 还会放大区县间不均；HSL 定标后各城观感一致
      const hsl = { h: 0, s: 0, l: 0 }
      new THREE.Color(city.color).getHSL(hsl)
      // L=0.36 + S≤0.42：纹理暗斑区 texel 极暗，顶面 L 低于 0.3 会整片沉黑
      //（北海首两版实锤）；提至 0.36 后暗斑区仍可辨，观感与首页四城高台同档
      const topMat = reg(new THREE.MeshPhongMaterial({
        color: new THREE.Color().setHSL(hsl.h, Math.min(hsl.s, 0.42), 0.36 + (idx % 4) * 0.008),
        map: terrain, shininess: 30, specular: new THREE.Color('#1a6478'),
      }))

      polys.forEach((poly) => {
        const geo = reg(new THREE.ExtrudeGeometry(polygonToShape(poly, project), {
          depth: DEPTH, bevelEnabled: false,
        }))
        const mesh = new THREE.Mesh(geo, [topMat, sideMat])
        mesh.userData.district = name
        group.add(mesh)
        districtPicks.push({ mesh, name, mat: topMat })

        const edges = new THREE.LineSegments(
          reg(new THREE.EdgesGeometry(geo, 30)),
          reg(new THREE.LineBasicMaterial({ color: new THREE.Color(edgeColor), transparent: true, opacity: 0.7 })),
        )
        group.add(edges)
      })
      mapRoot.add(group)
    })
  }

  // ---------- 景点：细光柱（城市色→亮白）+ 顶辉光 + 透明拾取球 + CSS2D 标签 ----------
  function buildSpots(attractions, project, city, labelEl) {
    const group = new THREE.Group()
    const cityColor = new THREE.Color(city.color)
    const glowTex = reg(makeGlowTexture())

    attractions.forEach((a, idx) => {
      if (!a.coord) return
      const [x, y] = project(a.coord)
      const h = 6.5 + idx * 0.6 // 轻微错落
      const spot = new THREE.Group()
      spot.position.set(x, y, 0)

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
      const cylinder = new THREE.Mesh(reg(new THREE.CylinderGeometry(0.16, 0.34, h, 12, 1, true)), mat)
      cylinder.rotation.x = Math.PI / 2
      cylinder.position.z = DEPTH + h / 2
      spot.add(cylinder)
      spotPicks.push({ mesh: cylinder, attraction: a })

      // 透明拾取球：光柱太细难点中，底部挂一个大半径隐形球兜底点击
      const hitBall = new THREE.Mesh(
        reg(new THREE.SphereGeometry(2.1, 12, 12)),
        reg(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.01, depthWrite: false })),
      )
      hitBall.position.z = DEPTH + 1.2
      hitBall.userData.noReflect = true // 倒影克隆时排除，避免隐形球变成微光斑
      spot.add(hitBall)
      spotPicks.push({ mesh: hitBall, attraction: a })

      const sprite = new THREE.Sprite(reg(new THREE.SpriteMaterial({
        map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })))
      sprite.scale.setScalar(2.2)
      sprite.position.z = DEPTH + h + 0.6
      spot.add(sprite)

      group.add(spot)

      // CSS2D 景点名标签：白字 + 城市色辉光（样式类在 CityMap.vue 全局块）
      if (labelEl) {
        const el = document.createElement('div')
        el.className = 'gx-spot-label'
        el.style.setProperty('--spot-color', city.color)
        el.textContent = a.name
        const obj = new CSS2DObject(el)
        obj.position.set(x, y, DEPTH + h + 1.1)
        labelObjects.push(obj)
        mapRoot.add(obj)
      }
    })
    layers.beams = group
    mapRoot.add(group)
  }

  // ---------- 地面装饰：刻度弧环 + 旋转亮弧 + 底座光晕（城市色）+ 波纹 ----------
  function buildGroundFx(city) {
    const group = new THREE.Group()

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

    const circlePts = new THREE.EllipseCurve(0, 0, 68, 68).getPoints(180)
    const circle = new THREE.Line(
      reg(new THREE.BufferGeometry().setFromPoints(circlePts)),
      reg(new THREE.LineBasicMaterial({ color: new THREE.Color('#1f7fd0'), transparent: true, opacity: 0.4 })),
    )
    circle.position.z = -1.6
    group.add(circle)

    const arcPts = new THREE.EllipseCurve(0, 0, 62, 62, 0, Math.PI * 0.5).getPoints(60)
    const arc = new THREE.Line(
      reg(new THREE.BufferGeometry().setFromPoints(arcPts)),
      reg(new THREE.LineBasicMaterial({ color: new THREE.Color('#5fe6ff'), transparent: true, opacity: 0.9 })),
    )
    arc.position.z = -1.4
    spinLoops.push({ obj: arc, speed: -0.004 })
    group.add(arc)

    // 底座光晕：城市色一团辉光。城市色是彩的（首页为青蓝背景系），
    // 浓度须再低一档（0.16→0.08），否则百色红光晕把下半屏染成红海
    const glow = new THREE.Mesh(
      reg(new THREE.PlaneGeometry(118, 118)),
      reg(new THREE.MeshBasicMaterial({
        map: reg(makeGlowTexture()), color: new THREE.Color(city.color),
        transparent: true, opacity: 0.08,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })),
    )
    glow.position.z = -2.2
    group.add(glow)

    layers.ringFx = group
    mapRoot.add(group)

    // 波纹：三圈相位错开扩散（RingGeometry 在 mapRoot 局部系天然朝上，勿加旋转）
    const rippleGroup = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        reg(new THREE.RingGeometry(1, 1.16, 96)),
        reg(new THREE.MeshBasicMaterial({
          color: new THREE.Color(city.color), transparent: true, opacity: 0.2,
          side: THREE.DoubleSide, depthWrite: false,
        })),
      )
      ring.position.z = -0.9
      ring.userData.phase = i / 3
      rippleRings.push(ring)
      rippleGroup.add(ring)
    }
    layers.ripple = rippleGroup
    mapRoot.add(rippleGroup)
  }

  // ---------- 漂浮粒子（白色光点） ----------
  function buildParticles() {
    const N = 380
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * MAP_SIZE * 1.4
      pos[i * 3 + 1] = (Math.random() - 0.5) * MAP_SIZE * 1.2
      pos[i * 3 + 2] = 2 + Math.random() * 13
    }
    const geo = reg(new THREE.BufferGeometry())
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const points = new THREE.Points(geo, reg(new THREE.PointsMaterial({
      size: 1.1, map: reg(makeGlowTexture()),
      transparent: true, opacity: 0.8, depthWrite: false,
      blending: THREE.AdditiveBlending, color: new THREE.Color('#dff6ff'),
    })))
    layers.particles = points
    mapRoot.add(points)
  }

  // ---------- 交互：射线拾取（景点优先，区县 hover 提亮） ----------
  function bindPicking(dom, { onPick, onHoverSpot }) {
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let downPos = null

    const pickSpot = (ev) => {
      const r = dom.getBoundingClientRect()
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObjects(spotPicks.map((p) => p.mesh), false)[0]
      return hit ? spotPicks.find((p) => p.mesh === hit.object)?.attraction ?? null : null
    }
    const pickDistrict = (ev) => {
      const r = dom.getBoundingClientRect()
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObjects(districtPicks.map((p) => p.mesh), false)[0]
      return hit ? hit.object.userData.district ?? null : null
    }

    dom.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY] })
    dom.addEventListener('pointerup', (e) => {
      // 拖拽旋转结束不触发下钻：位移小于阈值才算"点击"
      if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 6) return
      const a = pickSpot(e)
      if (a) onPick(a)
    })
    dom.addEventListener('pointermove', (e) => {
      const a = pickSpot(e)
      dom.style.cursor = a ? 'pointer' : 'grab'
      onHoverSpot(a ? { attraction: a, x: e.clientX, y: e.clientY } : null)

      // 区县 hover 整块提亮/熄灭（多 polygon 区县共用 topMat，一并生效）
      const name = a ? null : pickDistrict(e)
      if (name !== hoverDistrict) {
        districtPicks.forEach((p) => {
          if (p.name === hoverDistrict) p.mat.emissive.setScalar(0)
        })
        if (name) {
          districtPicks.forEach((p) => {
            if (p.name === name) p.mat.emissive.copy(p.mat.color).multiplyScalar(0.35)
          })
        }
        hoverDistrict = name
      }
    })
  }

  // ---------- 渲染循环 ----------
  function animate(clock) {
    const t = clock.getElapsedTime()
    spinLoops.forEach(({ obj, speed }) => { obj.rotation.z += speed })
    rippleRings.forEach((r) => {
      const p = (t * 0.45 + r.userData.phase) % 1
      r.scale.setScalar(14 + p * 30)
      r.material.opacity = 0.2 * (1 - p)
    })
    flowTextures.forEach((tex) => { tex.offset.x -= 0.011 })
    if (layers.particles) layers.particles.rotation.z = t * 0.03
    controls.update()
    composer.render()
    labelRenderer?.render(scene, camera)
    rafId = requestAnimationFrame(() => animate(clock))
  }

  // ---------- 初始化 ----------
  async function init(container, labelEl, { city, attractions, onPick, onHoverSpot }) {
    let geojson
    try {
      const resp = await fetch(`/geojson/${city.id}.json`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      geojson = normalizeRingWinding(await resp.json())
      if (!geojson.features?.length) throw new Error('features 为空')
    } catch (err) {
      throw new Error(`${city.fullName}地图数据加载失败：${err.message}`)
    }
    const project = makeProjector(geojson)
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight

    scene = new THREE.Scene()
    scene.background = new THREE.Color('#03101e')
    scene.fog = new THREE.Fog('#03101e', 150, 340)

    camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 1000)
    camera.position.set(0, 66, 84)

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    container.appendChild(renderer.domElement)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 30
    controls.maxDistance = 200
    controls.maxPolarAngle = 1.35
    controls.target.set(0, 0, 0)

    scene.add(new THREE.AmbientLight('#8ab8d8', 1.15))
    const sun = new THREE.DirectionalLight('#cfeaff', 1.5)
    sun.position.set(60, 90, 40)
    scene.add(sun)
    const fill = new THREE.DirectionalLight('#1e6f9f', 0.8)
    fill.position.set(-70, 40, -50)
    scene.add(fill)

    // 青色透视网格地面：延展入雾（与首页同款氛围）
    const grid = new THREE.GridHelper(460, 46, new THREE.Color('#1a5f7a'), new THREE.Color('#0e3d54'))
    grid.position.y = -7
    grid.material.transparent = true
    grid.material.opacity = 0.32
    scene.add(grid)

    mapRoot = new THREE.Group()
    mapRoot.rotation.x = -Math.PI / 2 // 局部 z 轴 = 世界高度轴
    scene.add(mapRoot)

    buildDistricts(geojson, project, city)
    buildSpots(attractions, project, city, labelEl)
    buildGroundFx(city)
    buildParticles()

    // 倒影：只让区县地形参与镜像。光柱 cylinder 自带 rotation.x=π/2，
    // 被 scale.z=-1 镜像后不会沉到地下，而是横躺悬在地图上方
    // （射线诊断实锤 y≈6~18 的红色半透明幽灵罩，把顶面盖出大块黑区）
    const refl = mapRoot.clone(true)
    refl.scale.z = -1
    refl.traverse((o) => {
      if (o.isMesh && o.userData.district) {
        o.material = reg(new THREE.MeshBasicMaterial({
          color: new THREE.Color(city.color), transparent: true, opacity: 0.08, depthWrite: false,
        }))
      } else {
        o.visible = false
      }
    })
    const reflGroup = new THREE.Group()
    reflGroup.add(refl)
    layers.reflection = reflGroup
    mapRoot.add(reflGroup)

    // CSS2D 标签渲染器（景点名）
    if (labelEl) {
      labelRenderer = new CSS2DRenderer()
      labelRenderer.setSize(labelEl.clientWidth || window.innerWidth, labelEl.clientHeight || window.innerHeight)
      labelRenderer.domElement.className = 'gx-label-layer'
      labelEl.appendChild(labelRenderer.domElement)
    }

    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.4, 0.38))
    composer.addPass(new OutputPass())

    bindPicking(renderer.domElement, { onPick, onHoverSpot })

    // 无头调试探针（仅 dev 注入，生产剔除）：projectWorld 供测试脚本
    // 把景点拾取球局部坐标换算成屏幕点击靶点
    if (import.meta.env.DEV) {
      window.__cityDebug = {
        scene,
        camera,
        controls,
        mapRoot,
        projectWorld: (x, y, z) => {
          const v = mapRoot.localToWorld(new THREE.Vector3(x, y, z)).project(camera)
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
  }

  /** 完整销毁（几何/材质/贴图/渲染器/DOM/监听） */
  function dispose(container, labelEl) {
    cancelAnimationFrame(rafId)
    rafId = 0
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
    if (typeof window !== 'undefined' && window.__cityDebug) delete window.__cityDebug
    Object.keys(layers).forEach((k) => delete layers[k])
    districtPicks.length = 0
    spotPicks.length = 0
    labelObjects.length = 0
    flowTextures.length = 0
    rippleRings.length = 0
    spinLoops.length = 0
    hoverDistrict = null
  }

  return { init, dispose }
}
