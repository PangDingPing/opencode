# opencode Docker Build Script
<<<<<<< HEAD
# Usage:
#   1. Build image: .\build.ps1
#   2. Run container: .\run.ps1
#   3. Cleanup: .\cleanup.ps1
=======
# Builds from source, copies the resulting binary into a lightweight Docker image
#
# Steps:
#   1. Build the Linux x64 binary using 'bun run script/build.ts --single'
#   2. Build Docker image that wraps the pre-built binary
#   3. Run container
>>>>>>> feat-build-docker-image-TMggJ0

param(
    [string]$ImageName = "yejian-opencode",
    [string]$ContainerName = "yejian-AIworkbench",
    [string]$ImageTag = "v0.0.1",
    [int]$HostPort = 8088,
    [int]$ContainerPort = 8088
)

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

Write-Host "=== opencode Docker Build Script ===" -ForegroundColor Cyan
<<<<<<< HEAD
Write-Host "Image Name: $ImageName`:$ImageTag" -ForegroundColor Yellow
=======
Write-Host "Image Name: ${ImageName}:${ImageTag}" -ForegroundColor Yellow
>>>>>>> feat-build-docker-image-TMggJ0
Write-Host "Container Name: $ContainerName" -ForegroundColor Yellow
Write-Host "Port Mapping: ${HostPort}:${ContainerPort}" -ForegroundColor Yellow
Write-Host ""

# Switch to repo root
Push-Location $RepoRoot

try {
    # Check Docker status
<<<<<<< HEAD
    Write-Host "[1/3] Checking Docker status..." -ForegroundColor Green
    $dockerStatus = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker is not running or user has no permission" -ForegroundColor Red
        Write-Host "Please start Docker Desktop and try again" -ForegroundColor Yellow
=======
    Write-Host "[1/4] Checking Docker status..." -ForegroundColor Green
    $dockerStatus = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker is not running or user has no permission" -ForegroundColor Red
>>>>>>> feat-build-docker-image-TMggJ0
        exit 1
    }
    Write-Host "Docker is running" -ForegroundColor Green

<<<<<<< HEAD
    # Build image
    Write-Host "[2/3] Building Docker image from source..." -ForegroundColor Green
    docker build -t "${ImageName}:${ImageTag}" -f "$ScriptDir/Dockerfile" .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Image build failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "Image built successfully: ${ImageName}:${ImageTag}" -ForegroundColor Green

    # Cleanup old container
    Write-Host "[3/3] Cleaning up old container..." -ForegroundColor Green
    $existingContainer = docker ps -a --filter "name=$ContainerName" --format "{{.Names}}"
    if ($existingContainer) {
        docker rm -f $ContainerName 2>&1 | Out-Null
        Write-Host "Old container removed: $ContainerName" -ForegroundColor Yellow
=======
    # Build the binary if it doesn't exist
    # Note: We build all platforms (no --single) so we get Linux x64 binary
    # that can run inside the Linux Docker container
    # We use the baseline-musl variant because Alpine uses musl libc (not glibc)
    $binaryPath = "packages/opencode/dist/opencode-linux-x64-baseline-musl/bin/opencode"
    if (-not (Test-Path $binaryPath)) {
        Write-Host "[2/4] Binary not found, building from source..." -ForegroundColor Yellow
        Write-Host "This may take a few minutes..." -ForegroundColor Yellow

        # Install dependencies from repo root
        bun install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: bun install failed on host" -ForegroundColor Red
            exit 1
        }

        # Build the binary from packages/opencode directory
        # Build all platforms (not --single) so we get Linux x64 too
        # skip-embed-web-ui avoids requiring the Web UI to be built first
        Push-Location "packages/opencode"
        bun run script/build.ts --skip-embed-web-ui
        $buildExit = $LASTEXITCODE
        Pop-Location

        if ($buildExit -ne 0) {
            Write-Host "ERROR: Binary build failed" -ForegroundColor Red
            exit 1
        }
        Write-Host "Binary built successfully" -ForegroundColor Green
    } else {
        Write-Host "[2/4] Pre-built binary found" -ForegroundColor Green
    }

    # Build Docker image (temporarily disable .dockerignore to include dist/)
    Write-Host "[3/4] Building Docker image..." -ForegroundColor Green
    $dockerignoreBackup = $null
    $dockerignoreRenamed = $false
    if (Test-Path ".dockerignore") {
        Move-Item ".dockerignore" ".dockerignore.dockerbuild" -Force
        $dockerignoreRenamed = $true
        Write-Host "  Temporarily disabled .dockerignore" -ForegroundColor Gray
    }
    docker build -t "${ImageName}:${ImageTag}" -f "$ScriptDir/Dockerfile" .
    $dockerBuildExit = $LASTEXITCODE
    if ($dockerignoreRenamed) {
        Move-Item ".dockerignore.dockerbuild" ".dockerignore" -Force
        $dockerignoreRenamed = $false
    }
    if ($dockerBuildExit -ne 0) {
        Write-Host "ERROR: Docker image build failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "Docker image built successfully" -ForegroundColor Green

    # Cleanup old container
    Write-Host "[4/4] Cleaning up old container..." -ForegroundColor Green
    $existingContainer = docker ps -a --filter "name=$ContainerName" --format "{{.Names}}"
    if ($existingContainer) {
        docker rm -f $ContainerName 2>&1 | Out-Null
        Write-Host "Old container removed" -ForegroundColor Yellow
>>>>>>> feat-build-docker-image-TMggJ0
    }

    # Create data directories
    $workbenchDir = "D:\AI\AIworkbench"
    $dataDir = "D:\AI\AIworkbench-data"
    if (-not (Test-Path $workbenchDir)) {
        New-Item -ItemType Directory -Path $workbenchDir -Force | Out-Null
<<<<<<< HEAD
        Write-Host "Created work directory: $workbenchDir" -ForegroundColor Yellow
    }
    if (-not (Test-Path $dataDir)) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        Write-Host "Created data directory: $dataDir" -ForegroundColor Yellow
=======
    }
    if (-not (Test-Path $dataDir)) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
>>>>>>> feat-build-docker-image-TMggJ0
    }

    # Start container
    Write-Host ""
    Write-Host "=== Starting Container ===" -ForegroundColor Cyan
    docker run -d --name $ContainerName `
        -p ${HostPort}:${ContainerPort} `
        -v "${workbenchDir}:/workspace" `
        -v "${dataDir}\root:/root" `
        -v "${dataDir}\tmp:/tmp" `
        -w /workspace `
        --hostname 0.0.0.0 `
        "${ImageName}:${ImageTag}"

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "=== Container Started Successfully ===" -ForegroundColor Green
        Write-Host "Web Service URL: http://localhost:${HostPort}" -ForegroundColor Cyan
        Write-Host "Container Name: $ContainerName" -ForegroundColor Cyan
        Write-Host ""
<<<<<<< HEAD
        Write-Host "View container logs:" -ForegroundColor Yellow
        Write-Host "  docker logs -f $ContainerName" -ForegroundColor White
        Write-Host ""
        Write-Host "Stop container:" -ForegroundColor Yellow
        Write-Host "  docker stop $ContainerName" -ForegroundColor White
        Write-Host ""
        Write-Host "Remove container:" -ForegroundColor Yellow
        Write-Host "  docker rm -f $ContainerName" -ForegroundColor White
=======
        Write-Host "View logs: docker logs -f $ContainerName" -ForegroundColor Yellow
        Write-Host "Stop container: docker stop $ContainerName" -ForegroundColor Yellow
>>>>>>> feat-build-docker-image-TMggJ0
    } else {
        Write-Host "ERROR: Container startup failed" -ForegroundColor Red
    }

} finally {
    Pop-Location
}