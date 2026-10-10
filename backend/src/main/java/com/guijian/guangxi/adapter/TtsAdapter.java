package com.guijian.guangxi.adapter;

/**
 * 语音合成适配器——AI 讲解员的声音出口。
 * P2 接入真实 TTS 供应商，支持流式音频返回与字幕时间轴。
 */
public interface TtsAdapter {

    /** 文本转语音，返回音频数据（P2 定义具体返回结构） */
    byte[] synthesize(String text);
}
