<template>
  <div class="attraction-view">
    <!-- 全屏背景墙：实拍图铺满整页固定不动，Ken Burns 缓放；无图时 CSS 艺术风景兜底 -->
    <div class="bg-layer" :class="{ immersed: awakened }" :style="{ '--c': cityColor }" aria-hidden="true">
      <img v-if="cover" class="bg-img" :src="cover" alt="" @error="coverError = true" />
      <div v-else class="bg-art"></div>
      <!-- 唤醒视频层：首帧与静照对齐，就绪后淡入实现"无缝唤醒"；懒加载（点击才挂载） -->
      <video
        v-if="awakened && !videoError"
        class="bg-video"
        :class="{ ready: videoReady }"
        :src="awakenVideo"
        autoplay
        loop
        muted
        playsinline
        @canplay="onVideoReady"
        @error="onVideoError"
      ></video>
      <template v-if="!cover">
        <svg class="hills hills-far" viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path d="M0,224 C240,140 420,190 640,150 C860,110 1080,180 1440,130 L1440,320 L0,320 Z" />
        </svg>
        <svg class="hills hills-near" viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path d="M0,288 C200,220 480,260 720,230 C960,200 1200,260 1440,226 L1440,320 L0,320 Z" />
        </svg>
        <div class="sun"></div>
      </template>
      <div class="bg-shade"></div>
    </div>

    <button class="back-btn" :class="{ dim: awakened }" @click="store.closeAttraction()">
      <span class="arrow">←</span> 返回{{ city.name }}
    </button>

    <!-- 沉浸模式控制：唤醒后唯一常驻按钮，点击回到静照 -->
    <button v-if="awakened" class="unawaken-btn" @click="toggleAwaken">◻ 回到静照</button>

    <div class="content" :class="{ immersed: awakened }">
      <header class="hero-meta">
        <span class="city-badge" :style="{ background: cityColor }">{{ city.name }} · {{ city.colorName }}</span>
        <h1>{{ attraction.name }}</h1>
        <p class="tags">
          <span v-for="t in attraction.tags" :key="t" class="tag">{{ t }}</span>
        </p>
      </header>

      <section class="panel">
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

        <!-- 唤醒风景：静照无缝切 AI 图生视频（点击懒加载，失败回退静照） -->
        <button
          class="awaken-btn"
          :class="{ active: awakened }"
          :disabled="!flags.awakenVideo"
          @click="toggleAwaken"
        >
          <span>唤醒风景 · 静照变 AI 视频</span>
          <em v-if="!flags.awakenVideo">素材生成中，敬请期待</em>
          <em v-else-if="!awakenVideo">该景点素材准备中</em>
          <em v-else-if="awakened && !videoReady">唤醒中…</em>
          <em v-else-if="awakened">回到静照</em>
          <em v-else>点击唤醒</em>
        </button>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import NarratorBox from '@/components/NarratorBox.vue'
import flags from '@/config/feature.flags'

const store = useAppStore()
const attraction = computed(() => store.currentAttraction)
const city = computed(() => store.currentCity)
const cityColor = computed(() => city.value?.color || 'var(--accent)')
const tab = ref('geo')

const coverError = ref(false)
const cover = computed(() => (coverError.value ? '' : attraction.value?.assets?.cover || ''))

// 唤醒风景状态机：idle → loading(视频挂载加载) → playing；可切回静照；出错回退
const awakened = ref(false)
const videoReady = ref(false)
const videoError = ref(false)
const awakenVideo = computed(() => attraction.value?.assets?.awakenVideo || '')

watch(
  () => attraction.value?.id,
  () => {
    coverError.value = false
    awakened.value = false
    videoReady.value = false
    videoError.value = false
  }
)

function toggleAwaken() {
  if (!flags.awakenVideo) return
  if (awakened.value) {
    awakened.value = false
    return
  }
  if (!awakenVideo.value) {
    ElMessage.info('该景点的唤醒素材准备中')
    return
  }
  videoReady.value = false
  awakened.value = true // 挂载 <video> 开始懒加载，就绪后淡入
}

function onVideoReady() {
  videoReady.value = true
}

function onVideoError() {
  videoError.value = true
  awakened.value = false
  ElMessage.warning('唤醒失败，已回到静照')
}
</script>

<style scoped>
.attraction-view {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background: var(--bg-deep);
}

/* ---------- 背景墙：fixed 铺满整页，滚动时纹丝不动 ---------- */
.bg-layer {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.bg-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  animation: kenburns 26s ease-in-out infinite alternate;
}

.bg-art {
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

/* 压暗渐变：顶部透出风景，底部加深直接托住正文文字（无面板） */
.bg-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(4, 12, 22, 0.32) 0%,
    rgba(4, 12, 22, 0.5) 42%,
    rgba(5, 13, 23, 0.94) 100%
  );
  transition: opacity 0.6s ease;
}

/* 沉浸模式：压暗层大幅减淡，让视频原色透出 */
.bg-layer.immersed .bg-shade {
  opacity: 0.18;
}

/* 唤醒视频层：就绪后淡入，盖在静照上 */
.bg-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.8s ease;
}

.bg-video.ready {
  opacity: 1;
}

@keyframes kenburns {
  from { transform: scale(1) translate(0, 0); }
  to { transform: scale(1.12) translate(-1.6%, 1.2%); }
}

@keyframes sunGlow {
  from { transform: scale(1); opacity: 0.85; }
  to { transform: scale(1.15); opacity: 1; }
}

/* ---------- 固定返回按钮（滚动时不随内容移动） ---------- */
.back-btn {
  position: fixed;
  top: 28px;
  left: 36px;
  z-index: 10;
  background: var(--bg-panel);
  color: var(--text-main);
  border: 1px solid rgba(125, 211, 252, 0.35);
  border-radius: 999px;
  padding: 8px 18px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.25s ease;
}

.back-btn:hover {
  border-color: var(--accent);
  background: rgba(56, 189, 248, 0.12);
}

/* 沉浸模式下返回按钮半透明防干扰，hover 恢复醒目 */
.back-btn.dim {
  opacity: 0.25;
}

.back-btn.dim:hover {
  opacity: 1;
}

/* ---------- 沉浸模式：唤醒后正文整体淡出，只剩纯视频 ---------- */
.content {
  position: relative;
  z-index: 1;
  padding: clamp(110px, 20vh, 220px) 24px 64px;
}

.hero-meta {
  max-width: 920px;
  margin: 0 auto 28px;
  transition: opacity 0.55s ease;
}

.content.immersed .hero-meta {
  opacity: 0.3;
}

.panel {
  max-width: 920px;
  margin: 0 auto;
  transition: opacity 0.55s ease, transform 0.55s ease;
}

.content.immersed .panel {
  opacity: 0;
  transform: translateY(16px);
  pointer-events: none;
}

/* 沉浸模式专属："回到静照"悬浮胶囊按钮 */
.unawaken-btn {
  position: fixed;
  bottom: 42px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 12;
  padding: 11px 28px;
  border-radius: 999px;
  border: 1px solid rgba(125, 211, 252, 0.55);
  background: rgba(7, 19, 31, 0.55);
  color: var(--text-main);
  font-size: 14px;
  letter-spacing: 2px;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: border-color 0.25s ease, background 0.25s ease;
  animation: fadeUp 0.6s ease;
}

.unawaken-btn:hover {
  border-color: var(--accent);
  background: rgba(56, 189, 248, 0.18);
}

@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translate(-50%, 12px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
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
  margin-top: 14px;
  font-size: clamp(34px, 5vw, 52px);
  font-weight: 700;
  letter-spacing: 6px;
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.65);
}

.tags {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}

.tag {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  color: rgba(255, 255, 255, 0.88);
  background: rgba(7, 19, 31, 0.35);
}

/* 无面板：文字直接映在背景墙上，仅保留栏宽与留白（栏宽/过渡定义见上方 .panel 主规则） */

.summary {
  font-size: 15px;
  line-height: 1.9;
  color: var(--text-main);
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.65);
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(125, 211, 252, 0.2);
}

.story-tabs {
  margin-top: 6px;
}

.story-tabs p {
  font-size: 14px;
  line-height: 2;
  color: rgba(240, 247, 252, 0.94);
  white-space: pre-line;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.7);
}

/* 唤醒风景按钮：待机/唤醒中/已唤醒三态 */
.awaken-btn {
  margin-top: 18px;
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px dashed rgba(125, 211, 252, 0.35);
  background: rgba(7, 19, 31, 0.35);
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.25s ease;
}

.awaken-btn em {
  font-style: normal;
  color: var(--accent);
}

.awaken-btn:hover:not(:disabled) {
  border-color: var(--accent);
  background: rgba(56, 189, 248, 0.1);
  color: var(--text-main);
}

.awaken-btn.active {
  border-style: solid;
  border-color: var(--accent);
  background: rgba(56, 189, 248, 0.14);
  color: var(--text-main);
}

.awaken-btn:disabled {
  cursor: default;
  opacity: 0.7;
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
