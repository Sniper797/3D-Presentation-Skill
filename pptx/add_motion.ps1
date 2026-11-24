# add_motion.ps1 - put the recorded scene videos behind the text of the deck, through PowerPoint itself.
#
#   powershell -File add_motion.ps1 -Deck <static.pptx> -Vid <vid folder> -Out <motion.pptx>
#
# Per slide listed in vid\videos.json:
#   fly-NN.mp4   plays once when the slide opens (the camera flies in from the previous slide's view)
#   loop-NN.mp4  starts when the flight ends, hidden until then, and repeats until the slide is left
# Both are muted, start by themselves, sit behind every text box, and carry their first frame as the still picture.
# PowerPoint writes the playback timing itself, so the file is whatever PowerPoint considers correct.
param([Parameter(Mandatory)][string]$Deck, [Parameter(Mandatory)][string]$Vid, [Parameter(Mandatory)][string]$Out)

$msoTrue = -1; $msoFalse = 0; $ppAdvanceOnTime = 2; $msoSendToBack = 1
$plan = Get-Content (Join-Path $Vid 'videos.json') -Raw | ConvertFrom-Json
Copy-Item $Deck $Out -Force
$was = Get-Process POWERPNT -ErrorAction SilentlyContinue
$pp = New-Object -ComObject PowerPoint.Application
$pp.DisplayAlerts = 1
try {
    $pres = $pp.Presentations.Open($Out, $msoFalse, $msoFalse, $msoFalse)
    $w = $pres.PageSetup.SlideWidth; $h = $pres.PageSetup.SlideHeight
    $loops = 0; $flights = 0; $groups = 0
    foreach ($s in $plan.slides) {
        $slide = $pres.Slides($s.n)
        $a = $null
        if ($s.fly) {
            $a = $slide.Shapes.AddMediaObject2((Join-Path $Vid $s.flyfile), $msoFalse, $msoTrue, 0, 0, $w, $h)
            $a.Name = 'Camera flight (video)'
            $a.AlternativeText = 'Video: the camera flies in from the previous part of the plant'
            $a.MediaFormat.Muted = $true
            $a.MediaFormat.SetDisplayPictureFromFile((Join-Path $Vid ($s.flyfile -replace '\.mp4$', '.jpg')))
            $a.AnimationSettings.PlaySettings.PlayOnEntry = $msoTrue
            $a.AnimationSettings.PlaySettings.LoopUntilStopped = $msoFalse
            $a.AnimationSettings.PlaySettings.RewindMovie = $msoFalse
            $a.AnimationSettings.PlaySettings.HideWhileNotPlaying = $msoFalse
            $a.AnimationSettings.AdvanceMode = $ppAdvanceOnTime
            $a.AnimationSettings.AdvanceTime = 0
            $a.AnimationSettings.AnimationOrder = 1
            $flights++
        }
        $b = $slide.Shapes.AddMediaObject2((Join-Path $Vid $s.loop), $msoFalse, $msoTrue, 0, 0, $w, $h)
        $b.Name = 'Scene in motion (video)'
        $b.AlternativeText = 'Video: the 3D scene of this slide in motion, repeating'
        $b.MediaFormat.Muted = $true
        $b.MediaFormat.SetDisplayPictureFromFile((Join-Path $Vid ($s.loop -replace '\.mp4$', '.jpg')))
        $b.AnimationSettings.PlaySettings.PlayOnEntry = $msoTrue
        $b.AnimationSettings.PlaySettings.LoopUntilStopped = $msoTrue
        $b.AnimationSettings.PlaySettings.RewindMovie = $msoFalse
        $b.AnimationSettings.PlaySettings.HideWhileNotPlaying = $(if ($s.fly) { $msoTrue } else { $msoFalse })
        $b.AnimationSettings.AdvanceMode = $ppAdvanceOnTime
        $b.AnimationSettings.AdvanceTime = 0
        $b.AnimationSettings.AnimationOrder = $(if ($s.fly) { 2 } else { 1 })
        # behind everything else: first the loop, then the flight under it
        $b.ZOrder($msoSendToBack)
        if ($a) { $a.ZOrder($msoSendToBack) }
        $loops++
        # the labels pinned to 3D parts appear when the loop starts, that is after the camera has arrived
        $names = @(); foreach ($sh in $slide.Shapes) { if ($sh.Name -like 'Callout *') { $names += $sh.Name } }
        if ($names.Count -gt 0) {
            $grp = $(if ($names.Count -gt 1) { $slide.Shapes.Range($names).Group() } else { $slide.Shapes.Item($names[0]) })
            $grp.Name = 'Callouts'
            $eff = $slide.TimeLine.MainSequence.AddEffect($grp, 10, 0, 2)      # fade, with the previous effect (the loop)
            $eff.Timing.Duration = 0.6
            $eff.Timing.TriggerDelayTime = 0.2
            $groups++
        }
    }
    $pres.Save()
    "saved: $loops looping videos, $flights camera flights, $groups callout groups, slides=$($pres.Slides.Count)"
    foreach ($n in ($plan.slides | Select-Object -First 2 | ForEach-Object { $_.n })) {
        $sl = $pres.Slides($n); $seq = $sl.TimeLine.MainSequence
        $names = @(); for ($i = 1; $i -le $seq.Count; $i++) { $e = $seq.Item($i); $names += "$($e.Shape.Name) [trigger $($e.Timing.TriggerType), repeat $($e.Timing.RepeatCount)]" }
        "slide ${n}: bottom shapes = $($sl.Shapes(1).Name) | $($sl.Shapes(2).Name) | $($sl.Shapes(3).Name); effects = $($names -join ' ; ')"
    }
    $pres.Close()
}
catch { "ERROR: $($_.Exception.Message)"; exit 1 }
finally { if (-not $was) { $pp.Quit() }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pp) }
"$Out  $((Get-Item $Out).Length) bytes"
