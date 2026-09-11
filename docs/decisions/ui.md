# The browser

The web front end: the stack, the disassembly widget, the arrow gutter, the panels, and how a repaint behaves under a live collaborator.

> **History, not reference.** Each entry is a decision with the bug that produced
> it. Entries are accurate as of when they were written and are **append-only**:
> a superseded decision keeps its text and gains a note pointing forward, because
> the value of a corrected decision is the correction. For what is true *now*, see
> `docs/05-model.md`, `docs/06-algebra.md`, `docs/07-api.md` and `docs/04-developer-guide.md`.

---

## UI Design Decisions

The eventual web UI is built around a single central widget: a disassembly view
holding assembler lines, comments, cross-reference arrows, and inline editable
elements (labels, comments). These decisions are recorded here because they
constrain the core data model, not just the presentation layer.

## UI stack: web components, no framework

Shoelace (`@shoelace-style/shoelace`) supplies application chrome — split
panels, and later menus, trees, dialogs, toolbars. Components are imported
individually so the bundle carries only what is used. Adoption is incremental:
add a component when a hand-rolled one would otherwise be written.

Rejected: **React with a data-dense component library** (Blueprint, Mantine).
The deciding factor is that CodeMirror 6 is the hero widget and is *already*
reactive — most of `src/ui/main.ts` is `StateField`/`StateEffect`/decoration
code. A framework would insert a wrapper and a boundary at exactly the most
complex point in the app, where CM6 manages its own DOM by design, while its
declarative-render benefit lands on the simplest panels — `renderMap()` is a
few dozen lines of plain DOM building.

Standard DOM is also the cheaper thing to reason about from cold. `<sl-split-panel>`
is an HTML tag: greppable, self-describing, documented outside this repo. A
bespoke component tree has to be reconstructed mentally before anything can be
changed, and this project is worked on in bursts across sessions.

The CRDT counter-argument is real but weaker than it looks: the server is
already the source of truth and the client already re-fetches and rebuilds, so
that *is* the re-render model, only explicit.

Nothing is foreclosed. `dockview-core` is also framework-agnostic, so if panels
later need true IDE docking it drops in beside this rather than replacing it.
Cost so far: +49KB, most of it the one-time Lit runtime.

## Widget: CodeMirror 6, read-only with decorations

Chosen over a hand-rolled virtualized list mainly because of **variable row
heights**. Inline multiline editing (a block comment expanding in place) breaks
naive virtualization: rows growing above the viewport cause scroll jump unless
anchoring is handled explicitly. CodeMirror 6's height map already handles
variable-height lines (soft wrapping produces them constantly) and anchors
scroll position across height changes.

What it provides:
- Virtualization — a full 64K map is tens of thousands of rows.
- Block widgets for multiline inline editors and standalone comment rows.
- Inline widgets for editable label tokens.
- Atomic/read-only ranges so generated assembler text is not directly editable.
- Gutters, for the cross-reference arrow layer.

Consequence: **edit inline, not in popups.** Block comments expand in place as
block widgets; label renames are in-place token editors. Popups/overlays are
reserved for things genuinely outside document flow — the aggregated xref list,
a region-kind picker.

Label editing uses both widget forms, picked by whether a label already exists:

- **Renaming** replaces the label token with an input (`Decoration.replace`), so
  the trailing `:` and xref stub stay put and the row does not reflow.
- **Naming a new address** has no token to replace, so the editor gets its own
  block row above the instruction (`Decoration.widget({block: true})`), indented
  to the label column — the row it is about to become.

Enter commits, Escape reverts, and **blur reverts rather than saving**: an empty
name means "delete this label", so a blur-commit would turn an accidentally
cleared field into a silent deletion.

**Line wrapping is a toggle, off by default** (`w`, or the Wrap button). A
disassembly is columnar and wrapping puts an operand under its own address, which
costs more than it saves on rows that fit; comments are the case it exists for,
since a paragraph about a routine has no columns to protect and is unreadable at
three screens wide. Wrapped rows get a hanging indent so continuations clear the
address column and the comment reads as one paragraph.

It lives in a `Compartment`, because `lineWrapping` cannot be added to a running
editor otherwise and rebuilding the state would throw away the scroll position
and selection while somebody is reading.

Two things that cost a browser round trip to find:

- **CodeMirror owns `view.dom.className` and rewrites it wholesale.** A class
  added with `dom.classList.add` survives until the first update that touches it
  — gaining `cm-focused` on the first click is enough — and then vanishes, taking
  whatever CSS depended on it. Go through `EditorView.editorAttributes` instead,
  inside the same compartment, so the class is part of the configuration rather
  than something applied beside it.
- **A duplicate key in a theme object silently drops the earlier rule.** It is a
  plain object literal, so adding a second entry for `.cm-arrow-gutter
  .cm-gutterElement` would have thrown away its font and padding without a
  warning. Merge, never append.

**Comments are wrapped in the row model, at a fixed column of 100.** A wrapped
line becomes *another comment row at the same address*, identical in every way to
one the author broke with a newline — so there is no continuation row to style,
no special case anywhere, and no way for the two to drift apart.

Three things fall out of putting it in the model rather than the view, and the
first is why it has to be there:

- **The CLI needs it.** A terminal cannot soft-wrap a listing into something
  readable; it needs real rows. Anything living in CodeMirror could never have
  served the consumer that most wants a wrapped comment.
- **The arrow gutter comes out right for free.** It is rendered per row, so a
  comment occupying three rows gets three cells and its verticals connect. A
  soft-wrapped line is still one document line and gets one cell, which is
  exactly where the connector broke.
- **Nothing depends on the viewport.** Wrapping to the window would make the row
  model depend on the window, so every resize would rebuild the document on top
  of whatever selection or inline editor was open. A column is a property of a
  listing, the way it is in a hand-written disassembly.

`AnalyzeOptions.commentWidth` is the seam for configuring it; nothing sets it
yet.

**There was briefly a soft-wrap toggle as well, and removing it is the lesson.**
It was added first, before the model wrap, and once comments wrapped at a column
it had nothing left to do on any normal pane — so it needed a compartment, a CSS
hanging indent, a dimmed-when-idle affordance and a `requestAnimationFrame`
measurement purely to stop looking broken. Machinery accreting around a feature
to make it *appear* to work is the signal that the feature is in the wrong layer.
One mechanism, in the model, serving all four consumers.

Two exemptions it deliberately keeps. An **inline** comment shares its row with
an instruction and cannot be broken, so those rows may still exceed the column —
they are the only ones that do, in the browser and in the CLI alike. And a
**word longer than the width** is left long rather than split, since it is
usually an identifier or an address and breaking it makes it unselectable.

Two gotchas worth remembering:Two gotchas worth remembering:

- A read-only view (`EditorView.editable.of(false)`) is **not focusable**. Without
  `contentAttributes: {tabindex: "0"}`, clicking a line leaves the keymap with no
  listener and every shortcut silently does nothing.
- Widgets holding form controls must return `true` from `ignoreEvent()` and stop
  propagation on keydown, or the editor's own keymap eats the typing.

Operands pointing outside the loaded map — zero-page variables, I/O registers,
KERNAL entry points — render as plain grey names rather than links. They are
named but have no bytes, and on 6502 they are common enough that making them
clickable means constantly landing on an error.

## Label types are backend concepts; the UI exposes one

The four label types are genuinely distinct concepts, even though the
disassembler currently treats three of them identically (all get queued):

- `entry` — where execution *starts*. Emitted by a layer or region, not by the
  user: a PRG layer sets `defaultRegionKind = "code"` and labels its load
  address. No caller, no return contract.
- `function` — a subroutine, from analysis (a JSR target) or declared by the
  user. Has callers and a return contract.
- `code` — a branch or jump target found by analysis. Intra-function.
- `address` — a named address, not queued. The default.

Do **not** collapse these because they behave alike today. That sameness is an
artifact of the disassembler only ever queueing them; they diverge as soon as
there is call-graph or basic-block analysis, which is where the information
would be needed and no longer recoverable.

The UI exposes only `function` (`f`), because that is the one a user reaches
for while reading code — promoting a `loc_` they have recognised as a
subroutine, or declaring one nothing references so it gets decoded at all.
`entry` and `code` render as read-only tags so the analysis stays visible. The
project file remains the escape hatch for anything else, including
hand-written `code` labels. General capability in the backend, common cases in
the front end.

Auto-generated names encode their type in the prefix:

```
sub_XXXX → function    loc_XXXX → code    dat_XXXX → address
```

So promoting an auto label renames `loc_XXXX` to `sub_XXXX`; leaving the old
prefix would contradict the tag. This cannot collide with auto-labelling,
because an auto name always encodes its own address and any existing label at
that address suppresses generation there (`allLabels.resolve(...)` short-circuits
the loop). Clearing `function` from a label still carrying an auto-shaped name
deletes it outright rather than leaving a redundant untyped entry; a name the
user chose is kept and only its type is cleared.

## Cross-reference arrow rendering

Two distinct styles, to keep the gutter from filling with long parallel lines:

**Nested margin arrows** for local references. 6502 relative branches are
limited to −128..+127 bytes (~40–60 instructions), so a `branch` reference is
*structurally* guaranteed local and always renders nested. Absolute `call`,
`jump`, and `data` references are usually distant.

**Open-ended stubs** for distant references: a short stub with a label, click to
jump. Both directions must be rendered — outbound (`▸ DrawGrid`) at the source,
inbound (`◂ from $8A12`) at the target. The inbound side is what reveals "this
routine has callers" when sitting at a function head.

Rules:
- **Classify by address distance, never by viewport.** Viewport-dependent
  classification makes arrows flip style while scrolling, reflowing the gutter
  and shuffling lane assignments under the cursor. Distance-based
  classification is model-derived, stable, and cacheable; nested arrows simply
  clip at the viewport edge.
- Threshold ~100 rows. Given the ISA, this only arbitrates same-page `JMP`s and
  near data references.
- **Lane allocation** is interval-overlap, ordered **shortest span first**: each
  arrow takes the innermost lane no overlapping arrow already holds. Ordering by
  length is what produces correct nesting — an arrow contained inside another is
  necessarily shorter, so it claims the inner lane and forces its container
  outward. Do *not* sweep by start address: that classic interval-graph greedy
  uses fewer lanes but inverts nesting, because an enclosing arrow that merely
  begins earlier steals the inner lane from the short arrow inside it.
  Endpoints touching counts as overlap, since two corners would land in one
  cell. Cap at 4–6 lanes; anything needing more demotes to a stub, which is what
  permanently bounds gutter width. Long arrows demote first under this ordering,
  which is the intended bias.
- **Aggregate hot targets.** A common subroutine may have dozens of inbound
  references; collapse to a single `◂ 14 refs` stub opening a popover list.
- Stub labels use the target's resolved label name, falling back to the address.
- Clicking a stub pushes onto a **navigation stack** — back-jump is the most-used
  key in any disassembler.
- Data references get no arrow at all. Only control flow (branch/jump/call) is
  drawn; data refs would fill the margin with noise.

Lane allocation and gutter rendering live in `src/core/view/arrows.ts`
(`allocateArrowLanes`, `renderArrowGutter`). They are model-derived and pure, so
the **CLI draws the same gutter as the web UI** — `formatRows()` prefixes it,
and `--no-arrows` turns it off. Box-drawing glyphs need no special handling in
a terminal. The gutter arrives as one pre-rendered
string per row, kept out of the document so copying disassembly does not drag
box-drawing characters along.

One rendering gotcha: box-drawing glyphs fill their em box, not the taller line
box, so unscaled verticals show a gap at every row boundary. The gutter span is
stretched with `scaleY` to make segments meet.

## The Debug tab

Application state in one place, because the interesting parts are split across
two machines and neither can see the other. The undo stack, the analysis
timings and the fetched blobs are the browser's; the CRDT document, the crash
log and the durable undo record are the server's, reached through `/api/debug`.

It is laid out so **disagreement is what shows up**: the document version beside
whether it matches this browser's, the base revision beside the stored one. A
value on its own means little; a pair that has drifted apart is the bug.

Two entries earn their place by naming things that are otherwise invisible:
*unreplayable updates*, which is non-zero only when someone wrote around the
document, and *shared with this browser: no*, which is the honest answer about
the two undo stacks.

The snapshot is a copy. A panel that could reach into the live arrays would be
able to corrupt an undo stack by being looked at, and `session.debug()` is
tested for that.

## Layers list, regions tree

The memory map is a **sidebar beside the disassembly**, not a tab. It is
context for reading code — which layer supplies these bytes, why this span is
text — so it has to be visible *while* reading. As a tab it forced a mode
switch to answer a question about the line under the cursor. It is a resizable
`<sl-split-panel>`; collapsing is a zero-width split, so dragging the divider
to the edge and pressing the toolbar button reach the same state, and the width
you chose is still there when you reopen it. Both are remembered in
`localStorage`, with every access wrapped because storage throws outright in
private windows and when site data is blocked.

It renders two different relationships in two different shapes, because they
are not the same relation:

- **Layers stack by z-order**, which is a *list*. Order is meaningful and
  editable; a tree would imply containment that does not exist.
- **Regions contain one another by address range**, which is a *tree*. Drawing
  it makes the override visible — why $8080 reads as text inside a code layer.

**Layers are numbered from the bottom** — the platform layer is level 0, and
higher numbers sit on top and shadow what is below. Do *not* surface
`MemoryMap`'s array index, which counts from the top because that is the order
bytes are searched: that is an implementation detail, it puts the foundation
layer at the highest number, and it reads in the opposite order to the project
file, where layers are declared bottom-up. The list is laid out with CSS
`column-reverse` so the stack reads the way it stacks.

The tree is derived at render time (`buildRegionTree` in
`src/server/map-view.ts`), never stored. A stored hierarchy would make
concurrent edits reparent nodes, which is exactly what the flat model avoids.
Regions that merely overlap without containment stay siblings rather than being
forced into a parent, since the model permits overlap and hiding it would
mislead.

D64 detail is a *property of a layer*, not a level of nesting: a layer sourced
from `disk.d64:filename` shows the image and file name. Modelling disks as
containers would be a real change to `FileLayer` and the schema, and nothing
needs it yet.

## Rendering under a live collaborator

**Repaints are deferred entirely while an inline label editor is open.** Blunt
and deliberate: a repaint replaces the document and rebuilds decorations, which
would pull the field out from under someone mid-word. The disassembly view is
not a collaborative text buffer and must not start behaving like one.

It also makes a latent bug unreachable — `LabelEditWidget.eq` compares by label
*name*, so a remote rename of the address being edited would rebuild the widget
even if editor state survived. Anyone removing the deferral has to fix that, and
must anchor on the **label id**: several labels can share an address, so an
address cannot identify one. Only the "naming a new address" case may key on an
address, because no label exists there yet.

Repaints otherwise coalesce on `requestAnimationFrame`. A hidden tab gets no
frames, so a remote edit arriving while nobody is looking waits until the tab is
looked at again — wanted, since re-analysing an invisible view is pure cost, but
it makes a background tab inspected programmatically look like a broken sync
when the socket under it is fine. That cost an hour once.

`analyze()` runs per
update with no incremental path — about 10–20ms for Gridrunner. If it ever
exceeds ~30ms the UI will stutter under a collaborator regardless of how the
document is updated, and that is the number to measure before optimising
anything else.

## Bytes as pictures

A C64 program's data is mostly images, and a hex column is the worst possible
way to look at one. Every reader in experiment 2 ended up scraping hex out of a
listing and writing their own bitmap printer, which is the clearest available
statement that this belongs in the tool.

**A decoder returns pixels, not pictures.** `src/core/view/bitmap-view.ts` is
DOM-free like `map-view.ts`: it hands back palette indices, and each consumer
draws them its own way. That is what lets one decoder serve the browser, the CLI
and an agent — and it is the contract a user-supplied decoder will have to
satisfy, so it was worth settling while the only implementations are ours.

**A bitmap region renders as text art, in the row model.** Not an inline canvas:
the same rows go to the browser, to `re64 disasm` and to `export_listing`, so
nothing is built twice and the listing somebody exports looks like the listing
they were reading. Colour and zoom belong in an explorer panel, where you are
choosing a format rather than reading code. Every art line repeats the address,
exactly as a multi-line comment does — a wrapped line and a hand-broken one are
the same thing here too.

**`view` is one string, not three fields.** `char:8`, `bits:3`, `sprite`. A
format, a stride and a column count would each have to be threaded through the
schema, the line serializer, the CRDT assignment, the op type, the diff, the
inverse and four call signatures — that is twelve sites per field. One string
diffs readably and leaves room for `snippet:<id>` without doing it again.

`bits` with a stride is the format that matters: sliding the byte width until an
image snaps into focus is how anyone has ever found graphics in a dump. The
others are the hardware's own layouts, worth having because guessing a sprite's
stride is tedious when only one is legal.

Default colours are black and white rather than the machine's own light-blue on
blue. Authenticity would be unreadable both as terminal shading and as a
thumbnail, and the real colours live in colour RAM somewhere else entirely, so
any choice here is a viewing default rather than a claim about the program.

**The explorer is a place to look, not a view of the model.** It writes nothing
to the project until you press the button, which matches how anyone actually
finds graphics in a dump — point at an address, slide the width, stop when a
picture appears — and means being wrong costs nothing. Once you have found
something, declaring it records what you found. It repaints itself on a slider
drag without going through `render()`, which would re-analyse the program for a
change that is purely about looking.

It brought the **first `EditorView.updateListener` in the codebase**, so the
panel can follow the cursor; `currentAddress()` had only ever been polled on
demand. Coalesced on a frame like every other repaint.

**Adding an interpretation is a compile error everywhere it has to be, and that
was not true of the union it replaced.** `RegionKind` had exactly one
compile-time guard — `rowStrategy`'s `never` — and nine silent sites: the
runtime `REGION_KINDS` whitelist, the MCP `z.enum` and its hand-duplicated arg
union, the CLI kind string, the explained-kinds list in `undecoded`,
`shouldDisassemble`, `generateLabels`, the analysis filter, and a colour in
`index.html`. The runtime whitelist was the nastiest: miss it and every write
threw `Unknown region kind`, so a missing case looked like a broken tool.

Splitting the union is what fixed it, because the three things it conflated
have different shapes:

| | |
|---|---|
| `Interpretation["is"]` | what a **claim says** the bytes are |
| `LayerDefault` | what a **layer assumes**, where nobody has said |
| `ByteReading` | the **answer** to "how do I read this byte", which is either |

`code` and `unknown` only ever belonged to the middle one. Code is what bytes
are when nobody has said otherwise, so it is never something a claim says; the
absence of a statement is not a kind of statement. With them gone,
`rowStrategy`'s `never` covers an interpretation exhaustively, and the sites that
used to need finding by hand either type-check now or read a *legacy file's*
kind — which is spelled `LegacyRegionKind` where it survives, so it is obvious
that it describes a file rather than the model.
