<template>
  <div class="card-mask" @click.self="store.closeAttraction()">
    <article class="attraction-card">
      <button class="close-btn" @click="store.closeAttraction()">×</button>

      <!-- CSS 艺术头图 + Ken Burns（P2 替换实拍/AI素材） -->
      <div class="hero" :style="{ '--c': cityColor }">
        <div class="hero-art"></div>
        <svg class="hills hills-far" viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path d="M0,224 C240,140 420,190 640,150 C860,110 1080,180 1440,130 L1440,320 L0,320 Z" />
        </svg>
        <svg class="hills hills-near" viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path d="M0,288 C200,220 480,260 720,230 C960,200 1200,260 1440,226 L1440,320 L0,320 Z" />
        </svg>
        <div class="sun"></div>
        <div class="hero-meta">
          <span class="city-badge" :style="{ background: cityColor }">{{ city.name }} · {{ city.colorName }}</span>
          <h1>{{ attraction.name }}</h1>
          <p class="tags">
            <span v-for="t in attraction.tags" :key="t" class="tag">{{ t }}</span>
          </p>
        </div>
      </div>

      <div class="body">
        <p class="summary">{{ attraction.summary }}</p>

        <el-tabs v-model="tab" class="story-tabs">
          <el-tab-pane label="地理科普" name="geo">
            <p>{{ attraction.narrative.geo }}</p>
          </el-tab-pane>
          <el-tab-pane label="民间传说" name="legend">
            <p>{{ attraction.narrative.legend }}</p>
          </el-tab-pane>
          <el-tab-pane label="历史人事" name="history">
            <p>{{ attraction.narrative.history }}</p>
          </el-tab-pane>
          <el-tab-pane label="风物延伸" name="extended">
            <p>{{ attraction.narrative.extended }}</p>
          </el-tab-pane>
        </el-tabs>

        <!-- AI 讲解员（流式字幕 + 语音朗读） -->
        <NarratorBox v-if="flags.ttsNarrator" />

        <!-- 唤醒风景：静照切 AI 图生视频（素材预生成中） -->
        <div class="pending-ai">
          <span>唤醒风景 · 静照变 AI 视频</span>
          <em>{{ flags.awakenVideo ? '点击唤醒' : '素材生成中，敬请期待' }}</em>
        </div>
      </div>
    </article>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import NarratorBox from '@/components/NarratorBox.vue'
import flags from '@/config/feature.flags'

const store = useAppStore()
const attraction = computed(() => store.currentAttraction)
const city = computed(() => store.currentCity)
const cityColor = computed(() => city.value?.color || 'var(--accent)')
const tab = ref('geo')
</script>

<style scoped>
.card-mask {
  position: fixed;
  inset: 0;
  background: rgba(3, 10, 18, 0.72);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.attraction-card {
  position: relative;
  width: min(880px, 92vw);
  max-height: 88vh;
  overflow: hidden auto;
  border-radius: 18px;
  background: var(--bg-panel);
  border: 1px solid rgba(125, 211, 252, 0.2);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
}

.close-btn {
  position: absolute;
  top: 14px;
  right: 16px;
  z-index: 5;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(7, 19, 31, 0.5);
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  transition: all 0.2s;
}

.close-btn:hover {
  background: rgba(230, 57, 70, 0.85);
  border-color: transparent;
}

/* ---------- Hero：CSS 艺术风景 + Ken Burns ---------- */
.hero {
  position: relative;
  height: 300px;
  overflow: hidden;
}

.hero-art {
  position: absolute;
  inset: -6%;
  background:
    radial-gradient(circle at 72% 30%, color-mix(in srgb, var(--c) 65%, #ffffff 10%) 0%, transparent 34%),
    radial-gradient(ellipse at 20% 110%, color-mix(in srgb, var(--c) 50%, #0c2136) 0%, transparent 55%),
    linear-gradient(180deg, #0a1c30 0%, color-mix(in srgb, var(--c) 38%, #0c2136) 62%, color-mix(in srgb, var(--c) 55%, #07131f) 100%);
  animation: kenburns 26s ease-in-out infinite alternate;
}

.hills {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 62%;
}

.hills-far path {
  fill: color-mix(in srgb, var(--c) 26%, #07131f);
  opacity: 0.85;
}

.hills-near path {
  fill: color-mix(in srgb, var(--c) 45%, #050e18);
}

.sun {
  position: absolute;
  top: 16%;
  left: 70%;
  width: 74px;
  height: 74px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 244, 214, 0.95) 0%, color-mix(in srgb, var(--c) 60%, #ffd166) 45%, transparent 72%);
  filter: blur(1px);
  animation: sunGlow 6s ease-in-out infinite alternate;
}

@keyframes kenburns {
  from { transform: scale(1) translate(0, 0); }
  to { transform: scale(1.12) translate(-1.6%, 1.2%); }
}

@keyframes sunGlow {
  from { transform: scale(1); opacity: 0.85; }
  to { transform: scale(1.15); opacity: 1; }
}

.hero-meta {
  position: absolute;
  left: 32px;
  bottom: 24px;
  z-index: 2;
}

.city-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  color: #fff;
  letter-spacing: 1px;
}

.hero-meta h1 {
  margin-top: 12px;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 4px;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.6);
}

.tags {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}

.tag {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  color: rgba(255, 255, 255, 0.85);
}

/* ---------- Body ---------- */
.body {
  padding: 24px 32px 28px;
}

.summary {
  font-size: 15px;
  line-height: 1.9;
  color: var(--text-main);
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(125, 211, 252, 0.15);
}

.story-tabs {
  margin-top: 6px;
}

.story-tabs p {
  font-size: 14px;
  line-height: 2;
  color: rgba(232, 241, 248, 0.88);
  white-space: pre-line;
}

.pending-ai {
  margin-top: 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px dashed rgba(125, 211, 252, 0.35);
  color: var(--text-dim);
  font-size: 13px;
}

.pending-ai em {
  font-style: normal;
  color: var(--accent);
}

/* Element Plus tabs 深色适配 */
:deep(.el-tabs__item) {
  color: var(--text-dim);
}

:deep(.el-tabs__item.is-active),
:deep(.el-tabs__item:hover) {
  color: var(--accent);
}

:deep(.el-tabs__active-bar) {
  background-color: var(--accent);
}

:deep(.el-tabs__nav-wrap::after) {
  background-color: rgba(125, 211, 252, 0.15);
}
</style>
