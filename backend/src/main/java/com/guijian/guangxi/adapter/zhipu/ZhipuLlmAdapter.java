package com.guijian.guangxi.adapter.zhipu;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.guijian.guangxi.adapter.ChatMessage;
import com.guijian.guangxi.adapter.LlmAdapter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 智谱 AI 适配器（open.bigmodel.cn）：
 * - 对话/流式：glm-4-flash（免费档）；多模态识景：glm-4v-flash（免费档）
 * - 向量：embedding-3（RAG 检索）
 * 接入方式：LLM_PROVIDER=zhipu + LLM_API_KEY=xxx，其余模型名均可用环境变量覆盖。
 */
@Component
@ConditionalOnProperty(name = "app.llm.provider", havingValue = "zhipu")
public class ZhipuLlmAdapter implements LlmAdapter {

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${app.llm.base-url:https://open.bigmodel.cn/api/paas/v4}")
    private String baseUrl;

    @Value("${app.llm.api-key:}")
    private String apiKey;

    @Value("${app.llm.model:glm-4-flash}")
    private String chatModel;

    @Value("${app.llm.vision-model:glm-4v-flash}")
    private String visionModel;

    @Value("${app.llm.embedding-model:embedding-3}")
    private String embeddingModel;

    @Override
    public String chat(List<ChatMessage> messages) {
        ObjectNode body = mapper.createObjectNode();
        body.put("model", chatModel);
        fillMessages(body, messages);
        try {
            JsonNode root = postForJson("/chat/completions", body, Duration.ofSeconds(120));
            return root.path("choices").path(0).path("message").path("content").asText("");
        } catch (IOException e) {
            throw new IllegalStateException("对话调用失败：" + e.getMessage(), e);
        }
    }

    @Override
    public void chatStream(List<ChatMessage> messages, StreamHandler handler) {
        try {
            ObjectNode body = mapper.createObjectNode();
            body.put("model", chatModel);
            body.put("stream", true);
            fillMessages(body, messages);

            HttpRequest request = builder("/chat/completions", Duration.ofSeconds(120))
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                    .build();
            HttpResponse<Stream<String>> resp = client.send(request, HttpResponse.BodyHandlers.ofLines());
            if (resp.statusCode() != 200) {
                // 鉴权失败/欠费等：把智谱的真实错误抛出去，前端才能给出准确提示
                throw new IOException("智谱接口返回 " + resp.statusCode() + "："
                        + truncate(resp.body().collect(Collectors.joining())));
            }
            // 逐行读 SSE：data: {...} / data: [DONE]
            resp.body().forEach(line -> {
                if (!line.startsWith("data:")) {
                    return;
                }
                String payload = line.substring(5).trim();
                if (payload.isEmpty() || "[DONE]".equals(payload)) {
                    return;
                }
                try {
                    String delta = mapper.readTree(payload)
                            .path("choices").path(0).path("delta").path("content").asText("");
                    if (!delta.isEmpty()) {
                        handler.onDelta(delta);
                    }
                } catch (Exception ignored) {
                    // 坏帧丢弃，不中断流
                }
            });
            handler.onComplete();
        } catch (Exception e) {
            handler.onError(e);
        }
    }

    @Override
    public List<float[]> embed(List<String> texts) {
        try {
            ObjectNode body = mapper.createObjectNode();
            body.put("model", embeddingModel);
            ArrayNode input = body.putArray("input");
            texts.forEach(input::add);

            JsonNode root = postForJson("/embeddings", body, Duration.ofSeconds(60));
            List<float[]> out = new ArrayList<>();
            for (JsonNode d : root.path("data")) {
                JsonNode arr = d.path("embedding");
                float[] vec = new float[arr.size()];
                for (int i = 0; i < arr.size(); i++) {
                    vec[i] = (float) arr.get(i).asDouble();
                }
                out.add(vec);
            }
            if (out.size() != texts.size()) {
                throw new IllegalStateException("向量数量不匹配：期望 " + texts.size() + "，返回 " + out.size());
            }
            return out;
        } catch (IOException e) {
            throw new IllegalStateException("向量嵌入调用失败：" + e.getMessage(), e);
        }
    }

    @Override
    public String seeImage(String prompt, String imageDataUrl) {
        ObjectNode body = mapper.createObjectNode();
        body.put("model", visionModel);
        ArrayNode messages = body.putArray("messages");
        ObjectNode user = messages.addObject();
        user.put("role", "user");
        ArrayNode content = user.putArray("content");
        ObjectNode text = content.addObject();
        text.put("type", "text");
        text.put("text", prompt);
        ObjectNode image = content.addObject();
        image.put("type", "image_url");
        image.putObject("image_url").put("url", imageDataUrl);

        try {
            JsonNode root = postForJson("/chat/completions", body, Duration.ofSeconds(120));
            return root.path("choices").path(0).path("message").path("content").asText("");
        } catch (IOException e) {
            throw new IllegalStateException("多模态识景调用失败：" + e.getMessage(), e);
        }
    }

    // ---------- 内部工具 ----------

    private void fillMessages(ObjectNode body, List<ChatMessage> messages) {
        ArrayNode arr = body.putArray("messages");
        for (ChatMessage m : messages) {
            ObjectNode n = arr.addObject();
            n.put("role", m.role());
            n.put("content", m.content());
        }
    }

    private HttpRequest.Builder builder(String path, Duration timeout) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException("未配置 LLM_API_KEY（provider=zhipu 需要 API Key）");
        }
        return HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(timeout)
                .header("Authorization", "Bearer " + apiKey)
                .header("Content-Type", "application/json");
    }

    private JsonNode postForJson(String path, ObjectNode body, Duration timeout) throws IOException {
        HttpRequest request = builder(path, timeout)
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                .build();
        HttpResponse<String> resp;
        try {
            resp = client.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("请求被中断", e);
        }
        if (resp.statusCode() != 200) {
            throw new IOException("智谱接口返回 " + resp.statusCode() + "：" + truncate(resp.body()));
        }
        return mapper.readTree(resp.body());
    }

    private String truncate(String s) {
        if (s == null) {
            return "";
        }
        return s.length() > 300 ? s.substring(0, 300) + "…" : s;
    }
}
