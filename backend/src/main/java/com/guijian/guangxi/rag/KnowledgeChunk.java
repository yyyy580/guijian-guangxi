package com.guijian.guangxi.rag;

/**
 * 知识块——RAG 检索的最小单元（景点 × 章节）。
 */
public record KnowledgeChunk(
        String attractionId,
        String attractionName,
        String cityId,
        String cityName,
        String section,
        String text) {
}
