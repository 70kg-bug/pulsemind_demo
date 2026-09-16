"""A manufactured ICU ward, in the canonical schema.

NOTHING HERE IS DERIVED FROM MIMIC-IV -- a licence constraint: this repository is
public and these assessments are written to a cloud database, so no value covered
by the PhysioNet DUA may reach either. The model is real, the physiology invented.

  DETERMINISTIC  a function of (seed, bed, tick), so the ward comes up
      identically twice and the service regenerates rather than remembers.
  COMPLETE       the eight beds cover every state the contract can represent:
      each band, a `demoting` stretch, a reading below the sufficiency floor, a
      majority-defaulted parameter, and a withheld explanation.

`check_levels()` validates category values against the model's own level set at
startup; an unrecognised one would be coded NaN and scored anyway.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from pipeline.core.features import Infusion, PatientContext, Reading, ServingAssets

TICK = timedelta(hours=1)      # the 60-minute grid the dwell is denominated in
ALL_PARAMS = ("spo2", "fio2", "flow_rate", "peep", "pip", "respiratory_rate_total",
              "minute_volume", "tidal_volume_observed", "etco2",
              "inspiratory_ratio", "expiratory_ratio")


@dataclass(frozen=True, slots=True)
class Bed:
    """One bed's identity and the shape of its clinical course."""

    patient_id: str
    bed_code: str
    unit: str
    care_unit: str
    sex: str
    age: float
    height_cm: float
    weight_kg: float
    icd_codes: tuple[tuple[str, int], ...]
    # The arc, in SpO2 points per tick and FiO2 points per tick. Negative SpO2
    # is deterioration. `recovers_after` turns the arc around, which is what
    # produces a `demoting` band -- the score falls but the display holds.
    spo2_slope: float = 0.0
    fio2_slope: float = 0.0
    spo2_start: float = 97.0
    fio2_start: float = 40.0
    recovers_after: int | None = None
    # Parameters this bed's sources never supply. Enough of them and the reading
    # falls below the sufficiency floor and no score may be published.
    absent: tuple[str, ...] = ()
    pressors: bool = False
    withhold_explanation: bool = False
    ventilated_hours_before_start: int = 0
    # Must be one of the 42 modes MIMIC actually charts. `check_levels`
    # enforces that -- an invented mode is coded NaN and scored anyway.
    vent_mode: str = "CPAP/PSV"


WARD: tuple[Bed, ...] = (
    Bed("PM-204", "ICU 04", "MICU", "Medical Intensive Care Unit (MICU)",
        "M", 67, 178, 84, (("J449", 10), ("I5022", 10), ("E119", 10)),
        spo2_slope=-1.1, fio2_slope=2.4, spo2_start=98, ventilated_hours_before_start=11,
        pressors=True, vent_mode="PRVC/AC"),
    Bed("PM-231", "ICU 02", "SICU", "Surgical Intensive Care Unit (SICU)",
        "F", 74, 162, 71, (("N179", 10), ("I509", 10)),
        spo2_slope=-0.5, fio2_slope=1.1, spo2_start=96, ventilated_hours_before_start=30,
        vent_mode="CMV/ASSIST"),
    Bed("PM-167", "ICU 09", "MICU", "Medical Intensive Care Unit (MICU)",
        "M", 58, 175, 92, (("J189", 10), ("E1165", 10)),
        spo2_slope=-1.0, fio2_slope=2.0, spo2_start=97, recovers_after=14,
        ventilated_hours_before_start=48, vent_mode="SIMV/PSV"),
    Bed("PM-118", "ICU 07", "MICU", "Medical Intensive Care Unit (MICU)",
        "F", 81, 158, 55, (("I2510", 10), ("N183", 10), ("F039", 10)),
        spo2_slope=-0.25, fio2_slope=0.6, spo2_start=96, ventilated_hours_before_start=6),
    Bed("PM-142", "ICU 01", "CCU", "Coronary Care Unit (CCU)",
        "M", 63, 180, 88, (("I219", 10),),
        spo2_slope=-0.1, fio2_slope=0.2, spo2_start=98, ventilated_hours_before_start=19),
    Bed("PM-309", "ICU 11", "SICU", "Surgical Intensive Care Unit (SICU)",
        "F", 45, 168, 64, (),
        spo2_slope=0.0, fio2_slope=0.0, spo2_start=99, ventilated_hours_before_start=4,
        vent_mode="PSV/SBT"),
    # The interface was never commissioned: NONE of the eleven arrive, so no
    # score may be published on any reading.
    #
    # ALL eleven, not nine. With nine the shares sat at 0.2962 imputed / 0.2997
    # documentation against a 0.30 floor and the bed published LOW on some
    # readings -- while its provenance was IDENTICAL throughout and
    # `imputed_share` still drifted 0.2315 -> 0.3695. The floor tracks where
    # attribution lands, not how many inputs are missing.
    Bed("PM-355", "ICU 12", "MICU", "Medical Intensive Care Unit (MICU)",
        "M", 70, 172, 79, (("J960", 10),),
        spo2_start=95, absent=ALL_PARAMS,
        ventilated_hours_before_start=2),
    Bed("PM-092", "ICU 06", "MICU", "Medical Intensive Care Unit (MICU)",
        "F", 69, 165, 68, (("J690", 10), ("K7460", 10)),
        spo2_slope=-0.8, fio2_slope=1.6, spo2_start=96, withhold_explanation=True,
        ventilated_hours_before_start=26, vent_mode="PCV+/PSV"),
)

DEVICES = (
    {"label": "Ventilator", "device_make_model": "Hamilton C6", "device_id": "VNT",
     "state": "streaming"},
    {"label": "Bedside monitor", "device_make_model": "Philips MX750", "device_id": "MON",
     "state": "streaming"},
    {"label": "Lab / EMR", "device_make_model": "Hospital interface", "device_id": "EMR",
     "state": "available"},
)

# Static context values that must exist in the model's category levels.
FIXED = {
    "admission_type": "EW EMER.",
    "admission_location": "EMERGENCY ROOM",
    "insurance": "Medicare",
    "language": "English",
    "marital_status": "MARRIED",
    "race": "WHITE",
}


def check_levels(assets: ServingAssets) -> None:
    """Fail at startup if the ward would emit a category the model never saw.

    An unrecognised level is coded NaN by pandas and scored without complaint,
    so this is the difference between a wrong answer and no answer.
    """
    problems = []
    for column, value in FIXED.items():
        if value not in assets.categorical[column]:
            problems.append(f"{column}={value!r}")
    for bed in WARD:
        if bed.sex not in assets.categorical["gender"]:
            problems.append(f"gender={bed.sex!r}")
        if bed.care_unit not in assets.categorical["first_careunit"]:
            problems.append(f"first_careunit={bed.care_unit!r}")
        if bed.vent_mode not in assets.categorical["ventilator_mode"]:
            problems.append(f"ventilator_mode={bed.vent_mode!r}")
    if problems:
        raise RuntimeError(
            "synthetic ward emits category values the model was not trained on: "
            + ", ".join(sorted(set(problems))))


def _jitter(seed: int, bed: Bed, tick: int, key: str, spread: float) -> float:
    """Reproducible noise. Hashed rather than drawn, so there is no RNG state."""
    material = f"{seed}:{bed.patient_id}:{tick}:{key}".encode()
    digest = hashlib.blake2b(material, digest_size=8).digest()
    unit = int.from_bytes(digest, "big") / float(1 << 64)      # [0, 1)
    return (unit - 0.5) * 2.0 * spread


def context_for(bed: Bed, ward_start: datetime) -> PatientContext:
    return PatientContext(
        sex=bed.sex,
        age_at_icu=float(bed.age),
        admission_type=FIXED["admission_type"],
        admission_location=FIXED["admission_location"],
        insurance=FIXED["insurance"],
        language=FIXED["language"],
        marital_status=FIXED["marital_status"],
        race=FIXED["race"],
        first_careunit=bed.care_unit,
        ventilation_start=ward_start - timedelta(hours=bed.ventilated_hours_before_start),
        height_cm=float(bed.height_cm),
        weight_kg=float(bed.weight_kg),
        hours_admit_to_icu=float(2 + bed.age % 5),
        ed_minutes=float(120 + bed.age % 90),
        prior_icu_stays=int(bed.age) % 3,
        icd_codes=bed.icd_codes,
    )


def reading_for(bed: Bed, tick: int, at: datetime, seed: int) -> Reading:
    """This bed's eleven numbers at this tick.

    A course that only ever worsens is not a ward. `recovers_after` reverses the
    arc so the score falls while the displayed band holds above it -- the
    `demoting` state, which is the one thing the observation strip exists to
    show and the one a monotonic demo never produces.
    """
    step = tick if bed.recovers_after is None or tick <= bed.recovers_after else (
        2 * bed.recovers_after - tick)

    spo2 = bed.spo2_start + bed.spo2_slope * step + _jitter(seed, bed, tick, "spo2", 0.7)
    fio2 = bed.fio2_start + bed.fio2_slope * step + _jitter(seed, bed, tick, "fio2", 1.5)
    severity = max(0.0, (bed.spo2_start - spo2) / 12.0)

    values = {
        "spo2": round(min(100.0, max(70.0, spo2)), 0),
        "fio2": round(min(100.0, max(21.0, fio2)), 0),
        "peep": round(5.0 + 3.5 * severity + _jitter(seed, bed, tick, "peep", 0.4), 0),
        "pip": round(20.0 + 9.0 * severity + _jitter(seed, bed, tick, "pip", 1.0), 0),
        "respiratory_rate_total": round(
            17.0 + 11.0 * severity + _jitter(seed, bed, tick, "rr", 1.2), 0),
        "minute_volume": round(
            8.6 + 2.4 * severity + _jitter(seed, bed, tick, "mv", 0.5), 1),
        "tidal_volume_observed": round(
            bed.weight_kg * 6.5 - 40.0 * severity + _jitter(seed, bed, tick, "vt", 18), 0),
        "flow_rate": round(42.0 + 9.0 * severity + _jitter(seed, bed, tick, "flow", 2.0), 1),
        "etco2": round(37.0 + 5.0 * severity + _jitter(seed, bed, tick, "etco2", 1.5), 0),
        "inspiratory_ratio": 1.0,
        "expiratory_ratio": round(3.0 - 0.6 * severity, 1),
    }
    # Not every parameter is charted at every reading; the gaps are what the
    # carried-forward provenance state exists to describe. The cadence uses the
    # parameter's POSITION, never `hash(p)` -- Python randomises string hashing
    # per process, so a hash here would silently make the ward different on
    # every restart while still looking deterministic.
    charted = {p: v for p, v in values.items()
               if p not in bed.absent
               and (p in ("spo2", "fio2") or (tick + ALL_PARAMS.index(p)) % 2 == 0)}

    infusions = ()
    if bed.pressors:
        started = at - timedelta(hours=max(1, tick))
        infusions = (Infusion("vasopressor", started, at + timedelta(hours=6),
                              0.06 + 0.04 * severity),)

    return Reading(observed_at=at, values=charted,
                   ventilator_mode=bed.vent_mode, infusions=infusions)


def devices_for(bed: Bed, at: datetime, offline: set[str]) -> list[dict]:
    """Input sources, with a live last-signal time.

    The device-to-parameter mapping is a prototype assumption, not schema. What
    is real is the consequence: drop the ventilator and eight of the eleven
    parameters stop refreshing.
    """
    out = []
    for spec in DEVICES:
        device_id = f"{spec['device_id']}-{bed.bed_code.split()[-1]}"
        is_offline = device_id in offline
        out.append({**spec, "device_id": device_id,
                    "state": "offline" if is_offline else spec["state"],
                    "last_signal_at": at.isoformat()})
    return out


@dataclass(frozen=True, slots=True)
class WardSpec:
    seed: int = 20260817
    # 24 hourly readings, so the board is populated on first load and the
    # observation strip has a `demoting` stretch inside its window. Hourly
    # rather than denser because the shipped dwell parameters
    # (demote_dwell_min = 120) are denominated in MIMIC's 60-minute grid; a
    # finer stream would need them re-expressed before they meant anything.
    backfill_ticks: int = 24
    beds: tuple[Bed, ...] = field(default=WARD)
