<template>
  <div class="narrator">
    <div class="n-head">
      <span class="n-avatar">桂桂</span>
      <span class="n-title">AI 讲解员</span>
      <button class="n-btn" :class="{ stop: playing || loading || synthesizing }" @click="toggle">
        {{ loading ? '准备中…' : synthesizing ? '合成语音中…' : playing ? '停止讲解' : '开始讲解' }}
      </button>
    </div>
    <p class="n-subtitle" :class="{ live: loading || playing }">
      {{ subtitle || '点一下，桂桂把这里的景·史·情讲给你听' }}
    </p>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { narrateStream } from '@/api/ai'
import { speakFull, stopSpeaking } from '@/composables/useVoice'

const store = useAppStore()
const attractionId = computed(() => store.currentAttraction?.id)

const subtitle = ref('')
const playing = ref(false)      // 有声播放中（真 TTS 或本地兜底）
const loading = ref(false)      // 讲解词流式生成中
const synthesizing = ref(false) // 真 TTS 音频合成中
let controller = null
let audioEl = null

function toggle() {
  playing.value || loading.value || synthesizing.value ? stop() : start()
}

function start() {
  if (!attractionId.value) return
  stop()
  subtitle.value = ''
  const ctrl = new AbortController()
  controller = ctrl
  loading.value = true
  // 讲解词流式上字幕；语音等全量文本就绪后交真 TTS，音色与节奏远胜本地合成
  narrateStream({ attractionId: attractionId.value }, (msg) => {
    if (msg.type === 'delta') {
      subtitle.value += msg.text
    } else if (msg.type === 'error') {
      subtitle.value += msg.message || '讲解服务暂时不可用'
    }
  }, ctrl.signal)
    .catch((err) => {
      if (err.name !== 'AbortError') subtitle.value = '讲解服务暂时不可用，请稍后再试'
    })
    .finally(() => {
      if (ctrl.signal.aborted) return
      loading.value = false
      const text = subtitle.value.trim()
      if (text) synthesizeAndPlay(text, ctrl.signal)
    })
}

/** 真 TTS 优先：整段文本取回音频直接播放；任何失败自动回退本地 speechSynthesis，永不哑火 */
async function synthesizeAndPlay(text, signal) {
  synthesizing.value = true
  let audio = null
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    })
    if (!res.ok) throw new Error(`TTS(${res.status})`)
    const blob = await res.blob()
    if (signal.aborted) return
    audio = new Audio(URL.createObjectURL(blob))
    await audio.play() // 页面已有用户点击（粘性激活），可正常出声
  } catch (err) {
    if (err?.name === 'AbortError') return // 用户已停止，不再兜底出声
    audio?.pause()
    if (audio) URL.revokeObjectURL(audio.src)
    audio = null
    synthesizing.value = false
    playing.value = true
    speakFull(text, () => {
      playing.value = false
    })
    return
  }
  audioEl = audio
  audio.onended = () => {
    playing.value = false
    cleanupAudio()
  }
  synthesizing.value = false
  playing.value = true
}

function cleanupAudio() {
  audioEl?.pause()
  if (audioEl) URL.revokeObjectURL(audioEl.src)
  audioEl = null
}

function stop() {
  controller?.abort()
  controller = null
  cleanupAudio()
  stopSpeaking()
  loading.value = false
  synthesizing.value = false
  playing.value = false
}

onUnmounted(stop)
</script>

<style scoped>
.narrator {
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(125, 211, 252, 0.3);
  background: linear-gradient(135deg, rgba(125, 211, 252, 0.08), rgba(125, 211, 252, 0.02));
}

.n-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.n-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), #4f7dd9);
  color: #fff;
  font-size: 13px;
  flex: none;
}

.n-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
  flex: 1;
}

.n-btn {
  padding: 7px 18px;
  border-radius: 999px;
  border: 1px solid rgba(125, 211, 252, 0.5);
  background: rgba(125, 211, 252, 0.12);
  color: var(--accent);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.n-btn:hover:not(:disabled) {
  background: rgba(125, 211, 252, 0.22);
}

.n-btn.stop {
  border-color: rgba(230, 57, 70, 0.55);
  background: rgba(230, 57, 70, 0.14);
  color: #ff8a8f;
}

.n-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.n-subtitle {
  margin-top: 10px;
  font-size: 14px;
  line-height: 2;
  color: rgba(232, 241, 248, 0.9);
  white-space: pre-line;
  min-height: 56px;
}

.n-subtitle.live {
  border-left: 2px solid var(--accent);
  padding-left: 10px;
}
</style>
