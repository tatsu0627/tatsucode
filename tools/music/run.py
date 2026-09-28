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
try:
    client = Client(SPACE)
    job = client.submit(state, 280, 42, False, 0, 24, 1.7, api_name="/studio_generate")
    last = None
    for update in job:
        last = update
        log.write(json.dumps(update, default=str)[:400] + "\n")
        log.flush()
    outs = job.outputs()
    log.write("final outputs: " + json.dumps(outs[-1] if outs else None, default=str)[:2000] + "\n")
    wav = None
    for o in reversed(outs):
        for item in (o if isinstance(o, (list, tuple)) else [o]):
            p = item.get("path") if isinstance(item, dict) else item
            if isinstance(p, str) and os.path.exists(p) and p.lower().endswith((".wav", ".mp3", ".flac")):
                wav = p
                break
        if wav:
            break
    if not wav:
        raise RuntimeError("no audio file in outputs")
    shutil.copy(wav, f"{OUT}/minimax-acoustic{os.path.splitext(wav)[1]}")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-codec:a", "libmp3lame",
                    "-b:a", "256k", f"{OUT}/minimax-acoustic.mp3"], check=True)
    log.write("OK\n")
except Exception:
    log.write(traceback.format_exc())
log.close()
