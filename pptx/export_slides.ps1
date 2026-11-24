# export_slides.ps1 - open a deck in PowerPoint without a window, count its media and export slides as PNG.
param([Parameter(Mandatory)][string]$Deck, [Parameter(Mandatory)][string]$Out, [string]$Slides = '2')
$was = Get-Process POWERPNT -ErrorAction SilentlyContinue
$pp = New-Object -ComObject PowerPoint.Application
try {
    $pres = $pp.Presentations.Open($Deck, -1, 0, 0)
    $media = 0; $linked = 0; $corner = 0
    foreach ($sl in $pres.Slides) { foreach ($sh in $sl.Shapes) { if ($sh.Type -eq 16) { $media++; if ($sh.MediaFormat.IsLinked) { $linked++ } }; if ($sh.Name -eq 'Organisation' -or $sh.Name -eq 'University') { $corner++ } } }
    "opened: slides=$($pres.Slides.Count) sections=$($pres.SectionProperties.Count) media=$media linked=$linked corner-marks-on-slides=$corner"
    New-Item -ItemType Directory -Force $Out | Out-Null
    foreach ($n in ($Slides -split '[,; ]+' | Where-Object { $_ })) { $pres.Slides([int]$n).Export((Join-Path $Out "slide-$n.png"), 'PNG', 1280, 720) }
    $pres.Close()
}
finally { if (-not $was) { $pp.Quit() }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pp) }
