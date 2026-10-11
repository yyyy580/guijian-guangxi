import flags from '@/config/feature.flags'

const played = new Set()

/**
 * 浏览器本地语音（speechSynthesis）：零成本、断网可用的 P1 方案。
 * P2 接入后端 TTS 适配器后，此处作为降级兜底保留。
 */
export function speak(text) {
  if (!flags.voiceWelcome || !('speechSynthesis' in window)) return
  try {
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'zh-CN'
    utter.rate = 1.05
    speechSynthesis.cancel()
    speechSynthesis.speak(utter)
  } catch {
    // 语音被浏览器自动播放策略拦截时静默失败，不影响主流程
  }
}

/**
 * 整段朗读（讲解员真 TTS 失败时的兜底）：先 cancel 再播，支持结束回调。
 * 页面已有用户点击（粘性激活），通常可正常出声。
 */
export function speakFull(text, onend) {
  if (!text || !('speechSynthesis' in window)) {
    onend?.()
    return
  }
  try {
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'zh-CN'
    utter.rate = 1.05
    if (onend) {
      utter.onend = onend
      utter.onerror = onend
    }
    speechSynthesis.cancel()
    speechSynthesis.speak(utter)
  } catch {
    onend?.()
  }
}

/** 停止所有本地朗读（讲解员停止/卡片关闭时调用） */
export function stopSpeaking() {
  if (!('speechSynthesis' in window)) return
  try {
    speechSynthesis.cancel()
  } catch {
    // 忽略
  }
}

/** 城市欢迎语彩蛋：每次会话每城只播一次 */
export function welcomeOnce(city) {
  if (!city || played.has(city.id)) return
  played.add(city.id)
  speak(city.welcome)
}
