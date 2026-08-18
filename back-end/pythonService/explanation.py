"""The plain-language explanation, generated locally and checked before it ships.

Measured, not assumed (`bki/reports/s19_llm_explanations.json`):

  SLOW      median 18.2 s, p90 23.3 s -- three orders of magnitude past the
            0.05 s score, so it is a separate endpoint and loads on first use.
  HEAVY     17 GB of weights, GPU only.
  NOT YET   5 violations in 200 against a ship criterion of zero (TREND_CLAIM 3,
            FABRICATED_NUMBER 1, IMPUTED_QUOTED 1). The template floor scores 0.

Every generated string is checked by `core.grounding` and a failing one is
replaced by the template floor, with the finding reported alongside. The checker
shares no code with the generator: one built on the writer's assumptions
inherits them and cannot catch them.
"""
from __future__ import annotations

import json
import time

from pipeline import config as C
from pipeline.core import explain as E
from pipeline.core import grounding as G

_generator = None


def policy() -> E.Policy:
    """Same construction as s18_explain.policy(), which is the definition."""
    evidence = None
    if C.EVIDENCE_MAP_JSON.exists():
        evidence = json.loads(
            C.EVIDENCE_MAP_JSON.read_text(encoding="utf-8")).get("keys")
    return E.Policy(
        display=C.PARAM_DISPLAY,
        max_imputed_share=C.SUFFICIENCY_MAX_IMPUTED_SHARE,
        max_doc_share=C.SUFFICIENCY_MAX_DOC_SHARE,
        insufficient_text=C.INSUFFICIENT_DATA_TEXT,
        unavailable_text=C.EXPLANATION_UNAVAILABLE_TEXT,
        contributor_k=C.EXPLAIN_CONTRIBUTOR_K,
        evidence=evidence,
        context_k=C.EVIDENCE_CONTEXT_K,
        actions_k=C.EVIDENCE_ACTIONS_K)


def check(record: dict, text: str, pol: E.Policy) -> list[G.Finding]:
    """Ground the text against the record it claims to explain.

    Evidence is passed as DATA, and only the passages the model actually saw --
    handing the checker the wrong passages would widen the exemption it grants
    for quoted guideline text (s18_explain.check).
    """
    evidence = ()
    if pol.evidence:
        context, _actions = E.select_evidence(record, pol)
        evidence = tuple({"text": c["quote"], "citation": c["citation"]}
                         for c in context)
    return G.check(record, text, display=C.PARAM_DISPLAY,
                   band_names=C.BAND_NAMES, evidence=evidence)


def generator():
    """Load the 7B on first use. Blocks for as long as the weights take."""
    global _generator
    if _generator is None:
        from pipeline.core import generate as Gen
        _generator = Gen.load_generator()
    return _generator


def generator_loaded() -> bool:
    """Has the 7B been loaded? Read-only -- never triggers the load.

    Scoring-ready and explanation-ready are two different states, and `/readyz`
    reports them separately.
    """
    return _generator is not None


def generate_explanation(record: dict, use_llm: bool = True) -> dict:
    """Explain one assessment, or say plainly why it cannot be explained.

    Returns the contract's Explanation shape plus the findings and timing, so a
    caller can show what happened rather than only what was produced.
    """
    pol = policy()
    started = time.perf_counter()

    # Below the sufficiency floor there is nothing honest to say, and
    # build_payload() raises rather than letting a generator try.
    try:
        E.build_payload(record, pol)
    except E.InsufficientData as reason:
        return {"status": "unavailable",
                "explanation_text": C.INSUFFICIENT_DATA_TEXT,
                "grounding_status": "not_checked",
                "findings": [], "generator": None,
                "withheld_because": str(reason),
                "seconds": round(time.perf_counter() - started, 3)}

    baseline = E.baseline(record, pol)
    if not use_llm:
        return _result("generated", baseline, check(record, baseline, pol),
                       generator_name="template", started=started, fell_back=False)

    try:
        block = E.explain(record, pol, generator=generator(),
                          generator_name=C.LLM_MODEL_ID)
    except Exception as failure:                      # noqa: BLE001
        # A generator that cannot load must not take the score down with it.
        # Band, score, inputs and contributors all remain available.
        return {"status": "unavailable",
                "explanation_text": C.EXPLANATION_UNAVAILABLE_TEXT,
                "grounding_status": "not_checked",
                "findings": [], "generator": None,
                "generator_error": f"{type(failure).__name__}: {failure}",
                "seconds": round(time.perf_counter() - started, 3)}

    text = block["text"]
    findings = check(record, text, pol)
    violations = [f for f in findings if f.severity == "violation"]
    if violations:
        # Substitute rather than warn. A grounded-but-wrong sentence in a
        # clinical voice is worse than a plainer one that is right.
        return _result("generated", baseline, check(record, baseline, pol),
                       generator_name="template", started=started, fell_back=True,
                       rejected=[f.to_json() for f in violations])
    return _result("generated", text, findings,
                   generator_name=C.LLM_MODEL_ID, started=started, fell_back=False,
                   guideline_context=block["guideline_context"],
                   suggested_actions=block["suggested_actions"])


def _result(status: str, text: str, findings, *, generator_name: str,
            started: float, fell_back: bool, rejected=None,
            guideline_context=None, suggested_actions=None) -> dict:
    # The contract enum is passed | violations_found | not_checked, with no
    # state for "checked, and something worth mentioning fired". A warning is
    # NOT a violation -- POSSIBLE_TREND_CLAIM means the phrasing looks like a
    # trend claim, not that it is one -- so warning-only text reports `passed`
    # and carries its findings alongside. Reporting it as `violations_found`
    # would put a red flag on prose the checker deliberately let through, and
    # the flag would then mean nothing when a real violation appeared.
    violations = [f for f in findings if f.severity == "violation"]
    return {
        "status": status,
        "explanation_text": text,
        "grounding_status": "violations_found" if violations else "passed",
        "findings": [f.to_json() for f in findings],
        "warnings": [f.to_json() for f in findings if f.severity == "warning"],
        "generator": generator_name,
        "fell_back_to_template": fell_back,
        "rejected_generation": rejected or [],
        "guideline_context": guideline_context or [],
        "suggested_actions": suggested_actions or [],
        "seconds": round(time.perf_counter() - started, 3),
    }
