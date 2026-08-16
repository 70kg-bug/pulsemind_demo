# PulseMind — design system

Tokens live in `src/index.css`. This file explains what they are for and why they were
chosen. If a colour, font size or radius is not documented here, it does not belong in
the product.

A note on how to read this: where a claim can be measured, the measurement is given. An
earlier version of this document justified several choices with reasoning that turned out
to be wrong when someone checked, which is worse than having no justification at all.

---

## 1. The ground

The page is a chart-paper green-grey at hue 170, and `--surface` is set to exactly the
same value. There are no cards in this product. Regions are bounded by 1px rules and
nothing else.

That is the most consequential decision in the system. The previous version used a white
surface on a light grey page — a luminance step of 1.129:1, plus a hairline border — and
that combination is what ships in every scaffolded dashboard. It accounted for most of the
product's generic first impression before a single label had been read.

The petrol lives in the chrome: the header and the footer, at `oklch(0.285 0.045 195)`.
It is there rather than across the page for a concrete reason. Chroma headroom in sRGB is
a function of lightness, and at hue 195 anything below about L 0.25 caps out near chroma
0.033 — dark enough and "petrol" can only render as a cool near-black. At L 0.285 the
colour is actually visible as a colour.

The page cast is chroma 0.008, which is close to the limit of what registers over a large
field. That is deliberate: it should read as paper, not as a colour.

> **Claim removed.** An earlier draft justified a petrol ground with the story that
> operating theatres use petrol-teal because it is the complement of blood red and
> suppresses afterimages. That story is weakly sourced — the afterimage rationale traces
> to a researcher quoted in a journalist's article rather than a study, and the actual
> 1914 origin was glare from white linen. More importantly the mechanism does not
> transfer: afterimage suppression requires a large saturated red field held in fixation,
> and this interface has a few hundred pixels of red tint. Do not reintroduce it.

> **Claim removed.** The same draft claimed complementary contrast makes the warm severity
> ramp maximally legible. Measured against same-lightness grounds, petrol scores about
> 0.05:1 *worse* than plain grey. WCAG contrast is a luminance ratio and hue opposition
> contributes essentially nothing.

---

## 2. Colour

Four band colours, one neutral ramp, one interactive accent. That is the entire budget,
and it matches the flight-deck convention of six or fewer. `--accent` means "you can act
on this" and never signals clinical state.

**Tints are for area, ink is for marks.** A band tint fills a cell and must not compete
with the number sitting on it, so all four tints take `--ink-950` and there is no
text-colour flip anywhere on the scale. Band ink is small and must read at a distance, so
it is saturated. The original prototype applied mid-saturation to both, which is why it
looked flat.

**Nothing depends on hue alone.** Every band also carries its name as text and a
four-segment meter, so the ordering survives greyscale, colour-vision deficiency and a
badly calibrated monitor.

Band hues follow the RCP NEWS2 observation chart, which is the one national early-warning
chart redesigned specifically so colour-blind clinicians could read it. Its luminance
ladder is monotonic. Chroma here is pushed past the NEWS2 values; the ordering is not.

Two published severity palettes were measured and rejected. IBM Carbon's alert set has
green `#198038` and red `#da1e28` differing by **0.001** in relative luminance — the two
most consequential states are the same grey. The NHS.UK status set fails the same way at
0.002.

**LOW is neutral, not green.** On a bedside monitor green already means "this lead is
live", not "this patient is well", and a point-in-time score with disclosed staleness
cannot support a reassurance claim.

**Red is reserved.** The CRITICAL band is the only red in the product. Destructive and
escalating actions are weighted rather than coloured.

### Contrast

Every token comment in `src/index.css` states its measured ratio against `--page`, and
any token below 4.5:1 is marked NON-BODY. This matters because the previous version
shipped `--ink-500` at **4.28:1** and `--ink-400` at **2.99:1**, unmarked, and used them
for 9px labels — in a product whose design rationale leads with safety-defensibility.

### Borrowing the alarm palette

IEC 60601-1 clause 7.8.1 notes that dot-matrix and other alphanumeric displays are not
indicator lights, so the standard's colour and flash requirements attach to physical
lamps and not to screen content. Nothing here violates a clause. The question is human
factors, and the resolution is to borrow the hue while breaking the form and the
behaviour:

- Nothing flashes, at any rate. 1.4–2.8 Hz is the high-priority alarm rate and 0.4–0.8 Hz
  the medium; a static indicator is pre-attentively not an alarm.
- No large field is filled at alarm chroma.
- No sound, ever.
- No silence, pause or reset control. The disposition buttons record a clinical review and
  close a prompt; they silence nothing, and the band does not change when they are pressed.
- A permanent "not an alarm" label in the header at every viewport width. It shortens on a
  phone rather than disappearing.

One structural point worth keeping in the design record: 60601-1-8 defines three
priorities and PulseMind publishes four bands. The mapping is not isomorphic, which is a
documentable reason to sit adjacent to the alarm palette rather than claim conformity
with it.

---

## 3. Type

Four faces, each with one job.

| Role | Face | Used for |
|---|---|---|
| Display | **Big Shoulders** | The single largest element on a screen |
| UI text | **Public Sans** | Labels, prose, buttons, headings |
| Quantity | **Atkinson Hyperlegible** | Vitals, scores, percentages, axis ticks |
| Machine identity | **JetBrains Mono** | Patient IDs, bed codes, timestamps, device tags |

A number read as an amount and a number read as a name should not look the same, which is
why numerals and identifiers use different faces.

Atkinson Hyperlegible is the load-bearing choice. It was drawn by the Braille Institute
with letterform differentiation as the explicit goal — the 0/O, 1/l/I, 5/S and 6/8
confusions this screen is exposed to — which makes it a decision that can be defended in a
review rather than asserted as taste.

Big Shoulders exists because of a measurement: in the previous version the UI face never
appeared above 22px and did so only three times, so swapping it would have cost a
font-loading round trip that nobody could see. Typographic character only becomes visible
at display sizes, so the system now has a display tier and uses it once per screen.

`font-variant-numeric: tabular-nums lining-nums` is global on both numeric faces, so
decimal points align and a value updating in place never shifts its neighbours.

### Scale

Two regimes, deliberately:

```
TEXT      11 · 12.5 · 14 · 16        packed tight; a ward board is a dense instrument
DISPLAY   20 · 25 · 31 · 39 · 49 · 61   strict ×1.25; where hierarchy becomes visible
```

The floor is 11px and it is enforced, not merely stated. The previous version declared the
same floor and then shipped `text-[10px]` in 42 places and `text-[9px]` in 7.

Size and colour interact. Display guidance puts the floor for *reading* at 16 arc minutes
but requires roughly 20 before the *colour* of an alphanumeric string can be reliably
discriminated — about 17px at a 560mm workstation distance. So a band name is never small
coloured text: it is dark text on a tint, which also satisfies the rule that either
foreground or background be achromatic. Where a small label needs a state signal, the
colour goes on an adjacent shape and the words stay achromatic.

---

## 4. Structure

Rules rather than cards; 1px hairlines and a maximum radius of 3px. Depth is carried by
background value, not by shadow — there are no box-shadows in the product except the
drawer.

Patients are ruled rows inside one region so any column can be scanned vertically. There
are no side accent bars: a thick coloured border on one edge of a card is among the most
recognisable tells of generated interfaces. Selection is a 3px accent edge on a flat row,
which is a "you are here" marker and deliberately not a severity signal.

The board's primary object is the ward scale — one calibrated axis with every patient
plotted on it. Segment widths are the real cut points from the band table, so the geometry
itself carries a fact about the model: the LOW band is narrow in score terms yet holds
71.5% of readings, and nearly half the probability space sits above the CRITICAL cut. Four
equal segments would have quietly misrepresented that.

### Responsive

Verified with a real viewport over CDP at 375 / 768 / 1024 / 1480px: `scrollWidth` equals
`innerWidth` and no element overflows. The original prototype had zero media queries.

---

## 5. Behaviour

Every glance at this screen is a resumption rather than a continuation — ICU nurses are
interrupted on the order of fourteen times an hour. So nothing is transient: no toasts, no
auto-dismissing banners, no hover-only content, no state that expires.

Three degraded states must look different from one another: below the sufficiency floor
(no score, no band, no prompt), explanation attempted and failed (everything else still
renders, fixed string shown verbatim), and explanation never attempted. A refusal must
never read as LOW, and must never look like a loading state or an error — it is a result.

Age is disclosed and never gated. Staleness is a timestamp, never a fade: a faded value
reads as disabled, and a stale CRITICAL reading is not less important than a fresh one.

The band is never re-derived from the score. It arrives already settled by the hysteresis
machine, and the band scale explains a band rather than computing one.

### Banned vocabulary

`rising`, `climbing`, `trending`, `trajectory`, `deteriorating`, `improving`, `worsening`,
`escalating`, `heading toward`, and any delta, arrow or slope — in visible copy,
`aria-label`s and exports alike.

The tense rule is precise. "Risk of deterioration" is the band's meaning and is always
fine. "Has been deteriorating" is a claim about the past that nothing in the model
supports.

### Motion — a narrow, documented exception

The rule above is that motion must not convey state. The ventilation rhythm on the patient
screen is a deliberate carve-out from that rule, not an exception hiding inside it.

Its period comes from the patient's charted respiratory rate and its amplitude from the
band. That split is the whole argument: IEC 60601-1-8 specifies alarm indicators by flash
*frequency*, so frequency is the channel that carries alarm priority, and here it is set
by physiology rather than severity. Amplitude is not a channel the standard addresses.

The visible effect is still "faster when sicker", because respiratory rate genuinely
tracks band in ventilated patients — CRITICAL at 28/min against LOW at 14 — but it is true
rather than encoded.

The form is constrained and should not ship without all of it:

- One instance, on the patient screen only. Never board rows: viewers track three to four
  moving objects, and sub-Hz rate differences are imperceptible, so seven breathing rows
  would be noise carrying no signal.
- On demand, six cycles, then it stops. It never auto-starts, so WCAG 2.2.2 never attaches
  and no pause control is needed — which matters, because a pause control is one of the
  behaviours that would make this read as an alarm.
- A bounded fill in a fixed track, never a growing glyph. Looming motion captures attention
  involuntarily.
- Continuous, 100% duty, achromatic. A flashing indicator is a two-state square wave at
  20–60% duty; 100% duty is the standard's non-flashing row.
- Beside the numeral it encodes, supplementing it rather than replacing it.
- The resting frame is the correct static appearance, because the global reduced-motion
  rule freezes the animation there.

**A heartbeat was requested and is not built.** There is no heart-rate field in the eleven
frozen parameters, and driving a beat rate from the band instead would make severity
determine frequency — which is precisely the alarm indicator's encoding scheme rather than
merely something adjacent to it.

---

## 6. Code conventions

Plain React: `useState` and `useEffect`, props down, one component per file named for what
it is. No custom abstraction layers, no defensive noise, no logging telemetry.

Variants come from the maps in `src/lib/bandStyles.ts`, so restyling a state is an edit in
one place. Screens depend on the data contract and never on the mock — all access goes
through `src/data/feed.ts`, and swapping in a real transport is a change to that file
alone.

`WardProvider` holds the only state in the product: which input sources are switched off in
the simulation. Everything else is still derived, and `applyOfflineDevices` is pure.

Tailwind class names are written out in full. The scanner reads source text statically, so
a template like `bg-band-${band}-tint` produces no CSS.

---

## 7. Sources

- RCP NEWS2 observation chart — <https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/>
- IEC 60601-1 §7.8.1 indicator-light note, via the MECA alarm standards cross-reference —
  <https://60601-1.com/wp-content/uploads/2019/04/meca-alarm-standards-cross-reference-2015-04-01.pdf>
- ANSI/HFES 100-2007 §7.2.5–7.2.6, display legibility and colour coding
- WCAG 2.1 SC 1.4.1 / 1.4.3 / 1.4.11, and 2.2.2 Pause, Stop, Hide —
  <https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html>
- Franconeri & Simons (2003), *Perception & Psychophysics* 65:999–1010, on looming and
  involuntary attention capture
- Hamilton Medical "Dynamic Lung", the precedent for animating ventilation at real
  respiratory rate — <https://www.hamilton-medical.com/en_US/Products/Technologies/Ventilation-Cockpit.html>
- IBM Carbon colour tokens — <https://carbondesignsystem.com/elements/color/tokens/>
- Atkinson Hyperlegible — <https://www.brailleinstitute.org/freefont/>
- PulseMind data dictionary and frontend data contract, in `planning/`

**Treated as unverified and not relied on for any rule above:** IEC 60601-1-8 flash
frequencies and duty cycles are behind a paywall and corroborated only by secondary
sources; ANSI/AAMI HE75:2025 numeric recommendations could not be obtained.
