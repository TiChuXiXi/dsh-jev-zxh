#Requires -Version 6.0
<#
.SYNOPSIS
  把 dsh-jev-zxh 挂进一个 DSH profile（Windows，本地开发用）。

.DESCRIPTION
  正式安装请走 npm：dsh plugin --profile web add dsh-jev-zxh
  本脚本只服务「本机源码目录直接挂载」的开发场景。

  为什么不直接用 `dsh plugin add <绝对路径>`：Windows 上 pnpm 会把 `link:D:/...`
  当相对路径处理，建出一个指向 `<profile 目录>\D:\...` 的死 junction，reconcile
  随即报 `cannot resolve profile bundle "dsh-jev-zxh"`。profile 在 C:、源码在 D: 时必踩。

  做法和 dsh-command-md / dsh-zh-localize 一致：
    1) 在 <DSH_HOME>\profiles\node_modules 下建 junction 指向本插件目录；
       Node 从 profile 目录向上解析包名时就能找到它，且能顺着真实路径解析到
       插件目录里本地的 node_modules\@deepseek-ai\dsh-tools。
    2) 把包名加进 <DSH_HOME>\profiles\<Profile>\package.json 的
       dsh.profile.bundles —— 这一步才让它成为一个组合层。

  注意 junction 名 = 【包名】dsh-jev-zxh，而插件行 id 是短名 dsh-jev。

.PARAMETER Profile
  目标 profile 名，默认 web。

.EXAMPLE
  pwsh -File .\install.ps1
  pwsh -File .\install.ps1 -Profile headless
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'

$packageName = 'dsh-jev-zxh'
$pluginDir = $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$sharedModules = Join-Path $dshHome 'profiles\node_modules'
$link = Join-Path $sharedModules $packageName
$profileDir = Join-Path $dshHome "profiles\$Profile"
$manifestPath = Join-Path $profileDir 'package.json'

if (-not (Test-Path -LiteralPath (Join-Path $pluginDir 'node_modules\@deepseek-ai\dsh-tools\package.json'))) {
  throw "缺少本地依赖。先在 $pluginDir 里跑：npm install --registry https://registry.npmjs.org"
}
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "找不到 profile 清单：$manifestPath"
}

# ---- 1) 共享 node_modules 里的 junction --------------------------------
New-Item -ItemType Directory -Path $sharedModules -Force | Out-Null
if (Test-Path -LiteralPath $link) {
  $existing = Get-Item -LiteralPath $link -Force
  if ($existing.LinkType -ne 'Junction') {
    throw "$link 已存在且不是 junction，拒绝覆盖。"
  }
  if ($existing.Target -ne $pluginDir) {
    Write-Host "替换已有 junction：$($existing.Target) -> $pluginDir"
    $existing.Delete()
  }
}
if (Test-Path -LiteralPath $link) {
  Write-Host "junction 已就位：$link -> $pluginDir"
} else {
  New-Item -ItemType Junction -Path $link -Target $pluginDir | Out-Null
  Write-Host "已建 junction：$link -> $pluginDir"
}

# ---- 2) 把包名加进 dsh.profile.bundles --------------------------------
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$bundles = @($manifest.dsh.profile.bundles)
if ($bundles -contains $packageName) {
  Write-Host "bundles 里已有 $packageName，跳过。"
} else {
  $backup = "$manifestPath.bak-$packageName"
  Copy-Item -LiteralPath $manifestPath -Destination $backup -Force
  $manifest.dsh.profile.bundles = @($bundles + $packageName)
  $manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath -Encoding utf8
  Write-Host "已把 $packageName 写进 $manifestPath"
  Write-Host "备份：$backup"
}

Write-Host ''
Write-Host '验证：'
Write-Host "  dsh --profile $Profile --dump-config | Select-String '$packageName' -Context 0,6"
Write-Host ''
Write-Host '生效：'
Write-Host '  1. 重启 dsh（bundle 层在启动时加载，刷新页面不够）'
Write-Host '  2. 新建会话（工具 schema 在会话创建时锁定）'
Write-Host '  3. 启动日志里应出现：[dsh-jev] jev_decide registered (model=typesafe/jev-1.13)'
Write-Host ''
Write-Host '配置（apiKey / endpoint / model）：在「设置 → 插件」页填，或按 id dsh-jev 覆盖 profile 的 cordis.patch.yml。'
