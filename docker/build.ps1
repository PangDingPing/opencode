# Builds from source, copies the resulting binary into a lightweight Docker image
#
# Steps:
#   1. Build the Linux x64 binary using 'bun run script/build.ts'
#   2. Build Docker image that wraps the pre-built binary
#   3. Run container

param(
    [string]$ImageName = "yejian-opencode",
    [string]$ContainerName = "yejian-AIworkbench",
    [string]$ImageTag = "v0.0.3",
    [int]$HostPort = 8088,
    [int]$ContainerPort = 8088,
    [string]$EnvFile = "",       # Optional: .env file path injected via --env-file
    [switch]$ForceRebuild = $false   # Always rebuild the binary even if dist/ exists
)

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

Write-Host "=== opencode Docker Build Script ===" -ForegroundColor Cyan
Write-Host "Image Name: ${ImageName}:${ImageTag}" -ForegroundColor Yellow
Write-Host "Container Name: $ContainerName" -ForegroundColor Yellow
Write-Host "Port Mapping: ${HostPort}:${ContainerPort}" -ForegroundColor Yellow
Write-Host ""

# Switch to repo root
Push-Location $RepoRoot

try {
    # Check Docker status
    Write-Host "[1/4] Checking Docker status..." -ForegroundColor Green
    $dockerStatus = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker is not running or user has no permission" -ForegroundColor Red
        exit 1
    }
    Write-Host "Docker is running" -ForegroundColor Green

    # Build the binary if it doesn't exist, or if -ForceRebuild is passed
    # Note: We build all platforms (no --single) so we get Linux x64 binary
    # that can run inside the Linux Docker container
    # We use the baseline-musl variant because Alpine uses musl libc (not glibc)
    # The binary embeds packages/app's built web UI, so source changes in
    # packages/app require rebuilding this binary to take effect.
    $binaryPath = "packages/opencode/dist/opencode-linux-x64-baseline-musl/bin/opencode"
    if ($ForceRebuild -or -not (Test-Path $binaryPath)) {
        if ($ForceRebuild) {
            Write-Host "[2/4] Force rebuild: removing existing binary..." -ForegroundColor Yellow
            Remove-Item -Recurse -Force packages\opencode\dist -ErrorAction SilentlyContinue
        } else {
            Write-Host "[2/4] Binary not found, building from source..." -ForegroundColor Yellow
        }
        Write-Host "This may take 15-30 minutes..." -ForegroundColor Yellow

        # Ensure workspace dependencies are installed (especially packages/app needed for Web UI embed)
        if (-not (Test-Path "node_modules")) {
            Write-Host "  Installing workspace dependencies..." -ForegroundColor Yellow
            bun install
            if ($LASTEXITCODE -ne 0) {
                Write-Host "ERROR: bun install failed on host" -ForegroundColor Red
                exit 1
            }
        }
        if (-not (Test-Path "packages/app/node_modules")) {
            Write-Host "  Installing packages/app dependencies..." -ForegroundColor Yellow
            bun install
            if ($LASTEXITCODE -ne 0) {
                Write-Host "ERROR: bun install failed on host" -ForegroundColor Red
                exit 1
            }
        }

        # Build the binary from packages/opencode directory
        # Build all platforms (not --single) so we get Linux x64 too
        # Without --skip-embed-web-ui, build.ts will run packages/app build and embed
        # the resulting dist into the binary, so our web UI branding changes are baked in.
        Push-Location "packages/opencode"
        bun run script/build.ts
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
    }

    # Create data directories
    $workbenchDir = "D:\AI\AIworkbench"
    $dataDir = "D:\AI\AIworkbench-data"
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
            -v "${workbenchDir}:/workspace" `
            -v "${dataDir}\root:/root" `
            -v "${dataDir}\tmp:/tmp" `
            -w /workspace `
            --hostname 0.0.0.0 `
            --env-file "$EnvFile" `
            "${ImageName}:${ImageTag}"
    } else {
        docker run -d --name $ContainerName `
            -p "${HostPort}:${ContainerPort}" `
            -v "${workbenchDir}:/workspace" `
            -v "${dataDir}\root:/root" `
            -v "${dataDir}\tmp:/tmp" `
            -w /workspace `
            --hostname 0.0.0.0 `
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
