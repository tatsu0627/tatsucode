"""Find the Space's per-call GPU cap: first request that passes the check is cancelled."""
import os, time
from gradio_client import Client
OUT = "docs/reference/generated"
os.makedirs(OUT, exist_ok=True)
state = {"mode": "studio", "description": "x", "instrumental": False, "title": "probe",
         "lyrics": "[verse]\nla la la\n", "global_meta": "Basic Attributes: bpm is 117.", "vocals": "", "arrangement": ""}
with open(f"{OUT}/cap-probe.txt", "w") as log:
    for d in [120, 100, 80, 60, 45, 30, 20, 10]:
        c = Client("MiniMaxAI/MiniMax-Music3")
        job = c.submit(state, d, 1, False, 0, 4, 1.7, api_name="/studio_generate")
        msg = "passed"
        try:
            for u in job:
                if "acquired" in str(u).lower():
                    break
            exc = job.exception() if job.done() else None
            if exc:
                msg = repr(exc)[:200]
        except Exception as e:
            msg = repr(e)[:200]
        job.cancel()
        log.write(f"duration={d}: {msg}\n"); log.flush()
        if msg == "passed":
            break
