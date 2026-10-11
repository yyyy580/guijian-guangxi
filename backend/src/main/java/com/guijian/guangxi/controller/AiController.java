package com.guijian.guangxi.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.guijian.guangxi.adapter.ChatMessage;
import com.guijian.guangxi.adapter.LlmAdapter;
import com.guijian.guangxi.adapter.TtsAdapter;
import com.guijian.guangxi.rag.KnowledgeChunk;
import com.guijian.guangxi.rag.RagService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
 * - POST /api/tts     语音合成：整段文本 → audio/wav（演示模式返回 503，前端回退本地语音）
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

    record TtsReq(String text) {
    }

    private final LlmAdapter llm;
    private final RagService rag;
    private final TtsAdapter tts;
    private final ObjectMapper mapper;

    public AiController(LlmAdapter llm, RagService rag, TtsAdapter tts, ObjectMapper mapper) {
        this.llm = llm;
        this.rag = rag;
        this.tts = tts;
        this.mapper = mapper;
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
            return Map.of("error", friendly(e));
        }
    }

    /**
     * 语音合成：{text} → audio/wav 二进制（GLM-TTS 彤彤音色）。
     * 失败一律返回 JSON {error}，前端据此自动回退本地 speechSynthesis，讲解永不哑火。
     */
    @PostMapping("/tts")
    public ResponseEntity<byte[]> tts(@RequestBody TtsReq req) {
        String text = req.text() == null ? "" : req.text().trim();
        if (text.isEmpty()) {
            return jsonError(HttpStatus.BAD_REQUEST, "文本不能为空");
        }
        if (text.length() > 1000) {
            // 智谱 input 上限 1024，留余量；前端超长时走本地语音兜底
            return jsonError(HttpStatus.BAD_REQUEST, "文本过长，无法一次性合成语音");
        }
        try {
            byte[] audio = tts.synthesize(text);
            if (audio == null || audio.length == 0) {
                return jsonError(HttpStatus.SERVICE_UNAVAILABLE, "TTS 未配置（演示模式），请回退本地语音");
            }
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType("audio/wav"))
                    .cacheControl(CacheControl.noStore())
                    .body(audio);
        } catch (Exception e) {
            log.warn("TTS 合成失败", e);
            return jsonError(HttpStatus.BAD_GATEWAY, friendly(e));
        }
    }

    private ResponseEntity<byte[]> jsonError(HttpStatus status, String message) {
        try {
            return ResponseEntity.status(status)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(mapper.writeValueAsBytes(Map.of("error", message)));
        } catch (Exception ignored) {
            return ResponseEntity.status(status).build();
        }
    }

    // ---------- 流式公共骨架 ----------

    /**
     * 先推 sources（参考来源），再推 delta 增量，收尾 done（幂等，防 [DONE] 与兜底重复）。
     */
    private void stream(SseEmitter emitter, List<ChatMessage> messages, List<Map<String, String>> sources) {
        SSE_EXECUTOR.execute(() -> {
            AtomicBoolean done = new AtomicBoolean(false);
            AtomicBoolean gotDelta = new AtomicBoolean(false);
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
                        gotDelta.set(true);
                        send(emitter, Map.of("type", "delta", "text", delta));
                    }

                    @Override
                    public void onComplete() {
                        if (!gotDelta.get()) {
                            // 流"正常"结束却一个字没吐：多半是 Key/模型配置有误被静默吞掉
                            send(emitter, Map.of("type", "error", "message",
                                    "AI 返回了空回答：请检查 API Key 与模型配置"));
                        }
                        finish.run();
                    }

                    @Override
                    public void onError(Throwable t) {
                        log.warn("LLM 流式失败", t);
                        send(emitter, Map.of("type", "error", "message", friendly(t)));
                        finish.run();
                    }
                });
            } catch (Exception e) {
                log.warn("SSE 处理异常", e);
                finish.run();
            }
        });
    }

    /**
     * 把底层异常翻译成用户能看懂、又能定位病因的中文提示。
     * 演示翻车保险：不暴露堆栈，但保留关键原因（401/429/未配置等）。
     */
    private String friendly(Throwable t) {
        String msg = t.getMessage() == null || t.getMessage().isBlank()
                ? t.getClass().getSimpleName() : t.getMessage();
        if (msg.contains("未配置 LLM_API_KEY")) {
            return "AI 服务未配置：请先设置 LLM_API_KEY 环境变量并重启后端";
        }
        if (msg.contains("未配置 TTS API Key")) {
            return "TTS 未配置：请设置 TTS_API_KEY 或 LLM_API_KEY 后重启后端";
        }
        if (msg.contains("401")) {
            return "智谱鉴权失败(401)：API Key 不正确，或账号未完成实名认证";
        }
        if (msg.contains("429")) {
            return "请求过于频繁(429)：请稍等几秒再试";
        }
        if (msg.contains("timed out") || msg.contains("超时") || msg.contains("Connection") || msg.contains("连接")) {
            return "网络连接智谱失败：请检查网络后重试";
        }
        return "AI 服务异常：" + (msg.length() > 100 ? msg.substring(0, 100) + "…" : msg);
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
