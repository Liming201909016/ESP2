param(
  [string]$OutputPath,
  [string]$ReleaseDirectory,
  [string]$SourceCommit = 'local',
  [string]$BuildRunId
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$standalone = Join-Path $root '.next/standalone'
if (-not (Test-Path (Join-Path $standalone 'server.js'))) { throw 'Run the production build before packaging.' }
if (-not (Test-Path (Join-Path $standalone 'node_modules/pg/lib/index.js'))) { throw 'The standalone PostgreSQL driver is missing.' }
if ($OutputPath -and $ReleaseDirectory) { throw 'Choose OutputPath or ReleaseDirectory, not both.' }
$windowsHost = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$node = if ($nodeCommand) { $nodeCommand.Source } elseif ($windowsHost) { Join-Path $env:ProgramFiles 'nodejs/node.exe' } else { throw 'Node.js 24 is required.' }
if ($SourceCommit -ne 'local') {
  if ($SourceCommit -notmatch '^[a-f0-9]{40}$' -or $BuildRunId -notmatch '^[1-9][0-9]*$') { throw 'CI packaging requires an exact commit and workflow run ID.' }
  $commit = & git -C $root rev-parse HEAD
  if ($LASTEXITCODE -ne 0 -or $commit.Trim() -cne $SourceCommit) { throw 'Source commit differs from the checked-out tree.' }
  & git -C $root diff --quiet HEAD --
  if ($LASTEXITCODE -ne 0) { throw 'Tracked source changes must not be labelled as the CI commit.' }
}
$stage = Join-Path ([IO.Path]::GetTempPath()) ('esp-standalone-' + [guid]::NewGuid().ToString('N'))
$package = if ($ReleaseDirectory) { Join-Path ([IO.Path]::GetFullPath($ReleaseDirectory)) 'release.zip' } elseif ($OutputPath) { [IO.Path]::GetFullPath($OutputPath) } else { $stage + '.zip' }
$manifest = if ($ReleaseDirectory) { Join-Path ([IO.Path]::GetFullPath($ReleaseDirectory)) 'manifest.json' } else { $package + '.manifest.json' }
if (Test-Path $package) { throw 'The output package already exists.' }
if (Test-Path $manifest) { throw 'The output manifest already exists.' }
New-Item -ItemType Directory -Path (Split-Path $package -Parent) -Force | Out-Null
New-Item -ItemType Directory -Path $stage | Out-Null
Get-ChildItem $standalone -Force | Where-Object { $_.Name -notlike '.env*' } | Copy-Item -Destination $stage -Recurse -Force
Copy-Item (Join-Path $root '.next/static') -Destination (Join-Path $stage '.next/static') -Recurse -Force
Copy-Item (Join-Path $root 'public') -Destination (Join-Path $stage 'public') -Recurse -Force
$stampArguments = @((Join-Path $PSScriptRoot 'release-package.mjs'), 'stamp', $stage, $SourceCommit)
if ($BuildRunId) { $stampArguments += $BuildRunId }
$null = & $node @stampArguments
if ($LASTEXITCODE -ne 0) { throw 'Release marker creation failed.' }
$tar = if ($windowsHost) { Join-Path $env:SystemRoot 'System32/tar.exe' } else { (Get-Command tar -ErrorAction Stop).Source }
& $tar -czf (Join-Path $stage 'node_modules.tar.gz') -C (Join-Path $stage 'node_modules') .
if ($LASTEXITCODE -ne 0) { throw 'Current dependency archive creation failed.' }
if ($windowsHost) {
  & $tar -a -cf $package -C $stage .
  if ($LASTEXITCODE -ne 0) { throw 'Standalone deployment archive creation failed.' }
} else {
  $zip = (Get-Command zip -ErrorAction Stop).Source
  Push-Location $stage
  try {
    & $zip -q -r -y $package .
    if ($LASTEXITCODE -ne 0) { throw 'Standalone deployment archive creation failed.' }
  } finally { Pop-Location }
}
$null = & $node (Join-Path $PSScriptRoot 'release-package.mjs') manifest $package $manifest
if ($LASTEXITCODE -ne 0) { throw 'Release package validation failed.' }
[pscustomobject]@{ PackagePath = $package; StagePath = $stage; ManifestPath = $manifest; Bytes = (Get-Item $package).Length }