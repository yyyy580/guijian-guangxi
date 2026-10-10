package com.guijian.guangxi.adapter.stub;

import com.guijian.guangxi.adapter.ChatMessage;
import com.guijian.guangxi.adapter.LlmAdapter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 占位实现：未配置真实 LLM 供应商时兜底，保证服务可启动、SSE 链路可联调。
 * 接入真实供应商：环境变量 LLM_PROVIDER=zhipu + LLM_API_KEY=xxx（application.yml: app.llm.provider）。
 */
@Component
@ConditionalOnProperty(name = "app.llm.provider", havingValue = "stub", matchIfMissing = true)
public class StubLlmAdapter implements LlmAdapter {

    @Override
    public String chat(List<ChatMessage> messages) {
        String last = messages.get(messages.size() - 1).content();
        return "【演示模式】大模型 Key 尚未配置（app.llm.provider=stub）。"
                + "接入智谱后，这里将依据知识库资料流式回答。本次收到 " + last.length() + " 字输入。";
    }
}
