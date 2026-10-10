/**
 * AI 能力前端客户端：SSE 流式（fetch + ReadableStream 逐行解析）与识景。
 * 后端消息统一为 JSON：{type: sources|delta|done|error, ...}
 */

/** 通用 SSE 流式 POST：EventSource 不支持 POST，故用 fetch 手动解析 data: 帧 */
export async function postStream(url, body, onMessage, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`服务异常(${res.status})`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload) continue
      try {
        onMessage(JSON.parse(payload))
      } catch {
        // 坏帧丢弃，不中断流
      }
    }
  }
}

/** RAG 知识问答：{question, attractionId?} */
export const chatStream = (payload, onMessage, signal) => postStream('/api/chat', payload, onMessage, signal)

/** AI 讲解词：{attractionId} */
export const narrateStream = (payload, onMessage, signal) => postStream('/api/narrate', payload, onMessage, signal)

/** 多模态识景：{image: dataURL, hint?} → {text} 或 {error} */
export async function seeImage(payload) {
  const res = await fetch('/api/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return { error: `识景服务异常(${res.status})` }
  return res.json()
}
