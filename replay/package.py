"""Build the replay into one tarball for `scp`, and refuse to build a leaky one.

    python replay/package.py      # -> replay/dist/pulsemind-replay-<bundle>.tar.gz + .sha256

1. Builds the SvelteKit UI with the replay flags and asserts `_app/env.js` carries them
   exactly. The flags are baked in at build time and a wrong one fails silently: an
   unrecognised data source renders the 30-patient fixture set perfectly. Set from
   here, not from Git Bash, which rewrote `/api` into `C:/Program Files/Git/api` on
   its way to a Windows program -- the assertion caught exactly that.
2. Assembles the server, its scripts, the bundle and the UI.
3. Scans every file, gzip contents included, with checks/secrets_gate.py's patterns and
   the live values in back-end/.env, and refuses .env / .csv / .parquet outright.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
FRONT_END = DEMO.parent / "frontend-and-backend-FINAL" / "front-end"
DIST = HERE / "dist"

sys.path.insert(0, str(DEMO / "checks"))
from secrets_gate import CREDENTIALED, live_secrets, scan  # noqa: E402

FLAGS = {
    "PUBLIC_PULSEMIND_DATA_SOURCE": "pulsemind",
    "PUBLIC_PULSEMIND_API_BASE": "/api",
    "PUBLIC_PULSEMIND_DEMO_CONTROLS": "true",
    "PUBLIC_PULSEMIND_REQUIRE_AUTH": "false",
    "PUBLIC_PULSEMIND_REPLAY": "true",
}
SCRIPTS = ("server.py", "run.sh", "stop.sh", "tunnel.sh", "README.md")
EXECUTABLE = ("run.sh", "stop.sh", "tunnel.sh", "server.py")


def build_ui() -> Path:
    env = {**os.environ, **FLAGS}
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise SystemExit("pnpm not found")
    print("building the UI with the replay flags ...")
    done = subprocess.run(f'"{pnpm}" build', cwd=FRONT_END, env=env, shell=True,
                          capture_output=True, text=True)
    if done.returncode:
        raise SystemExit(f"pnpm build failed:\n{done.stdout[-2000:]}\n{done.stderr[-2000:]}")
    build = FRONT_END / "build"
    baked = dict(re.findall(r'(\w+):"((?:[^"\\]|\\.)*)"',
                            (build / "_app" / "env.js").read_text(encoding="utf-8")))
    wrong = {k: (v, baked.get(k)) for k, v in FLAGS.items() if baked.get(k) != v}
    if wrong:
        raise SystemExit(f"_app/env.js does not carry the replay flags: {wrong}")
    print(f"  env.js carries all {len(FLAGS)} flags exactly")
    return build


def check_bundle(partial: bool) -> dict:
    manifest = json.loads((HERE / "bundle" / "manifest.json").read_text(encoding="utf-8"))
    hours = manifest["hours"]
    for n in range(hours + 1):
        if not (HERE / "bundle" / "hours" / f"h{n:02d}.json.gz").exists():
            raise SystemExit(f"bundle is missing hour {n}: run record.py reads")
    beds = json.loads(gzip.decompress(
        (HERE / "bundle" / "hours" / "h00.json.gz").read_bytes()))["patients"].keys()
    missing = [(b, n) for b in beds for n in range(hours + 1)
               if not (HERE / "bundle" / "explanations" / b / f"h{n:02d}.json.gz").exists()]
    if missing and not partial:
        raise SystemExit(f"{len(missing)} explanations missing, e.g. {missing[:3]}: "
                         "run record.py explanations, or --partial to stage without them")
    if missing:
        print(f"  PARTIAL: {len(missing)} explanations missing; Generate answers 503 for them")
    for rel, digest in manifest["files"].items():
        actual = hashlib.sha256((HERE / "bundle" / rel).read_bytes()).hexdigest()
        if actual != digest:
            raise SystemExit(f"bundle/{rel} does not match its manifest digest")
    return manifest


def members(build: Path):
    """(archive name, bytes) for everything that ships."""
    for name in SCRIPTS:
        data = (HERE / name).read_bytes()
        if name.endswith(".sh"):
            data = data.replace(b"\r\n", b"\n")  # a CRLF shebang line does not run
        yield name, data
    for path in sorted((HERE / "bundle").rglob("*")):
        if path.is_file():
            yield "bundle/" + path.relative_to(HERE / "bundle").as_posix(), path.read_bytes()
    for path in sorted(build.rglob("*")):
        if path.is_file():
            yield "ui/" + path.relative_to(build).as_posix(), path.read_bytes()


def leaks(name: str, data: bytes, secrets: list) -> list:
    base = name.rsplit("/", 1)[-1]
    if base == ".env" or base.endswith(".env") or CREDENTIALED.search(name):
        return [f"{name}: refused by name"]
    text = gzip.decompress(data) if name.endswith(".gz") else data
    return [f"{name}: {finding}" for finding in scan(text.decode("utf-8", "ignore"), secrets)]


def main() -> None:
    partial = "--partial" in sys.argv[1:]
    manifest = check_bundle(partial)
    build = build_ui()
    secrets = live_secrets()
    files = list(members(build))
    problems = [p for name, data in files for p in leaks(name, data, secrets)]
    if problems:
        raise SystemExit("REFUSED, would ship:\n  " + "\n  ".join(problems))
    print(f"  scanned {len(files)} files against {len(secrets)} live .env value(s): clean")

    DIST.mkdir(exist_ok=True)
    stamp = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()[:10]
    target = DIST / f"pulsemind-replay-{stamp}{'-partial' if partial else ''}.tar.gz"
    with tarfile.open(target, "w:gz") as tar:
        for name, data in files:
            info = tarfile.TarInfo(f"pulsemind-replay/{name}")
            info.size = len(data)
            info.mode = 0o755 if name in EXECUTABLE else 0o644
            info.mtime = 0
            tar.addfile(info, io.BytesIO(data))
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    (DIST / (target.name + ".sha256")).write_text(f"{digest}  {target.name}\n", encoding="utf-8")
    size = target.stat().st_size / 1e6
    print(f"{target.relative_to(DEMO)}  {size:.1f} MB  sha256 {digest[:16]}")


if __name__ == "__main__":
    main()
