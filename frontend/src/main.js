import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import './styles/main.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia).use(router).use(ElementPlus).mount('#app')

// 开发/测试辅助：无头浏览器拾取不了 3D 地图点击，把 store 状态挂到 window，
// E2E 直接改视图状态绕过 3D 交互。生产构建自动剔除。
if (import.meta.env.DEV) {
  window.__gxStore = pinia.state.value
}
