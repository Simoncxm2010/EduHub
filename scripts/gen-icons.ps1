# Generate EduHub PWA icons (PNG) using .NET System.Drawing.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-icons.ps1
param([string]$OutDir = "web/public/icons")

Add-Type -AssemblyName System.Drawing

# U+67A2 = "枢"
$char = [string][char]0x67A2

function New-Icon {
  param([string]$Path, [int]$Size, [string]$Text, [float]$FontRatio = 0.52)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(79, 110, 242),
    [System.Drawing.Color]::FromArgb(123, 147, 255),
    45.0)
  $g.FillRectangle($brush, $rect)

  $font = New-Object System.Drawing.Font('Microsoft YaHei', ($Size * $FontRatio), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $layoutRect = New-Object System.Drawing.RectangleF(0, 0, $Size, $Size)
  $g.DrawString($Text, $font, [System.Drawing.Brushes]::White, $layoutRect, $sf)

  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Host "Created $Path ($Size x $Size)"
}

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

New-Icon -Path (Join-Path $OutDir "icon-512.png") -Size 512 -Text $char
New-Icon -Path (Join-Path $OutDir "icon-192.png") -Size 192 -Text $char
New-Icon -Path (Join-Path $OutDir "apple-touch-icon.png") -Size 180 -Text $char
