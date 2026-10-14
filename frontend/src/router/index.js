import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/screen',
      name: 'screen',
      component: () => import('@/views/ScreenView.vue'),
    },
  ],
})

export default router
