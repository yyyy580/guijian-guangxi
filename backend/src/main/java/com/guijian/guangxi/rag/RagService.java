package com.guijian.guangxi.rag;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guijian.guangxi.adapter.LlmAdapter;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 简化版 RAG：九景 JSON 直接做知识库（内容量小，内存向量索引即可，不引向量库）。
 *
 * 检索策略（自动降级）：
 * 1. provider=zhipu 且 Key 可用 → embedding-3 向量 + 余弦相似度；
 * 2. 向量不可用（stub/构建失败）→ 字符二元组（bigram）重合度打分，中文问答场景够用。
 * 两路都带「当前景点加成」：正在浏览的景点知识块 ×1.4 优先。
 */
@Service
public class RagService {

    private static final Logger log = LoggerFactory.getLogger(RagService.class);

    private final LlmAdapter llm;
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${app.content.path:../content}")
    private String contentPath;

    @Value("${app.llm.provider:stub}")
    private String provider;

    private final List<KnowledgeChunk> chunks = new ArrayList<>();
    private final Map<String, String> rawJsonById = new HashMap<>();
    /** 与 chunks 一一对应；null = 关键词模式 */
    private volatile float[][] vectors;
    /** 上次索引构建失败时间戳；5 分钟内不重试，避免每次提问都打一遍 embedding API */
    private static final long VECTOR_RETRY_INTERVAL_MS = 5 * 60 * 1000;
    private volatile long vectorFailedAt;

    public RagService(LlmAdapter llm) {
        this.llm = llm;
    }

    @PostConstruct
    void loadContent() {
        try {
            Path root = Paths.get(contentPath).toAbsolutePath().normalize();

            // 城市 id → 名称
            Map<String, String> cityNames = new HashMap<>();
            JsonNode cities = mapper.readTree(Files.readString(root.resolve("cities.json"))).path("cities");
            for (JsonNode c : cities) {
                cityNames.put(c.path("id").asText(), c.path("name").asText());
            }

            // narrative 字段 → 章节名（LinkedHashMap 保证分块顺序稳定）
            Map<String, String> sections = new LinkedHashMap<>();
            sections.put("summary", "概览");
            sections.put("geo", "地理科普");
            sections.put("legend", "民间传说");
            sections.put("history", "历史人事");
            sections.put("extended", "风物延伸");

            try (var files = Files.list(root.resolve("attractions"))) {
                for (Path f : files.filter(p -> p.toString().endsWith(".json")).sorted().toList()) {
                    String raw = Files.readString(f);
                    JsonNode a = mapper.readTree(raw);
                    String id = a.path("id").asText(f.getFileName().toString().replace(".json", ""));
                    rawJsonById.put(id, raw);
                    String name = a.path("name").asText(id);
                    String cityId = a.path("cityId").asText("");
                    String cityName = cityNames.getOrDefault(cityId, cityId);

                    chunks.add(new KnowledgeChunk(id, name, cityId, cityName, "概览", a.path("summary").asText()));
                    JsonNode n = a.path("narrative");
                    sections.forEach((field, label) -> {
                        String text = n.path(field).asText("");
                        if (!text.isBlank()) {
                            chunks.add(new KnowledgeChunk(id, name, cityId, cityName, label, text));
                        }
                    });
                }
            }
            log.info("RAG 知识库装载完成：{} 个景点，{} 条知识块（检索模式：{}）",
                    rawJsonById.size(), chunks.size(), "zhipu".equalsIgnoreCase(provider) ? "向量优先" : "关键词");
        } catch (Exception e) {
            log.error("RAG 知识库装载失败，问答将不可用", e);
        }
    }

    /** 指定景点的全部知识块 */
    public List<KnowledgeChunk> chunksOf(String attractionId) {
        return chunks.stream().filter(c -> c.attractionId().equals(attractionId)).toList();
    }

    /** 景点原始 JSON（讲解词生成的完整上下文） */
    public String attractionJson(String attractionId) {
        return rawJsonById.get(attractionId);
    }

    public record Retrieved(KnowledgeChunk chunk, double score) {
    }

    /**
     * 检索 topK 条与 query 最相关的知识块。
     *
     * @param attractionId 当前浏览景点（可空），其知识块获得 1.4 倍加成
     */
    public List<Retrieved> search(String query, String attractionId, int topK) {
        if (chunks.isEmpty() || query == null || query.isBlank()) {
            return List.of();
        }
        ensureVectorIndex();
        float[] q = vectors != null ? embedOne(query) : null;

        List<Retrieved> scored = new ArrayList<>();
        for (int i = 0; i < chunks.size(); i++) {
            KnowledgeChunk c = chunks.get(i);
            double s = q != null
                    ? cosine(q, vectors[i])
                    : bigramScore(query, c.attractionName() + c.section() + c.text());
            if (attractionId != null && attractionId.equals(c.attractionId())) {
                s *= 1.4;
            }
            scored.add(new Retrieved(c, s));
        }
        scored.sort(Comparator.comparingDouble(Retrieved::score).reversed());
        return scored.subList(0, Math.min(topK, scored.size()));
    }

    // ---------- 向量索引（惰性构建一次） ----------

    private void ensureVectorIndex() {
        if (!"zhipu".equalsIgnoreCase(provider) || vectors != null || chunks.isEmpty()) {
            return;
        }
        if (vectorFailedAt > 0 && System.currentTimeMillis() - vectorFailedAt < VECTOR_RETRY_INTERVAL_MS) {
            return; // 处于失败退避期，本次直接走关键词检索
        }
        synchronized (this) {
            if (vectors != null) {
                return;
            }
            try {
                log.info("开始构建 RAG 向量索引：{} 条知识块", chunks.size());
                List<String> texts = chunks.stream()
                        .map(c -> c.attractionName() + "·" + c.section() + "\n" + c.text())
                        .toList();
                List<float[]> embs = new ArrayList<>();
                for (int i = 0; i < texts.size(); i += 16) {
                    embs.addAll(llm.embed(texts.subList(i, Math.min(texts.size(), i + 16))));
                }
                if (embs.size() != texts.size()) {
                    throw new IllegalStateException("向量数量与知识块不匹配：期望 " + texts.size() + "，得到 " + embs.size());
                }
                vectors = embs.toArray(new float[0][]);
                log.info("RAG 向量索引构建完成");
            } catch (Exception e) {
                vectorFailedAt = System.currentTimeMillis();
                log.warn("向量索引构建失败，自动回退关键词检索（{} 分钟内不再重试）：{}",
                        VECTOR_RETRY_INTERVAL_MS / 60000, e.getMessage());
            }
        }
    }

    /** 单条查询向量化；失败返回 null（本次检索回退关键词） */
    private float[] embedOne(String text) {
        try {
            return llm.embed(List.of(text)).get(0);
        } catch (Exception e) {
            log.warn("查询向量化失败，本次回退关键词检索：{}", e.getMessage());
            return null;
        }
    }

    // ---------- 打分 ----------

    private double cosine(float[] a, float[] b) {
        double dot = 0, na = 0, nb = 0;
        int n = Math.min(a.length, b.length);
        for (int i = 0; i < n; i++) {
            dot += a[i] * b[i];
            na += (double) a[i] * a[i];
            nb += (double) b[i] * b[i];
        }
        return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
    }

    /** 字符二元组重合度：中文无分词器的兜底相似度 */
    private double bigramScore(String query, String text) {
        Set<String> q = bigrams(query);
        if (q.isEmpty()) {
            return 0;
        }
        Set<String> t = bigrams(text);
        long hit = q.stream().filter(t::contains).count();
        return (double) hit / q.size();
    }

    private Set<String> bigrams(String s) {
        String clean = s == null ? "" : s.replaceAll("\\s+", "");
        Set<String> set = new HashSet<>();
        for (int i = 0; i < clean.length() - 1; i++) {
            set.add(clean.substring(i, i + 2));
        }
        return set;
    }
}
