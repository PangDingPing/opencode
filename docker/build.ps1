# opencode Docker Build Script
# Usage:
#   1. Build image: .\build.ps1
#   2. Run container: .\run.ps1
#   3. Cleanup: .\cleanup.ps1

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
Write-Host "Image Name: $ImageName`:$ImageTag" -ForegroundColor Yellow
Write-Host "Container Name: $ContainerName" -ForegroundColor Yellow
Write-Host "Port Mapping: ${HostPort}:${ContainerPort}" -ForegroundColor Yellow
Write-Host ""

# Switch to repo root
Push-Location $RepoRoot

try {
    # Check Docker status
    Write-Host "[1/3] Checking Docker status..." -ForegroundColor Green
    $dockerStatus = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker is not running or user has no permission" -ForegroundColor Red
        Write-Host "Please start Docker Desktop and try again" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "Docker is running" -ForegroundColor Green

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
    }

    # Create data directories
    $workbenchDir = "D:\AI\AIworkbench"
    $dataDir = "D:\AI\AIworkbench-data"
    if (-not (Test-Path $workbenchDir)) {
        New-Item -ItemType Directory -Path $workbenchDir -Force | Out-Null
        Write-Host "Created work directory: $workbenchDir" -ForegroundColor Yellow
    }
    if (-not (Test-Path $dataDir)) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        Write-Host "Created data directory: $dataDir" -ForegroundColor Yellow
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
        Write-Host "View container logs:" -ForegroundColor Yellow
        Write-Host "  docker logs -f $ContainerName" -ForegroundColor White
        Write-Host ""
        Write-Host "Stop container:" -ForegroundColor Yellow
        Write-Host "  docker stop $ContainerName" -ForegroundColor White
        Write-Host ""
        Write-Host "Remove container:" -ForegroundColor Yellow
        Write-Host "  docker rm -f $ContainerName" -ForegroundColor White
    } else {
        Write-Host "ERROR: Container startup failed" -ForegroundColor Red
    }

} finally {
    Pop-Location
}