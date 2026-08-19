"""PulseMind model service. Scores, bands and explains; stores nothing.

    POST /ward/seed        build the ward and backfill its history
    POST /ward/tick        one more reading per bed
    POST /explain/patient  explain a stored record in plain language (slow)
    GET  /healthz          model, band table and scoring device

Per-stay state travels in and out with each request, so Node keeps it in Mongo.

Run from the repository root, with bki importable:
    ..\\.venv\\Scripts\\python.exe -m uvicorn app:app --app-dir back-end/pythonService
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

import explanation as expl

import contract
import model_runtime as rt
import synthetic_ward as sw
from pipeline import config as C

# Provenance captured at startup, when the model thread is idle by construction,
# so the probes can answer without queueing behind the workload they monitor.
_READY: dict = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Load the model and validate the ward before the first request arrives.

    `check_levels` fails at startup rather than scoring an unseen category, which
    would be coded NaN and answered anyway.
    """
    runtime = rt.runtime()
    sw.check_levels(runtime.assets)
    _READY.update(runtime.provenance)
    yield
    # Nothing to tear down -- see model_runtime.


app = FastAPI(title="PulseMind model service", version=C.RISK_SCHEMA_VERSION,
              lifespan=lifespan)


@app.exception_handler(rt.Overloaded)
async def _overloaded(request: Request, exc: rt.Overloaded) -> JSONResponse:
    """503, not 429.

    429 (RFC 6585 section 4) means this caller has spent their quota. A full
    model queue is reduced capacity and the caller did nothing wrong, which is
    503 with a Retry-After the client can actually honour.
    """
    return JSONResponse(
        status_code=503,
        media_type="application/problem+json",
        headers={"Retry-After": str(exc.retry_after)},
        content={"type": "about:blank",
                 "title": "Service Unavailable",
                 "status": 503,
                 "detail": "the model thread is saturated; retry shortly",
                 "queue_depth": exc.depth},
    )


# ---------------------------------------------------------------------------
# Wire shapes
# ---------------------------------------------------------------------------
# EVERY FIELD THAT MULTIPLIES WORK IS BOUNDED. `backfill_ticks` is the sharp one:
# each tick is one model-thread round-trip per bed, so an unbounded int let an
# unauthenticated caller ask for millions of them and freeze the board with no
# way to see why. `extra="forbid"` because silently accepting and discarding an
# unknown field is how a caller comes to believe it did something.
_STRICT = ConfigDict(extra="forbid")


class SeedRequest(BaseModel):
    model_config = _STRICT
    seed: int = 20260817
    # 48 = the widest history the observation strip can plot.
    backfill_ticks: int = Field(24, ge=1, le=48)


class BedState(BaseModel):
    """What Node holds for one bed between calls, read back out of Mongo."""

    model_config = _STRICT
    patient_id: str = Field(..., max_length=64)
    tick: int = Field(..., ge=0, le=100_000)
    stay_state: dict
    last_band: str | None = None
    offline_devices: list[str] = Field(default_factory=list, max_length=16)


class TickRequest(BaseModel):
    model_config = _STRICT
    seed: int = 20260817
    beds: list[BedState] = Field(..., max_length=64)


class ExplainRequest(BaseModel):
    model_config = _STRICT
    patient_id: str = Field(..., max_length=64)
    # The stored record for the reading being explained, exactly as it was
    # scored. Not a tick to re-score -- see `_score_tick`.
    record: dict
    # False runs the deterministic template floor instead of the 7B: 0 violations
    # and 0 warnings against the LLM's 5 and 41, and no GPU.
    use_llm: bool = True


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def _bed(patient_id: str) -> sw.Bed:
    for bed in sw.WARD:
        if bed.patient_id == patient_id:
            return bed
    raise HTTPException(404, f"no bed {patient_id}")


def _score_tick(bed: sw.Bed, tick: int, at: datetime, seed: int,
                state: dict | None, offline: set[str], last_band: str | None) -> dict:
    """Generate, score, band and map one reading for one bed."""
    context = sw.context_for(bed, at - sw.TICK * tick)
    reading = sw.reading_for(bed, tick, at, seed)

    # An offline source stops refreshing: values age rather than vanish, which
    # is what pushes a reading toward the floor.
    if offline:
        supplied = _parameters_still_arriving(bed, offline)
        reading = sw.Reading(observed_at=reading.observed_at,
                             values={k: v for k, v in reading.values.items()
                                     if k in supplied},
                             ventilator_mode=reading.ventilator_mode,
                             infusions=reading.infusions)

    record, next_state = rt.score(context, reading, state)
    devices = sw.devices_for(bed, at, offline)

    published = contract.assessment(
        record,
        patient_id=bed.patient_id, bed_code=bed.bed_code, unit=bed.unit,
        devices=devices, readings_since_admission=tick + 1,
        explanation=(contract.unavailable_explanation()
                     if bed.withhold_explanation else None),
    )
    # Only a scored reading may carry a prompt. `insufficient_data` implies no
    # RISK_PROMPT row at all -- absent, not null.
    if published["assessment_status"] == "assessed":
        published["prompt"] = contract.prompt_for(last_band, published, at)

    # Node stores this so `/explain/patient` explains THIS reading. Re-scoring at
    # a later `now` steps the band machine twice and narrates a dwell -- sometimes
    # a band -- no stored row had; grounding cannot catch it, both sides of the
    # check being wrong together.
    published["record"] = record

    return {"patient_id": bed.patient_id,
            "assessment": published,
            "stay_state": next_state,
            "tick": tick}


# Which parameters each source supplies. A prototype assumption, labelled as one
# in the UI -- the real mapping is a property of the hospital's interface.
SOURCE_PARAMETERS = {
    "VNT": ("fio2", "peep", "pip", "respiratory_rate_total", "minute_volume",
            "tidal_volume_observed", "flow_rate", "inspiratory_ratio",
            "expiratory_ratio"),
    "MON": ("spo2", "etco2"),
    "EMR": (),
}


def _parameters_still_arriving(bed: sw.Bed, offline: set[str]) -> set[str]:
    lost: set[str] = set()
    for device_id in offline:
        prefix = device_id.split("-")[0]
        lost.update(SOURCE_PARAMETERS.get(prefix, ()))
    return set(sw.ALL_PARAMS) - lost


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/healthz")
async def healthz() -> dict:
    """LIVENESS. Answers from module state and never touches the model thread.

    It used to call `rt.runtime()`, which enqueues -- so the probe blocked for the
    length of whatever was running, and a supervisor would restart the service
    precisely while it was working. `async def` so it does not consume one of
    anyio's threadpool tokens either.
    """
    return {"status": "pass", "service": "pulsemind-model",
            "schema_version": C.RISK_SCHEMA_VERSION}


@app.get("/readyz")
async def readyz() -> JSONResponse:
    """READINESS: can this service do useful work right now?

    Scoring-ready and explanation-ready are genuinely different states -- the 7B
    loads on first use and the service scores without it -- so a missing explainer
    is `warn` and still 2xx.
    """
    depth = rt.queue_depth()
    checks = {
        "model:loaded": {"status": "pass" if _READY else "fail"},
        "model_thread:alive": {"status": "pass" if rt.thread_alive() else "fail"},
        "queue:depth": {"status": "warn" if depth >= rt.MAX_QUEUE_DEPTH else "pass",
                        "observedValue": depth,
                        "observedUnit": "requests"},
        "explainer:loaded": {"status": "pass" if expl.generator_loaded() else "warn"},
    }
    failed = any(c["status"] == "fail" for c in checks.values())
    return JSONResponse(
        status_code=503 if failed else 200,
        content={"status": "fail" if failed else
                 ("warn" if any(c["status"] == "warn" for c in checks.values()) else "pass"),
                 "checks": checks,
                 "provenance": _READY},
    )


@app.post("/ward/seed")
def seed(request: SeedRequest) -> dict:
    """Build the ward and score its backfilled history, oldest reading first.

    Bands come from pushing real scores through the real hysteresis machine in
    order; thresholding them afterwards would fabricate the `demoting` stretch.
    """
    runtime = rt.runtime()
    sw.check_levels(runtime.assets)

    # TIMEZONE-AWARE, deliberately: a naive `isoformat()` emits no offset, the
    # browser reads it as local, and every reading claims to be hours stale.
    now = datetime.now(timezone.utc).replace(microsecond=0)
    start = now - sw.TICK * (request.backfill_ticks - 1)

    patients = []
    for bed in sw.WARD:
        state, last_band, history = None, None, []
        for tick in range(request.backfill_ticks):
            at = start + sw.TICK * tick
            step = _score_tick(bed, tick, at, request.seed, state, set(), last_band)
            state = step["stay_state"]
            if step["assessment"]["assessment_status"] == "assessed":
                last_band = step["assessment"]["risk_level"]
            history.append(step["assessment"])
        patients.append({
            "patient_id": bed.patient_id,
            "bed_code": bed.bed_code,
            "unit": bed.unit,
            "history": history,
            "stay_state": state,
            "tick": request.backfill_ticks - 1,
            "last_band": last_band,
            "context": _patient_context(bed),
        })
    return {"seeded_at": now.isoformat(), "ticks": request.backfill_ticks,
            "patients": patients}


@app.post("/ward/tick")
def tick(request: TickRequest) -> dict:
    """One more reading per bed, from the state Node read back out of Mongo."""
    now = datetime.now(timezone.utc).replace(microsecond=0)
    out = []
    for bed_state in request.beds:
        bed = _bed(bed_state.patient_id)
        step = _score_tick(bed, bed_state.tick + 1, now, request.seed,
                           bed_state.stay_state, set(bed_state.offline_devices),
                           bed_state.last_band)
        out.append(step)
    return {"at": now.isoformat(), "patients": out}


@app.post("/explain/patient")
def explain_patient(request: ExplainRequest) -> dict:
    """Explain a stored reading, in plain language.

    Its own endpoint because it is three orders of magnitude slower: 66 ms to
    score, 18-23 s to write. The record arrives from Node and is never rebuilt --
    rebuilding re-scores at a new `now` and explains a state no row ever had.
    """
    bed = _bed(request.patient_id)
    if not request.record.get("telemetry"):
        raise HTTPException(422, "record is not a scored reading")
    # The guard belongs where the policy is. Without it Node would generate an
    # explanation and overwrite the fixed withheld string on the assessment.
    if bed.withhold_explanation:
        return {**contract.unavailable_explanation(),
                "findings": [], "generator": None, "seconds": 0.0}

    from explanation import generate_explanation

    # On the model thread, not this request's worker. The generator is a second
    # CUDA consumer and two contexts on two threads segfault the process.
    return rt.on_model_thread(generate_explanation, request.record, request.use_llm)


def _patient_context(bed: sw.Bed) -> dict:
    """The context drawer's fields: recorded, never computed by the model."""
    return {
        "ventilation_episode_id": f"VE-{bed.patient_id.split('-')[1]}",
        "stay_id": f"ST-{bed.patient_id.split('-')[1]}",
        "age": f"{bed.age:.0f}",
        "sex": "Male" if bed.sex == "M" else "Female",
        "weight": f"{bed.weight_kg:.0f} kg",
        "height": f"{bed.height_cm:.0f} cm",
        "ethnicity": f"{sw.FIXED['race'].title()}, recorded",
        "comorbidities": [{"label": contract.CHARLSON_LABELS.get(f"cci_{n}", n),
                           "icd_code": code}
                          for code, _v in bed.icd_codes
                          for n in _charlson_names(code)],
        "charlson_index": _charlson_index(bed),
    }


def _charlson_names(code: str) -> list[str]:
    from pipeline.core.charlson import CHARLSON
    return [name for name, (_i9, i10, _w) in CHARLSON.items()
            if any(code.upper().startswith(p) for p in i10)]


def _charlson_index(bed: sw.Bed) -> int:
    from pipeline.core.features import (charlson_age_points, charlson_comorbidity_score,
                                        charlson_flags)
    flags = charlson_flags(bed.icd_codes)
    return charlson_comorbidity_score(flags) + charlson_age_points(bed.age)
