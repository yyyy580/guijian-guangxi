<template>
  <div class="narrator">
    <div class="n-head">
      <span class="n-avatar">桂桂</span>
      <span class="n-title">AI 讲解员</span>
      <button class="n-btn" :class="{ stop: playing }" :disabled="loading" @click="toggle">
        {{ loading ? '准备中…' : playing ? '停止讲解' : '开始讲解' }}
      </button>
    </div>
    <p class="n-subtitle" :class="{ live: playing }">
      {{ subtitle || '点一下，桂桂把这里的景·史·情讲给你听' }}
    </p>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { narrateStream } from '@/api/ai'
import { speakSentence, stopSpeaking } from '@/composables/useVoice'

const store = useAppStore()
const attractionId = computed(() => store.currentAttraction?.id)

const subtitle = ref('')
const playing = ref(false)
const loading = ref(false)
let controller = null

function toggle() {
  playing.value ? stop() : start()
}

function start() {
  if (!attractionId.value) return
  stop()
  subtitle.value = ''
  const ctrl = new AbortController()
  controller = ctrl
  loading.value = true
  playing.value = true
  let speakBuffer = '' // 待朗读缓冲（切句后消耗）；字幕用 subtitle 只增不减
  narrateStream({ attractionId: attractionId.value }, (msg) => {
    if (msg.type === 'delta') {
      subtitle.value += msg.text
      speakBuffer += msg.text
      // 整句投喂朗读：字幕流式推进，语音按句排队
      const cut = takeSentences(speakBuffer)
      cut.sentences.forEach(speakSentence)
      speakBuffer = cut.rest
    } else if (msg.type === 'error') {
      subtitle.value += msg.message || '讲解服务暂时不可用'
    }
  }, ctrl.signal)
    .catch((err) => {
      if (err.name !== 'AbortError') subtitle.value = '讲解服务暂时不可用，请稍后再试'
    })
    .finally(() => {
      if (speakBuffer.trim() && !ctrl.signal.aborted) speakSentence(speakBuffer.trim())
      loading.value = false
      playing.value = false
    })
}

function stop() {
  controller?.abort()
  controller = null
  stopSpeaking()
  loading.value = false
  playing.value = false
}

/** 取出缓冲中所有完整句（以句末标点/换行切分），返回 {sentences, rest} */
function takeSentences(text) {
  const sentences = []
  let rest = text
  const re = /^([\s\S]*?[。！？!?…；;\n])/
  let m
  while ((m = rest.match(re))) {
    const s = m[1].trim()
    if (s) sentences.push(s)
    rest = rest.slice(m[1].length)
  }
  return { sentences, rest }
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
