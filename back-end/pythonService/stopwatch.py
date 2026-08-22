"""Measure what each pipeline stage actually costs, and report it in one header.

Every duration this module carries is measured at the point the work happens.
Nothing here estimates. A stage that did not run has NO entry, because a zero
would be a fact the system does not have -- the same rule that keeps a defaulted
clinician name out of an audit record (PM-CLIN-001).

The output is W3C Server-Timing, so the numbers travel on the response that
produced them and never enter `contract/clinical.ts`. Operational data in the
clinical contract would also have to be declared in the Mongoose schema to
survive a save (PM-VER-003), for figures nobody wants persisted.

SPANS AGGREGATE BY NAME, and that is the whole reason this is a class rather
than a dict of floats. `/ward/seed` scores 192 readings in one request and
`/ward/tick` scores 8, so `assess` is entered once per bed per tick. Repeating
the entry 192 times would be legal Server-Timing and unreadable; summing it and
carrying the count says the same thing in one field.

NOT THREAD-CONFINED. A `Timings` is created on the request thread and written to
from the model thread, because that is where the work runs (`model_runtime`).
The request thread blocks on the future while that happens, so the two never
write at once -- but the lock is kept anyway, since the cost is nothing and the
failure it prevents is one request's time being attributed to another.
"""
from __future__ import annotations

import re
import threading
from contextlib import contextmanager
from time import perf_counter

# A Server-Timing name is an RFC 9110 token. Anything else has to be rejected
# here rather than emitted, because a malformed header does not fail loudly --
# the browser simply drops the entry and the panel shows a stage that silently
# never appears.
_TOKEN = re.compile(r"^[A-Za-z0-9!#$%&'*+.^_`|~-]+$")


class _Span:
    __slots__ = ("ms", "count", "desc")

    def __init__(self) -> None:
        self.ms: float = 0.0
        self.count: int = 0
        self.desc: str | None = None


def _quote(text: str) -> str:
    """A Server-Timing desc is a quoted-string: escape the two chars that end it."""
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"') + '"'


class Timings:
    """Named spans for one request, rendered as one Server-Timing header."""

    def __init__(self) -> None:
        # Insertion-ordered, so the header reads in the order the pipeline ran.
        self._spans: dict[str, _Span] = {}
        self._lock = threading.Lock()

    def add(self, name: str, ms: float, desc: str | None = None) -> None:
        """Record a measured duration in milliseconds. Repeats accumulate."""
        if not _TOKEN.match(name):
            raise ValueError(f"{name!r} is not a valid Server-Timing name")
        with self._lock:
            span = self._spans.setdefault(name, _Span())
            span.ms += ms
            span.count += 1
            if desc is not None:
                span.desc = desc

    def mark(self, name: str, desc: str) -> None:
        """Record a non-duration observation -- queue depth, a device, a model id.

        Kept distinct from `add` so it cannot be mistaken for a timing: it emits
        a `desc` with no `dur`, which is what the spec is for.
        """
        if not _TOKEN.match(name):
            raise ValueError(f"{name!r} is not a valid Server-Timing name")
        with self._lock:
            span = self._spans.setdefault(name, _Span())
            span.desc = desc

    @contextmanager
    def span(self, name: str, desc: str | None = None):
        """Time a block. `perf_counter`, never `time()` -- this is an interval."""
        started = perf_counter()
        try:
            yield
        finally:
            self.add(name, (perf_counter() - started) * 1000.0, desc)

    def to_header(self) -> str:
        """Render W3C Server-Timing. Empty string when nothing was measured.

        An empty string is the honest answer for a request that did no
        instrumented work; the caller must not set the header at all in that
        case, so a reader never sees an entry that means nothing.
        """
        with self._lock:
            parts = []
            for name, span in self._spans.items():
                entry = name
                if span.count:
                    entry += f";dur={span.ms:.3f}"
                desc = span.desc
                # A span entered more than once is a sum, and saying so is the
                # difference between "scoring took 432 ms" and "scoring took
                # 432 ms across 8 readings". Only one of those is true.
                if desc is None and span.count > 1:
                    desc = f"{span.count}x"
                elif desc is not None and span.count > 1:
                    desc = f"{desc}, {span.count}x"
                if desc is not None:
                    entry += f";desc={_quote(desc)}"
                parts.append(entry)
            return ", ".join(parts)


class _NullTimings(Timings):
    """Accepts every call and records nothing.

    So an instrumented function can be called by something that does not want
    timings without either allocating a collector per call -- `/ward/seed`
    scores 192 readings in one request -- or scattering `if timings is not None`
    through the scoring path, where a missed branch would be a crash rather than
    a missing measurement.
    """

    def add(self, name: str, ms: float, desc: str | None = None) -> None:
        pass

    def mark(self, name: str, desc: str) -> None:
        pass


#: Shared, immutable in effect: it holds nothing, so it cannot leak one
#: request's measurements into another's.
NULL = _NullTimings()
