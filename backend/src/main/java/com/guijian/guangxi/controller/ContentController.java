package com.guijian.guangxi.controller;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 内容层只读 API：原样转发 content/ 下的 JSON。
 * 前端 dev 模式可直接走 Vite 静态资源；此 API 供生产部署与未来 SSR/小程序端复用。
 */
@RestController
@RequestMapping("/api")
public class ContentController {

    private static final Pattern SAFE_ID = Pattern.compile("^[a-z0-9-]+$");

    @Value("${app.content.path:../content}")
    private String contentPath;

    @GetMapping("/cities")
    public ResponseEntity<String> cities() {
        return readJson("cities.json");
    }

    @GetMapping("/foods")
    public ResponseEntity<String> foods() {
        return readJson("foods.json");
    }

    @GetMapping("/attractions/{id}")
    public ResponseEntity<String> attraction(@PathVariable String id) {
        if (!SAFE_ID.matcher(id).matches()) {
            return ResponseEntity.badRequest().build();
        }
        return readJson("attractions/" + id + ".json");
    }

    @GetMapping("/geojson/{name}")
    public ResponseEntity<String> geojson(@PathVariable String name) {
        if (!SAFE_ID.matcher(name).matches()) {
            return ResponseEntity.badRequest().build();
        }
        return readJson("geojson/" + name + ".json");
    }

    private ResponseEntity<String> readJson(String relative) {
        Path root = Paths.get(contentPath).toAbsolutePath().normalize();
        Path target = root.resolve(relative).normalize();
        if (!target.startsWith(root) || !Files.exists(target)) {
            return ResponseEntity.notFound().build();
        }
        try {
            return ResponseEntity.ok()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Files.readString(target, StandardCharsets.UTF_8));
        } catch (IOException e) {
            return ResponseEntity.internalServerError().build();
        }
    }
}
