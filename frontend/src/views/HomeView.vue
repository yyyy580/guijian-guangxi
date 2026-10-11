<template>
  <div class="home">
    <!-- 三级视图链：广西省图 → 城市地图 → 景点页，同一镜头感转场 -->
    <Transition name="drill" mode="out-in">
      <MapStage v-if="!store.currentCity" key="province" @drill="onDrill" />
      <AttractionView
        v-else-if="store.currentAttraction"
        :key="store.currentAttraction.id"
      />
      <CityMap v-else :key="store.currentCity.id" :city="store.currentCity" />
    </Transition>

    <!-- 全局知识问答浮窗（不随视图切换销毁，会话保留） -->
    <ChatPanel v-if="flags.ragChat" />

    <!-- 首屏启动遮罩：四城九景数据就绪前盖住空白，避免地图闪断 -->
    <Transition name="boot-fade">
      <div v-if="booting" class="boot-overlay">
        <div class="boot-ring"></div>
        <p class="boot-text">桂见广西 · 正在唤醒四城九景</p>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import MapStage from '@/components/MapStage.vue'
import CityMap from '@/components/CityMap.vue'
import AttractionView from '@/components/AttractionView.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import flags from '@/config/feature.flags'
import { useAppStore } from '@/stores/app'
import { welcomeOnce } from '@/composables/useVoice'

const store = useAppStore()

/** 城市清单与九景详情任一未就绪即视为启动中 */
const booting = computed(() => !store.cities.length || !Object.keys(store.attractions).length)

if (import.meta.env.DEV) {
  // 调试入口：无头测试可直接操纵 store 验证视图流转（与 __cityChart 同款约定）
  window.__store = store
}

onMounted(async () => {
  const citiesJson = await fetch('/cities.json').then((r) => r.json())
  store.setCities(citiesJson.cities)
  // 九景详情并发拉取（本地静态资源，断网同样可用）
  const ids = citiesJson.cities.flatMap((c) => c.attractions)
  const list = await Promise.all(ids.map((id) => fetch(`/attractions/${id}.json`).then((r) => r.json())))
  store.setAttractions(list)
})

/** 省图任一入口（光柱/图例/城市区域）选中城市 → 下钻城市视图 */
function onDrill(city) {
  if (!flags.cityDrilldown) return
  // 进入城市时播欢迎语：点击自带用户手势，语音可正常触发
  setTimeout(() => welcomeOnce(city), 500)
}
</script>

<style scoped>
.home {
  width: 100%;
  height: 100%;
}

/* ---------- 首屏启动遮罩 ---------- */
.boot-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  background:
    radial-gradient(ellipse at 50% 38%, rgba(20, 52, 84, 0.5) 0%, transparent 62%),
    var(--bg-deep, #07131f);
}

.boot-ring {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 3px solid rgba(125, 211, 252, 0.18);
  border-top-color: var(--accent, #38bdf8);
  animation: boot-spin 0.9s linear infinite;
}

.boot-text {
  font-size: 14px;
  letter-spacing: 4px;
  color: rgba(232, 241, 248, 0.72);
  animation: boot-breathe 2s ease-in-out infinite;
}

@keyframes boot-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes boot-breathe {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

.boot-fade-leave-active {
  transition: opacity 0.6s ease;
}

.boot-fade-leave-to {
  opacity: 0;
}

/* 镜头感下钻转场：进入时由近推远 */
.drill-enter-active {
  transition: all 0.65s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.drill-leave-active {
  transition: all 0.4s ease;
}

.drill-enter-from {
  opacity: 0;
  transform: scale(1.08);
}

.drill-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
