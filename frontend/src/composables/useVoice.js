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

/** 城市欢迎语彩蛋：每次会话每城只播一次 */
export function welcomeOnce(city) {
  if (!city || played.has(city.id)) return
  played.add(city.id)
  speak(city.welcome)
}
