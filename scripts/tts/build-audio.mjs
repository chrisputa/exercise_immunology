#!/usr/bin/env node
// Generates the read-aloud audio for every page that contains the ReadAloud
// component. Run as `npm run tts`; `npm run publish` runs it as well.
//
//   1. builds the site (skip with --skip-build) and reads each page's text with
//      the same extraction code the player uses (src/utils/tts-extract.js)
//   2. splits it into sentences; every sentence is keyed by a hash of its
//      spoken text + model + voice + speed
//   3. sentences missing from the cache are spoken by Kokoro
//      (scripts/tts/synthesize.py); everything else is reused, so editing one
//      paragraph only re-synthesises the sentences that changed
//   4. writes public/tts/<page>/<voice>.<hash>.mp3 + manifest.json (sentence
//      timings and a fingerprint of the text the audio belongs to)
//
// Files: config in tts.config.json; sentence cache in
// ~/.cache/course-tts/<package name>/ (COURSE_TTS_CACHE overrides); Python
// from the shared env ~/.local/share/course-tts/venv (COURSE_TTS_PYTHON
// overrides), created by `npm run tts:setup`.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { blocksFingerprint, extractBlocks } from '../../src/utils/tts-extract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'public', 'tts');
const args = new Set(process.argv.slice(2));

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'tts.config.json'), 'utf8'));
const pkgName = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name;
const CACHE = process.env.COURSE_TTS_CACHE || path.join(os.homedir(), '.cache', 'course-tts', pkgName);
const PYTHON = process.env.COURSE_TTS_PYTHON || path.join(os.homedir(), '.local', 'share', 'course-tts', 'venv', 'bin', 'python');
// Flags: --skip-build (reuse dist/), --dry-run (only report what would be
// spoken), --spoken (with --dry-run: list every sentence a pronunciation rule
// changes), --only <id>[,<id>…] (just these pages, e.g. for a test; nothing
// belonging to other pages is removed or pruned).
const argv = process.argv.slice(2);
const onlyArg = argv.find((a) => a.startsWith('--only='))?.slice(7) ?? argv[argv.indexOf('--only') + 1];
const ONLY = argv.some((a) => a === '--only' || a.startsWith('--only='))
    ? new Set((onlyArg ?? '').split(',').map((s) => s.trim()).filter(Boolean))
    : null;
const home = (p) => p.replace(os.homedir(), '~');

const started = Date.now();
const clock = (seconds) => {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const roughly = (seconds) =>
    seconds < 60 ? 'under a minute' : seconds < 3600 ? `~${Math.round(seconds / 60)} min` : `~${(seconds / 3600).toFixed(1)} h`;
const n = (x) => x.toLocaleString('en');

// Measured speed of earlier runs on this machine (written by synthesize.py),
// used to estimate how long the synthesis will take. 0.01 s per character is
// about what an Apple M1 does on the CPU.
const STATS = path.join(path.dirname(CACHE), 'stats.json');
let secondsPerChar = 0.01;
try {
    secondsPerChar = JSON.parse(fs.readFileSync(STATS, 'utf8')).secondsPerChar || secondsPerChar;
} catch {
    /* no earlier run */
}

function fail(msg) {
    console.error(`\n✗ Read-aloud audio: ${msg}\n`);
    process.exit(1);
}

console.log('Read-aloud audio');

const sha = (s) => createHash('sha256').update(s).digest('hex');

// ── 1. build & extract ───────────────────────────────────────────────────
if (!args.has('--skip-build')) {
    process.stdout.write('  Building the site … ');
    const t0 = Date.now();
    const r = spawnSync('npx', ['astro', 'build'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
        console.log('');
        console.error(r.stdout, r.stderr);
        fail('astro build failed.');
    }
    console.log(`done (${Math.round((Date.now() - t0) / 1000)} s)`);
}

function* htmlFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* htmlFiles(p);
        else if (entry.name === 'index.html') yield p;
    }
}

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const splitSentences = (text) =>
    Array.from(segmenter.segment(text), (s) => s.segment.trim()).filter(Boolean);

// What is read: shared with the player via the manifest, so both apply the
// same rules when computing the fingerprint.
const extractOptions = { skipSections: config.skipSections ?? [] };

// Spoken form of a sentence (the page text stays as it is): literal
// replacements first, longest first so "V̇CO₂/V̇O₂" wins over "V̇"; then the
// regex patterns in the order given.
const pronunciations = Object.entries(config.pronunciations ?? {}).sort((a, b) => b[0].length - a[0].length);
let patterns;
try {
    patterns = (config.patterns ?? []).map(([re, to]) => [new RegExp(re, 'gu'), to]);
} catch (err) {
    fail(`Invalid pattern in tts.config.json → patterns: ${err.message}`);
}
const speak = (text) => {
    let t = pronunciations.reduce((s, [from, to]) => s.split(from).join(to), text);
    for (const [re, to] of patterns) t = t.replace(re, to);
    return t.replace(/\s+/g, ' ').trim();
};

const pages = [];
for (const file of htmlFiles(DIST)) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('data-tts-id')) continue;
    const { document } = parseHTML(html);
    const widget = document.querySelector('[data-tts-id]');
    if (ONLY && !ONLY.has(widget.getAttribute('data-tts-id'))) continue;
    const root = document.querySelector(widget.getAttribute('data-tts-target'));
    if (!root) fail(`${path.relative(ROOT, file)}: element to read (data-tts-target) not found.`);
    const blocks = extractBlocks(root, extractOptions);
    const sentences = [];
    blocks.forEach((block, b) => {
        const parts = splitSentences(block.text);
        parts.forEach((text, i) => {
            const last = i === parts.length - 1;
            const pause = !last
                ? config.pauses.sentence
                : block.kind === 'heading'
                  ? config.pauses.heading
                  : config.pauses.paragraph;
            sentences.push({ b, text, spoken: speak(text), pause });
        });
    });
    pages.push({ id: widget.getAttribute('data-tts-id'), fingerprint: blocksFingerprint(blocks), blocks: blocks.length, sentences });
}
pages.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
if (ONLY) {
    const unknown = [...ONLY].filter((id) => !pages.some((p) => p.id === id));
    if (!ONLY.size || unknown.length) fail(`--only: unknown page(s): ${unknown.join(', ') || '(none given)'}`);
}

// ── 2. plan ──────────────────────────────────────────────────────────────
const sentenceKey = (voice, spoken) => sha(JSON.stringify([config.model, voice, config.speed, spoken])).slice(0, 24);
const sentenceDir = (voice) => path.join(CACHE, 'sentences', voice);
const previewDir = path.join(CACHE, 'preview');
if (!args.has('--dry-run')) fs.rmSync(previewDir, { recursive: true, force: true });

const jobs = [];
const plans = [];
const usedKeys = new Map(config.voices.map((v) => [v.id, new Set()]));

for (const page of pages) {
    const dir = path.join(OUT, page.id);
    let previous = null;
    try {
        previous = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    } catch {
        /* first run for this page */
    }
    const plan = { page, dir, voices: [] };
    for (const voice of config.voices) {
        const sentences = page.sentences.map((s) => ({ ...s, key: sentenceKey(voice.id, s.spoken) }));
        sentences.forEach((s) => usedKeys.get(voice.id).add(s.key));
        const audioHash = sha(JSON.stringify([sentences.map((s) => [s.b, s.key, s.pause]), config.mp3Quality])).slice(0, 10);
        const file = `${voice.id}.${audioHash}.mp3`;
        const reuse = previous?.voices?.find((v) => v.file === file);
        if (reuse && previous.fingerprint === page.fingerprint && fs.existsSync(path.join(dir, file))) {
            plan.voices.push({ ...reuse, label: voice.label, status: 'unchanged' });
            continue;
        }
        const seen = new Set();
        const missing = sentences.filter((s) => {
            if (seen.has(s.key) || fs.existsSync(path.join(sentenceDir(voice.id), `${s.key}.flac`))) return false;
            seen.add(s.key);
            return true;
        });
        const preview = missing.length ? path.join(previewDir, `${page.id}.${voice.id}.mp3`) : null;
        jobs.push({
            lecture: page.id,
            voice: voice.id,
            speed: config.speed,
            cacheDir: sentenceDir(voice.id),
            out: path.join(dir, file),
            mp3Quality: config.mp3Quality,
            preview: previous ? preview : null, // a first run would just duplicate the lecture
            sentences: sentences.map(({ key, pause }) => ({ key, pause })),
            missing: missing.map(({ key, spoken }) => ({ key, spoken }))
        });
        plan.voices.push({ id: voice.id, label: voice.label, file, status: 'build', missing, total: sentences.length, firstRun: !previous, preview: previous ? preview : null });
    }
    plans.push(plan);
}

if (args.has('--dry-run')) {
    if (args.has('--spoken')) {
        console.log('\nSentences changed by pronunciation rules (text → spoken):');
        for (const page of pages) {
            for (const s of page.sentences) if (s.spoken !== s.text) console.log(`  [${page.id}] ${s.text}\n      → ${s.spoken}`);
        }
    }
    console.log('\nDry run, nothing is generated:');
    for (const { page, voices } of plans) {
        for (const v of voices) {
            const what = v.status === 'unchanged' ? 'unchanged' : `${n(v.missing.length)} sentences to speak`;
            console.log(`  ${page.id.padEnd(14)} ${v.id.padEnd(11)} ${what}`);
        }
    }
    const chars = jobs.reduce((c, j) => c + j.missing.reduce((k, s) => k + s.spoken.length, 0), 0);
    if (chars) console.log(`  Estimated time: ${roughly(chars * secondsPerChar)}`);
    process.exit(0);
}

// ── 3. synthesise ────────────────────────────────────────────────────────
let results = new Map();
if (jobs.length) {
    const total = jobs.reduce((k, j) => k + j.missing.length, 0);
    const chars = jobs.reduce((c, j) => c + j.missing.reduce((k, s) => k + s.spoken.length, 0), 0);
    if (total > 0 && !fs.existsSync(PYTHON)) {
        fail(`${n(total)} sentences need to be spoken, but the Kokoro environment is missing (${home(PYTHON)}).\n  Set it up once with:  npm run tts:setup`);
    }
    const pagesToDo = new Set(jobs.filter((j) => j.missing.length).map((j) => j.lecture)).size;
    if (total > 0) {
        console.log(`  ${n(total)} ${total === 1 ? 'sentence' : 'sentences'} to speak in ${pagesToDo} ${pagesToDo === 1 ? 'page' : 'pages'}` +
            ` (${config.voices.map((v) => v.id).join(', ')}) — estimated ${roughly(chars * secondsPerChar)}.` +
            ' Interrupting with Ctrl+C is safe: spoken sentences are kept.');
    } else {
        console.log('  Nothing new to speak, reassembling from cached sentences …');
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-tts-'));
    const jobFile = path.join(tmp, 'jobs.json');
    const resultFile = path.join(tmp, 'results.json');
    fs.writeFileSync(jobFile, JSON.stringify({ jobs, statsFile: STATS, secondsPerChar }));
    const python = fs.existsSync(PYTHON) ? PYTHON : 'python3';
    const r = spawnSync(python, [path.join(ROOT, 'scripts', 'tts', 'synthesize.py'), jobFile, resultFile], {
        cwd: ROOT,
        stdio: ['ignore', 'inherit', 'pipe'],
        encoding: 'utf8'
    });
    if (r.status === 130 || r.signal === 'SIGINT') {
        fs.rmSync(tmp, { recursive: true, force: true });
        process.exit(130);
    }
    if (r.status !== 0) {
        console.error(r.stderr);
        fail('Speech synthesis failed. Sentences spoken so far stay cached; running again continues from there.');
    }
    for (const res of JSON.parse(fs.readFileSync(resultFile, 'utf8')).results) {
        results.set(`${res.lecture}|${res.voice}`, res);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 4. manifests, cleanup, report ────────────────────────────────────────
const report = [];
for (const { page, dir, voices } of plans) {
    fs.mkdirSync(dir, { recursive: true });
    const manifest = {
        version: 1,
        extract: extractOptions,
        fingerprint: page.fingerprint,
        blocks: page.blocks,
        sentences: page.sentences.map((s) => s.b),
        voices: voices.map((v) => {
            const res = results.get(`${page.id}|${v.id}`);
            return {
                id: v.id,
                label: v.label,
                file: v.file,
                duration: res ? res.duration : v.duration,
                timings: res ? res.timings : v.timings
            };
        })
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    const keep = new Set(['manifest.json', ...voices.map((v) => v.file)]);
    for (const f of fs.readdirSync(dir)) if (!keep.has(f)) fs.rmSync(path.join(dir, f));

    for (const v of voices) {
        if (v.status === 'unchanged') {
            report.push(`  ${page.id.padEnd(14)} ${v.id.padEnd(11)} unchanged`);
        } else if (v.firstRun) {
            const fresh = v.missing.length < v.total ? `, ${n(v.missing.length)} of them newly spoken` : '';
            report.push(`  ${page.id.padEnd(14)} ${v.id.padEnd(11)} created (${n(v.total)} sentences${fresh})`);
        } else if (!v.missing.length) {
            report.push(`  ${page.id.padEnd(14)} ${v.id.padEnd(11)} reassembled from cached sentences`);
        } else {
            report.push(`  ${page.id.padEnd(14)} ${v.id.padEnd(11)} ${n(v.missing.length)} ${v.missing.length === 1 ? 'sentence' : 'sentences'} newly spoken`);
            for (const s of v.missing.slice(0, 8)) {
                const t = s.text.length > 90 ? `${s.text.slice(0, 87)}…` : s.text;
                report.push(`      + “${t}”`);
            }
            if (v.missing.length > 8) report.push(`      … and ${n(v.missing.length - 8)} more`);
            report.push(`      Listen to just these: ${home(v.preview)}`);
        }
    }
}

// Pages that no longer carry the player lose their audio.
const live = new Set(pages.map((p) => p.id));
if (!ONLY && fs.existsSync(OUT)) {
    for (const entry of fs.readdirSync(OUT, { withFileTypes: true })) {
        const d = entry.name;
        // Only page folders; leave stray files such as macOS's .DS_Store alone.
        if (entry.isDirectory() && !d.startsWith('.') && !live.has(d)) {
            fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
            report.push(`  ${d.padEnd(14)} removed (page no longer has a read-aloud player)`);
        }
    }
}

// Drop cached sentences nothing refers to any more (old wording, old voices).
let pruned = 0;
const sentencesRoot = path.join(CACHE, 'sentences');
if (!ONLY && fs.existsSync(sentencesRoot)) {
    for (const voiceDir of fs.readdirSync(sentencesRoot)) {
        const used = usedKeys.get(voiceDir);
        const full = path.join(sentencesRoot, voiceDir);
        if (!used) {
            pruned += fs.readdirSync(full).length;
            fs.rmSync(full, { recursive: true, force: true });
            continue;
        }
        for (const f of fs.readdirSync(full)) {
            if (!used.has(f.replace(/\.flac(\.part)?$/, ''))) {
                fs.rmSync(path.join(full, f));
                pruned++;
            }
        }
    }
}

// Keep an already built dist/ in step, so `npm run preview` plays the new audio.
if (fs.existsSync(DIST)) {
    fs.rmSync(path.join(DIST, 'tts'), { recursive: true, force: true });
    if (fs.existsSync(OUT)) fs.cpSync(OUT, path.join(DIST, 'tts'), { recursive: true });
}

console.log(`\nSummary (${config.voices.map((v) => v.id).join(', ')}):`);
console.log(report.join('\n'));
if (pruned) console.log(`  ${n(pruned)} cached sentences no longer used were deleted`);
console.log(`Done in ${clock((Date.now() - started) / 1000)}.\n`);
