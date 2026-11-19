[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$VcpkgRoot,
    [Parameter(Mandatory)][string]$WebView2Sdk,
    [Parameter(Mandatory)][string]$SherpaSdk,
    [Parameter(Mandatory)][string]$VoicePack,
    [string]$CMake = 'cmake',
    [string]$InstalledDir,
    [string]$MsvcRedistRoot = $env:VCToolsRedistDir
)
$ErrorActionPreference = 'Stop'
$toolchain = Join-Path (Resolve-Path -LiteralPath $VcpkgRoot).Path 'scripts/buildsystems/vcpkg.cmake'
$sdk = (Resolve-Path -LiteralPath $WebView2Sdk).Path
$sherpa = (Resolve-Path -LiteralPath $SherpaSdk).Path
$voice = (Resolve-Path -LiteralPath $VoicePack).Path
$argsList = @('-S', $PSScriptRoot, '-B', (Join-Path $PSScriptRoot 'build-x64'),
    '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_TRY_COMPILE_CONFIGURATION=Release', "-DCMAKE_TOOLCHAIN_FILE=$toolchain",
    "-DWEBVIEW2_SDK=$sdk", "-DSHERPA_SDK=$sherpa", "-DKITTEN_VOICE_PACK=$voice", '-DVCPKG_TARGET_TRIPLET=x64-windows')
if ($InstalledDir) {
    $installed = (Resolve-Path -LiteralPath $InstalledDir).Path
    $argsList += @('-DVCPKG_MANIFEST_MODE=OFF', "-DVCPKG_INSTALLED_DIR=$installed")
}
if ($MsvcRedistRoot) {
    $redist = (Resolve-Path -LiteralPath $MsvcRedistRoot).Path
    $argsList += "-DMSVC_REDIST_DIR=$redist"
}
$build = Join-Path $PSScriptRoot 'build-x64'
$dist = Join-Path $PSScriptRoot 'dist'
& $CMake @argsList
if ($LASTEXITCODE -ne 0) { throw 'Desktop configure failed.' }
& $CMake --build $build --parallel
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
& $CMake --install $build --prefix $dist
if ($LASTEXITCODE -ne 0) { throw 'Desktop packaging failed.' }
Write-Host "Ready: $(Join-Path $dist 'WordYarn.exe')"
