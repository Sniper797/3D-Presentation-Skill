# The same deck as a PowerPoint file

Two files come out of one built deck, and the HTML stays the master:

| File | What it is |
|---|---|
| **Still** | Every slide is the captured 3D scene as a background picture, with native, editable text boxes and shapes at the positions measured in the browser. Theme colours and fonts from the deck's palette, two layouts, sections by chapter, speaker notes, a fade between slides. |
| **Motion** | The still deck plus, behind the text of every slide whose scene is visible: a clip of the camera flying in from the previous slide (2.4 s, once), then the scene in motion as a clip that repeats until the slide is left. Callouts fade in after the camera arrives. |

For motion that is not this pattern (a clip on its own slide, PowerPoint's own effects, Morph, a chart that grows),
use `animating-pptx-decks`.

## Commands

Run from the skill folder. `<deck>` is the folder that holds `out/index.html`.

```
python pptx/capture.py <deck>                                  -> <deck>/pptx/cap/  bg-NN.jpg, ref-NN.jpg, layout.json
node pptx/build_pptx.js <deck> [out.pptx]                      -> <deck>/pptx/<deck>.pptx          (still)
python pptx/capture_video.py <deck> [slide numbers] [--crf 26] -> <deck>/pptx/vid/  loop-NN.mp4, fly-NN.mp4, videos.json
powershell -File pptx/add_motion.ps1 -Deck <still.pptx> -Vid <deck>/pptx/vid -Out <motion.pptx>
powershell -File pptx/export_slides.ps1 -Deck <any.pptx> -Out <folder> -Slides "2,5,9"     (pictures to look at)
powershell -File pptx/test_show.ps1 -Deck <motion.pptx> -Slides "5,9"                      (reads PowerPoint's players)
```

`build_pptx.js` needs two environment variables: `PPTX_SKILL`, the folder of the `pptx` skill (load that skill; its
base directory is shown when it loads, and it changes between installs), and `NODE_PATH`, this skill's
`pptx/node_modules` (`npm install` inside `pptx/` if the folder is missing). Python needs `websockets` and `pillow`;
the recorder needs `ffmpeg`; the last three commands need Windows with PowerPoint.

## What to read in the output

- `capture_video.py` prints, per slide, `frame-to-frame` and `seam`: the difference between frame 0 and the frame
  after the last one, in 8-bit levels. A loop that repeats shows 0.000 to 0.012 against 0.4 to 0.8. A line marked
  `DOES NOT REPEAT` means something in `scene.js` runs on its own clock or on `Math.random()`.
- `add_motion.ps1` prints the counts and, for two slides, the bottom shapes and the effects. The two videos must be
  the bottom shapes.
- `export_slides.ps1` prints `linked=0` (every clip is inside the file) and the number of corner marks on slides.
  Open the pictures: text, callouts and the corner mark must sit above the scene.
- `test_show.ps1` runs the show in a window and prints each player's state and position: the flight runs to about
  2400 ms and stops, the loop's position wraps past its period.

Say the size before sending: 238 s of video made a 74 MB file (26 slides), 98 s made 22 MB (10 slides). E-mail and
Remote Control refuse files above 25 to 30 MiB.

## Traps that were hit

| Seen | Cause and fix |
|---|---|
| The organisation name and logo vanish on video slides | Layout shapes always lie under a slide's own shapes, so a full-slide video covers them. `build_pptx.js` therefore draws the corner mark on every slide. Found by looking at an exported picture, after a deck had already been delivered without it. |
| PowerPoint breaks a line where the browser did not | The browser balances lines (`text-wrap: pretty`); PowerPoint fills them greedily. `capture.py` forces `text-wrap: wrap` while it measures, and `extract.js` keeps `nowrap` runs together with no-break spaces. |
| Line spacing drifts in long paragraphs | "Single" spacing is the font's own line height. `extract.js` measures it in the page for the deck's two fonts. |
| Recording takes minutes per slide | Something waits on `requestAnimationFrame`; a headless page gets about one per second. Draw with `PRES3D.renderAt` and take the screenshot straight away. |
| `-Slides 9,21` arrives as 921 | `powershell -File` passes it as one token. The scripts take a string: `-Slides "9,21"`. |
| "Call was rejected by callee" | PowerPoint is busy loading the media. `test_show.ps1` waits and asks again; do the same in a new script. |
| The screen capture of the running show is a picture of another window | It grabs whatever is on screen. Judge playback from the players' numbers, and the look from exported slides. |
| A deck opens with a repair prompt after editing its XML | Folder entries in the zip, or a font reference that names the wrong script. `build_pptx.js` repacks files only and rewrites `+mj-lt` on East Asian and complex-script runs. |

## Limits to tell the user

- Going backwards replays the forward flight: the clip is recorded in one direction.
- All the text of a slide appears at once, not line by line as in the HTML.
- A short hiccup is possible when PowerPoint moves from the flight clip to the loop.
- `test_show.ps1` puts a PowerPoint window on the user's screen for about half a minute. Tell them before running it.
- The fonts are the deck's system fonts (Cambria, Segoe UI); a Mac substitutes them.
- Not tried: a right-to-left deck through `build_pptx.js` (it sets the alignment and right-to-left mode, unverified),
  PowerPoint for Mac, Keynote, Google Slides, and nobody has yet watched a full run on a presentation computer.
