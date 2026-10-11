@echo off
chcp 936 >nul
title 桂见广西 · 后端启动器
cd /d "%~dp0"

echo ============================================
echo   桂见广西 后端一键启动（双击即可）
echo ============================================
echo.

set "LLM_PROVIDER=zhipu"
set "LLM_API_KEY="
set /p "LLM_API_KEY=请粘贴智谱 API Key（直接回车 = 演示模式）: "

if defined LLM_API_KEY (
    echo ==^> Key 已配置，将接入真实 AI
) else (
    echo ==^> 未配置 Key，进入演示模式
)

echo ==^> 正在启动，首次需等 1-2 分钟...
echo ==^> 成功标志：出现 Started GuijianApplication
echo ==^> 本窗口请保持打开，关闭窗口 = 停止后端
echo.

call mvn spring-boot:run

echo.
echo ==^> 后端已退出。如启动失败，请把本窗口上方红色文字拍照发给老师。
pause