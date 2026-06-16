# opencode Docker run script
# Start the pre-built container (v0.0.3 supports -EnvFile for API key injection)
# Note: All user-facing strings are English to avoid PowerShell encoding issues
#       (see readme.md "pitfall 1" for the encoding pitfall this prevents)

param(
    [string]$ImageName = "yejian-opencode",
    [string]$ContainerName = "yejian-AIworkbench",
    [string]$ImageTag = "v0.0.3",
    [int]$HostPort = 8088,
    [int]$ContainerPort = 8088,
    [string]$EnvFile = ""        # Optional: .env file path, will be passed via --env-file
)

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

# Remove old container if it exists
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
        -v "D:\AI\AIworkbench:/workspace" `
        -v "D:\AI\AIworkbench-data\root:/root" `
        -v "D:\AI\AIworkbench-data\tmp:/tmp" `
        -w /workspace `
        --hostname 0.0.0.0 `
        --env-file "$EnvFile" `
        "${ImageName}:${ImageTag}"
} else {
    docker run -d --name $ContainerName `
        -p "${HostPort}:${ContainerPort}" `
        -v "D:\AI\AIworkbench:/workspace" `
        -v "D:\AI\AIworkbench-data\root:/root" `
        -v "D:\AI\AIworkbench-data\tmp:/tmp" `
        -w /workspace `
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
