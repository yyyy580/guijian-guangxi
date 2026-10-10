package com.guijian.guangxi.adapter.stub;

import com.guijian.guangxi.adapter.TtsAdapter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * 占位实现：返回空音频占位，P2 接入真实 TTS。
 */
@Component
@ConditionalOnProperty(name = "app.tts.provider", havingValue = "stub", matchIfMissing = true)
public class StubTtsAdapter implements TtsAdapter {

    @Override
    public byte[] synthesize(String text) {
        return new byte[0];
    }
}
