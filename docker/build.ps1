# Builds opencode Docker image using multi-stage build
#
# v0.0.8: 构建加速优化
#         - 国内镜像源（apt 清华 / pip 清华 / npm 淘宝 / bun 淘宝）
#         - 完善 BuildKit 缓存挂载（apt/bun/pip/npm 下载缓存持久化）
#         - 预期：首次 1-2 小时，有缓存 10-20 分钟（vs v0.0.7 的 6-7 小时）
#
# v0.0.7: 多阶段构建，binary 在 Docker builder 阶段编译（Linux 容器）
#
# Steps:
#   1. Check Docker status
#   2. Build Docker image (multi-stage: builder compiles binary, runtime uses it)
#   3. Run container

param(
    [string]$ImageName = "yejian-opencode",
    [string]$ContainerName = "yejian-AIworkbench",
    [string]$ImageTag = "v0.0.8",
    [int]$HostPort = 80,
    [int]$ContainerPort = 8088,
    [string]$EnvFile = "",       # Optional: .env file path injected via --env-file
    [switch]$ForceRebuild = $false   # Pass --no-cache to docker build (force full rebuild)
)

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

Write-Host "=== opencode Docker Build Script (multi-stage) ===" -ForegroundColor Cyan
Write-Host "Image Name: ${ImageName}:${ImageTag}" -ForegroundColor Yellow
Write-Host "Container Name: $ContainerName" -ForegroundColor Yellow
Write-Host "Port Mapping: ${HostPort}:${ContainerPort}" -ForegroundColor Yellow
if ($ForceRebuild) {
    Write-Host "Force Rebuild: --no-cache (full rebuild, slow)" -ForegroundColor Yellow
}
Write-Host ""

# Switch to repo root
Push-Location $RepoRoot

try {
    # Check Docker status
    Write-Host "[1/3] Checking Docker status..." -ForegroundColor Green
    $dockerStatus = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker is not running or user has no permission" -ForegroundColor Red
        exit 1
    }
    Write-Host "Docker is running" -ForegroundColor Green

    # Build Docker image (multi-stage build)
    # .dockerignore 保留（排除 node_modules/dist/.git），builder 阶段会在容器里重新 bun install
    # binary 在 builder 阶段编译，runtime 阶段只用 binary
    # v0.0.8: 国内镜像源 + BuildKit 缓存挂载，首次 1-2 小时，有缓存 10-20 分钟
    Write-Host "[2/3] Building Docker image (multi-stage: builder + runtime)..." -ForegroundColor Green
    Write-Host "  builder stage: bun install + compile binary (首次 ~30 min, 有缓存 ~5 min)" -ForegroundColor Gray
    Write-Host "  runtime stage: apt + pip + npm (首次 ~60 min, 有缓存 ~10 min)" -ForegroundColor Gray
    if ($ForceRebuild) {
        docker build --network=host --no-cache -t "${ImageName}:${ImageTag}" -f "$ScriptDir/Dockerfile" .
    } else {
        docker build --network=host -t "${ImageName}:${ImageTag}" -f "$ScriptDir/Dockerfile" .
    }
    $dockerBuildExit = $LASTEXITCODE
    if ($dockerBuildExit -ne 0) {
        Write-Host "ERROR: Docker image build failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "Docker image built successfully" -ForegroundColor Green

    # Cleanup old container
    Write-Host "[3/3] Cleaning up old container and starting..." -ForegroundColor Green
    $existingContainer = docker ps -a --filter "name=$ContainerName" --format "{{.Names}}"
    if ($existingContainer) {
        docker rm -f $ContainerName 2>&1 | Out-Null
        Write-Host "Old container removed" -ForegroundColor Yellow
    }

    # Create data directories
    $workbenchDir = "E:\AI\YEJIAN"
    $dataDir = "E:\AI\AIworkbench-data"
    if (-not (Test-Path $workbenchDir)) {
        New-Item -ItemType Directory -Path $workbenchDir -Force | Out-Null
    }
    if (-not (Test-Path $dataDir)) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    }
    if (-not (Test-Path "$dataDir\root")) {
        New-Item -ItemType Directory -Path "$dataDir\root" -Force | Out-Null
    }
    if (-not (Test-Path "$dataDir\tmp")) {
        New-Item -ItemType Directory -Path "$dataDir\tmp" -Force | Out-Null
    }

    # Start container
    # Note: do NOT use a variable that bundles "--env-file <path>" into one string
    #       and pass it to docker - PowerShell won't split on spaces, so docker
    #       will see " --env-file \"path\"" as a single (malformed) image name.
    #       Use two separate code paths instead.
    Write-Host ""
    Write-Host "=== Starting Container ===" -ForegroundColor Cyan
    if ($EnvFile -ne "") {
        if (-not (Test-Path $EnvFile)) {
            Write-Host "ERROR: env file not found: $EnvFile" -ForegroundColor Red
            exit 1
        }
        Write-Host "Injecting env file: $EnvFile" -ForegroundColor Yellow
        docker run -d --name $ContainerName `
            -p "${HostPort}:${ContainerPort}" `
            -v "${workbenchDir}:/YEJIAN" `
            -v "${dataDir}\root:/root" `
            -v "${dataDir}\tmp:/tmp" `
            -w /YEJIAN `
            --hostname 0.0.0.0 `
            --env-file "$EnvFile" `
            --restart always `
            "${ImageName}:${ImageTag}"
    } else {
        docker run -d --name $ContainerName `
            -p "${HostPort}:${ContainerPort}" `
            -v "${workbenchDir}:/YEJIAN" `
            -v "${dataDir}\root:/root" `
            -v "${dataDir}\tmp:/tmp" `
            -w /YEJIAN `
            --hostname 0.0.0.0 `
            --restart always `
            "${ImageName}:${ImageTag}"
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "=== Container Started Successfully ===" -ForegroundColor Green
        Write-Host "Web Service URL: http://localhost:${HostPort}" -ForegroundColor Cyan
        Write-Host "Container Name: $ContainerName" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "View logs: docker logs -f $ContainerName" -ForegroundColor Yellow
        Write-Host "Stop container: docker stop $ContainerName" -ForegroundColor Yellow
    } else {
        Write-Host "ERROR: Container startup failed" -ForegroundColor Red
    }

} finally {
    Pop-Location
}
