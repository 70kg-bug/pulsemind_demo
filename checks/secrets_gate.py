"""Would a push leak a secret, or credentialed data? Run before every push.

Both repositories are public and the model was trained on MIMIC-IV under a
PhysioNet DUA, so two different things must never be committed: credentials, and
anything patient-derived.

This script contains no secret of its own. The live values are read out of
`back-end/.env` at runtime -- that file is gitignored, and hardcoding a password
into the tool that checks for leaked passwords would be self-defeating.

    python checks/secrets_gate.py          # exits non-zero if anything would leak
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent

# Shapes that are a credential regardless of value.
PATTERNS = [
    (r"mongodb(\+srv)?://[^\s\"']+", "a MongoDB connection string"),
    (r"\bsk-[A-Za-z0-9]{20,}", "an API key"),
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "a private key"),
    (r"\bAKIA[0-9A-Z]{16}\b", "an AWS access key id"),
]

# A file may name a variable without holding its value.
NAME_ONLY = re.compile(r"MONGODB_URI|MODEL_SERVICE_URL|<username>|<password>")

# Anything patient-shaped. The ward is manufactured, so a CSV or parquet landing
# here is either a mistake or a DUA breach.
CREDENTIALED = re.compile(r"\.(csv|parquet)$|df_imputed|risk_records|chartevents|-query\.csv", re.I)


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True,
                          text=True).stdout


# A variable is a secret because of what it is, not because it is in .env.
# MODEL_SERVICE_URL and PORT live there too and are not secrets -- treating them
# as such makes the gate cry wolf on .env.example and on ordinary config.
SECRET_NAME = re.compile(r"SECRET|TOKEN|PASSWORD|PASSWD|_KEY|APIKEY|CREDENTIAL|URI$",
                         re.I)


def live_secrets() -> list[str]:
    """The actual values from .env, so tracked files can be grepped by content."""
    env = REPO / "back-end" / ".env"
    if not env.exists():
        return []
    found = []
    for line in env.read_text(encoding="utf-8").splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        name, value = (part.strip() for part in line.split("=", 1))
        value = value.strip("'\"")
        if len(value) < 8:
            continue
        # Embedded userinfo makes any URI a credential, whatever it is called.
        userinfo = re.search(r"//[^:/]+:([^@]+)@", value)
        if not (SECRET_NAME.search(name) or userinfo):
            continue
        found.append(value)
        if userinfo:
            # Worth searching for on its own: a password can be pasted somewhere
            # without the connection string around it.
            found.append(userinfo.group(1))
    return found


def placeholder(uri: str) -> bool:
    """USER:PASSWORD@CLUSTER is documentation; user:hunter2@cluster0 is not."""
    userinfo = re.search(r"//([^@/]+)@", uri)
    return bool(userinfo and re.fullmatch(r"[A-Z_<>{}\[\]]+:[A-Z_<>{}\[\]]+",
                                          userinfo.group(1)))


def main() -> None:
    failures: list[str] = []
    tracked = [f for f in git("ls-files").splitlines() if f.strip()]
    secrets = live_secrets()
    print(f"{len(tracked)} tracked files; "
          f"{len(secrets)} live value(s) read from .env to search for")

    for relative in tracked:
        path = REPO / relative
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        for value in secrets:
            if value in text:
                failures.append(f"{relative} contains a LIVE value from .env")

        lines = text.splitlines()
        for pattern, what in PATTERNS:
            for match in re.finditer(pattern, text):
                n = text[:match.start()].count("\n")
                context = lines[n] if n < len(lines) else ""
                token = match.group(0)
                if NAME_ONLY.search(context) and "://" not in token:
                    continue
                if token.startswith("mongodb") and placeholder(token):
                    continue
                failures.append(f"{relative}:{n + 1} {what}")

    if not failures:
        print("  [PASS] no credential in any tracked file")

    forbidden = [f for f in tracked if CREDENTIALED.search(f)]
    if forbidden:
        failures += [f"{f} is patient-shaped and tracked" for f in forbidden]
    else:
        print("  [PASS] nothing CSV, parquet or record-shaped is tracked")

    env = (REPO / "back-end" / ".env").relative_to(REPO).as_posix()
    if (REPO / env).exists():
        ignored = subprocess.run(["git", "check-ignore", "-q", env],
                                 cwd=REPO).returncode == 0
        if not (ignored and env not in tracked):
            failures.append(f"{env} is not properly ignored")
        else:
            print(f"  [PASS] {env} is ignored and untracked")

    for value in secrets:
        if git("log", "--all", "-S", value, "--oneline").strip():
            failures.append("a live .env value appears in git history")
            break
    else:
        if secrets:
            print("  [PASS] no live value appears in any commit")

    if failures:
        print("\nGATE FAILED:")
        for f in dict.fromkeys(failures):
            print("  ", f)
    else:
        print("\nGATE PASSED -- nothing secret or credentialed would be pushed")
    sys.exit(1 if failures else 0)


main()
