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

/** 讲解员逐句投喂朗读：不 cancel，speechSynthesis 自动排队依次播 */
export function speakSentence(text) {
  if (!text || !('speechSynthesis' in window)) return
  try {
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'zh-CN'
    utter.rate = 1.05
    speechSynthesis.speak(utter)
  } catch {
    // 语音被浏览器自动播放策略拦截时静默失败，不影响字幕主流程
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
