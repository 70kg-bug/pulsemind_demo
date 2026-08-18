"""Load the model once, score one reading, advance one band machine.

Wires together `pipeline.core` from the bki repo and holds it for the process
lifetime; owns no model logic of its own.

STATELESS: per-stay snapshots arrive with the request and leave with the
response, so Mongo stays the single history of record.
"""
from __future__ import annotations

import json
import os
import queue
import threading
from concurrent.futures import Future
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from pipeline import config as C
from pipeline.core import bands as B
from pipeline.core import records as R
from pipeline.core.features import PatientContext, Reading, ServingAssets, StayFeatures
from pipeline.core.scoring import load_scorer

SERVING_ASSETS = Path(os.getenv("PM_MODELS_ROOT", str(C.MODELS))) / "serving_assets.json"


@dataclass(frozen=True, slots=True)
class Runtime:
    assets: ServingAssets
    scorer: object
    machine: B.BandMachine
    band_table_version: str
    # Measured label rate, base rate, lift and envelope per band. All four are
    # required by `core/explain.build_payload`.
    band_meaning: dict
    # Verbatim, not a subset: build_payload reads `arm` and `horizon_hours`.
    table_provenance: dict

    @property
    def provenance(self) -> dict:
        return {
            **self.table_provenance,
            "band_table_version": self.band_table_version,
            # Part of the model's identity: the band cuts are only valid for
            # scores produced on this device.
            "scoring_device": self.scorer.device,
            "features": len(self.assets.feature_order),
        }


# ---------------------------------------------------------------------------
# ONE THREAD OWNS THE MODEL, for the process lifetime. Canonical statement.
#
# The booster is pinned to CUDA: the band cuts are only valid for the device they
# were produced on, and CPU and CUDA disagree by up to 0.125 on the raw score.
#
# Measured: main thread works, worker thread works, main thread AGAIN after a
# worker touched the booster kills the process with STATUS_STACK_BUFFER_OVERRUN
# (0xC0000409), no traceback. That is FastAPI's default -- a `def` endpoint runs
# in anyio's pool and successive requests land on different threads.
#
# DAEMON, not a ThreadPoolExecutor: `executor.shutdown(wait=True)` dies 0xC0000409
# too, so the model is deliberately never released. Only exit ends this process.
# ---------------------------------------------------------------------------
# Depth is in REQUESTS, not jobs: `_on_model_thread` blocks on the future, and
# `/ward/seed` loops its 192 scorings sequentially, so one request is never more
# than one item. Eight is a few seconds of scoring, or one explanation plus a
# short line behind it.
MAX_QUEUE_DEPTH = 8

_WORK: "queue.Queue[tuple]" = queue.Queue(maxsize=MAX_QUEUE_DEPTH)
_runtime: Runtime | None = None


class Overloaded(Exception):
    """The model thread is saturated. A refusal, not a failure.

    One GPU and one thread mean load cannot be spread, only shed. Accepting work
    we cannot start is how a queue becomes an outage nobody can see.
    """

    def __init__(self, depth: int, retry_after: int = 25) -> None:
        super().__init__(f"model thread saturated, {depth} queued")
        self.depth, self.retry_after = depth, retry_after


def _worker() -> None:
    while True:
        fn, args, future = _WORK.get()
        if future.set_running_or_notify_cancel():
            try:
                future.set_result(fn(*args))
            except BaseException as failure:            # noqa: BLE001
                future.set_exception(failure)


_MODEL_THREAD = threading.Thread(target=_worker, name="pulsemind-model", daemon=True)
_MODEL_THREAD.start()


# THE OWNER OF THE GPU GIVES UP FIRST. Each of these must stay below the Node
# timeout for the same path (config/modelService.js: 120 s score, 300 s explain).
# It used to be one 600 s value above both, so Node abandoned a call while this
# thread kept the GPU for another five minutes and the next request queued behind
# a computation nobody would read.
#
# Two values, not one: 90 s would be correct for scoring and wrong for the 7B,
# which is ~40 s of cold load plus 13-42 s of generation, and ~75 s to generate
# on a nearly full card.
SCORE_TIMEOUT_S = 90.0
EXPLAIN_TIMEOUT_S = 240.0


def _on_model_thread(fn, *args, timeout: float = SCORE_TIMEOUT_S):
    """Run fn on the one thread that is allowed to touch the model."""
    future: Future = Future()
    try:
        _WORK.put((fn, args, future), block=False)
    except queue.Full:
        raise Overloaded(_WORK.qsize()) from None
    return future.result(timeout=timeout)


def queue_depth() -> int:
    """Items waiting for the model thread. Read-only -- never enqueues."""
    return _WORK.qsize()


def thread_alive() -> bool:
    return _MODEL_THREAD.is_alive()


def on_model_thread(fn, *args):
    """Public: run anything that touches CUDA on the model thread.

    The 7B comes through here too -- two CUDA contexts on two threads segfault
    the interpreter (exit 139) mid-load. Generating blocks scoring for 18-23 s.
    """
    return _on_model_thread(fn, *args, timeout=EXPLAIN_TIMEOUT_S)


def _load() -> Runtime:
    """Runs ON the model thread, so the CUDA context is created there."""
    global _runtime
    if _runtime is None:
        table = json.loads(C.BAND_TABLE_JSON.read_text())
        base_rate = table["provenance"]["base_rate"]
        _runtime = Runtime(
            assets=ServingAssets.load(SERVING_ASSETS),
            scorer=load_scorer(),
            machine=B.BandMachine.from_json(table["machine"]),
            band_table_version=table["schema_version"],
            band_meaning={b["band"]: {"observed_rate": b["observed_rate"],
                                      "base_rate": base_rate,
                                      "lift": b["lift_vs_base_rate"],
                                      "envelope": b["envelope"]}
                          for b in table["bands"]},
            table_provenance=dict(table["provenance"]),
        )
    return _runtime


def runtime() -> Runtime:
    """Load everything once. ~7.5 MB of artifacts and about a second."""
    return _on_model_thread(_load)


def _restore_stay(context: PatientContext, state: dict | None):
    """Rebuild the two per-stay machines from a stored snapshot.

    `None` starts a fresh stay: correct for a new admission, wrong for a restart,
    which is why the caller persists it. Must already be on the model thread.
    """
    rt = _load()
    features = StayFeatures(context, rt.assets)
    stepper = B.BandStepper(rt.machine)
    if state:
        features.restore(state["features"])
        stepper.restore(state["bands"])
    return features, stepper


def snapshot(features: StayFeatures, stepper: B.BandStepper, origin: datetime) -> dict:
    return {
        "features": features.snapshot(),
        "bands": stepper.snapshot(),
        "origin": origin.isoformat(),
    }


def score(context: PatientContext, reading: Reading, state: dict | None) -> tuple[dict, dict]:
    """One reading in, one s17-shaped record and the next state out.

    s17-shaped is the contract `verify.py` checks and `core/explain.py` consumes;
    `contract.py` maps it to the display shape.
    """
    return _on_model_thread(_score, context, reading, state)


def _score(context: PatientContext, reading: Reading, state: dict | None) -> tuple[dict, dict]:
    rt = _load()
    features, stepper = _restore_stay(context, state)
    origin = (datetime.fromisoformat(state["origin"]) if state
              else reading.observed_at)

    frame = features.push(reading)
    calibrated = float(rt.scorer.score(frame)[0])
    contributions, bias = rt.scorer.contributions(frame)

    # Minutes on a consistent origin, as BandStepper.push expects; the origin
    # travels in the snapshot so it survives a restart.
    minutes = (reading.observed_at - origin).total_seconds() / 60.0
    view = stepper.push(calibrated, minutes)

    attribution = R.attribution(frame, contributions[0], float(bias[0]), rt.assets)
    telemetry = R.telemetry_from_frame(frame, rt.assets)

    record = {
        "schema_version": C.RISK_SCHEMA_VERSION,
        "provenance": rt.provenance,
        "charttime": reading.observed_at.isoformat(),
        "risk": {"calibrated": calibrated, "is_probability": True},
        "band": {
            "displayed": view.displayed,
            "instant": view.instant,
            "state": view.state,
            "readings_in_state": view.readings_in_state,
            **rt.band_meaning[view.displayed],
        },
        "telemetry": {t.parameter: {"value": t.value, "age_min": t.age_min,
                                    "measured": t.measured, "source": t.source}
                      for t in telemetry},
        **attribution,
    }
    assert R.reconstructs(record, calibrated), (
        "the record does not reconstruct its own score -- an explanation that "
        "does not add up is worse than no explanation")
    return record, snapshot(features, stepper, origin)
