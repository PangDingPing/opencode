# opencode Docker 清理脚本
# 停止并删除容器

param(
    [string]$ContainerName = "yejian-AIworkbench",
    [switch]$RemoveImage
)

Write-Host "=== 清理 Docker 容器 ===" -ForegroundColor Cyan

# 停止容器
$runningContainer = docker ps --filter "name=$ContainerName" --format "{{.Names}}"
if ($runningContainer) {
    Write-Host "停止容器: $ContainerName" -ForegroundColor Yellow
    docker stop $ContainerName 2>&1 | Out-Null
}

# 删除容器
$existingContainer = docker ps -a --filter "name=$ContainerName" --format "{{.Names}}"
if ($existingContainer) {
    Write-Host "删除容器: $ContainerName" -ForegroundColor Yellow
    docker rm -f $ContainerName 2>&1 | Out-Null
} else {
    Write-Host "容器不存在: $ContainerName" -ForegroundColor Gray
}

# 删除镜像（可选）
if ($RemoveImage) {
    $imageName = "yejian-opencode:latest"
    Write-Host "删除镜像: $imageName" -ForegroundColor Yellow
    docker rmi $imageName 2>&1 | Out-Null
}

Write-Host ""
Write-Host "清理完成" -ForegroundColor Green
