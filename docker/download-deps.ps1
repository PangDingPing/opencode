# 预下载 pip/npm 依赖到本地目录
#
# 作用：
#   1. 把 pip wheels 下载到 docker/pip-wheels/（linux x86_64 平台）
#   2. 把 npm 全局包下载到 docker/npm-cache/
#   3. 即使 Docker 缓存被清，也能从本地快速恢复
#
# 用法：
#   .\docker\download-deps.ps1              # 下载所有依赖
#   .\docker\download-deps.ps1 -PipOnly     # 只下载 pip 依赖
#   .\docker\download-deps.ps1 -NpmOnly     # 只下载 npm 依赖
#
# 说明：
#   - 下载的 wheels 是 linux x86_64 平台的，可以直接 COPY 进 Docker 容器
#   - 下载后可以用 docker build --build-arg USE_LOCAL_WHEELS=1 使用本地 wheels
#   - 也可以作为备份，Docker 缓存被清后快速恢复

param(
    [switch]$PipOnly = $false,
    [switch]$NpmOnly = $false
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

$PipWheelsDir = Join-Path $ScriptDir "pip-wheels"
$NpmCacheDir = Join-Path $ScriptDir "npm-cache"

Write-Host "=== 预下载依赖到本地 ===" -ForegroundColor Cyan

# 下载 pip wheels
if (-not $NpmOnly) {
    Write-Host ""
    Write-Host "[1/2] 下载 pip wheels 到 $PipWheelsDir" -ForegroundColor Green

    if (-not (Test-Path $PipWheelsDir)) {
        New-Item -ItemType Directory -Path $PipWheelsDir -Force | Out-Null
    }

    # 用 Docker 容器下载（保证是 linux x86_64 平台的 wheels）
    # 用清华镜像源加速
    $requirementsPath = Join-Path $ScriptDir "requirements.txt"
    $requirementsPptPath = Join-Path $ScriptDir "requirements-ppt.txt"

    Write-Host "  用 python:3.11-slim 容器下载 wheels..." -ForegroundColor Gray
    Write-Host "  镜像源: https://pypi.tuna.tsinghua.edu.cn/simple" -ForegroundColor Gray

    docker run --rm `
        -v "${PipWheelsDir}:/wheels" `
        -v "${requirementsPath}:/requirements.txt:ro" `
        -v "${requirementsPptPath}:/requirements-ppt.txt:ro" `
        python:3.11-slim `
        sh -c "pip install --upgrade pip -q && pip download -r /requirements.txt -r /requirements-ppt.txt -d /wheels --index-url https://pypi.tuna.tsinghua.edu.cn/simple"

    if ($LASTEXITCODE -eq 0) {
        $wheelCount = (Get-ChildItem $PipWheelsDir -Filter "*.whl" -ErrorAction SilentlyContinue | Measure-Object).Count
        $tarCount = (Get-ChildItem $PipWheelsDir -Filter "*.tar.gz" -ErrorAction SilentlyContinue | Measure-Object).Count
        $totalSize = (Get-ChildItem $PipWheelsDir | Measure-Object -Property Length -Sum).Sum / 1MB
        Write-Host "  pip wheels 下载完成: $wheelCount wheels + $tarCount tarballs, $([math]::Round($totalSize, 1)) MB" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: pip wheels 下载失败" -ForegroundColor Red
    }
}

# 下载 npm 全局包
if (-not $PipOnly) {
    Write-Host ""
    Write-Host "[2/2] 下载 npm 全局包到 $NpmCacheDir" -ForegroundColor Green

    if (-not (Test-Path $NpmCacheDir)) {
        New-Item -ItemType Directory -Path $NpmCacheDir -Force | Out-Null
    }

    # 用 Docker 容器下载 npm 包
    Write-Host "  用 node:18-slim 容器下载 npm 包..." -ForegroundColor Gray
    Write-Host "  镜像源: https://registry.npmmirror.com" -ForegroundColor Gray

    docker run --rm `
        -v "${NpmCacheDir}:/npm-cache" `
        node:18-slim `
        sh -c "npm config set registry https://registry.npmmirror.com && npm pack docx pdf-lib pdfjs-dist pnpm --pack-destination /npm-cache"

    if ($LASTEXITCODE -eq 0) {
        $pkgCount = (Get-ChildItem $NpmCacheDir -Filter "*.tgz" -ErrorAction SilentlyContinue | Measure-Object).Count
        $totalSize = (Get-ChildItem $NpmCacheDir | Measure-Object -Property Length -Sum).Sum / 1MB
        Write-Host "  npm 包下载完成: $pkgCount packages, $([math]::Round($totalSize, 1)) MB" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: npm 包下载失败" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== 完成 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "下载的文件可以用作备份，Docker 缓存被清后可以快速恢复。" -ForegroundColor Yellow
Write-Host "Dockerfile 里的 cache mount 已经会自动缓存依赖，这个脚本是额外的备份。" -ForegroundColor Yellow
Write-Host ""
Write-Host "查看 Docker 缓存大小: docker builder du" -ForegroundColor Gray
Write-Host "清理 Docker 缓存:     docker builder prune" -ForegroundColor Gray
