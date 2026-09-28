"""Generate an acoustic guitar-and-vocal version with the MiniMax Music 3 Space."""
import json
import os
import shutil
import subprocess
import traceback

from gradio_client import Client

OUT = "docs/reference/generated"
os.makedirs(OUT, exist_ok=True)
SPACE = "MiniMaxAI/MiniMax-Music3"
HERE = os.path.dirname(os.path.abspath(__file__))

GLOBAL_META = (
    "Basic Attributes: bpm is 117. key is C, and scale is major. Acoustic Singer-Songwriter / Indie Folk. "
    "Global Emotional Progression: A nervous, wry confession that slowly turns into awe. The verses are "
    "hushed and conversational, the choruses open up with warm, anxious urgency, the bridge argues and "
    "drives, a quiet breakdown hangs in suspense, and the final chorus is the fullest and most exposed "
    "moment before the outro falls back to a whisper and ends on an unresolved question. "
    "Application Scenarios & Imagery: one person with a guitar in a small wooden room late at night, "
    "a desk lamp over pages of matrix math. Sonics & Production Profile: intimate, organic, close-miked "
    "recording with natural room ambience, warm and uncompressed, no electronic elements."
)
VOCALS = (
    "Vocal Gender & Timbre: Singer A (Male), a warm, slightly husky baritone with a gentle, honest tone. "
    "Vocal Style: soft and close in the verses, almost spoken; the choruses rise with earnest, slightly "
    "strained urgency; the bridge is rhythmic and insistent; the breakdown is fragile and quiet; the final "
    "chorus is full-voiced and emotional; the outro lines are half-whispered. Harmony/Backing Vocals: none "
    "until the final chorus, where a soft high harmony doubles the lead. Vocal FX: light natural room "
    "reverb only."
)
ARRANGEMENT = (
    "Instrument Lifecycle Description (Primary/Secondary Layering): Primary: a single steel-string acoustic "
    "guitar carries the whole song. Fingerpicked arpeggios with a walking bass line in the intro and verses; "
    "warm open strumming in the choruses; tight palm-muted eighth notes in the first half of the bridge that "
    "open into full strumming; single sustained chords left ringing in the breakdown; gentle fingerpicking "
    "again in the outro, ending on a long ringing Cmaj7. Secondary: none. Groove & Foundation Progression: "
    "no drums, no bass, no percussion; the pulse comes only from the guitar and the voice. "
    "Embellishments, Textures & Spatial FX: audible finger slides and string noise, soft room reverb."
)

with open(os.path.join(HERE, "lyrics.txt")) as f:
    LYRICS = f.read().strip()

state = {
    "mode": "studio",
    "description": "Stripped-back acoustic guitar and voice version of a nerdy, anxious song about linear algebra.",
    "instrumental": False,
    "title": "I Am Actually Scared of Linear Algebra (Acoustic)",
    "lyrics": LYRICS,
    "global_meta": GLOBAL_META,
    "vocals": VOCALS,
    "arrangement": ARRANGEMENT,
}

log = open(f"{OUT}/minimax-log.txt", "w")


def attempt(lyrics, duration, steps):
    client = Client(SPACE)
    st = dict(state, lyrics=lyrics)
    job = client.submit(st, duration, 42, False, 0, steps, 1.7, api_name="/studio_generate")
    for update in job:
        log.write(json.dumps(update, default=str)[:300] + "\n")
        log.flush()
    log.write(f"status: {job.status()}\n")
    exc = job.exception() if hasattr(job, "exception") else None
    if exc:
        raise exc
    for o in reversed(job.outputs()):
        for item in (o if isinstance(o, (list, tuple)) else [o]):
            p = item.get("path") if isinstance(item, dict) else item
            if isinstance(p, str) and os.path.exists(p) and p.lower().endswith((".wav", ".mp3", ".flac")):
                return p
    raise RuntimeError("no audio file in outputs")


# One call is capped at roughly 216-260 GPU-seconds, about 100 s of audio at
# 30 steps, so render the song in four sections with the same prompt and seed
# and join them with short crossfades after trimming edge silence.
def split_points(text):
    idx, pos = [], 0
    for tag, nth in [("[verse]", 2), ("[bridge]", 1), ("[pre-chorus]", 1)]:
        at = -1
        for _ in range(nth):
            at = text.index(tag, at + 1)
        idx.append(at)
    return idx


a, b, c = split_points(LYRICS)
parts = [LYRICS[:a], LYRICS[a:b], LYRICS[b:c], LYRICS[c:]]
TRIM = ("silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB,areverse")

# The anonymous ZeroGPU quota covers about one section per day, so each run
# renders only the sections still missing and stitches once all four exist.
for i, lyr in enumerate(parts, 1):
    dst = f"{OUT}/minimax-part{i}.mp3"
    if os.path.exists(dst):
        continue
    log.write(f"=== part {i}\n")
    try:
        wav = attempt(lyr.strip(), 80, 20)
    except Exception:
        log.write(traceback.format_exc() + "\n")
        break
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-af", TRIM, "-ar", "44100",
                    "-ac", "2", "-codec:a", "libmp3lame", "-b:a", "256k", dst], check=True)
    log.write(f"OK part {i}\n")

done = [f"{OUT}/minimax-part{i}.mp3" for i in range(1, 5) if os.path.exists(f"{OUT}/minimax-part{i}.mp3")]
log.write(f"parts rendered: {len(done)}/4\n")
if len(done) == 4:
    inputs, chain, label = [], "", "[0:a]"
    for f in done:
        inputs += ["-i", f]
    for k in range(1, 4):
        chain += f"{label}[{k}:a]acrossfade=d=1:c1=tri:c2=tri[x{k}];"
        label = f"[x{k}]"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", chain.rstrip(";"),
                    "-map", label, "-codec:a", "libmp3lame", "-b:a", "256k",
                    f"{OUT}/minimax-acoustic.mp3"], check=True)
    log.write("stitched minimax-acoustic.mp3\n")
log.close()
