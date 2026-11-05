# Генерирует иконки приложения (PWA / Android / iOS) в public/.
# Запуск: powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
# Это временные фирменные иконки: чёрный фон, красная полоса, «DTT».
# Когда будет настоящий логотип клуба — замените PNG-файлы в public/ (те же имена и размеры).

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'public'

function New-Icon([int]$size, [string]$name, [double]$safe) {
  # $safe — доля холста, в которую вписан рисунок (для maskable-иконок Android обрезает края).
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::FromArgb(10, 10, 10))

  $inner = $size * $safe
  $off = ($size - $inner) / 2
  $red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(225, 6, 0))
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)

  # Красная вертикальная полоса слева (как в логотипе навбара)
  $g.FillRectangle($red, [single]($off + $inner * 0.12), [single]($off + $inner * 0.22), [single]($inner * 0.07), [single]($inner * 0.56))

  # «DTT»
  $font = New-Object System.Drawing.Font('Arial', [single]($inner * 0.30), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Near'; $fmt.LineAlignment = 'Center'
  $rect = New-Object System.Drawing.RectangleF ([single]($off + $inner * 0.24)), ([single]($off + $inner * 0.10)), ([single]($inner * 0.76)), ([single]($inner * 0.62))
  $g.DrawString('DTT', $font, $white, $rect, $fmt)

  # Красная подчёркивающая линия
  $g.FillRectangle($red, [single]($off + $inner * 0.27), [single]($off + $inner * 0.68), [single]($inner * 0.56), [single]($inner * 0.05))

  $path = Join-Path $out $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "$name ${size}x${size}"
}

New-Icon 192 'pwa-192x192.png' 1.0
New-Icon 512 'pwa-512x512.png' 1.0
New-Icon 512 'maskable-icon-512x512.png' 0.8   # Android: рисунок в безопасной зоне 80%
New-Icon 180 'apple-touch-icon.png' 1.0        # iOS «На экран Домой»
New-Icon 64  'favicon-64x64.png' 1.0
