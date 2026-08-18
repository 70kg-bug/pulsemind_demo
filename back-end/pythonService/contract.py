"""Map the internal record onto the frontend data contract.

Separate from `model_runtime` on purpose: the record is the clinical shape
`verify.py` checks and `core/explain.py` consumes, the contract is the display
shape in `contract/clinical.ts`. When the finalised UI lands, this file changes
and nothing behind it does.

Three mappings do real work rather than renaming a key:

  share_of_decision   |contribution| / attribution_total, over ALL 109 features.
      Over the eight the record carries it would overstate every one of them --
      the top-8 hold about 77% of the decision.

  assessment_status   the sufficiency floor decides this, not the model. Either
      share above 0.30 means no score, no band and no prompt -- a refusal,
      shaped differently so it can never be read as a low score.

  source              the dictionary is normative: `population_reference`, not
      `cohort_default`.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from pipeline import config as C
from pipeline.core.explain import VALUE_SUFFIXES, feature_label, split_feature

# `feature_label` handles the parameter-derived features and falls back to
# underscore-replacement for the rest, which gives "pbw kg" and "charlson
# index" -- the ones a clinician would actually see mislabelled.
FEATURE_LABELS = {
    "age_at_icu": "Age at ICU admission",
    "gender": "Sex",
    "race": "Recorded race",
    "insurance": "Insurance category",
    "language": "Recorded language",
    "marital_status": "Marital status",
    "admission_type": "Admission type",
    "admission_location": "Admission source",
    "first_careunit": "First ICU care unit",
    "hours_admit_to_icu": "Hours from admission to ICU",
    "ed_minutes": "Time in the emergency department",
    "prior_icu_stays": "Previous ICU stays",
    "height_cm": "Height",
    "weight_kg": "Weight",
    "pbw_kg": "Predicted body weight",
    "vent_hours": "Hours ventilated",
    "charlson_index": "Charlson index",
    "charlson_comorbidity_score": "Charlson comorbidity score",
    "charlson_age_points": "Charlson age points",
    "ventilator_mode": "Ventilator mode",
    "ventilator_mode_age_min": "Time since the ventilator mode was charted",
    "tidal_volume_ml_per_kg_pbw": "Tidal volume per kg predicted body weight",
}
for _group in ("vasopressor", "sedative", "opioid", "paralytic", "inotrope"):
    FEATURE_LABELS[f"{_group}_running"] = f"{_group.capitalize()} running"
    FEATURE_LABELS[f"{_group}_rate"] = f"{_group.capitalize()} rate"
    FEATURE_LABELS[f"{_group}_minutes_since_start"] = (
        f"Time since the {_group} infusion started")

CHARLSON_LABELS = {
    "cci_myocardial_infarction": "Myocardial infarction",
    "cci_congestive_heart_failure": "Congestive heart failure",
    "cci_peripheral_vascular": "Peripheral vascular disease",
    "cci_cerebrovascular": "Cerebrovascular disease",
    "cci_dementia": "Dementia",
    "cci_chronic_pulmonary": "Chronic pulmonary disease",
    "cci_rheumatic": "Rheumatic disease",
    "cci_peptic_ulcer": "Peptic ulcer disease",
    "cci_mild_liver_disease": "Mild liver disease",
    "cci_diabetes_uncomplicated": "Diabetes, uncomplicated",
    "cci_diabetes_complicated": "Diabetes with complications",
    "cci_paraplegia_hemiplegia": "Paraplegia or hemiplegia",
    "cci_renal_disease": "Renal disease",
    "cci_malignancy": "Malignancy",
    "cci_severe_liver_disease": "Severe liver disease",
    "cci_metastatic_tumor": "Metastatic solid tumour",
    "cci_aids_hiv": "AIDS / HIV",
}
FEATURE_LABELS.update(CHARLSON_LABELS)

# C.SUFFICIENCY_MAX_* rather than a literal, so the service and the pipeline
# cannot disagree about the floor.
INSUFFICIENCY = {
    "imputed": "imputed_share_above_floor",
    "documentation": "documentation_share_above_floor",
}


def label_for(feature: str) -> str:
    return FEATURE_LABELS.get(feature) or feature_label(feature, C.PARAM_DISPLAY)


def insufficiency_reason(record: dict) -> str | None:
    """Which floor a reading failed, or None if it passed both."""
    if record["imputed_share"] > C.SUFFICIENCY_MAX_IMPUTED_SHARE:
        return INSUFFICIENCY["imputed"]
    if record["documentation_share"] > C.SUFFICIENCY_MAX_DOC_SHARE:
        return INSUFFICIENCY["documentation"]
    return None


def parameters(record: dict) -> list[dict]:
    """The eleven, each with its unit and its provenance.

    Never a value without a source: four of the eleven are majority cohort
    default, so a bare number states a population statistic in a clinical voice.
    """
    out = []
    for name, reading in record["telemetry"].items():
        _label, unit, _decimals = C.PARAM_DISPLAY[name]
        default = reading["source"] == "population_reference"
        out.append({
            "parameter_name": name,
            "value": reading["value"],
            "unit": unit or None,
            "source": reading["source"],
            # A cohort default has no age; the dictionary is normative. The
            # record keeps s17's raw age, a real number when the parameter was
            # charted beyond the 240-minute LOCF cutoff -- shown here it would
            # give a population statistic a measurement's provenance.
            "age_minutes": None if default else reading["age_min"],
        })
    return out


def contributors(record: dict) -> list[dict]:
    """Ranked drivers, as shares of the WHOLE decision."""
    total = record["attribution_total"] or 1.0
    imputed = {name for name, t in record["telemetry"].items()
               if t["source"] == "population_reference"}
    out = []
    for rank, c in enumerate(record["contributors"], start=1):
        feature = c["feature"]
        parameter, suffix = split_feature(feature, C.PARAM_DISPLAY)
        out.append({
            "feature_name": label_for(feature),
            # The machine name this feature derives from, or null for a static
            # or intervention feature. The parameter screen joins on it;
            # matching on the display label only ever worked by coincidence.
            "parameter": parameter,
            "share_of_decision": round(abs(c["contribution"]) / total, 4),
            "rank": rank,
            "kind": c["kind"],
            "is_imputed": _rests_on_a_default(feature, parameter, suffix, imputed),
        })
    return out


def _rests_on_a_default(feature: str, parameter: str | None, suffix: str | None,
                        imputed: set[str]) -> bool:
    """Does this driver rest on a value the patient never had?

    Only the VALUE forms can. `fio2_delta_t_min` is charting behaviour -- a real
    measured number even when FiO2 is a cohort default -- and marking it imputed
    produces a contributor that is at once `kind: documentation` and
    `is_imputed`, which `records.attribution` treats as impossible because the
    two shares are defined over disjoint feature sets.
    """
    if feature == "tidal_volume_ml_per_kg_pbw":
        # Derived from tidal_volume_observed_final, so it inherits that
        # parameter's imputation, as `records.attribution` does. A suffix scan
        # misses it.
        return "tidal_volume_observed" in imputed
    return parameter in imputed and suffix in VALUE_SUFFIXES


def assessment(record: dict, *, patient_id: str, bed_code: str, unit: str,
               devices: list[dict], readings_since_admission: int,
               explanation: dict | None = None, citations: list[dict] | None = None,
               prompt: dict | None = None, review: dict | None = None) -> dict:
    """The record as the frontend reads it -- scored, or explicitly refused."""
    base = {
        "patient_id": patient_id,
        "bed_code": bed_code,
        "unit": unit,
        "assessed_at": record["charttime"],
        "imputed_share": record["imputed_share"],
        "documentation_share": record["documentation_share"],
        "parameters": parameters(record),
        "devices": devices,
    }

    refused = insufficiency_reason(record)
    if refused:
        # A separate shape, so a refusal can never be read as a low score.
        return {**base,
                "assessment_status": "insufficient_data",
                "insufficiency_reason": refused,
                "readings_since_admission": readings_since_admission}

    band = record["band"]
    return {**base,
            "assessment_status": "assessed",
            "risk_score": round(record["risk"]["calibrated"], 4),
            "risk_level": band["displayed"],
            "instant_level": band["instant"],
            "band_state": band["state"],
            "readings_in_state": band["readings_in_state"],
            "contributors": contributors(record),
            "explanation": explanation,
            "citations": citations or [],
            "prompt": prompt,
            "review": review,
            # So a stored assessment traces to what produced it.
            "model_version": record["provenance"]["model"],
            "band_table_version": record["provenance"]["band_table_version"],
            "scoring_device": record["provenance"]["scoring_device"]}


def prompt_for(previous: str | None, current: dict, at: datetime) -> dict | None:
    """Raise a prompt only on a promotion, never on every reading.

    58,765 golden-set assessments raised 1,721 prompts -- one interruption per
    34 readings, and that gap is the point of the hysteresis machine.
    """
    if current["assessment_status"] != "assessed":
        return None
    order = list(C.BAND_NAMES)
    now = current["risk_level"]
    # An unrecognised watermark means the band table changed under stored
    # state. Treating it as "no previous band" raises a prompt on the next
    # non-LOW reading, the safe direction; `order.index` would instead take the
    # whole ward down with a ValueError.
    if previous not in order:
        previous = None
    if previous is not None and order.index(now) <= order.index(previous):
        return None
    if now == order[0]:
        return None
    return {"raised_at": at.isoformat(), "band_at_raise": now, "status": "open"}


def unavailable_explanation() -> dict:
    """The fixed string. Never synthesised prose in a slot that signals absence."""
    return {"status": "unavailable",
            "explanation_text": C.EXPLANATION_UNAVAILABLE_TEXT,
            "grounding_status": "not_checked"}
