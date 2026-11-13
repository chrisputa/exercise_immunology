"""Kokoro worker for scripts/tts/build-audio.mjs — not meant to be run by hand.

Reads a job file (JSON) listing, per lecture and voice, the sentences to read
in order. Sentences not yet in the cache are synthesised (one FLAC per
sentence, named by a hash of text + voice + settings), then each lecture is
assembled into one constant-bitrate MP3 with pauses between sentences, and the
start/end time of every sentence is written back for highlighting.

Constant bitrate matters: browsers seek VBR MP3s only approximately, which
would put the highlight out of step with the voice.

Progress goes to stdout: a single self-updating line in a terminal, a line
every few percent otherwise (logs, CI). The measured speed is written to the
stats file so the next run can estimate its duration up front.
"""

import json
import os
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

SR = 24000  # Kokoro's output rate
TTY = sys.stdout.isatty()

_pipelines = {}


def pipeline(voice: str):
    # Voice ids encode the language: 'a…' US English, 'b…' British English.
    lang = voice[0]
    if lang not in _pipelines:
        from kokoro import KPipeline

        _pipelines[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
    return _pipelines[lang]


def synthesise(text: str, voice: str, speed: float) -> np.ndarray:
    parts = [r.audio.numpy() for r in pipeline(voice)(text, voice=voice, speed=speed) if r.audio is not None]
    if not parts:  # nothing pronounceable (e.g. only symbols): keep a short silence
        return np.zeros(int(0.1 * SR), dtype=np.float32)
    return np.concatenate(parts).astype(np.float32)


def write_mp3(path: Path, audio: np.ndarray, quality: float):
    tmp = path.with_name(path.name + ".part")
    sf.write(tmp, audio, SR, format="MP3", subtype="MPEG_LAYER_III", bitrate_mode="CONSTANT", compression_level=quality)
    tmp.replace(path)


def clock(seconds: float) -> str:
    s = max(0, int(round(seconds)))
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def roughly(seconds: float) -> str:
    if seconds < 60:
        return "< 1 min"
    if seconds < 3600:
        return f"~{round(seconds / 60)} min"
    return f"~{seconds / 3600:.1f} h"


class Progress:
    """Sentences done/total, weighted by characters for the time estimate."""

    def __init__(self, total_sentences: int, total_chars: int, seconds_per_char: float):
        self.total_s, self.total_c = total_sentences, total_chars
        self.done_s = self.done_c = 0
        self.guess = seconds_per_char  # from earlier runs, until we have our own numbers
        self.start = time.time()
        self.synth_time = 0.0  # time spent speaking only (no loading, no MP3 encoding)
        self.label = ""
        self.last_print = 0.0
        self.last_pct = -1

    def advance(self, chars: int, seconds: float):
        self.done_s += 1
        self.done_c += chars
        self.synth_time += seconds

    def seconds_per_char(self):
        # Trust our own measurement once there is enough of it.
        if self.done_c >= 1500 or self.synth_time >= 20:
            return self.synth_time / max(self.done_c, 1)
        return self.guess

    def remaining(self):
        return (self.total_c - self.done_c) * self.seconds_per_char()

    def line(self, note=""):
        pct = self.done_c / self.total_c if self.total_c else 1
        width = 24
        filled = int(pct * width)
        bar = "█" * filled + "░" * (width - filled)
        what = note or self.label
        return (f"  {bar} {pct * 100:3.0f}%  {self.done_s:,}/{self.total_s:,} sentences  "
                f"{what}  ·  {clock(time.time() - self.start)} elapsed, {roughly(self.remaining())} left")

    def show(self, note="", force=False):
        now = time.time()
        if TTY:
            if force or now - self.last_print >= 0.25:
                sys.stdout.write("\r\x1b[2K" + self.line(note))
                sys.stdout.flush()
                self.last_print = now
        else:
            pct = int(self.done_c / self.total_c * 20) * 5 if self.total_c else 100
            if force or pct != self.last_pct or now - self.last_print >= 60:
                print(self.line(note), flush=True)
                self.last_pct, self.last_print = pct, now

    def message(self, text):
        """A permanent line above the progress line."""
        if TTY:
            sys.stdout.write("\r\x1b[2K")
        print(text, flush=True)
        if TTY and self.done_s < self.total_s:
            self.show(force=True)


def main():
    spec = json.loads(Path(sys.argv[1]).read_text())
    jobs = spec["jobs"]
    stats_file = Path(spec["statsFile"])
    total_s = sum(len(j["missing"]) for j in jobs)
    total_c = sum(len(s["spoken"]) for j in jobs for s in j["missing"])
    progress = Progress(total_s, total_c, spec["secondsPerChar"])
    results = []

    if total_s:
        print("  Loading Kokoro …", flush=True)
        for voice in {j["voice"] for j in jobs if j["missing"]}:
            pipeline(voice)

    try:
        for job in jobs:
            voice, speed = job["voice"], job["speed"]
            cache = Path(job["cacheDir"])
            cache.mkdir(parents=True, exist_ok=True)
            progress.label = f"{job['lecture']} · {voice}"

            for s in job["missing"]:
                target = cache / f"{s['key']}.flac"
                if not target.exists():  # the same sentence may occur twice in one run
                    t0 = time.time()
                    audio = synthesise(s["spoken"], voice, speed)
                    tmp = target.with_name(target.name + ".part")
                    sf.write(tmp, audio, SR, format="FLAC", subtype="PCM_16")
                    tmp.replace(target)
                    progress.advance(len(s["spoken"]), time.time() - t0)
                else:
                    progress.advance(len(s["spoken"]), 0.0)
                progress.show()

            # Assemble the lecture and record where each sentence sits.
            if total_s:
                progress.show(f"{job['lecture']} · {voice}: writing MP3", force=True)
            parts, timings, t = [], [], 0
            for s in job["sentences"]:
                audio, _ = sf.read(cache / f"{s['key']}.flac", dtype="float32")
                timings.append([round(t / SR, 3), round((t + len(audio)) / SR, 3)])
                parts.append(audio)
                t += len(audio)
                gap = int(s["pause"] * SR)
                parts.append(np.zeros(gap, dtype=np.float32))
                t += gap
            Path(job["out"]).parent.mkdir(parents=True, exist_ok=True)
            write_mp3(Path(job["out"]), np.concatenate(parts), job["mp3Quality"])

            # Just the new sentences, back to back, for a quick listen.
            if job.get("preview") and job["missing"]:
                gap = np.zeros(int(0.8 * SR), dtype=np.float32)
                clips = []
                for s in job["missing"]:
                    clips += [sf.read(cache / f"{s['key']}.flac", dtype="float32")[0], gap]
                Path(job["preview"]).parent.mkdir(parents=True, exist_ok=True)
                write_mp3(Path(job["preview"]), np.concatenate(clips), job["mp3Quality"])

            new = len(job["missing"])
            progress.message(f"  ✓ {job['lecture']} · {voice}: {len(job['sentences'])} sentences"
                             f" ({new} newly spoken), {clock(t / SR)} of audio")
            results.append({"lecture": job["lecture"], "voice": voice, "timings": timings, "duration": round(t / SR, 3)})
    except KeyboardInterrupt:
        if TTY:
            sys.stdout.write("\r\x1b[2K")
        print(f"\n  Interrupted after {progress.done_s:,} of {total_s:,} sentences. They are cached; "
              "running again continues from there.", flush=True)
        save_stats(stats_file, progress)
        sys.exit(130)

    if TTY and total_s:
        sys.stdout.write("\r\x1b[2K")
        sys.stdout.flush()
    save_stats(stats_file, progress)
    Path(sys.argv[2]).write_text(json.dumps({"results": results}))


def save_stats(stats_file: Path, progress: Progress):
    # Only a run that spoke enough text gives a meaningful speed.
    if progress.done_c < 1500:
        return
    try:
        stats_file.parent.mkdir(parents=True, exist_ok=True)
        stats_file.write_text(json.dumps({"secondsPerChar": progress.synth_time / progress.done_c}))
    except OSError:
        pass


if __name__ == "__main__":
    main()
