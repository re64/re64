# The re64 MCP API

**Generated from the live `tools/list` schema** by `npm run gen:api`, so this is
what a client actually sees rather than what somebody remembered. A test
regenerates it and compares, because a committed generated file goes stale in
silence.

Companion to `docs/developer-guide.md`, which is how to use all this;
`docs/algebra.md`, which is why the writes are shaped the way they are; and
`docs/model.md`, which is the document these reach. `docs/decisions/agents.md`
says why each of them exists and what it replaced.

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

### Ids, and the one rule behind most of these signatures

**Everything you can address has an id, and the id is the only handle.**

- **`add_*` never takes an id.** The server mints it and hands it back.
- **`edit_*` and `remove_*` take one, and never create.** An id nothing holds is
  an error, not an invitation.
- **`edit_*` names only what changes.** Omitted is left alone; `null` clears.
  Sending a whole object reasserts fields you never read, which silently reverts
  a collaborator.
- **A name may resolve on a read and never on a write.** Whether a name is
  unambiguous is a property of what *you* have synced — a name reaching one
  constant for you may reach two for a peer — so a write keyed on one does
  different things depending on what arrived. Select a view by name; remove a
  constant by id.

Auto-generated names (`sub_`, `loc_`, `dat_`), a layer's own entry label and
built-in platform names are marked `writable: false` and their ids withheld,
because nothing stored them.

See `docs/algebra.md` for the full rules.

**Writes return more than `ok`:**

| field | what it says |
|---|---|
| `did` | one line per operation, in addresses |
| `claims` | each id beside the address it was minted for |
| `scope` | `layer:<id>`, `target:<name>` or `machine` — what the claim belongs to |
| `covers` | the span, spelled out, when an extent was given |
| `nestedInside` | the enclosing claim, when this one landed inside another |
| `instructions` | before, after, and the delta a decision unlocked |
| `orphaned` | instructions this edit stopped decoding, when it stopped any |
| `warnings` | anything this edit made true |
| `rejected` | batch entries declined, with the reason |

**The batch contract, on every batch tool:** apply what is applicable, report
what was declined in `rejected`, and fail only when nothing was applicable.

---

## The tools

88 tools.

### Orienting

What is here, who you are, and how far along it is.

#### `list_projects`

Every project on this server, and the users an edit can be made as. Start here when you do not know what exists.

#### `whoami`

Who this server thinks you are, and whether your session is your own. Identity comes from the X-Re64-User header and is never a tool argument, so there is no other way to find out — and an edit recorded against the wrong name is invisible until somebody reads the history. Worth one call at the start if you care how your work is attributed.

#### `describe_project`

What a project contains: its layers, its declared regions, where disassembly starts, and how much of it has been named by a person rather than by the disassembler. The last of those is the best single measure of how far along the work is.

#### `list_participants`

Who is in this project: people in a browser and other agents, online first, with when each was last seen. Membership lives in the document rather than in the socket's presence, so this is the same list a browser shows — and somebody who has left is still listed, marked offline, rather than vanishing.

#### `list_targets`

The named views this project has over its layer stack, which is selected, and every layer with the id a target is defined in terms of — including layers the current selection hides, since that is how you find the view that shows them.

---

### Reading

Structured rows, never rendered text — character offsets into a column are useless to a caller, which is the finding this whole surface was built on.

#### `read_disassembly`

Disassembly from an address. Each line carries both the rendered text and the fields behind it, so you can read it and act on it without parsing. Bounded; follow nextStart to continue.

| argument | type | | |
|---|---|---|---|
| `start` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `lines` | `integer` | optional | Default 80 |

#### `read_bytes`

The raw bytes at an address, as hex and as base64. For when you want to work on the data yourself rather than read a listing — your own script, your own decoder, your own arithmetic. These are the bytes the analysis sees, which is not the same as reading the file: a project is a stack of layers and the topmost one supplying an address wins, so a patch or a second file changes what is really there. Addresses nothing supplies are listed as unmapped rather than quietly returned as zero.

| argument | type | | |
|---|---|---|---|
| `start` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `length` | `integer` | **required** | How many bytes; 8192 at a time |

#### `render`

Draw a span and get a picture back, without touching the project. This is how you find out what data *is*: point at an address, pick a layout, look. Sliding the width until an image snaps into focus is how graphics have always been found in a memory dump, and until now nothing offered it — you had to add a claim, read the listing, then remove the claim and the comments it made. This writes nothing. `view` is `bits:<bytes-per-row>` for exploring, or the machine's own layouts: `char:<columns>` for an 8x8 font, `sprite:<columns>` and `sprite-multi:<columns>` for hardware sprites — which are addressed in 64-byte blocks, so a bank of them is 64 bytes apart and this steps that way. Which of hires and multicolour a sprite uses is a per-sprite bit the program sets at run time and is not in the data, so try both. `as: "grid"` is a contact sheet, every cell at once, which is what you want for finding things; `as: "frames"` is the same cells as an animated PNG, which is what you want for a walk cycle. The image comes back as a url to fetch, because an image inline is tens of thousands of tokens; small ones also come back as text art.

| argument | type | | |
|---|---|---|---|
| `claim` | `string` | optional | A claim id from claims_at or list_claims. Draws exactly what that claim covers, using its own view — so naming a sprite once makes it drawable by name afterwards. Give this or start/length/view, not both. |
| `start` | `string,number` | optional | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `length` | `integer` | optional | How many bytes to draw |
| `view` | `string` | optional | bits:<n> \| char:<n> \| sprite:<n> \| sprite-multi:<n> — n is per row. With a claim, overrides the claim's own view without editing it. |
| `as` | `grid` \| `frames` | optional | grid: one sheet (default). frames: an animated PNG, one cell per frame |
| `delayMs` | `integer` | optional | Frame delay for `as: frames`; default 120 |

#### `preview`

Read a span **as** something, without saying it is that. Writes nothing. `as: "text"` decodes it — name an encoding or get all three, which is usually the question. `as: "code"` decodes it linearly as instructions and reports how many bytes did not decode and how many opcodes are undocumented: data read as code usually shows both, real code usually shows neither. `as: "record"` with a typeId hands back the fields decoded, which is the read side of add_type. `render` has always done this for pictures. This is the same thing for the readings you cannot see: previously the only way to find out was to add a claim, look, and take it back — a probe that writes, in a document somebody else is reading. What the bytes *are* is still add_claim's to say, once you have looked.

| argument | type | | |
|---|---|---|---|
| `start` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `length` | `integer` | **required** | How many bytes |
| `as` | `text` \| `code` \| `record` | **required** |  |
| `encoding` | `petscii` \| `screen` \| `ascii` | optional | For as:"text"; omit to see all three |
| `typeId` | `string` | optional | For as:"record", from list_types |

#### `where`

What an address is, in the units the machine uses: which screen cell, which sprite pointer, and where its colour byte is. The inverse of the `screen(...)` and `sprite(...)` forms every address argument accepts — you can write `screen(10,2)` to get to `$0592`, and this is how you go the other way while reading a listing. Both conversions depend on runtime state rather than on the project — the screen base in `$D018`, the VIC bank in `$DD00` — so the answer names the bases it assumed, and you can override them.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `screenBase` | `string,number` | optional | Where this program keeps its screen; $0400 at power-on |
| `bank` | `string,number` | optional | The VIC's 16K bank; $0000 at power-on |

#### `list_claims`

Labels, narrowed by where they came from, their type, their name, or an address range.

| argument | type | | |
|---|---|---|---|
| `source` | `user` \| `layer` \| `platform` \| `auto` \| `analysis` | optional | user = somebody chose it; layer = the file named it; platform = the built-in C64 table; auto = the disassembler invented it; analysis = a pass concluded it |
| `type` | `entry` \| `function` \| `code` \| `address` | optional |  |
| `namePattern` | `string` | optional | Case-insensitive substring |
| `from` | `string,number` | optional | Inclusive; with `to`, narrows to a range |
| `to` | `string,number` | optional | Inclusive, like `export_listing`'s `to` |
| `limit` | `integer` | optional | Default 200 |

#### `claims_at`

Every claim covering an address, with nothing resolved. The read that makes an additive write safe: naming an address never replaces what is there, so this is how you see what is there before adding beside it — and how you get the id to correct one instead. Several claims covering an address is ordinary, not a fault; which of them renders is a separate question.

| argument | type | | |
|---|---|---|---|
| `at` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |

#### `list_roots`

Where decoding starts. A root is what makes bytes get decoded regardless of whether anything reaches them — a load address, an entry point, a routine nothing calls because it is reached through a jump table. There is no add_root or remove_root: a root is a field on a claim, so add_claim with `root` declares one and edit_claim with `root: null` takes it back. A root reported without an id is inherent to a file rather than something this project said, so there is nothing to take back.

#### `list_comments`

Everything written about this project, in address order — what has been understood so far, without reading the listing to find it.

| argument | type | | |
|---|---|---|---|
| `limit` | `integer` | optional | Default 200 |

#### `list_constants`

Every declared constant, with its value.

#### `list_types`

Every record layout this project declares, with its fields in memory order and where each type is meant. `unexplainedBytes` is how much of a record nobody has accounted for, which is a work queue rather than a fault: a reader who has proved nineteen fields of a 200-byte record has said something true.

#### `list_decoders`

Decoders this project carries, with their source. One kept here can be run again, and by anyone else in the project, without pasting it.

#### `export_listing`

The disassembly as a listing, the way a hand-written one reads: any constants used in the span as an equate block, then the rows. Plain text rather than JSON, so it is both what you compare against a reference and the cheapest way to read a lot at once.

| argument | type | | |
|---|---|---|---|
| `start` | `string,number` | optional | From the beginning if omitted |
| `lines` | `integer` | optional | Default 200 |
| `end` | `string,number` | optional | Alternative to `lines`: stop at this address |
| `claim` | `string` | optional | A claim id from claims_at or list_claims: lists exactly what it covers. Give this or start, not both. |

---

### Searching

Every hit says which routine it lands in, which is what makes a list of fifty addresses usable rather than a haystack.

#### `find_references`

What refers to an address, and what it refers to. Inbound entries carry the calling line, so you need not read each one separately.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `direction` | `in` \| `out` \| `both` | optional | Default both |

#### `find_instructions`

Every instruction matching a mnemonic, an operand range, or both — each with the routine it sits in. On this machine the range is the meaning: $D000-$D02E is the VIC-II (sprites, colours, raster), $D400-$D418 the SID, $DC00-$DC0F the CIA (joystick, keyboard). So "what makes a sound" is stores into $D400, and "what draws" is stores into $D000. For immediate values — how many lives, which colour — use find_immediates instead: an immediate names no address and cannot be in a range.

| argument | type | | |
|---|---|---|---|
| `mnemonic` | `string` | optional | STA, LDA, JSR … case does not matter |
| `from` | `string,number` | optional | Lowest operand address to match |
| `to` | `string,number` | optional | Highest operand address to match |
| `limit` | `integer` | optional | Default 100 |

#### `find_bytes`

Every place a sequence of bytes occurs. The search that does not care what anything means: the other copies of a table, where a magic value is written, whether a pattern recurs before there is any theory about why. Use ?? for any byte — the useful searches are nearly always partial, like "A9 ?? 8D 20 D0" for any store of a literal to the border colour. Each hit says which region and routine it lands in.

| argument | type | | |
|---|---|---|---|
| `pattern` | `string` | **required** | Hex bytes, spaces between, ?? for any: "A9 ?? 8D" |
| `limit` | `integer` | optional | Default 100 |

#### `find_immediates`

Every instruction loading an immediate value, optionally just one value, with whatever constant is already bound there. The question after naming one site: where else is this value loaded, and does it mean the same thing there? Only a reader can answer the second part. **This is the on-ramp to naming values**: what comes back is the batch `bind_constants` takes, once `add_constant` has declared a name and returned its id. A value with no name renders as `#$08` forever, and the answer says how many of these sites are in that state.

| argument | type | | |
|---|---|---|---|
| `value` | `string,number` | optional | Only sites loading this byte |
| `limit` | `integer` | optional | Default 100 |

#### `find_unnamed`

Addresses the disassembler had to invent a name for, most-referenced first. This is the work queue: an auto-named address is one that has been found and not yet understood. Their names cannot be edited by id — name the address instead. Returns them in `targets`, beside a `total` that counts them all rather than the page.

| argument | type | | |
|---|---|---|---|
| `kind` | `calls` \| `jumps` \| `data` \| `any` | optional | calls = sub_, jumps = loc_, data = dat_. Default any |
| `limit` | `integer` | optional | Default 50 |

#### `find_undecoded`

Spans of bytes nothing has explained: no claim says what they hold and no root reaches them, so nothing decoded there either. This is the orientation question on a project nobody has worked on yet — find_unnamed ranks what has already been reached, which on a fresh project is almost nothing. Biggest span first. Both kinds of answer shrink this list: `add_claim is:` says what bytes are, and `add_claim root:` says to decode them. It counts what is left to do rather than what is wrong, which is why it is not a hygiene check — on a fresh project it is the whole binary, and none of that is a fault.

| argument | type | | |
|---|---|---|---|
| `limit` | `integer` | optional | Default 20 |
| `minimumBytes` | `integer` | optional | Ignore holes smaller than this. Default 1. |

---

### Analysing

The answers say which they are: `effects follow:block` is exact because a block has one path; everything wider is a union over paths — what the code *can* touch, never what it must.

#### `effects`

What the code at an address touches — registers, flags and memory — over a scope you choose. The question naming a routine requires: `writes $(0xD418) and $(0xD40F)` says it makes a noise whatever it is called. Give any address inside a routine, not only its first. `follow` says how far to look, and the four points differ in what they assume: - `block` — the straight-line block here. **Exact**: a block has no branch inside it, so this holds for every input. A block ends at the first branch, jump or call, so at a routine head that begins `JSR` this is one instruction. Use it beside run_block. - `routine` — the routine's own blocks, not entering what it calls. - `calls` — plus everything its callees reach, transitively. The default, and what a caller usually means. - `returning` — `calls`, refusing to enter a callee that never comes back. Use it when `calls` unions most of the program: on this reference project it takes a subsystem from 47% of every slot touched to 13%. `stoppedAt` names every place it stopped, so nothing is hidden. Everything but `block` is what the code *can* touch, never what it must: an intersection over paths is often unanswerable, and a maybe dressed as a certainty is worse than neither. A routine's extent is worked out from control flow, not declared, because one that tail-jumps away is in two places and no single span describes it. Reachability is static, so a computed jump leads somewhere this cannot follow.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `follow` | `block` \| `routine` \| `calls` \| `returning` | optional | How far to look. Default `calls`. |

#### `call_graph`

Who calls a routine, and what it calls, to a depth. The shape of a program rather than one address at a time — where to start reading, and what a change would reach. Sees absolute JSRs only, so a routine reached through a computed jump or an RTS dispatch looks unconnected. It says so on every answer.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `depth` | `integer` | optional | How far down to follow. Default 2 |

#### `run_decoder`

Run a decoder you write over a span of bytes, and see what it produces. For data whose layout is not one of the built-in ones — a packed screen, a run-length-encoded animation, a font in an order somebody invented — where the only honest description is code. The body receives `bytes` (a plain array of numbers) and `params`, and must return {kind:"bitmap", width, height, pixels, palette}, {kind:"frames", delayMs, frames}, or {kind:"text", lines}. A bitmap comes back drawn as text so you can read it. It runs with no access to anything: no network, no files, no clock, no randomness — so it is a pure function of the bytes — and it is stopped if it does not finish quickly.

| argument | type | | |
|---|---|---|---|
| `start` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `length` | `integer` | **required** | How many bytes to hand it |
| `source` | `string` | optional | The body of the function. Use `return` to produce the result. |
| `decoder` | `string` | optional | Id of a decoder kept in the project, instead of source. See list_decoders. |
| `params` | `object` | optional | Passed through as `params`, for anything the body should not hard-code |

#### `list_warnings`

What the disassembler could not make sense of. describe_project reports how many there are, which is enough to know something is wrong and no use for doing anything about it.

#### `disagreements`

Where this project contradicts itself: one name reaching two addresses, two claims reading one span differently, a decode root inside somebody else's data. Nothing is resolved for you — that is the point. Declaring is additive, so two readers who disagree both stand and this is how anybody finds out, rather than one of them silently winning. A claim nested inside another is not a contradiction: an 8K table and a 40-byte string inside it are both true.

---

### Saying what an address is

One noun. `add_claim` takes a `name`, an `is`, an `extent` and a `root` — any of them, at least one. **Always adds**; correcting is `edit_claim`, by id.

#### `add_claim`

Say something about an address. **This adds; it never replaces.** A claim carries any of: a `name`, what the bytes are (`is`), how far it reaches (`extent`), and whether to decode from there (`root`). One tool rather than two, because naming an address and saying what a span holds were only ever separate because an assembler source file has labels and directives — the machine does not. Several claims can cover one address and that is the point: the reference disassembly calls $08 a scratch byte in most of a program and something specific in one routine, and both are true. So an address cannot say which claim you meant, and a write keyed by one must not decide. The id comes back; use it with edit_claim to correct what you said, or claims_at first to see what is already there. Which name an operand shows is bind_primary_name, by claim id. The result also says the claim's `scope` — which layer or target it belongs to. That is derived from the address, never chosen, and it is what decides whether the claim follows its bytes if that layer is ever linked somewhere else.

| argument | type | | |
|---|---|---|---|
| `at` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `name` | `string` | optional |  |
| `is` | `data` \| `text` \| `bitmap` \| `jumptable` \| `record` | optional | What the bytes are. There is no `code`: code is what bytes are when nobody has said otherwise, so to have an address decoded set a root. `record` is an array of a layout from list_types, and needs typeId. |
| `typeId` | `string` | optional | With is:"record": which layout, from list_types |
| `extent` | `integer` | optional | Bytes covered. On a name it makes an operand inside render as NAME + $000F; on an interpretation it is the span. |
| `root` | `entry` \| `routine` \| `location` \| `data` | optional | Surface this regardless of what reaches it. `routine` is a subroutine, `entry` is where execution starts, `data` means show these bytes even though nothing names them — an unreferenced sprite sheet needs it. |
| `encoding` | `petscii` \| `screen` \| `ascii` \| `keycode` | optional |  |
| `view` | `string` | optional | For a bitmap: char:8, bits:3, sprite, snippet:<id> |
| `comment` | `string` | optional |  |
| `method` | `guessed` \| `transcribed` \| `read` \| `derived` \| `ran` | optional | **How you know**, not how sure you are. guessed = a hypothesis; transcribed = copied by hand from a listing or another project; read = reasoned from the code; derived = an analysis here computed it; ran = watched happening in the machine. Two accounts that agree are one account unless the methods differ — which is why this is the axis rather than a confidence score. |
| `expectVersion` | `string` | optional | Refuse if the project has changed since you read it |

#### `add_claims`

Say several things at once, as one action. Undo takes the whole batch back. Use this rather than a call per claim: a real disassembly has hundreds, and one round trip each is almost all protocol. Partial, like every batch here — an entry that cannot be written is reported in `rejected` and the rest still land.

| argument | type | | |
|---|---|---|---|
| `claims` | `array` | **required** |  |
| `expectVersion` | `string` | optional |  |

#### `edit_claim`

Correct a claim, by its id. The way to change what you said rather than say something else: adding is never keyed by an address, because several claims cover any interesting one and so an address cannot say which you meant. `claims_at` reports the ids covering an address; an invented `dat_`/`loc_`/`sub_` name has none, because nothing stored it, and naming that address is an ordinary `add_claim`. Every field is optional and **omitting one leaves it alone**; passing `null` clears it — which is how a root is taken off, an extent removed, or an interpretation un-said.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** | Claim id, from claims_at or add_claim |
| `at` | `string,number` | optional | Move it. Absolute, like every address here — a claim is stored relative to the layer holding its bytes, and this is converted |
| `name` | `any` | optional |  |
| `is` | `any` | optional |  |
| `typeId` | `string,null` | optional | With is:"record", the layout |
| `extent` | `any` | optional |  |
| `root` | `any` | optional |  |
| `encoding` | `any` | optional |  |
| `view` | `string,null` | optional |  |
| `method` | `any` | optional | How you know, revised: a guess you have since run is no longer a guess |
| `expectVersion` | `string` | optional |  |

#### `remove_claim`

Take back a claim, by its id. By id and only by id: an address cannot identify a claim, since several cover any interesting one — which is what claims_at is for. Removing a claim leaves its bytes explained by whatever else covers them, or by nothing, which is an honest answer rather than a gap to be avoided.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** |  |
| `expectVersion` | `string` | optional |  |

#### `mark_function`

Declare an address a subroutine, creating a label if there is none. This makes it an entry point, so it is how code nothing references gets decoded. An invented name is rewritten so its prefix matches.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `name` | `string` | optional |  |
| `expectVersion` | `string` | optional |  |

#### `unmark_function`

Take back a function declaration. An auto-shaped name is removed outright rather than left behind contradicting its own prefix; a name someone chose is kept and only its type is cleared.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `expectVersion` | `string` | optional |  |

---

### Choosing which name shows

Several claims cover any interesting address, so two questions arise that a single name cannot answer: which renders by default, and which a particular operand means.

#### `bind_primary_name`

Choose which of several claims at an address gives the name that renders where nothing says otherwise. By claim id: two claims at one address may share a name, so a name cannot say which you mean.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `claim` | `string` | **required** | From claims_at or list_claims |
| `expectVersion` | `string` | optional |  |

#### `unbind_primary_name`

Stop choosing, so the name at this address falls back to rank. There was no way to do this: a primary could be set and never taken off.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `expectVersion` | `string` | optional |  |

#### `bind_name`

Say which name the operands referring to an address mean, over a span. Give `from` alone for one instruction, or `from` and `to` for a whole routine. Stored per site, so a binding travels with its instruction rather than with a range that may stop being the right one.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | The address being referred to |
| `name` | `string` | **required** | Which of its labels these sites mean |
| `from` | `string,number` | **required** | First instruction to bind |
| `to` | `string,number` | optional | Last instruction; just `from` if omitted |
| `expectVersion` | `string` | optional |  |

#### `unbind_name`

Let the operand at an address resolve by the usual rule again.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `expectVersion` | `string` | optional |  |

---

### Comments

Their own objects, with ids. `add_comment` mints and never overwrites — an address cannot identify a comment, for exactly the reason it cannot identify a claim.

#### `add_comment`

Add a comment about an address, and return its id. "before" gets its own rows above the label and may run to several lines; "inline" shares the instruction's row and cannot. Comments are their own objects, so an address needs no label to carry one — and SEVERAL can share an address: all of them render. Adding is cheap and deciding what survives is an editing pass, so add freely, then use edit_comment, reorder_comments and remove_comment, each by id. This never overwrites anybody, including you.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `text` | `string` | **required** |  |
| `placement` | `before` \| `inline` \| `after` | optional | before (own rows above the label), inline (shares the instruction's row), or after (own rows below it, for an observation about what happens next). Default before. |
| `expectVersion` | `string` | optional |  |

#### `add_comments`

Add several comments in one call, as one action. Undo takes the batch back whole. A real disassembly carries more comments than labels, so one round trip each is almost all protocol.

| argument | type | | |
|---|---|---|---|
| `comments` | `array` | **required** |  |
| `expectVersion` | `string` | optional |  |

#### `edit_comment`

Revise a comment by id: its text, its placement, or where it sits among the comments at its address. The half add_comment deliberately does not do — an address does not identify a comment, so revising by address is how one writer silently destroys another's.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** | From list_comments or add_comment |
| `text` | `string` | optional |  |
| `placement` | `before` \| `inline` \| `after` | optional |  |
| `expectVersion` | `string` | optional |  |

#### `reorder_comments`

Put the comments at an address in the order given, by id. Ordering is otherwise by id — stable everywhere and arbitrary — which is fine while an address carries one comment and no use once several do. Ids you leave out keep their places after the ones you name.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `ids` | `array` | **required** | In the order you want them |
| `expectVersion` | `string` | optional |  |

#### `remove_comment`

Delete a comment by id. Several comments can share an address, so an address does not identify one.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** | From list_comments |
| `expectVersion` | `string` | optional |  |

---

### Declarations

Project-level, because a way of *reading* bytes describes none of its own — so there is no layer for one to move with when the stack is reordered. Constants and types and decoders all take the same three verbs.

#### `add_constant`

Declare a name for a byte value: EMPTY_CELL = $00, ORANGE = $08. **This adds a declaration; it never replaces one.** Declaring the same name twice gives two constants, because a name is prose somebody chose and two readers can pick the same word for different things — use edit_constant with the id to revise one. Declaring changes no listing: a value has no single meaning, and in the reference disassembly the same byte is both a colour and a direction in different routines. Use bind_constant to say that a particular operand means this one.

| argument | type | | |
|---|---|---|---|
| `name` | `string` | **required** |  |
| `value` | `string,number` | **required** | A byte, $00-$FF |
| `expectVersion` | `string` | optional |  |

#### `add_constants`

Declare several constants in one call, as one action. Adds, like add_constant: a batch that quietly revised whatever it matched would be the obvious way to get back the behaviour that was removed. Declaring changes no listing; bind_constant is what makes an operand show a name.

| argument | type | | |
|---|---|---|---|
| `constants` | `array` | **required** |  |
| `expectVersion` | `string` | optional |  |

#### `edit_constant`

Revise a declared constant by its id: its name, its value, or both. The id comes from add_constant or list_constants. By id because declaring is additive, so a name can reach two constants and would not say which.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** |  |
| `name` | `string` | optional |  |
| `value` | `string,number` | optional | A byte, $00-$FF |
| `expectVersion` | `string` | optional |  |

#### `remove_constant`

Forget a declared constant, by id. Operands bound to it go back to showing the literal; nothing needs unbinding first.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** | From add_constant or list_constants |
| `expectVersion` | `string` | optional |  |

#### `bind_constant`

Say that the immediate operand at an address means a named constant, so it renders as #ORANGE rather than #$08. Refused if the instruction takes no immediate or loads a different value. Takes a name or an id; where a name reaches two constants the operand's own value picks between them, since two constants sharing a name must differ in value to be worth telling apart.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `constant` | `string` | **required** | A constant id from add_constant or list_constants |
| `expectVersion` | `string` | optional |  |

#### `bind_constants`

Bind several sites in one call, as one action. add_constants batches the declarations, which change no listing by design; this batches the operation that actually changes what a reader sees.

| argument | type | | |
|---|---|---|---|
| `bindings` | `array` | **required** |  |
| `expectVersion` | `string` | optional |  |

#### `unbind_constant`

Read the operand at an address as its literal value again.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `expectVersion` | `string` | optional |  |

#### `add_type`

Declare a record layout: what the bytes of one array element mean. The thing a claim alone cannot say. An 8,400-byte table that a reader has established is 42 records of 200 bytes, with nineteen named fields each, could previously be expressed as one `data` span and a note — finished analysis, discarded for want of a shape. **Holes are legal and are the point**: declare the fields you have proved and leave the rest unexplained, rather than inventing padding. `size` is bytes per record; how many records a claim holds is derived from its extent, never stored. Returns the id. Bind it with add_claim is:"record" typeId:<id>.

| argument | type | | |
|---|---|---|---|
| `name` | `string` | **required** |  |
| `size` | `integer` | **required** | Bytes per record |
| `fields` | `object` | **required** | By offset. Two fields cannot share one, so the key is the identity. |
| `expectVersion` | `string` | optional |  |

#### `edit_type`

Correct a record layout, by its id. The fields are given whole: send the layout you mean, and a field you leave out is one you removed. Two readers adding *different* fields to one record still both survive — that merges per offset underneath, which is why fields carry no ids of their own.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** | Type id, from list_types or add_type |
| `name` | `string` | **required** |  |
| `size` | `integer` | **required** |  |
| `fields` | `object` | **required** |  |
| `expectVersion` | `string` | optional |  |

#### `remove_type`

Take back a record layout, by its id. A claim still referencing it renders its bytes rather than breaking — the same rule a dangling constant follows, so a delete racing somebody else's binding heals itself instead of needing a sweep.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** |  |
| `expectVersion` | `string` | optional |  |

#### `add_decoder`

Keep a decoder in the project so it can be used again and by somebody else. **Always adds**, and returns the id — `edit_decoder` revises by that id. It lives at project level rather than on a layer, because a way of *reading* bytes describes none of its own — the same reason a constant declaration does.

| argument | type | | |
|---|---|---|---|
| `name` | `string` | **required** | What it is for, shown in a listing and a menu |
| `source` | `string` | **required** | The body of a function taking (bytes, params) |
| `expectVersion` | `string` | optional |  |

#### `edit_decoder`

Revise a decoder by id. Omitted fields are left alone, so changing the name does not resend a source somebody else has corrected. An id nothing holds is an error — this never creates one.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** | From add_decoder or list_decoders |
| `name` | `string` | optional |  |
| `source` | `string` | optional |  |
| `expectVersion` | `string` | optional |  |

#### `remove_decoder`

Drop a decoder from the project. Anything referring to it falls back to showing the bytes, the way a dangling constant renders its literal.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** |  |
| `expectVersion` | `string` | optional |  |

---

### Running it

A scenario is a list of typed steps the machine executes in order — not a script, which is what makes a re-run able to resume from where the last one got to. The machine itself is never stored: it is derived from these steps and the project's bytes, so the script is the truth and the machine is a cache. Captures go to the file store and are recorded in the document, so what a run produced can be read again, and by somebody else, without running it.

#### `list_scenarios`

Every workflow this project carries, with the captures each has produced and a `url` to fetch each capture's bytes. A scenario is what the machine is asked to do; the machine itself is never stored, because it is derived from these steps and the project's bytes.

#### `add_scenario`

Declare a workflow for the machine. **Always adds**, and returns the id. Steps run in order: `start` where to begin, `set` to pin registers or memory, `input` to point a joystick, `key` to hold keys on the keyboard, `run` until frames/cycles/a breakpoint/a watchpoint, and `capture` to keep something. A joystick and a set of keys both stay as they were put until another step changes them, so a keystroke is press, run, release — which is what a program's own debounce is written against. Running is deterministic: the same steps over the same bytes give the same result, which is what lets a re-run resume rather than start again.

| argument | type | | |
|---|---|---|---|
| `name` | `string` | **required** |  |
| `description` | `string` | optional |  |
| `steps` | `array` | **required** |  |
| `expectVersion` | `string` | optional |  |

#### `edit_scenario`

Revise a workflow by id. Omitted fields are left alone; `steps` is written whole, because a scenario is one author's sequence and the order is the meaning. An id nothing holds is an error — this never creates.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** | From add_scenario or list_scenarios |
| `name` | `string` | optional |  |
| `description` | `string,null` | optional |  |
| `steps` | `array` | optional |  |
| `expectVersion` | `string` | optional |  |

#### `remove_scenario`

Forget a workflow, by id. Anything it captured stays, because a capture is evidence rather than a by-product.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** |  |
| `expectVersion` | `string` | optional |  |

#### `run_scenario`

Run a workflow and keep what it captured. Says what each step did, where the machine stopped, and — if the scenario asserts anything — whether the checks passed. Each capture comes back with a **`url`**: GET it to fetch the bytes, which for a screen or frames is JSON holding palette indices you can render however you like. Bytes go over HTTP rather than through this result because a captured screen is a few hundred kilobytes. Re-running a scenario whose later steps changed resumes from where the earlier ones left off rather than starting over.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** |  |
| `expectVersion` | `string` | optional |  |

#### `play_sid`

Turn a captured sound-chip log into a recording you can listen to. Takes the id of a `capture` whose `what` was `sid`, and returns a WAV as a url. The notes are not modelled, they are transcribed: a note starts and stops where the gate bit went on and off, at the cycle it happened, and its pitch is the frequency register, which is a divider and nothing else. What is ours is the waveform shape and the envelope curve, and the filter is not modelled at all — the answer says so, on every recording, because audio that sounds plausible is the easiest kind of confident wrong answer to publish.

| argument | type | | |
|---|---|---|---|
| `capture` | `string` | **required** | A capture id from list_scenarios, of kind sid |
| `seconds` | `number` | optional | Stop after this long, for a log longer than you want to hear |

#### `run_program`

Run the program from an address until it leaves the bytes this project holds — which is how a loader exits once its work is done, so no limit has to be guessed. Unlike run_block, which is one straight line by design, this follows branches and calls wherever they go. Give `capture` to keep a range of the resulting memory as a file, then add_byte_layer over it: that is how a packed program becomes something you can read. It runs over flat memory and does not emulate the VIC, SID or CIA — hardware it touched is reported so you can judge the answer, and an undocumented opcode stops it rather than being guessed.

| argument | type | | |
|---|---|---|---|
| `from` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `stopAt` | `string,number` | optional | Stop here instead of running on |
| `maxInstructions` | `integer` | optional | Default 20 million, about ten seconds |
| `capture` | `object` | optional |  |
| `expectVersion` | `string` | optional |  |

#### `run_block`

Execute the block at an address with values you choose, and see what comes out. The complement of block_effects: that says which slots the block touches for any input, this says what happens for one. Often the fastest route to what a routine is for — pick values, look at the exit and the bytes written, and the intent shows. One block only, deliberately: a block has no branch inside it, so the instructions that run are known before it starts and no path is chosen on your behalf. Unset registers start at zero and unset memory comes from the program as loaded; every result reports which values it actually read and where each came from, so you can see what an answer rests on. Decimal mode is not modelled and says so.

| argument | type | | |
|---|---|---|---|
| `address` | `string,number` | **required** | An address, as $8100, 0x8100, decimal text, or a number — or a place: screen(row,column), screen(cell) and sprite(pointer), each taking an optional base or VIC bank as a last argument since both depend on where the program put them |
| `registers` | `object` | optional | Starting registers and flags; anything omitted starts at zero |
| `memory` | `object` | optional | Starting bytes, keyed by address as $D012 or decimal |

---

### Evidence

Something said about a **claim** rather than about an address. It is where a refutation lives that shares no bytes with what it refutes, where an earlier reading is kept rather than deleted, and where a claim points at a scenario that re-verifies it. Both experiment-0 agents asked for this shape and neither toolchain had it.

#### `list_evidence`

What has been said about a claim: evidence for it, against it, or replacing it. Give a claim id to see just that one. This is where a refutation lives that shares no bytes with what it refutes — `$8DF9` holding `$3B` refutes a claim about the *glyph* `$3B`, somewhere else entirely, which `disagreements` could never find by sweeping addresses.

| argument | type | | |
|---|---|---|---|
| `claim` | `string` | optional | Only evidence about this claim |

#### `add_evidence`

Say something about a **claim** rather than about an address. `supports` backs it up; `refutes` says it is wrong; `supersedes` replaces it, which is how an earlier reading that led somewhere is kept rather than deleted — the wrong model that led to the right place is worth keeping. Point at a `scenario` and the evidence re-verifies: running it says pass or fail rather than leaving a sentence nobody can check.

| argument | type | | |
|---|---|---|---|
| `claim` | `string` | **required** | The claim this is about, from claims_at |
| `kind` | `supports` \| `refutes` \| `supersedes` | **required** |  |
| `scenario` | `string` | optional | A scenario that checks it — the strongest form, because it re-runs |
| `capture` | `string` | optional | Something a run produced, from list_scenarios |
| `other` | `string` | optional | Another claim, for refutes and supersedes |
| `note` | `string` | optional | Why, for the part no reference carries |
| `expectVersion` | `string` | optional |  |

#### `edit_evidence`

Revise a piece of evidence by id. Omitted fields are left alone; `null` clears one. An id nothing holds is an error.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** |  |
| `kind` | `supports` \| `refutes` \| `supersedes` | optional |  |
| `scenario` | `string,null` | optional |  |
| `capture` | `string,null` | optional |  |
| `other` | `string,null` | optional |  |
| `note` | `string,null` | optional |  |
| `expectVersion` | `string` | optional |  |

#### `remove_evidence`

Withdraw a piece of evidence, by id. The claim it was about is untouched.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** |  |
| `expectVersion` | `string` | optional |  |

---

### Building a project

From a binary to something disassemblable. Bytes go over HTTP rather than through a tool argument: a disk image is ~175KB, and base64 of it would be tens of thousands of tokens for a file you never read.

#### `create_project`

Start a project with nothing in it: no layers, no bytes. The first step when you have been handed a binary and no project. Follow it with prepare_upload to put the file in, list_disk_files if it is a .d64, and add_layer to make something disassemblable.

| argument | type | | |
|---|---|---|---|
| `name` | `string` | **required** |  |

#### `prepare_upload`

Get a URL to PUT a binary to. Bytes go over HTTP rather than through a tool argument, because a disk image is ~175KB and base64 of it would be tens of thousands of tokens for a file you never need to read. The URL is good once and expires. The name is what layers will refer to it by.

| argument | type | | |
|---|---|---|---|
| `name` | `string` | **required** | What layers will call it, e.g. "revenge.d64" |

#### `list_disk_files`

The directory of a .d64 disk image this project holds — what is on the disk, and the path to give add_layer for each entry.

| argument | type | | |
|---|---|---|---|
| `name` | `string` | **required** | The image, as uploaded |

#### `add_byte_layer`

Add a layer over bytes — which is what turns an uploaded binary into something to disassemble. `path` is the file's name, or "image.d64:FILE" for one inside a disk image. A .prg carries its load address in its first two bytes; a raw layer needs one given. Type "bytes" takes the bytes inline instead of a file, at an address you give: a patch, a poked value, a hand-assembled shim. Link the layer into a target with set_target, or nothing reads it.

| argument | type | | |
|---|---|---|---|
| `type` | `prg` \| `raw` \| `bytes` | **required** |  |
| `path` | `string` | optional | The file, for prg and raw |
| `bytes` | `string` | optional | For type "bytes": hex, spaces optional — "A9 01 8D 20 D0" |
| `name` | `string` | optional | Defaults to the file's name |
| `address` | `string,number` | optional | Required for raw and bytes, ignored for prg |
| `length` | `integer` | optional | For type "bytes": repeat them to this width |
| `expectVersion` | `string` | optional |  |

#### `add_layer`

Add a symbols layer: names for addresses that hold no loaded bytes — zero page variables, I/O registers, KERNAL entry points. Usually unnecessary, because naming or commenting such an address creates one on demand. Use this to give it a name of your choosing, or to add a second.

| argument | type | | |
|---|---|---|---|
| `name` | `string` | **required** |  |
| `expectVersion` | `string` | optional |  |

#### `add_rom_layer`

Link a machine ROM into this project, as reference rather than as something to read. It lands where the hardware decodes it — BASIC at $A000, the KERNAL at $E000, the character set at $D000 — and its bytes stay **out of the disassembly**: you want to know what the program reads out of a ROM, not eight kilobytes of it in your listing. Never added by default, because that would make the analysis depend on whether the host happens to have the files. If it does not, the project still loads and describe_project reports `romsMissing` — every answer that would have used those bytes is then short, and that must not be silent. What it makes answerable: a program reading ROM for data. Gridrunner's random number generator takes its entropy from BASIC ROM through eleven callers, and with nothing supplying those bytes there is no answer.

| argument | type | | |
|---|---|---|---|
| `rom` | `basic` \| `kernal` \| `characters` | **required** |  |
| `expectVersion` | `string` | optional |  |

#### `remove_layer`

Take a layer out of the project. For the scratch layers a build leaves behind: a capture aimed at the wrong range, a probe, a second attempt. Without it a project carries every one of them for ever, and `list_targets` is the only place they show. Refuses while the layer still owns labels, regions or comments, since those would go with it — move them first. Give the id from `list_targets`, not the name.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** | Layer id, from list_targets |
| `expectVersion` | `string` | optional |  |

#### `add_target`

Declare a view over the layer stack. **Always adds**, and returns the id — `edit_target` revises by that id. A target is a phase of the program's life: the loader, the image it expands into, a level it pulls in later.

| argument | type | | |
|---|---|---|---|
| `name` | `string` | **required** |  |
| `layers` | `array` | **required** | Bottom-up, so the last shadows the rest |
| `entryPoints` | `array` | optional |  |
| `order` | `integer` | optional | Where this sits in the program's life: the loader before the image it expands, before the levels |
| `description` | `string` | optional | What this phase is, in prose — a name carries none of it |
| `expectVersion` | `string` | optional |  |

#### `edit_target`

Revise a view by id. Omitted fields are left alone, so describing a target does not restate its layers and two people revising one do not revert each other. An id nothing holds is an error — this never creates.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** | From add_target or list_targets |
| `name` | `string` | optional |  |
| `layers` | `array` | optional | Bottom-up, so the last shadows the rest; omit to leave the links alone |
| `entryPoints` | `array` | optional |  |
| `order` | `integer` | optional |  |
| `description` | `string` | optional |  |
| `expectVersion` | `string` | optional |  |

#### `remove_target`

Forget a view, by id. The layers and everything in them are untouched.

| argument | type | | |
|---|---|---|---|
| `id` | `string` | **required** | From list_targets |
| `expectVersion` | `string` | optional |  |

#### `set_project_description`

Say what this project is: provenance, what the binary is, anything a reader should know before the first line. A hand-written listing keeps this in its file header.

| argument | type | | |
|---|---|---|---|
| `description` | `string` | **required** |  |
| `expectVersion` | `string` | optional |  |

---

### History and export

There is no save step — an edit is durable when the call returns. `changes_since` is the poll that stands in for the socket a browser has.

#### `changes_since`

What has happened to a project since a position you were given. Use it to catch up rather than re-reading everything: someone may be editing alongside you. Pass 0 the first time, then the cursor you get back — or the name of a tag, to ask what has changed since you marked it.

| argument | type | | |
|---|---|---|---|
| `cursor` | `integer` | optional | Default 0, from the beginning |
| `tag` | `string` | optional | A tag name, instead of a cursor |
| `limit` | `integer` | optional | Default 100 |

#### `undo`

Take back your own most recent action — the whole of it, however many changes it made. Reaches anything recorded here, on the command line, or in a browser. Any part of it that somebody else has changed since is left alone and reported rather than reverted over the top of them.

#### `tag_project`

Mark this point with a name you can come back to — a tag, in the git sense. It is not a save: the document already holds every edit the moment it lands. What a tag buys is a position you can ask about later, so changes_since takes its name and tells you what has happened since.

| argument | type | | |
|---|---|---|---|
| `name` | `string` | **required** | Short, and unique within the project |
| `note` | `string` | optional | Why this point is worth marking |

#### `list_tags`

Points that have been marked, oldest first, each with how many changes have been recorded since and whether the project still looks the way it did — which are different questions, since an edit and its undo move the count and not the content.

#### `remove_tag`

Forget a tag. The history it pointed at is untouched.

| argument | type | | |
|---|---|---|---|
| `name` | `string` | **required** |  |

#### `export_project`

Return the project as .re64 text. The document is the truth and holds every edit the moment it lands, so nothing needs saving — this is for getting a readable, diffable copy out. describe_project reports exportStale when a write to the stored copy has failed, which is otherwise silent.

---

### Talking

A message describes no bytes, so it reaches no `.re64` and moves no version.

#### `post_message`

Say something to whoever else is in this project — people in a browser see it live. Use it to say what you are about to work on, ask about something ambiguous, or report what you found. It is not an annotation: it goes nowhere near the listing, leaves no history entry, cannot be undone, and is not in the exported file. Put a conclusion in a comment; put a conversation here. At most 2000 characters, and it refuses rather than truncating — a long status post is several messages.

| argument | type | | |
|---|---|---|---|
| `text` | `string` | **required** |  |

#### `read_messages`

What people and agents working this project have said to each other. Newest last. This is where somebody tells you what they are already working on, or what they have concluded that is not yet in the listing.

| argument | type | | |
|---|---|---|---|
| `limit` | `integer` | optional | Default 50 |


---

## Known tensions

Written down rather than smoothed over.

**`find_references` sees absolute addressing only**, and says so on every
answer. A routine reached through a zero-page or indirect jump appears to have no
callers, which is the opposite of the truth — so the blind spot is stated rather
than left to be inferred from an empty result.

**Statically reachable is smaller than executed**, and the gap is not a defect. A
disagreement with a human listing always has three live explanations: the
annotation is wrong, the decode leading there is wrong, or the program does
something no walk can follow.

**Banking is not modelled.** `$D000` is VIC registers or character ROM depending
on `$01`, and layers cannot express that — shadowing is static z-order, banking is
runtime alternation. Targets answer the *overlay* half of this and not this half.

**A claim inside an instruction renders no row.** It resolves correctly in
operands and the write says so at the time; the listing has nowhere to draw it.

**`add_layer` makes symbols layers only**, with `add_byte_layer` and
`add_rom_layer` beside it. A naming wart rather than a gap, recorded so it is
not mistaken for one.
