# opencode Docker Image Export Script
# Exports the Docker image to a tar file for transfer to other machines
#
# Usage: .\export.ps1

param(
    [string]$ImageName = "yejian-opencode",
    [string]$ImageTag = "v0.0.1",
    [string]$OutputDir = "D:\AI"
)

$tarFile = Join-Path $OutputDir "${ImageName}-${ImageTag}.tar"

Write-Host "=== opencode Docker Image Export ===" -ForegroundColor Cyan
Write-Host "Image: ${ImageName}:${ImageTag}" -ForegroundColor Yellow
Write-Host "Output: $tarFile" -ForegroundColor Yellow
Write-Host ""

# Check if image exists
$imageExists = docker images --format "{{.Repository}}:{{.Tag}}" | Where-Object { $_ -eq "${ImageName}:${ImageTag}" }
if (-not $imageExists) {
    Write-Host "ERROR: Image ${ImageName}:${ImageTag} not found" -ForegroundColor Red
    Write-Host "Please run build.ps1 first" -ForegroundColor Yellow
    exit 1
}

# Create output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    Write-Host "Created output directory: $OutputDir" -ForegroundColor Yellow
}

# Export the image
Write-Host "Exporting image to tar file..." -ForegroundColor Green
docker save -o $tarFile "${ImageName}:${ImageTag}"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Export failed" -ForegroundColor Red
    exit 1
}

# Show file info
$fileSize = (Get-Item $tarFile).Length / 1MB
Write-Host ""
Write-Host "=== Export Complete ===" -ForegroundColor Green
Write-Host "File: $tarFile" -ForegroundColor Cyan
Write-Host ("Size: {0:N2} MB" -f $fileSize) -ForegroundColor Cyan
Write-Host ""
Write-Host "To use this image on another machine:" -ForegroundColor Yellow
Write-Host "  1. Copy the tar file to the target machine" -ForegroundColor White
Write-Host "  2. On the target machine, run:" -ForegroundColor White
Write-Host "     docker load -i ${ImageName}-${ImageTag}.tar" -ForegroundColor White
Write-Host ""
Write-Host "Then start the container with:" -ForegroundColor Yellow
Write-Host "  docker run -d --name yejian-AIworkbench -p 8088:8088 \`" -ForegroundColor White
Write-Host "    -v `"D:\AI\AIworkbench:/workspace`" \`" -ForegroundColor White
Write-Host "    -v `"D:\AI\AIworkbench-data/root:/root`" \`" -ForegroundColor White
Write-Host "    -v `"D:\AI\AIworkbench-data/tmp:/tmp`" \`" -ForegroundColor White
Write-Host "    -w /workspace \`" -ForegroundColor White
Write-Host "    ${ImageName}:${ImageTag}" -ForegroundColor White