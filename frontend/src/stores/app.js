import { defineStore, acceptHMRUpdate } from 'pinia'

/**
 * 全局应用状态：
 * - cities/currentCity：城市清单与当前选中城市（驱动下钻）
 * - attractions：九景详情缓存（id → JSON）
 * - currentAttraction：当前打开的景点卡片
 */
export const useAppStore = defineStore('app', {
  state: () => ({
    cities: [],
    attractions: {},
    currentCity: null,
    currentAttraction: null,
  }),
  getters: {
    cityAttractions(state) {
      if (!state.currentCity) return []
      return state.currentCity.attractions.map((id) => state.attractions[id]).filter(Boolean)
    },
  },
  actions: {
    setCities(cities) {
      this.cities = cities
    },
    setAttractions(list) {
      this.attractions = Object.fromEntries(list.map((a) => [a.id, a]))
    },
    selectCity(city) {
      this.currentCity = city
      this.currentAttraction = null
    },
    backToProvince() {
      this.currentCity = null
      this.currentAttraction = null
    },
    openAttraction(attraction) {
      this.currentAttraction = attraction
    },
    closeAttraction() {
      this.currentAttraction = null
    },
  },
})

// 开发热更新时保持 store 定义同步，避免 HMR 后旧实例缺新 action
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAppStore, import.meta.hot))
}
