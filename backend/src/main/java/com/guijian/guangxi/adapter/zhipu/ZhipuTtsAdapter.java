package com.guijian.guangxi.adapter.zhipu;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.guijian.guangxi.adapter.TtsAdapter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * 智谱 GLM-TTS 语音合成适配器：
 * - 端点 POST /audio/speech，非流式 response_format=wav（24000Hz），浏览器 Audio 可直接播放
 * - 与大模型共用开放平台 Key：app.tts.api-key 默认回落 LLM_API_KEY
 */
@Component
@ConditionalOnProperty(name = "app.tts.provider", havingValue = "zhipu")
public class ZhipuTtsAdapter implements TtsAdapter {

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${app.tts.base-url:https://open.bigmodel.cn/api/paas/v4}")
    private String baseUrl;

    @Value("${app.tts.api-key:}")
    private String apiKey;

    @Value("${app.tts.model:glm-tts}")
    private String model;

    @Value("${app.tts.voice:tongtong}")
    private String voice;

    @Override
    public byte[] synthesize(String text) {
        ObjectNode body = mapper.createObjectNode();
        body.put("model", model);
        body.put("input", text);
        body.put("voice", voice);
        body.put("response_format", "wav");   // 流式才支持 pcm；非流式用 wav 浏览器直接可播

        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/audio/speech"))
                .timeout(Duration.ofSeconds(60))
                .header("Authorization", "Bearer " + requireKey())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        HttpResponse<byte[]> resp;
        try {
            resp = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
        } catch (IOException e) {
            throw new IllegalStateException("TTS 调用失败：" + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("TTS 请求被中断", e);
        }
        if (resp.statusCode() != 200) {
            String detail = new String(resp.body(), StandardCharsets.UTF_8);
            // 状态码放进消息头几个字符，friendly() 靠 401/429 关键字翻译病因
            throw new IllegalStateException("智谱接口返回 " + resp.statusCode() + "：" + truncate(detail));
        }
        return resp.body();
    }

    private String requireKey() {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException("未配置 TTS API Key（provider=zhipu 需要 API Key）");
        }
        return apiKey;
    }

    private String truncate(String s) {
        if (s == null) {
            return "";
        }
        return s.length() > 300 ? s.substring(0, 300) + "…" : s;
    }
}
