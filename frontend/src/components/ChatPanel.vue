<template>
  <div class="chat-root">
    <button v-if="!open" class="fab" @click="open = true">
      <span class="fab-icon">💬</span>问一问
    </button>

    <transition name="pop">
      <!-- 注意：transition 包裹层会隔断 v-if/v-else 链，这里必须独立 v-if -->
      <section v-if="open" class="panel">
        <header class="p-head">
          <span class="p-avatar">桂桂</span>
          <div class="p-title">
            <strong>知识问答</strong>
            <small>基于四城九景内容库实时检索</small>
          </div>
          <button class="p-close" @click="close">×</button>
        </header>

        <div ref="listEl" class="p-body">
          <div v-if="!messages.length" class="p-empty">
            <p>我是讲解员桂桂，关于广西四城九景，尽管问我~</p>
            <div class="p-tips">
              <button v-for="q in quickQuestions" :key="q" @click="ask(q)">{{ q }}</button>
            </div>
          </div>

          <template v-for="(m, i) in messages" :key="i">
            <div class="msg" :class="m.role">
              <img v-if="m.image" :src="m.image" class="msg-img" alt="识景照片" />
              <p v-if="m.text">{{ m.text }}</p>
              <div v-if="m.sources?.length" class="msg-src">
                <span v-for="s in m.sources" :key="s.name + s.section">{{ s.name }}·{{ s.section }}</span>
              </div>
            </div>
          </template>

          <div v-if="thinking" class="msg assistant">
            <p class="thinking">桂桂思考中…</p>
          </div>
        </div>

        <footer class="p-foot">
          <button class="p-cam" title="拍照识景" @click="fileEl?.click()">📷</button>
          <input ref="fileEl" type="file" accept="image/*" hidden @change="onPickImage" />
          <input
            v-model="draft"
            class="p-input"
            :placeholder="placeholder"
            @keydown.enter="send"
          />
          <button class="p-send" :disabled="streaming || !draft.trim()" @click="send">
            {{ streaming ? '…' : '发送' }}
          </button>
        </footer>
      </section>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useAppStore } from '@/stores/app'
import { chatStream, seeImage } from '@/api/ai'

const store = useAppStore()

const open = ref(false)
const draft = ref('')
const messages = ref([]) // {role:'user'|'assistant', text, image?, sources?}
const streaming = ref(false)
const thinking = ref(false)
const listEl = ref(null)
const fileEl = ref(null)
let controller = null

const quickQuestions = [
  '百色起义是谁领导的？',
  '漓江为什么甲天下？',
  '银滩的沙为什么是银色的？',
  '靖西鹅泉有什么传说？',
]

const placeholder = computed(() =>
  store.currentAttraction ? `关于${store.currentAttraction.name}，想问点什么？` : '想了解广西的什么？',
)

watch(messages, scrollToBottom, { deep: true })
watch(thinking, scrollToBottom)

function scrollToBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

function ask(q) {
  if (streaming.value || !q.trim()) return
  draft.value = ''
  messages.value.push({ role: 'user', text: q.trim() })
  reply()
}

function send() {
  ask(draft.value)
}

/** 流式生成回答：sources 事件挂参考来源，delta 逐字追加 */
function reply() {
  const bubble = { role: 'assistant', text: '', sources: [] }
  messages.value.push(bubble)
  streaming.value = true
  controller = new AbortController()
  chatStream(
    { question: messages.value[messages.value.length - 2].text, attractionId: store.currentAttraction?.id },
    (msg) => {
      if (msg.type === 'sources') bubble.sources = msg.items
      else if (msg.type === 'delta') bubble.text += msg.text
      else if (msg.type === 'error') bubble.text += (bubble.text ? '\n' : '') + (msg.message || '服务异常')
    },
    controller.signal,
  )
    .catch((err) => {
      if (err.name !== 'AbortError') bubble.text += (bubble.text ? '\n' : '') + '连接中断，请稍后再试'
    })
    .finally(() => {
      streaming.value = false
      controller = null
    })
}

/** 多模态识景：照片 → 一次性描述（非流式） */
async function onPickImage(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  messages.value.push({ role: 'user', text: '帮我看看这张照片', image: dataUrl })
  thinking.value = true
  try {
    const r = await seeImage({ image: dataUrl, hint: store.currentAttraction?.name })
    messages.value.push({ role: 'assistant', text: r.text || r.error || '识景服务没有返回内容' })
  } catch {
    messages.value.push({ role: 'assistant', text: '识景服务暂时不可用，请稍后再试' })
  } finally {
    thinking.value = false
  }
}

function close() {
  controller?.abort()
  controller = null
  streaming.value = false
  open.value = false
}
</script>

<style scoped>
.chat-root {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 130;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

/* 悬浮按钮 */
.fab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 22px;
  border: 1px solid rgba(125, 211, 252, 0.45);
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(13, 34, 56, 0.92), rgba(20, 48, 78, 0.92));
  color: var(--accent);
  font-size: 15px;
  letter-spacing: 2px;
  cursor: pointer;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  transition: all 0.2s;
}

.fab:hover {
  transform: translateY(-2px);
  border-color: var(--accent);
}

.fab-icon {
  font-size: 17px;
}

/* 面板 */
.panel {
  width: min(380px, calc(100vw - 44px));
  height: min(600px, calc(100vh - 44px));
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  border: 1px solid rgba(125, 211, 252, 0.3);
  background: linear-gradient(160deg, rgba(9, 22, 38, 0.97), rgba(13, 32, 54, 0.97));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(10px);
  overflow: hidden;
}

.p-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(125, 211, 252, 0.15);
}

.p-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), #4f7dd9);
  color: #fff;
  font-size: 14px;
  flex: none;
}

.p-title {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.p-title strong {
  font-size: 15px;
  color: var(--text-main);
}

.p-title small {
  font-size: 11px;
  color: var(--text-dim);
}

.p-close {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: transparent;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}

.p-close:hover {
  background: rgba(230, 57, 70, 0.8);
  border-color: transparent;
}

/* 消息区 */
.p-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.p-empty {
  margin-top: 26px;
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.8;
}

.p-tips {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.p-tips button {
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px dashed rgba(125, 211, 252, 0.35);
  background: rgba(125, 211, 252, 0.05);
  color: rgba(232, 241, 248, 0.85);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.p-tips button:hover {
  border-style: solid;
  border-color: var(--accent);
  color: var(--accent);
}

.msg {
  max-width: 88%;
  padding: 10px 13px;
  border-radius: 12px;
  font-size: 13.5px;
  line-height: 1.9;
  white-space: pre-line;
}

.msg.user {
  align-self: flex-end;
  background: linear-gradient(135deg, rgba(79, 125, 217, 0.35), rgba(79, 125, 217, 0.22));
  border: 1px solid rgba(79, 125, 217, 0.4);
  color: var(--text-main);
}

.msg.assistant {
  align-self: flex-start;
  background: rgba(125, 211, 252, 0.07);
  border: 1px solid rgba(125, 211, 252, 0.22);
  color: rgba(232, 241, 248, 0.92);
}

.thinking {
  color: var(--text-dim);
  animation: blink 1.4s ease-in-out infinite;
}

@keyframes blink {
  50% {
    opacity: 0.45;
  }
}

.msg-img {
  width: 100%;
  max-width: 220px;
  border-radius: 8px;
  margin-bottom: 6px;
  display: block;
}

.msg-src {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.msg-src span {
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid rgba(125, 211, 252, 0.35);
  color: var(--accent);
}

/* 输入区 */
.p-foot {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgba(125, 211, 252, 0.15);
}

.p-cam {
  flex: none;
  width: 40px;
  border-radius: 10px;
  border: 1px solid rgba(125, 211, 252, 0.3);
  background: rgba(125, 211, 252, 0.06);
  cursor: pointer;
  font-size: 16px;
}

.p-cam:hover {
  border-color: var(--accent);
}

.p-input {
  flex: 1;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(125, 211, 252, 0.25);
  background: rgba(7, 19, 31, 0.6);
  color: var(--text-main);
  font-size: 13.5px;
  outline: none;
}

.p-input:focus {
  border-color: var(--accent);
}

.p-send {
  flex: none;
  padding: 0 18px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, var(--accent), #4f7dd9);
  color: #fff;
  font-size: 13.5px;
  cursor: pointer;
}

.p-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 弹出动效 */
.pop-enter-active,
.pop-leave-active {
  transition: all 0.28s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(16px) scale(0.97);
}
</style>
