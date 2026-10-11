# 一键启动后端（带智谱环境变量），避免手动敲命令出错。
# 用法：右键"使用 PowerShell 运行"，或在本目录执行 .\start-backend.ps1
# 说明：Key 只写入当前窗口环境变量，不落盘、不入 Git。

Set-Location $PSScriptRoot

# provider 默认走智谱；首次运行时提示粘贴 Key（直接回车则退回 stub 演示模式）
if (-not $env:LLM_PROVIDER) { $env:LLM_PROVIDER = "zhipu" }
if (-not $env:LLM_API_KEY) {
    $key = Read-Host "请粘贴智谱 API Key（留空回车 = 演示模式）"
    if ($key.Trim()) { $env:LLM_API_KEY = $key.Trim() }
}

if ($env:LLM_API_KEY) {
    Write-Host "==> provider=zhipu，Key 已配置（尾部：...$($env:LLM_API_KEY.Substring([Math]::Max(0, $env:LLM_API_KEY.Length - 4)))）" -ForegroundColor Green
} else {
    Write-Host "==> 未配置 Key，进入 stub 演示模式" -ForegroundColor Yellow
}

Write-Host "==> Java: $(java -version 2>&1 | Select-Object -First 1)"
Write-Host "==> 启动后端（输出同步记录到 backend\backend-start.log）..."

# 输出同步写入日志文件：万一启动失败，直接看日志定位，无需截图
mvn spring-boot:run 2>&1 | Tee-Object -FilePath "$PSScriptRoot\backend-start.log"

Write-Host "==> 后端已退出。如启动失败，把日志最后一屏发给老师即可：backend\backend-start.log" -ForegroundColor Yellow
