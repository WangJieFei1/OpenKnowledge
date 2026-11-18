$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Build a Windows installer on Windows.' }

$thumbprint = ([string]$env:OPEN_KNOWLEDGE_WINDOWS_CERT_THUMBPRINT).Trim()
if ($thumbprint -notmatch '^[0-9A-Fa-f]{40}$') {
    throw 'Set OPEN_KNOWLEDGE_WINDOWS_CERT_THUMBPRINT to a code-signing certificate thumbprint.'
}
$cert = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint"
if (-not $cert.HasPrivateKey -or $cert.NotBefore -gt (Get-Date) -or $cert.NotAfter -lt (Get-Date)) {
    throw 'The selected code-signing certificate or its private key is unavailable.'
}

Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$arch = node -p process.arch
if ($LASTEXITCODE -ne 0 -or $arch -ne 'x64') { throw 'Use x64 Node.js on the Windows x64 build machine.' }
$bunArch = bun -p process.arch
if ($LASTEXITCODE -ne 0 -or $bunArch -ne $arch) { throw 'Use the same architecture for Bun and Node.js.' }
$env:OPEN_KNOWLEDGE_WINDOWS_RELEASE = '1'
$env:OPEN_KNOWLEDGE_EDITION = 'general'
$releaseOut = Join-Path $PWD ("out/windows-release-" + [guid]::NewGuid().ToString('N'))
$env:OPEN_KNOWLEDGE_WINDOWS_RELEASE_OUT = ([System.IO.Directory]::CreateDirectory($releaseOut)).FullName
bun run build
if ($LASTEXITCODE -ne 0) { throw 'Windows app build failed.' }
node node_modules/@electron-forge/cli/dist/electron-forge.js make --platform=win32 --arch=x64 --targets=squirrel
if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }

$installers = @(Get-ChildItem -Path (Join-Path $releaseOut 'make/squirrel.windows/x64') -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows installer.' }
$installer = $installers[0].FullName
$executables = @(Get-ChildItem -Path $releaseOut -Filter 'open-knowledge-general.exe' -Recurse -File)
if ($executables.Count -ne 1) { throw 'Expected exactly one packaged application executable.' }
foreach ($file in @($installer, $executables[0].FullName)) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or
        $signature.SignerCertificate.Thumbprint -ne $thumbprint -or
        -not $signature.TimeStamperCertificate) {
        throw "The file does not have a valid, timestamped signature from the selected certificate: $file"
    }
}
Write-Output "Verified Windows installer: $installer"
