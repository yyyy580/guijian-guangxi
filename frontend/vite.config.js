import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// content/ 目录作为静态资源根：dev 与 build 后均可通过 /cities.json 等路径直接访问
// —— 内容层与展示层解耦，改 JSON 即改内容，零代码改动
export default defineConfig({
  plugins: [vue()],
  publicDir: fileURLToPath(new URL('../content', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
