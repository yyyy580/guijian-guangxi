package com.guijian.guangxi.adapter;

import java.util.List;

/**
 * 大模型适配器——AI 深度能力的统一入口（对话 / 流式 / 向量 / 多模态）。
 * 供应商涨价/停服时仅需新增或切换实现类（application.yml: app.llm.provider），
 * 上层 RAG/问答/讲解代码零改动。
 */
public interface LlmAdapter {

    /** 多轮对话，返回完整回答 */
    String chat(List<ChatMessage> messages);

    /** 单轮便捷入口 */
    default String chat(String prompt) {
        return chat(List.of(ChatMessage.user(prompt)));
    }

    /**
     * 流式对话：delta 增量回调（可能多线程单线程不定，Handler 实现需自行保序）。
     * 默认伪流式：一次性取回后切块推送，保证仅实现 chat() 的适配器也能流式联调。
     */
    default void chatStream(List<ChatMessage> messages, StreamHandler handler) {
        try {
            String full = chat(messages);
            for (int i = 0; i < full.length(); i += 6) {
                handler.onDelta(full.substring(i, Math.min(full.length(), i + 6)));
            }
            handler.onComplete();
        } catch (Exception e) {
            handler.onError(e);
        }
    }

    /** 文本批量向量化（RAG 检索用）；不支持的实现抛 UnsupportedOperationException */
    default List<float[]> embed(List<String> texts) {
        throw new UnsupportedOperationException("当前 LLM 适配器不支持向量嵌入");
    }

    /** 多模态识景：imageDataUrl 为 data:image/...;base64,xxx；不支持的实现抛异常 */
    default String seeImage(String prompt, String imageDataUrl) {
        throw new UnsupportedOperationException("当前 LLM 适配器不支持多模态识景");
    }

    /** 流式回调 */
    interface StreamHandler {
        void onDelta(String delta);

        void onComplete();

        default void onError(Throwable error) {
        }
    }
}
