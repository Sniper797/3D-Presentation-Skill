# test_show.ps1 - measure that the videos really play: runs the slide show in a window for a few seconds
# and reads PowerPoint's own media players (state and position) on the given slides.
#
#   powershell -File test_show.ps1 -Deck <motion.pptx> -Slides 9,21 [-Shot <folder for screen captures>]
#
# Player state: 0 playing, 1 paused, 2 stopped, 3 not ready. Position in milliseconds.
param([Parameter(Mandatory)][string]$Deck, [string]$Slides = '9', [string]$Shot = '')
$SlideList = $Slides -split '[,; ]+' | Where-Object { $_ } | ForEach-Object { [int]$_ }   # -File passes "9,21" as one string

Add-Type -AssemblyName System.Drawing
function Invoke-Com([scriptblock]$Do) {          # PowerPoint rejects calls while it is busy (loading media, starting the show): wait and ask again
    for ($i = 0; $i -lt 60; $i++) { try { return & $Do } catch { if ($_.Exception.Message -match '0x80010001|0x8001010A|rejected|busy') { Start-Sleep -Milliseconds 500 } else { throw } } }
    throw 'PowerPoint stayed busy for 30 s'
}
$was = Get-Process POWERPNT -ErrorAction SilentlyContinue
$pp = New-Object -ComObject PowerPoint.Application
try {
    $pres = Invoke-Com { $pp.Presentations.Open($Deck, -1, 0, -1) }
    Start-Sleep -Seconds 3
    Invoke-Com { $pres.SlideShowSettings.ShowType = 2 }          # in a window, not full screen
    $win = Invoke-Com { $pres.SlideShowSettings.Run() }
    Start-Sleep -Seconds 2
    Invoke-Com { $win.Left = 40; $win.Top = 40; $win.Width = 720; $win.Height = 420 }
    $view = Invoke-Com { $win.View }
    foreach ($n in $SlideList) {
        $sl = Invoke-Com { $pres.Slides($n) }
        $ids = @{}; foreach ($sh in $sl.Shapes) { if ($sh.Type -eq 16) { $ids[$sh.Name] = $sh.Id } }   # 16 = msoMedia
        Invoke-Com { $view.GotoSlide($n) }
        $t0 = Get-Date
        foreach ($at in 1.2, 2.0, 4.0, 7.0, 13.5) {
            $wait = $at - ((Get-Date) - $t0).TotalSeconds; if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]($wait * 1000)) }
            $line = "slide $n  t=$('{0:0.0}' -f ((Get-Date) - $t0).TotalSeconds)s"
            foreach ($k in ($ids.Keys | Sort-Object)) {
                try { $p = $view.Player($ids[$k]); $line += "  | $k : state $($p.State) pos $($p.CurrentPosition) ms" } catch { $line += "  | $k : no player" }
            }
            $line
            if ($Shot -and ($at -eq 2.0 -or $at -eq 7.0)) {
                try {
                    $x = [int]($win.Left * 96 / 72); $y = [int]($win.Top * 96 / 72); $cw = [int]($win.Width * 96 / 72); $chh = [int]($win.Height * 96 / 72)
                    $bmp = New-Object System.Drawing.Bitmap $cw, $chh; $g = [System.Drawing.Graphics]::FromImage($bmp)
                    $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size); $bmp.Save((Join-Path $Shot "show-$n-$at.png")); $g.Dispose(); $bmp.Dispose()
                } catch { "  (screen capture failed: $($_.Exception.Message))" }
            }
        }
    }
    Invoke-Com { $view.Exit() }
    Start-Sleep -Seconds 1
    Invoke-Com { $pres.Close() }
}
catch { "ERROR: $($_.Exception.Message)" }
finally { if (-not $was) { try { Invoke-Com { $pp.Quit() } } catch {} }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pp) }
