package com.guijian.guangxi.controller;

import com.guijian.guangxi.adapter.ChatMessage;
import com.guijian.guangxi.adapter.LlmAdapter;
import com.guijian.guangxi.rag.KnowledgeChunk;
import com.guijian.guangxi.rag.RagService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * AI 能力接口（SSE 流式）：
 * - POST /api/chat    RAG 知识问答：检索知识块 → 依据资料流式回答（事件：sources/delta/done/error）
 * - POST /api/narrate AI 讲解员：依据景点全量资料生成口播讲解词（事件：delta/done/error）
 * - POST /api/vision  多模态识景：照片描述（非流式，演示模式返回明确提示）
 *
 * SSE 消息统一为 JSON：{type, text?/message?/items?}，前端按 type 分发。
 */
@RestController
@RequestMapping("/api")
public class AiController {

    private static final Logger log = LoggerFactory.getLogger(AiController.class);

    /** Java 21 虚拟线程：每个 SSE 连接独享，不阻塞 Servlet 线程池 */
    private static final java.util.concurrent.Executor SSE_EXECUTOR =
            java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor();

    record ChatReq(String question, String attractionId) {
    }

    record NarrateReq(String attractionId) {
    }

    record VisionReq(String image, String hint) {
    }

    private final LlmAdapter llm;
    private final RagService rag;

    public AiController(LlmAdapter llm, RagService rag) {
        this.llm = llm;
        this.rag = rag;
    }

    @PostMapping(value = "/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter chat(@RequestBody ChatReq req) {
        SseEmitter emitter = new SseEmitter(120_000L);
        String question = req.question() == null ? "" : req.question().trim();
        if (question.isEmpty()) {
            finishWithError(emitter, "问题不能为空");
            return emitter;
        }

        List<RagService.Retrieved> hits = rag.search(question, req.attractionId(), 4);
        StringBuilder ctx = new StringBuilder();
        List<Map<String, String>> sources = new ArrayList<>();
        int i = 1;
        for (RagService.Retrieved h : hits) {
            KnowledgeChunk c = h.chunk();
            ctx.append("[").append(i++).append("] ")
                    .append(c.attractionName()).append("·").append(c.section())
                    .append("：").append(c.text()).append("\n\n");
            sources.add(Map.of("name", c.attractionName(), "section", c.section()));
        }
        if (sources.isEmpty()) {
            finishWithError(emitter, "知识库为空，请检查 content/ 目录");
            return emitter;
        }

        String system = """
                你是文旅导览应用《桂见广西》的 AI 讲解员"桂桂"。回答规则：
                1. 只依据【参考资料】回答；资料不足以回答时坦诚说明，可建议游客实地探访，严禁编造。
                2. 200 字以内，口语化、亲切，像导游面对游客。
                3. 涉及历史事件与人物保持严谨，不添加资料之外的"史实"。
                """;
        String user = "【参考资料】\n" + ctx + "【游客问题】" + question;
        stream(emitter, List.of(ChatMessage.system(system), ChatMessage.user(user)), sources);
        return emitter;
    }

    @PostMapping(value = "/narrate", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter narrate(@RequestBody NarrateReq req) {
        SseEmitter emitter = new SseEmitter(120_000L);
        String raw = rag.attractionJson(req.attractionId());
        if (raw == null) {
            finishWithError(emitter, "景点不存在：" + req.attractionId());
            return emitter;
        }

        String system = """
                你是《桂见广西》的 AI 讲解员"桂桂"。请依据景点资料写一段 260~320 字的口播讲解词：
                - 第一句欢迎语并点出景点名；
                - 按"景—史—情"推进，有机融合地理、传说、历史、风物素材；
                - 口语化、短句，适合语音朗读；结尾一句引导游客身临其境。
                只使用资料中的信息，严禁编造。
                """;
        stream(emitter, List.of(ChatMessage.system(system), ChatMessage.user("景点资料：\n" + raw)), null);
        return emitter;
    }

    @PostMapping("/vision")
    public Map<String, Object> vision(@RequestBody VisionReq req) {
        String image = req.image();
        if (image == null || image.isBlank()) {
            return Map.of("error", "缺少图片");
        }
        if (!image.startsWith("data:")) {
            image = "data:image/jpeg;base64," + image;
        }
        String hint = req.hint() == null ? "" : req.hint().trim();
        String prompt = "这是游客上传的旅行照片"
                + (hint.isEmpty() ? "" : "，拍摄地可能与「" + hint + "」有关")
                + "。请用 80~150 字描述照片中的风景与氛围，再给一句简短旅行建议。地点不确定就明说，禁止编造。";
        try {
            return Map.of("text", llm.seeImage(prompt, image));
        } catch (UnsupportedOperationException e) {
            return Map.of("error", "识景功能需要配置真实大模型 Key 后可用（当前为演示模式）");
        } catch (Exception e) {
            log.warn("识景失败", e);
            return Map.of("error", "识景服务暂时不可用，请稍后再试");
        }
    }

    // ---------- 流式公共骨架 ----------

    /**
     * 先推 sources（参考来源），再推 delta 增量，收尾 done（幂等，防 [DONE] 与兜底重复）。
     */
    private void stream(SseEmitter emitter, List<ChatMessage> messages, List<Map<String, String>> sources) {
        SSE_EXECUTOR.execute(() -> {
            AtomicBoolean done = new AtomicBoolean(false);
            Runnable finish = () -> {
                if (done.compareAndSet(false, true)) {
                    send(emitter, Map.of("type", "done"));
                    emitter.complete();
                }
            };
            emitter.onTimeout(finish);
            emitter.onError(e -> done.set(true));
            try {
                if (sources != null) {
                    send(emitter, Map.of("type", "sources", "items", sources));
                }
                llm.chatStream(messages, new LlmAdapter.StreamHandler() {
                    @Override
                    public void onDelta(String delta) {
                        send(emitter, Map.of("type", "delta", "text", delta));
                    }

                    @Override
                    public void onComplete() {
                        finish.run();
                    }

                    @Override
                    public void onError(Throwable t) {
                        log.warn("LLM 流式失败", t);
                        send(emitter, Map.of("type", "error", "message", "AI 服务暂时不可用，请稍后再试"));
                        finish.run();
                    }
                });
            } catch (Exception e) {
                log.warn("SSE 处理异常", e);
                finish.run();
            }
        });
    }

    private void finishWithError(SseEmitter emitter, String message) {
        send(emitter, Map.of("type", "error", "message", message));
        emitter.complete();
    }

    private void send(SseEmitter emitter, Object payload) {
        try {
            emitter.send(SseEmitter.event().data(payload));
        } catch (IOException ignored) {
            // 客户端断开属正常现象
        }
    }
}
