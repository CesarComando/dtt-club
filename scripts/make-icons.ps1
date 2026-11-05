# Генерирует иконки приложения (PWA / Android / iOS) в public/ из логотипа клуба.
# Запуск: powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
# Исходник: assets/logo-source.jpg (квадратный логотип; лучше 1024×1024 и больше).
# Чтобы сменить иконку — замените исходник и запустите скрипт ещё раз.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'public'
$src = [System.Drawing.Image]::FromFile((Join-Path $root 'assets\logo-source.jpg'))

# Цвет фона берём из угла логотипа — поля maskable-иконки сливаются с рисунком.
$bg = ([System.Drawing.Bitmap]$src).GetPixel(4, 4)

function New-Icon([int]$size, [string]$name, [double]$safe) {
  # $safe — доля холста под рисунок (Android обрезает края maskable-иконок по кругу/скруглению).
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.SmoothingMode = 'AntiAlias'
  $g.PixelOffsetMode = 'HighQuality'
  $g.Clear($bg)

  $inner = [int]($size * $safe)
  $off = [int](($size - $inner) / 2)
  $g.DrawImage($src, $off, $off, $inner, $inner)

  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "$name ${size}x${size}"
}

New-Icon 192 'pwa-192x192.png' 1.0
New-Icon 512 'pwa-512x512.png' 1.0
New-Icon 512 'maskable-icon-512x512.png' 0.8   # Android: рисунок в безопасной зоне 80%
New-Icon 180 'apple-touch-icon.png' 1.0        # iOS «На экран Домой»
New-Icon 64  'favicon-64x64.png' 1.0

$src.Dispose()
