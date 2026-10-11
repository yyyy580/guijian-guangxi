import flags from '@/config/feature.flags'

const played = new Set()

/**
 * 智能挑选最优中文音色：Edge/Chrome 的"在线自然音色"（接近真人）
 * > Windows 本地音色（机械）> 浏览器默认。真后端 TTS 不可用时的免费最优兜底。
 */
let bestVoice = null
function pickBestVoice() {
  if (bestVoice) return bestVoice
  if (!('speechSynthesis' in window)) return null
  const voices = speechSynthesis.getVoices() || []
  const zh = voices.filter((v) => /^(zh|cmn)/i.test(v.lang))
  if (!zh.length) return null
  const score = (v) =>
    (/natural/i.test(v.name) ? 100 : 0) +
    (/online/i.test(v.name) ? 40 : 0) +
    (/(xiaoxiao|xiaoyi|yunxi|yunyang|yunjian)/i.test(v.name) ? 30 : 0) +
    (/(huihui|yaoyao|kangkang)/i.test(v.name) ? 10 : 0)
  bestVoice = zh.sort((a, b) => score(b) - score(a))[0]
  return bestVoice
}

// 音色列表异步加载：就绪后重置缓存，下次朗读自动选中自然音色
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => {
    bestVoice = null
  }
}

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
    const v = pickBestVoice()
    if (v) utter.voice = v
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
    const v = pickBestVoice()
    if (v) utter.voice = v
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
