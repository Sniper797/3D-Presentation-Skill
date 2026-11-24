"""Pack STL files (print files, Fusion exports) into <deck>/models.js, so that a deck shows the real parts.

    python stl2models.py <deck folder> part1.stl [part2.stl ...] [--key name1,name2]

Every model becomes window.MODELS3D[key] = { d, c, h, n }: its triangles as 16-bit numbers inside its own bounding
box, base64. That is about 24 characters per triangle (an STL in base64 would be 67) and accurate to 1/65534 of the
part's size: 0.003 mm on a 200 mm part. scene.js reads it with STAGE.stl(key, { fit: size }).
The key is the file name without .stl unless --key gives the names. Existing models in models.js are kept.

Sizes: 100,000 triangles add 2.4 MB to the deck and draw without trouble. Above 300,000, export the STL from Fusion
at a lower refinement instead of carrying detail no screen will show.
"""
import array
import base64
import json
import pathlib
import re
import struct
import sys

for _s in (sys.stdout, sys.stderr):                    # Arabic file and folder names must not crash a cp1252 console
    _s.reconfigure(encoding="utf-8", errors="replace")

argv = sys.argv[1:]
keys = None
if "--key" in argv:
    keys = argv[argv.index("--key") + 1].split(",")
    del argv[argv.index("--key"):argv.index("--key") + 2]
if len(argv) < 2:
    sys.exit(__doc__)
deck = pathlib.Path(argv[0]).resolve()
files = [pathlib.Path(a) for a in argv[1:]]
if keys and len(keys) != len(files):
    sys.exit("--key needs one name per STL file")


def triangles(path):
    """Vertex coordinates of an STL file, binary or ASCII: a flat list of 9 numbers per triangle."""
    data = path.read_bytes()
    count = struct.unpack_from("<I", data, 80)[0] if len(data) >= 84 else -1
    if count >= 0 and len(data) == 84 + 50 * count:                      # binary: the length matches its own header
        out = array.array("f")
        for i in range(count):
            out.frombytes(data[84 + 50 * i + 12:84 + 50 * i + 48])
        return list(out)
    nums = re.findall(rb"vertex\s+(\S+)\s+(\S+)\s+(\S+)", data)             # ASCII
    if not nums or len(nums) % 3:
        sys.exit(f"{path}: neither a binary nor an ASCII STL")
    return [float(v) for tri in nums for v in tri]


target = deck / "models.js"
models = {}
if target.exists():
    m = re.search(r"window\.MODELS3D\s*=\s*(\{.*\});?\s*$", target.read_text(encoding="utf-8"), flags=re.S)
    if m:
        models = json.loads(m.group(1))
for i, f in enumerate(files):
    key = keys[i] if keys else f.stem
    v = triangles(f)
    mn = [min(v[k::3]) for k in range(3)]
    mx = [max(v[k::3]) for k in range(3)]
    c = [(a + b) / 2 for a, b in zip(mn, mx)]
    h = [max((b - a) / 2, 1e-9) for a, b in zip(mn, mx)]
    q = array.array("h", (max(-32767, min(32767, round((x - c[k % 3]) / h[k % 3] * 32767))) for k, x in enumerate(v)))
    if sys.byteorder != "little":
        q.byteswap()
    models[key] = {"d": base64.b64encode(q.tobytes()).decode("ascii"), "c": [round(x, 5) for x in c], "h": [round(x, 5) for x in h], "n": len(v) // 9}
    size = [round(b - a, 2) for a, b in zip(mn, mx)]
    print(f"{key:<24} {len(v) // 9:>8,} triangles  size {size}  {len(models[key]['d']) / 1e6:.2f} MB" + ("   <- heavy: export a coarser STL" if len(v) // 9 > 300_000 else ""))
target.write_text("window.MODELS3D = " + json.dumps(models, separators=(",", ":")) + ";\n", encoding="utf-8", newline="\n")
print(f"{target}  {target.stat().st_size:,} bytes  models: {', '.join(models)}")
