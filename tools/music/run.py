"""Probe the MiniMax Music 3 Space: dump its API and app source."""
import os
from gradio_client import Client
from huggingface_hub import hf_hub_download

OUT = "docs/reference/generated"
os.makedirs(OUT, exist_ok=True)
SPACE = "MiniMaxAI/MiniMax-Music3"

with open(f"{OUT}/probe.txt", "w") as f:
    try:
        c = Client(SPACE)
        info = c.view_api(return_format="dict", print_info=False)
        import json
        f.write(json.dumps(info, indent=1, default=str)[:60000])
    except Exception as e:
        f.write(f"client error: {e!r}\n")
for name in ["app.py", "README.md"]:
    try:
        p = hf_hub_download(SPACE, name, repo_type="space")
        with open(p) as src, open(f"{OUT}/space_{name}.txt", "w") as dst:
            dst.write(src.read())
    except Exception as e:
        with open(f"{OUT}/probe.txt", "a") as f:
            f.write(f"\n{name}: {e!r}\n")
