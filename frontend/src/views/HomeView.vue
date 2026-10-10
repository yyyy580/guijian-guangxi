<template>
  <div class="home">
    <MapStage v-if="flags.map3D" />
    <div v-else class="fallback-tip">3D 地图已关闭（feature.flags.map3D = false）</div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import MapStage from '@/components/MapStage.vue'
import flags from '@/config/feature.flags'
import { useAppStore } from '@/stores/app'

const store = useAppStore()

onMounted(async () => {
  // 城市清单进 store，供后续下钻层/卡片组件共享
  if (store.cities.length === 0) {
    const data = await fetch('/cities.json').then((r) => r.json())
    store.setCities(data.cities)
  }
})
</script>

<style scoped>
.home {
  width: 100%;
  height: 100%;
}
.fallback-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-dim);
}
</style>
