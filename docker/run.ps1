# opencode Docker 运行脚本
# 启动已构建的容器

param(
    [string]$ImageName = "yejian-opencode",
    [string]$ContainerName = "yejian-AIworkbench",
    [string]$ImageTag = "latest",
    [int]$HostPort = 8088,
    [int]$ContainerPort = 8088
)

Write-Host "=== 启动 opencode 容器 ===" -ForegroundColor Cyan

# 检查镜像是否存在
$imageExists = docker images --format "{{.Repository}}:{{.Tag}}" | Where-Object { $_ -eq "${ImageName}:${ImageTag}" }
if (-not $imageExists) {
    Write-Host "错误: 镜像 ${ImageName}:${ImageTag} 不存在" -ForegroundColor Red
    Write-Host "请先运行 build.ps1 构建镜像" -ForegroundColor Yellow
    exit 1
}

# 清理旧容器（如果存在）
$existingContainer = docker ps -a --filter "name=$ContainerName" --format "{{.Names}}"
if ($existingContainer) {
    Write-Host "删除旧容器: $ContainerName" -ForegroundColor Yellow
    docker rm -f $ContainerName 2>&1 | Out-Null
}

# 启动新容器
Write-Host "启动容器: $ContainerName" -ForegroundColor Green
docker run -d --name $ContainerName `
    -p ${HostPort}:${ContainerPort} `
    -v "D:\AI\AIworkbench:/workspace" `
    -v "D:\AI\AIworkbench-data\root:/root" `
    -v "D:\AI\AIworkbench-data\tmp:/tmp" `
    -w /workspace `
    --hostname 0.0.0.0 `
    "${ImageName}:${ImageTag}"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "=== 容器启动成功 ===" -ForegroundColor Green
    Write-Host "Web 服务地址: http://localhost:${HostPort}" -ForegroundColor Cyan
    Write-Host "容器名称: $ContainerName" -ForegroundColor Cyan
} else {
    Write-Host "错误: 容器启动失败" -ForegroundColor Red
}
