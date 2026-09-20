# opencode Docker run script
# Rewritten 2026-09-20 to match the actual production container config (perf fix A1):
#   - Data root:  E:\AI\AIworkbench-data (the live environment)
#   - Workspace:  E:\AI\YEJIAN -> /YEJIAN (working dir, stays on bind mount)
#   - DB dir:     /root/.local/share/opencode now on named volume "yejian-opencode-data"
#                 (lives on WSL2 ext4, bypasses gRPC-FUSE bind-mount overhead, 5-10x faster DB writes)
#   - Container name defaults to "yejian-<ImageTag>" (e.g. yejian-v0.1.6), --restart always
# NOTE: the named volume must be populated once via the migration steps in
#       docker/readme.md section 4.5 BEFORE first use, otherwise the database
#       inside the container will be empty.
# Note: All user-facing strings are English to avoid PowerShell encoding issues
#       (see readme.md "pitfall 1" for the encoding pitfall this prevents)

param(
    [string]$ImageName = "yejian-opencode",
    [string]$ContainerName = "",   # default: "yejian-<ImageTag>", e.g. yejian-v0.1.6
    [string]$ImageTag = "v0.1.6",
    [int]$HostPort = 8088,
    [int]$ContainerPort = 8088,
    [string]$EnvFile = "E:\AI\dockerimage\api-keys-v0.0.8.env"   # production API keys file
)

if (-not $ContainerName) { $ContainerName = "yejian-$ImageTag" }

Write-Host "=== Starting opencode container ===" -ForegroundColor Cyan
Write-Host "Image: ${ImageName}:${ImageTag}" -ForegroundColor Yellow
Write-Host "Container: $ContainerName" -ForegroundColor Yellow
Write-Host "Port: ${HostPort}:${ContainerPort}" -ForegroundColor Yellow
if ($EnvFile -ne "") {
    Write-Host "Env file: $EnvFile" -ForegroundColor Yellow
}
Write-Host ""

# Check if image exists
$imageExists = docker images --format "{{.Repository}}:{{.Tag}}" | Where-Object { $_ -eq "${ImageName}:${ImageTag}" }
if (-not $imageExists) {
    Write-Host "ERROR: image ${ImageName}:${ImageTag} not found" -ForegroundColor Red
    Write-Host "Please run build.ps1 first" -ForegroundColor Yellow
    exit 1
}

# Remove old container if it exists (re-running with the same name)
$existingContainer = docker ps -a --filter "name=$ContainerName" --format "{{.Names}}"
if ($existingContainer) {
    Write-Host "Removing old container: $ContainerName" -ForegroundColor Yellow
    docker rm -f $ContainerName 2>&1 | Out-Null
}

# Start new container
# Note: do NOT use a variable that bundles "--env-file <path>" into one string
#       and pass it to docker - PowerShell won't split on spaces, so docker
#       will see " --env-file \"path\"" as a single (malformed) image name.
#       Use two separate code paths instead.
Write-Host "Starting container: $ContainerName" -ForegroundColor Green
if ($EnvFile -ne "") {
    if (-not (Test-Path $EnvFile)) {
        Write-Host "ERROR: env file not found: $EnvFile" -ForegroundColor Red
        exit 1
    }
    docker run -d --name $ContainerName `
        -p "${HostPort}:${ContainerPort}" `
        -v "E:\AI\YEJIAN:/YEJIAN" `
        -v "E:\AI\AIworkbench-data\root:/root" `
        -v "yejian-opencode-data:/root/.local/share/opencode" `
        -v "E:\AI\AIworkbench-data\tmp:/tmp" `
        -w /YEJIAN `
        -e TZ=Asia/Shanghai `
        --env-file "$EnvFile" `
        --restart always `
        --hostname 0.0.0.0 `
        "${ImageName}:${ImageTag}"
} else {
    docker run -d --name $ContainerName `
        -p "${HostPort}:${ContainerPort}" `
        -v "E:\AI\YEJIAN:/YEJIAN" `
        -v "E:\AI\AIworkbench-data\root:/root" `
        -v "yejian-opencode-data:/root/.local/share/opencode" `
        -v "E:\AI\AIworkbench-data\tmp:/tmp" `
        -w /YEJIAN `
        -e TZ=Asia/Shanghai `
        --restart always `
        --hostname 0.0.0.0 `
        "${ImageName}:${ImageTag}"
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "=== Container started successfully ===" -ForegroundColor Green
    Write-Host "Web URL: http://localhost:${HostPort}" -ForegroundColor Cyan
    Write-Host "Container name: $ContainerName" -ForegroundColor Cyan
} else {
    Write-Host "ERROR: container startup failed" -ForegroundColor Red
}
