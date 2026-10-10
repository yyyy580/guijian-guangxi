import { defineStore } from 'pinia'

/**
 * 全局应用状态：当前选中城市、城市清单。
 * MapStage 与后续 CityLayer / AttractionCard 通过此 store 共享选中状态。
 */
export const useAppStore = defineStore('app', {
  state: () => ({
    cities: [],
    currentCity: null,
  }),
  actions: {
    setCities(cities) {
      this.cities = cities
    },
    selectCity(city) {
      this.currentCity = city
    },
  },
})
