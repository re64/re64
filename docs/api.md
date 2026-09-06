# The re64 MCP API, as it stands

Seventy-two tools, extracted from the live `tools/list` schema rather than from
the source, so this is what a client actually sees. Companion to
`docs/model.md`: that one is the document, this one is how you reach it.

No history here either. `CLAUDE.md` says why each of these exists and what it
replaced.

---

## How it is reached

```
claude mcp add --transport http re64 http://127.0.0.1:5164/mcp \
  --header "X-Re64-User: <user id>"
```

The transport is **stateless** — a fresh `McpServer` per request — and MCP lives
inside the web server, so an agent's edit goes through the same `runOps` a click
does and lands in an open browser without a reload.

**Identity rides on the `X-Re64-User` header, never in a tool schema.** A model
can omit a parameter, invent one, or claim to be somebody else, and removing the
parameter later would break every schema carrying it. Three outcomes, kept
apart: a claim matching a known user is that user; a claim matching nothing is
believed and recorded as given; no claim at all is anonymous. `whoami` reports
which. Sessions come from `Mcp-Session-Id` where the host issues one, or
`X-Re64-Session`.

---

## Conventions

**Every tool takes `project` and `target`.** `project` selects the project;
`target` selects the view to answer for, and every answer reports the one it
used. Omitting `target` uses the project's `defaultTarget`. Naming a target that
does not exist is refused rather than answered for with a different stack.

**Addresses** are `"$8000"`, `"0x8000"` or `32768`, anywhere an address is
taken. Ranges are inclusive at both ends. `extent` is a byte count.

**`expectVersion`** on a write refuses if the project has moved since you read
it — the conflict dialog an agent cannot be shown. The version comes from
`describe_project`.

**Writes return more than `ok`:**

| field | what it says |
|---|---|
| `did` | one line per operation, in addresses |
| `claims` | each id beside the address it was minted for |
| `scope` | `layer:<id>`, `target:<name>` or `machine` — what the claim belongs to |
| `covers` | the span, spelled out, when an extent was given |
| `instructions` | before, after, and the delta a decision unlocked |
| `orphaned` | instructions this edit stopped decoding, when it stopped any |
| `warnings` | anything this edit made true |
| `rejected` | batch entries declined, with the reason |

**The batch contract, on every batch tool:** apply what is applicable, report
what was declined in `rejected`, and fail only when nothing was applicable.

**Ids are how you name a thing.** An address cannot identify a claim — several
cover any interesting one — so corrections are by id, and every write hands the
ids back. Auto-generated names (`sub_`, `loc_`, `dat_`) are marked
`writable: false` and their ids withheld, because nothing stored them.

---

## The tools

### Orienting

Where you start, and what the project is.

| tool | arguments | |
|---|---|---|
| `list_projects` | — | Every project on this server, and the users an edit can be made as |
| `create_project` | **name** | Start a project with nothing in it: no layers, no bytes |
| `describe_project` | — | What a project contains: its layers, its declared regions, where disassembly starts, and how much of it has been named by a person rather than by the disassembler |
| `whoami` | — | Who this server thinks you are, and whether your session is your own |
| `list_participants` | — | Who is in this project: people in a browser and other agents, online first, with when each was last seen |
| `list_targets` | — | The named views this project has over its layer stack, which is selected, and every layer with the id a target is defined in terms of — including layers the current selection hides, since that is how you find the view that shows them |
| `list_roots` | — | Where decoding starts |

### Reading

Structured rows and records, never rendered text you have to parse.

| tool | arguments | |
|---|---|---|
| `read_disassembly` | **start**, lines | Disassembly from an address |
| `export_listing` | start, lines, end | The disassembly as a listing, the way a hand-written one reads: any constants used in the span as an equate block, then the rows |
| `read_bytes` | **start**, **length** | The raw bytes at an address, as hex and as base64 |
| `list_claims` | source, type, namePattern, from, to, limit | Labels, narrowed by where they came from, their type, their name, or an address range |
| `claims_at` | **at** | Every claim covering an address, with nothing resolved |
| `list_comments` | limit | Everything written about this project, in address order — what has been understood so far, without reading the listing to find it |
| `list_constants` | — | Every declared constant, with its value |
| `list_decoders` | — | Decoders this project carries, with their source |
| `list_types` | — | Every record layout this project declares, with its fields in memory order and where each type is meant |
| `list_warnings` | — | What the disassembler could not make sense of |

### Searching

Who touches this, and what is left to do.

| tool | arguments | |
|---|---|---|
| `find_references` | **address**, direction | What refers to an address, and what it refers to |
| `find_instructions` | mnemonic, from, to, limit | Every instruction matching a mnemonic, an operand range, or both — each with the routine it sits in |
| `find_immediates` | value, limit | Every instruction loading an immediate value, optionally just one value, with whatever constant is already bound there |
| `find_bytes` | **pattern**, limit | Every place a sequence of bytes occurs |
| `find_unnamed` | kind, limit | Addresses the disassembler had to invent a name for, most-referenced first |
| `find_undecoded` | limit, minimumBytes | Spans of bytes nothing has explained: no claim says what they hold and no root reaches them, so nothing decoded there either |

### Analysing

What code *does*, by reading it or by running it.

| tool | arguments | |
|---|---|---|
| `effects` | **address**, follow | What the code at an address touches — registers, flags and memory — over a scope you choose |
| `call_graph` | **address**, depth | Who calls a routine, and what it calls, to a depth |
| `run_block` | **address**, registers, memory | Execute the block at an address with values you choose, and see what comes out |
| `run_program` | **from**, stopAt, maxInstructions, capture, expectVersion | Run the program from an address until it leaves the bytes this project holds — which is how a loader exits once its work is done, so no limit has to be guessed |
| `run_decoder` | **start**, **length**, source, decoder, params | Run a decoder you write over a span of bytes, and see what it produces |
| `disagreements` | — | Where this project contradicts itself: one name reaching two addresses, two claims reading one span differently, a decode root inside somebody else's data |

### Saying things about addresses

The claim vocabulary. Adding always adds; correcting is by id.

| tool | arguments | |
|---|---|---|
| `add_claim` | **at**, name, is, typeId, extent, root, encoding, view, comment, expectVersion | Say something about an address |
| `add_claims` | **claims**, expectVersion | Say several things at once, as one action |
| `set_claim` | **id**, name, is, extent, root, encoding, view, expectVersion | Correct a claim, by its id |
| `remove_claim` | **id**, expectVersion | Take back a claim, by its id |
| `mark_function` | **address**, name, expectVersion | Declare an address a subroutine, creating a label if there is none |
| `unmark_function` | **address**, expectVersion | Take back a function declaration |
| `set_primary_name` | **address**, **name**, expectVersion | Choose which of several names at an address is shown where nothing says otherwise |
| `bind_name` | **address**, **name**, **from**, to, expectVersion | Say which name the operands referring to an address mean, over a span |
| `unbind_name` | **address**, expectVersion | Let the operand at an address resolve by the usual rule again |

### Comments

Their own objects, with their own ids and order.

| tool | arguments | |
|---|---|---|
| `add_comment` | **address**, **text**, placement, expectVersion | Add a comment about an address, and return its id |
| `add_comments` | **comments**, expectVersion | Add several comments in one call, as one action |
| `edit_comment` | **id**, text, placement, expectVersion | Revise a comment by id: its text, its placement, or where it sits among the comments at its address |
| `remove_comment` | **id**, expectVersion | Delete a comment by id |
| `reorder_comments` | **address**, **ids**, expectVersion | Put the comments at an address in the order given, by id |

### Declarations

Project-level tables a claim or a site points at.

| tool | arguments | |
|---|---|---|
| `add_constant` | **name**, **value**, expectVersion | Declare a name for a byte value: EMPTY_CELL = $00, ORANGE = $08 |
| `add_constants` | **constants**, expectVersion | Declare several constants in one call, as one action |
| `edit_constant` | **id**, name, value, expectVersion | Revise a declared constant by its id: its name, its value, or both |
| `remove_constant` | **name**, expectVersion | Forget a declared constant, by id or by a name that reaches exactly one |
| `bind_constant` | **address**, **name**, expectVersion | Say that the immediate operand at an address means a named constant, so it renders as #ORANGE rather than #$08 |
| `bind_constants` | **bindings**, expectVersion | Bind several sites in one call, as one action |
| `unbind_constant` | **address**, expectVersion | Read the operand at an address as its literal value again |
| `set_decoder` | **name**, **source**, id, expectVersion | Keep a decoder in the project so it can be used again and by somebody else |
| `remove_decoder` | **id**, expectVersion | Drop a decoder from the project |
| `add_type` | **name**, **size**, **fields**, expectVersion | Declare a record layout: what the bytes of one array element mean |
| `edit_type` | **id**, **name**, **size**, **fields**, expectVersion | Correct a record layout, by its id |
| `remove_type` | **id**, expectVersion | Take back a record layout, by its id |

### Building a project

Getting bytes in, and arranging them.

| tool | arguments | |
|---|---|---|
| `prepare_upload` | **name** | Get a URL to PUT a binary to |
| `add_byte_layer` | **type**, **path**, name, address, expectVersion | Add a layer over bytes the project holds — which is what turns an uploaded binary into something to disassemble |
| `add_layer` | **name**, expectVersion | Add a symbols layer: names for addresses that hold no loaded bytes — zero page variables, I/O registers, KERNAL entry points |
| `add_rom_layer` | **rom**, expectVersion | Link a machine ROM into this project, as reference rather than as something to read |
| `remove_layer` | **id**, expectVersion | Take a layer out of the project |
| `list_disk_files` | **name** | The directory of a .d64 disk image this project holds — what is on the disk, and the path to give add_layer for each entry |
| `set_target` | **name**, layers, entryPoints, order, description, expectVersion | Declare a named view: which layers are linked in, in what order, where each one lands, and where disassembly starts beyond what they contribute |
| `remove_target` | **name**, expectVersion | Forget a view |

### History and export

What happened, and getting it out.

| tool | arguments | |
|---|---|---|
| `undo` | — | Take back your own most recent action — the whole of it, however many changes it made |
| `changes_since` | cursor, tag, limit | What has happened to a project since a position you were given |
| `tag_project` | **name**, note | Mark this point with a name you can come back to — a tag, in the git sense |
| `list_tags` | — | Points that have been marked, oldest first, each with how many changes have been recorded since and whether the project still looks the way it did — which are different questions, since an edit and its undo move the count and not the content |
| `remove_tag` | **name** | Forget a tag |
| `export_project` | — | Return the project as .re64 text |
| `set_project_description` | **description**, expectVersion | Say what this project is: provenance, what the binary is, anything a reader should know before the first line |

### Talking

People and agents on one document.

| tool | arguments | |
|---|---|---|
| `post_message` | **text** | Say something to whoever else is in this project — people in a browser see it live |
| `read_messages` | limit | What people and agents working this project have said to each other |

---

## Known tensions

Stated without recommendations, as in `docs/model.md`.

**Four spellings for an address.** One concept, four argument names across the
surface, and the choice is not predictable from what the tool does:

| | |
|---|---|
| `at` | `add_claim`, `add_claims` |
| `address` | `add_comment`, `find_references`, `effects`, `set_primary_name`, `bind_name` |
| `start` | `read_disassembly`, `read_bytes`, `export_listing`, `run_block` |
| `from` / `to` | `find_instructions`, `find_immediates`, `bind_name` |

Both readers in experiment 8 lost calls to this — one counted five rejections
finding `read_disassembly {start, lines}` after trying `from`/`to`, `count`,
`limit`, `rows` and `end`. `bind_name` takes `address` *and* `from`/`to`, which
mean different things.

**`target` is on every tool, including those with no view.** It is injected once
in the `tool()` helper rather than declared seventy-two times, which is why
`list_projects`, `whoami` and `create_project` all advertise it and none can use
it.

**Nobody passed `target` once, in 724 calls of experiment 8.** Both projects had
a single target, so there was no reason to — the optional-but-reported design is
untested rather than vindicated.

**`set_decoder` is named for an upsert and behaves like an add.** Called twice
with one name it makes two decoders; it revises only when given `id`. One reader
left twenty-one identically-named decoders in a project. `run_decoder` takes
`decoder`; `remove_decoder` takes `id`; both mean the same thing.

**A decoder's source contract is undiscoverable.** The source is a *function
body* with `bytes` already in scope, returning `{kind: "text", lines: [...]}` or
a bitmap. Anything shaped like a function — `function decode(b) {}`, an arrow,
`export default` — is never called, and every one of them fails with the same
message about the return value, which describes the wrong problem. Two readers
each spent six round trips on it.

**`add_layer` makes symbols layers only.** Byte layers are `add_byte_layer`,
ROMs are `add_rom_layer`, and there is no `layer.set`, so a layer cannot be
renamed after creation.

**`post_message` caps at 2000 characters and refuses rather than truncating.**
It is the tool where you most want to hand over a table; one reader hit the cap
four times.

**`tools/list` is not reachable through `experiments/mcp-call.sh`**, so agents
learn the surface from error messages. That is deliberate for the experiments —
a wrapper that helped would suppress the signal — but it means every run spends
calls probing schemas.

**Three concepts share two words.** `view` on a claim is a rendering format
(`char:8`, `snippet:<id>`); a *target* is also routinely called a view, in
prose and in tool descriptions; and both can appear in one call.

**What agents reached for that does not exist**, from experiment 8 — the highest
signal these runs produce, since inventing a name is an unguarded statement
about what the API should have had:

`bind_decoder` · `find_strings` · `render_screen` · `screen_address` ·
`describe_character` · `find_char_uses` · `list_routines` · `list_hygiene` ·
`list_symbols` · `compare_spans` · `render_glyph` · `remove_entry_point` ·
`set_entry_points` · `list_tools`

Three of those cluster: on a program whose entire state lives in screen memory,
converting `$0592` to row 10 column 2 was the most repeated hand arithmetic of
both runs.

Two more were guesses at the name of something real — `warnings` and `hygiene`
for `list_warnings`, whose count `describe_project` reports without saying which
tool shows it.
