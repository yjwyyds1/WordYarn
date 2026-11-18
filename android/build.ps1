[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Jdk,
    [Parameter(Mandatory)][string]$BuildTools,
    [Parameter(Mandatory)][string]$AndroidJar,
    [Parameter(Mandatory)][string]$D8Jar,
    [Parameter(Mandatory)][string]$SherpaAar,
    [Parameter(Mandatory)][string]$KotlinJar,
    [Parameter(Mandatory)][string]$VoicePack,
    [string]$DebugKey = (Join-Path $env:LOCALAPPDATA 'WordYarnBuild/android-debug.keystore')
)
$ErrorActionPreference = 'Stop'
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with code $LASTEXITCODE" }
}

$repo = Split-Path -Parent $PSScriptRoot
$build = Join-Path $PSScriptRoot 'build'
$dist = Join-Path $PSScriptRoot 'dist'
$assets = Join-Path $build 'assets/reader'
$classes = Join-Path $build 'classes'
$site = Join-Path $repo 'web/site'
$voice = (Get-Item -LiteralPath $VoicePack).FullName
$voiceFiles = @('model.int8.onnx','voices.bin','tokens.txt','espeak-ng-data')
foreach ($name in $voiceFiles) {
    if (!(Test-Path -LiteralPath "$voice/$name")) { throw "Incomplete voice pack: $name" }
}
New-Item -ItemType Directory -Force $assets, "$assets/assets", "$assets/data", $classes, $dist | Out-Null
Copy-Item "$site/assets/css", "$site/assets/js" "$assets/assets" -Recurse -Force
Copy-Item "$site/assets/wordyarn.svg" "$assets/assets/" -Force
Copy-Item "$site/data/chapters.js" "$assets/data/" -Force
foreach ($chapter in 1..30) {
    Copy-Item ("$site/data/ch{0:00}.js" -f $chapter) "$assets/data/" -Force
}
Copy-Item "$PSScriptRoot/assets/mobile.*" "$assets/assets/" -Force
$html = [IO.File]::ReadAllText("$site/index.html")
$html = $html.Replace('</head>', '<link rel="stylesheet" href="assets/mobile.css"></head>')
$anchor = '<script src="assets/js/study.js"></script>'
if (!$html.Contains($anchor)) { throw 'Cannot find study script anchor' }
$html = $html.Replace($anchor, '<script src="assets/mobile.js"></script>' + [Environment]::NewLine + $anchor)
$preview = '<button class="btn primary-study" id="voicePreview">'
if (!$html.Contains($preview)) { throw 'Cannot find voice preview button' }
$html = $html.Replace($preview, '<label for="androidVoiceText">试读英文</label><textarea id="androidVoiceText" maxlength="1800" rows="3" placeholder="留空试听默认句子"></textarea>' + $preview)
[IO.File]::WriteAllText("$assets/index.html", $html)

if (!(Test-Path -LiteralPath $DebugKey)) {
    New-Item -ItemType Directory -Force (Split-Path -Parent $DebugKey) | Out-Null
    Invoke-Checked "$Jdk/bin/keytool.exe" @('-genkeypair','-keystore',$DebugKey,'-storepass','android',
        '-keypass','android','-alias','androiddebugkey','-dname','CN=WordYarn Android Debug','-keyalg','RSA','-keysize','2048','-validity','10000')
}
$env:JAVA_HOME = $Jdk
Invoke-Checked "$BuildTools/aapt2.exe" @('compile','--dir',"$PSScriptRoot/res",'-o',"$build/res.zip")
Invoke-Checked "$BuildTools/aapt2.exe" @('link','-I',$AndroidJar,'--manifest',"$PSScriptRoot/AndroidManifest.xml",
    '-o',"$build/resources.apk","$build/res.zip")
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$engineJar = "$build/sherpa.jar"
$aar = [IO.Compression.ZipFile]::OpenRead((Get-Item -LiteralPath $SherpaAar).FullName)
try {
    $library = $aar.GetEntry('classes.jar')
    if (!$library) { throw 'Sherpa AAR has no classes.jar' }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($library, $engineJar, $true)
} finally { $aar.Dispose() }
$sources = @(Get-ChildItem "$PSScriptRoot/src" -Recurse -Filter '*.java' -File | Select-Object -ExpandProperty FullName)
Invoke-Checked "$Jdk/bin/javac.exe" (@('--release','8','-encoding','UTF-8','-classpath',"$AndroidJar;$engineJar;$KotlinJar",'-d',$classes) + $sources)
$jar = "$build/classes.jar"
if (Test-Path -LiteralPath $jar) { Remove-Item -LiteralPath $jar }
[IO.Compression.ZipFile]::CreateFromDirectory($classes, $jar)
$dex = "$build/bytecode.zip"
Invoke-Checked "$Jdk/bin/java.exe" @('-cp',$D8Jar,'com.android.tools.r8.D8','--lib',$AndroidJar,
    '--min-api','26','--output',$dex,$jar,$engineJar,$KotlinJar)
Copy-Item "$build/resources.apk" "$build/unaligned.apk" -Force
$archive = [IO.Compression.ZipFile]::Open("$build/unaligned.apk", [IO.Compression.ZipArchiveMode]::Update)
try {
    function Copy-ZipEntries([string]$Path, [scriptblock]$Map) {
        $inputZip = [IO.Compression.ZipFile]::OpenRead($Path)
        try {
            foreach ($item in $inputZip.Entries) {
                $target = & $Map $item.FullName
                if (!$target) { continue }
                $entry = $archive.CreateEntry($target, [IO.Compression.CompressionLevel]::Optimal)
                $from = $item.Open()
                $to = $entry.Open()
                try { $from.CopyTo($to) } finally { $to.Dispose(); $from.Dispose() }
            }
        } finally { $inputZip.Dispose() }
    }
    Copy-ZipEntries $dex { param($name) if ($name -match '^classes\d*\.dex$') { $name } }
    Copy-ZipEntries (Get-Item -LiteralPath $SherpaAar).FullName {
        param($name)
        if ($name -match '^jni/(arm64-v8a|armeabi-v7a|x86_64)/[^/]+\.so$') { 'lib/' + $name.Substring(4) }
    }
    if (!$archive.GetEntry('lib/arm64-v8a/libsherpa-onnx-jni.so')) { throw 'Missing ARM64 sherpa JNI library' }
    # Android AssetManager expects forward slashes in ZIP entry names.
    $prefix = (Get-Item -LiteralPath $assets).FullName.Length + 1
    Get-ChildItem -LiteralPath $assets -Recurse -File | ForEach-Object {
        $entry = 'assets/reader/' + $_.FullName.Substring($prefix).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry) | Out-Null
    }
    foreach ($name in $voiceFiles) {
        Get-ChildItem -LiteralPath "$voice/$name" -Recurse -File | ForEach-Object {
            $entry = 'assets/voice/' + $_.FullName.Substring($voice.Length + 1).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry) | Out-Null
        }
    }
    Get-ChildItem -LiteralPath "$PSScriptRoot/licenses" -File | ForEach-Object {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, ('assets/licenses/' + $_.Name)) | Out-Null
    }
}
finally { $archive.Dispose() }
Invoke-Checked "$BuildTools/zipalign.exe" @('-P','16','-f','4',"$build/unaligned.apk","$build/aligned.apk")
$apk = Join-Path $dist 'WordYarn.apk'
Invoke-Checked "$BuildTools/apksigner.bat" @('sign','--ks',$DebugKey,'--ks-pass','pass:android','--key-pass','pass:android',
    '--ks-key-alias','androiddebugkey','--out',$apk,"$build/aligned.apk")
Invoke-Checked "$BuildTools/apksigner.bat" @('verify','--verbose',$apk)
Write-Output $apk
