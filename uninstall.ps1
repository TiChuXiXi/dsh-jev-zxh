#Requires -Version 6.0
<#
.SYNOPSIS
  把 dsh-jev-zxh 从 DSH profile 里摘掉（install.ps1 的反操作）。

.DESCRIPTION
  只做两件事：删掉 profiles\node_modules\dsh-jev-zxh 这个 junction，从
  profiles\<Profile>\package.json 的 dsh.profile.bundles 里移除包名。
  不碰插件源码目录，不碰任何别的 junction（例如 dsh-command-md / dsh-zh-localize）。

  如果当初是用 npm 装的（dsh plugin add dsh-jev-zxh），应该用
  `dsh plugin --profile <profile> remove dsh-jev-zxh`，本脚本管不到那种安装。

.PARAMETER Profile
  目标 profile 名，默认 web。
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'

$packageName = 'dsh-jev-zxh'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$link = Join-Path $dshHome "profiles\node_modules\$packageName"
$manifestPath = Join-Path $dshHome "profiles\$Profile\package.json"

if (Test-Path -LiteralPath $link) {
  $item = Get-Item -LiteralPath $link -Force
  if ($item.LinkType -ne 'Junction') {
    throw "$link 不是 junction（LinkType=$($item.LinkType)），拒绝删除。"
  }
  $item.Delete()
  Write-Host "已删 junction：$link"
} else {
  Write-Host "junction 本来就不存在：$link"
}

if (Test-Path -LiteralPath $manifestPath) {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $bundles = @($manifest.dsh.profile.bundles)
  if ($bundles -contains $packageName) {
    $backup = "$manifestPath.bak-$packageName-uninstall"
    Copy-Item -LiteralPath $manifestPath -Destination $backup -Force
    $manifest.dsh.profile.bundles = @($bundles | Where-Object { $_ -ne $packageName })
    $manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath -Encoding utf8
    Write-Host "已从 bundles 移除 $packageName"
    Write-Host "备份：$backup"
  } else {
    Write-Host "bundles 里本来就没有 $packageName。"
  }
} else {
  Write-Host "找不到 profile 清单：$manifestPath"
}

Write-Host '重启 dsh 后生效。'
