param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("prep", "up", "down", "rebuild", "status")]
  [string]$Action,

  [string]$ComposeFile = "infra/docker/docker-compose.osrm.yml",
  [string]$Profile = "/opt/foot.lua",
  [string]$RegionFile = "/data/region.osm.pbf",
  [string]$RegionBase = "/data/region.osrm"
)

$ErrorActionPreference = "Stop"

function Invoke-Compose {
  param([string[]]$ComposeArgs)
  & docker compose -f $ComposeFile @ComposeArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed with exit code $LASTEXITCODE"
  }
}

switch ($Action) {
  "prep" {
    Write-Host "Preparing OSRM graph files from $RegionFile ..."
    Invoke-Compose -ComposeArgs @(
      "run", "--rm", "osrm-tools",
      "osrm-extract -p $Profile $RegionFile"
    )
    Invoke-Compose -ComposeArgs @(
      "run", "--rm", "osrm-tools",
      "osrm-partition $RegionBase"
    )
    Invoke-Compose -ComposeArgs @(
      "run", "--rm", "osrm-tools",
      "osrm-customize $RegionBase"
    )
    Write-Host "OSRM prep complete."
  }
  "up" {
    Write-Host "Starting OSRM service ..."
    Invoke-Compose -ComposeArgs @("up", "-d", "osrm")
  }
  "down" {
    Write-Host "Stopping OSRM services ..."
    Invoke-Compose -ComposeArgs @("down")
  }
  "rebuild" {
    & $PSCommandPath -Action prep -ComposeFile $ComposeFile -Profile $Profile -RegionFile $RegionFile -RegionBase $RegionBase
    & $PSCommandPath -Action up -ComposeFile $ComposeFile
  }
  "status" {
    Invoke-Compose -ComposeArgs @("ps")
  }
}
