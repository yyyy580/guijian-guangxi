<template>
  <div class="home">
    <Transition name="drill" mode="out-in">
      <MapStage v-if="!store.currentCity" key="province" @drill="onDrill" />
      <CityMap v-else :key="store.currentCity.id" :city="store.currentCity" />
    </Transition>

    <AttractionCard v-if="store.currentAttraction" />

    <!-- 全局知识问答浮窗（不随卡片开关销毁，会话保留） -->
    <ChatPanel v-if="flags.ragChat" />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import MapStage from '@/components/MapStage.vue'
import CityMap from '@/components/CityMap.vue'
import AttractionCard from '@/components/AttractionCard.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import flags from '@/config/feature.flags'
import { useAppStore } from '@/stores/app'
import { welcomeOnce } from '@/composables/useVoice'

const store = useAppStore()

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
