#!/usr/bin/env bash
# One-time setup of the Python environment for the read-aloud audio (Kokoro).
# It is shared by all course repos on this machine and lives outside Dropbox:
#   ~/.local/share/course-tts/venv        (override: COURSE_TTS_VENV)
# Kokoro needs Python 3.10–3.12; the first suitable interpreter found is used.
set -euo pipefail

VENV="${COURSE_TTS_VENV:-$HOME/.local/share/course-tts/venv}"

find_python() {
    local candidates=()
    for v in 3.12 3.11 3.10; do
        candidates+=("python$v" "/opt/homebrew/bin/python$v")
        for p in "$HOME"/.pyenv/versions/$v*/bin/python; do candidates+=("$p"); done
    done
    candidates+=(python3)
    for c in "${candidates[@]}"; do
        if command -v "$c" >/dev/null 2>&1 &&
            "$c" -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)' 2>/dev/null; then
            echo "$c"
            return 0
        fi
    done
    return 1
}

if [ -x "$VENV/bin/python" ] && "$VENV/bin/python" -c 'import kokoro, soundfile' 2>/dev/null; then
    echo "Kokoro environment already set up: $VENV"
else
    PY="$(find_python)" || {
        echo "No Python 3.10–3.12 found. Install one, e.g.:  brew install python@3.12" >&2
        exit 1
    }
    echo "Setting up the Kokoro environment with $("$PY" --version) → $VENV"
    mkdir -p "$(dirname "$VENV")"
    "$PY" -m venv "$VENV"
    "$VENV/bin/pip" install --quiet --upgrade pip
    "$VENV/bin/pip" install --quiet "kokoro>=0.9.4,<1" soundfile
fi

# Fetch the model, voices and English language data once, so the first real
# run doesn't stall on downloads.
echo "Downloading model and language data (once, about 350 MB) …"
"$VENV/bin/python" - <<'EOF'
import warnings; warnings.filterwarnings("ignore")
from kokoro import KPipeline
for lang, voice in (("a", "af_heart"), ("b", "bf_emma")):
    p = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
    for _ in p("Ready.", voice=voice): pass
print("Kokoro is ready.")
EOF
