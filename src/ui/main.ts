/**
 * re64 prototype UI.
 *
 * Two CodeMirror editors behind tabs: a read-only disassembly view whose
 * clickable spans come from server-supplied token ranges, and a plain JSON
 * editor for the project file.
 *
 * The disassembly is rendered from structured rows, never parsed back from
 * text — see "UI Design Decisions" in CLAUDE.md.
 */

import { EditorState, StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  DecorationSet,
  keymap,
  lineNumbers,
  highlightActiveLine,
  gutter,
  GutterMarker,
  WidgetType,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";

type LabelType = "entry" | "function" | "code" | "address";

/**
 * The UI only sets "function"; the other types exist but are not user actions.
 *
 * "code" is auto-generated for branch and jump targets, and "entry" comes from
 * a layer or region — a PRG load address, say. Both are shown as tags so the
 * analysis is visible, but neither is something you reach for while reading
 * code. Declaring a function is. Anything else can still be hand-written in
 * the project file.
 */

interface RowToken {
  start: number;
  end: number;
  kind: "operand" | "label" | "xref" | "mnemonic" | "labeltype";
  target?: number;
  name?: string;
  labelType?: LabelType;
}

interface Row {
  address: number;
  kind: "label" | "instruction" | "data" | "text" | "word";
  text: string;
  tokens: RowToken[];
  illegal?: boolean;
}

interface Analysis {
  name: string;
  rows: Row[];
  lineForAddress: Record<number, number>;
  arrows: string[];
  warnings: string[];
  stats: {
    instructions: number;
    labels: number;
    regions: number;
    rows: number;
    arrows: number;
    arrowsDemoted: number;
  };
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

// --- State ------------------------------------------------------------

let analysis: Analysis | null = null;
const navStack: number[] = [];

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const setStatus = (msg: string, isError = false) => {
  const el = $("#status");
  el.textContent = msg;
  el.className = isError ? "error" : "";
};

// --- Disassembly decorations -----------------------------------------

const setRows = StateEffect.define<Row[]>();

function buildDecorations(rows: Row[], doc: EditorState["doc"]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  // Operands pointing outside the loaded map — zero-page variables above all,
  // which are named but have no bytes — render as plain names rather than dead
  // links, so clicking through code never lands on an error.
  const lowest = rows.length ? rows[0].address : 0;
  const highest = rows.length ? rows[rows.length - 1].address : 0;
  const hasRow = (address: number) => address >= lowest && address <= highest;

  rows.forEach((row, i) => {
    const lineStart = doc.line(i + 1).from;

    // The address column is a fixed 4 characters on every row kind.
    builder.add(lineStart, lineStart + 4, Decoration.mark({ class: "tok-addr" }));

    const sorted = [...row.tokens].sort((a, b) => a.start - b.start);
    for (const tok of sorted) {
      const attrs: Record<string, string> = {};
      let cls: string;

      switch (tok.kind) {
        case "operand":
          if (hasRow(tok.target!)) {
            cls = "tok-operand";
            attrs["data-target"] = String(tok.target);
            attrs.title = `Go to $${hex4(tok.target!)}`;
          } else {
            cls = "tok-operand-offmap";
            attrs.title = `$${hex4(tok.target!)} — outside the loaded memory map`;
          }
          break;
        case "label":
          cls = "tok-label";
          attrs["data-rename"] = String(tok.target);
          attrs["data-name"] = tok.name ?? "";
          // Carried so a click knows which range the inline editor replaces.
          attrs["data-line"] = String(i);
          attrs["data-from"] = String(tok.start);
          attrs["data-to"] = String(tok.end);
          attrs.title = "Click to rename";
          break;
        case "xref":
          cls = "tok-xref";
          attrs["data-target"] = String(tok.target);
          attrs.title = `Go to referrer $${hex4(tok.target!)}`;
          break;
        case "mnemonic":
          cls = row.illegal ? "tok-mnemonic illegal" : "tok-mnemonic";
          break;
        case "labeltype":
          // Display only. "code" and "entry" are analysis output, not settings;
          // the one type worth changing by hand is function, bound to f.
          cls = `tok-labeltype type-${tok.labelType}`;
          attrs.title =
            tok.labelType === "function"
              ? "function — an entry point for disassembly (f to clear)"
              : tok.labelType === "code"
                ? "code — a branch or jump target found by analysis"
                : "entry — start of a program or code region";
          break;
      }

      builder.add(
        lineStart + tok.start,
        lineStart + tok.end,
        Decoration.mark({ class: cls, attributes: attrs })
      );
    }
  });

  return builder.finish();
}

// --- Nested arrow gutter ----------------------------------------------

/**
 * The arrow gutter is plain pre-rendered text from the server, kept out of the
 * document so selecting and copying disassembly does not drag box-drawing
 * characters along with it.
 */
class ArrowMarker extends GutterMarker {
  constructor(private readonly glyphs: string) {
    super();
  }
  eq(other: ArrowMarker) {
    return other.glyphs === this.glyphs;
  }
  toDOM() {
    // Box-drawing glyphs fill their em box, not the taller line box, so
    // unscaled verticals show a gap at every row boundary. Stretching the span
    // to the line height makes the segments meet.
    const span = document.createElement("span");
    span.className = "arrow-glyphs";
    span.textContent = this.glyphs;
    return span;
  }
}

const arrowGutter = gutter({
  class: "cm-arrow-gutter",
  lineMarker(view, line) {
    if (!analysis?.arrows.length) return null;
    const lineNo = view.state.doc.lineAt(line.from).number;
    const glyphs = analysis.arrows[lineNo - 1];
    return glyphs ? new ArrowMarker(glyphs) : null;
  },
  lineMarkerChange: (update) =>
    update.transactions.some((tr) => tr.effects.some((e) => e.is(setRows))),
});

const decorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setRows)) {
        return buildDecorations(effect.value, tr.state.doc);
      }
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// --- Inline label editing ---------------------------------------------

interface EditTarget {
  address: number;
  name: string;
  /** 0-based row index the editor attaches to. */
  line: number;
  /** Character range within the row, when replacing an existing label. */
  from: number;
  to: number;
  /**
   * No label exists at this address yet, so the editor gets its own block row
   * above the instruction rather than replacing a token.
   */
  isNew: boolean;
}

const setEdit = StateEffect.define<EditTarget | null>();

const editField = StateField.define<EditTarget | null>({
  create: () => null,
  update(target, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEdit)) return effect.value;
      // A reload invalidates the line numbers the target refers to.
      if (effect.is(setRows)) return null;
    }
    return target;
  },
});

/**
 * In-place editor for a label name.
 *
 * Enter commits, Escape reverts, and clicking away reverts rather than saving —
 * a blur-commit would turn an accidentally cleared field into a label deletion.
 */
class LabelEditWidget extends WidgetType {
  constructor(private readonly target: EditTarget) {
    super();
  }

  eq(other: LabelEditWidget) {
    return (
      other.target.address === this.target.address &&
      other.target.name === this.target.name &&
      other.target.isNew === this.target.isNew
    );
  }

  toDOM() {
    const target = this.target;
    const input = document.createElement("input");
    input.className = "label-edit";
    input.value = target.name;
    input.spellcheck = false;
    input.placeholder = `label for $${hex4(target.address)}`;
    input.style.width = `${Math.max(target.name.length + 2, 16)}ch`;

    let settled = false;
    const finish = (save: boolean) => {
      if (settled) return;
      settled = true;
      if (save) void commitLabelEdit(target, input.value);
      else endLabelEdit();
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
      // Keep the editor's own keymap (n, g, Enter, Backspace) out of the field.
      event.stopPropagation();
    });
    input.addEventListener("blur", () => finish(false));

    // Focus once CodeMirror has attached the widget to the document.
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);

    if (target.isNew) {
      const row = document.createElement("div");
      row.className = "label-edit-row";
      row.appendChild(input);
      return row;
    }
    return input;
  }

  /** Let the input handle its own events instead of the editor. */
  ignoreEvent() {
    return true;
  }
}

const editDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_deco, tr) {
    const target = tr.state.field(editField);
    if (!target || target.line >= tr.state.doc.lines) return Decoration.none;

    const line = tr.state.doc.line(target.line + 1);
    const widget = new LabelEditWidget(target);

    return target.isNew
      ? Decoration.set([
          Decoration.widget({ widget, block: true, side: -1 }).range(line.from),
        ])
      : Decoration.set([
          Decoration.replace({ widget }).range(line.from + target.from, line.from + target.to),
        ]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

function beginLabelEdit(target: EditTarget): void {
  disasmView.dispatch({ effects: setEdit.of(target) });
}

function endLabelEdit(): void {
  if (disasmView.state.field(editField) === null) return;
  disasmView.dispatch({ effects: setEdit.of(null) });
  disasmView.focus();
}

async function commitLabelEdit(target: EditTarget, value: string): Promise<void> {
  const name = value.trim();
  endLabelEdit();

  if (name === target.name) return;

  if (!name) {
    if (target.isNew) return;
    await fetch("/api/label", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: target.address }),
    });
    setStatus(`Removed label at $${hex4(target.address)}`);
  } else {
    const res = await fetch("/api/label", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: target.address, name }),
    });
    if (!res.ok) {
      setStatus((await res.json()).error ?? "Failed to save label", true);
      return;
    }
    setStatus(`${target.isNew ? "Added" : "Renamed"} ${name} at $${hex4(target.address)}`);
  }

  await loadDisassembly(target.address);
  await loadProjectFile();
}

// --- Navigation -------------------------------------------------------

function currentAddress(): number | null {
  if (!analysis) return null;
  const line = disasmView.state.doc.lineAt(disasmView.state.selection.main.head).number;
  return analysis.rows[line - 1]?.address ?? null;
}

/** Scroll to an address, recording where we came from. */
function goToAddress(address: number, record = true): void {
  if (!analysis) return;

  // Fall back to the nearest preceding row when the address is mid-instruction.
  let line = analysis.lineForAddress[address];
  if (line === undefined) {
    let best = -1;
    let bestAddr = -1;
    for (const [addrStr, idx] of Object.entries(analysis.lineForAddress)) {
      const a = Number(addrStr);
      if (a <= address && a > bestAddr) {
        bestAddr = a;
        best = idx;
      }
    }
    if (best < 0) {
      setStatus(`$${hex4(address)} is outside the loaded memory map`, true);
      return;
    }
    line = best;
  }

  if (record) {
    const from = currentAddress();
    if (from !== null) navStack.push(from);
  }

  const pos = disasmView.state.doc.line(line + 1).from;
  disasmView.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
  });
  disasmView.focus();
  updateBackButton();
  setStatus(`$${hex4(address)}`);
}

function goBack(): void {
  const previous = navStack.pop();
  if (previous === undefined) {
    setStatus("Nothing to go back to");
    return;
  }
  goToAddress(previous, false);
}

function updateBackButton(): void {
  ($("#back") as HTMLButtonElement).disabled = navStack.length === 0;
  $("#back").textContent = navStack.length ? `← Back (${navStack.length})` : "← Back";
}

// --- Label editing ----------------------------------------------------

/**
 * Set a label's type and save it.
 *
 * Types are not cosmetic: entry, function, and code all queue the address as a
 * disassembly entry point, so changing one can uncover code the work queue
 * could not otherwise reach. The status line reports that gain, because it is
 * the whole reason to touch the setting.
 */
async function setLabelType(
  address: number,
  name: string,
  type: LabelType
): Promise<void> {
  const res = await fetch("/api/label", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, name, type }),
  });
  if (!res.ok) {
    setStatus((await res.json()).error ?? "Failed to change type", true);
    return;
  }

  const before = analysis?.stats.instructions ?? 0;
  await loadDisassembly(address);
  await loadProjectFile();
  const delta = (analysis?.stats.instructions ?? 0) - before;

  setStatus(
    `${name} is now ${type}` +
      (delta > 0
        ? ` — ${delta} more instructions`
        : delta < 0
          ? ` — ${-delta} fewer instructions`
          : "")
  );
}

// --- Function toggle --------------------------------------------------

/**
 * Mark the current line as a function, or clear it.
 *
 * Declaring a function is the one type change worth a keystroke: it queues the
 * address as a disassembly entry point, which is how code nothing references —
 * reached only through a jump table or an indirect JMP — gets decoded at all.
 *
 * On an unlabelled address it creates the label too, named sub_XXXX, since
 * "this is a subroutine" is usually known before a good name is.
 */
function toggleFunctionOnCurrentLine(): void {
  if (!analysis) return;

  const lineNo = disasmView.state.doc.lineAt(disasmView.state.selection.main.head).number;
  const row = analysis.rows[lineNo - 1];
  if (!row) return;

  const labelRow = analysis.rows.find(
    (r) => r.address === row.address && r.kind === "label"
  );
  const token = labelRow?.tokens.find((t) => t.kind === "label");

  const name = token?.name ?? `sub_${hex4(row.address)}`;
  const isFunction = token?.labelType === "function";

  if (!isFunction) {
    // Auto-generated names encode their type in the prefix, so a promoted
    // label has to move to sub_ — leaving it as loc_ would give a function the
    // prefix reserved for branch targets, and the name would contradict the tag.
    const promoted = isAutoGeneratedName(name, row.address)
      ? `sub_${hex4(row.address)}`
      : name;
    void setLabelType(row.address, promoted, "function");
    return;
  }

  // Clearing a name the disassembler would generate anyway removes the entry
  // outright, rather than leaving a redundant untyped label behind. A name you
  // chose is kept — only its type is cleared.
  if (isAutoGeneratedName(name, row.address)) {
    void removeLabel(row.address, name);
  } else {
    void setLabelType(row.address, name, "address");
  }
}

/** True when the name is exactly what auto-labelling produces for this address. */
function isAutoGeneratedName(name: string, address: number): boolean {
  return new RegExp(`^(sub|loc|dat)_${hex4(address)}$`).test(name);
}

async function removeLabel(address: number, name: string): Promise<void> {
  const res = await fetch("/api/label", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) {
    setStatus((await res.json()).error ?? "Failed to remove label", true);
    return;
  }
  await loadDisassembly(address);
  await loadProjectFile();
  setStatus(`${name} is no longer a function`);
}

/**
 * Name the address on the current line — the IDA "n" key.
 *
 * Edits the existing label row when there is one; otherwise opens a new block
 * row above the current line, since there is no token to replace in place.
 */
function nameCurrentLine(): void {
  if (!analysis) return;

  const lineNo = disasmView.state.doc.lineAt(disasmView.state.selection.main.head).number;
  const row = analysis.rows[lineNo - 1];
  if (!row) return;

  const labelLine = analysis.rows.findIndex(
    (r) => r.address === row.address && r.kind === "label"
  );

  if (labelLine >= 0) {
    const token = analysis.rows[labelLine].tokens.find((t) => t.kind === "label")!;
    beginLabelEdit({
      address: row.address,
      name: token.name ?? "",
      line: labelLine,
      from: token.start,
      to: token.end,
      isNew: false,
    });
    return;
  }

  beginLabelEdit({
    address: row.address,
    name: "",
    line: lineNo - 1,
    from: 0,
    to: 0,
    isNew: true,
  });
}

// --- Editors ----------------------------------------------------------

const clickHandler = EditorView.domEventHandlers({
  mousedown(event) {
    const el = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-target],[data-rename]"
    );
    if (!el) return false;

    const rename = el.getAttribute("data-rename");
    if (rename !== null) {
      beginLabelEdit({
        address: Number(rename),
        name: el.getAttribute("data-name") ?? "",
        line: Number(el.getAttribute("data-line")),
        from: Number(el.getAttribute("data-from")),
        to: Number(el.getAttribute("data-to")),
        isNew: false,
      });
      event.preventDefault();
      return true;
    }

    const target = el.getAttribute("data-target");
    if (target !== null) {
      goToAddress(Number(target));
      event.preventDefault();
      return true;
    }
    return false;
  },
});

const navKeymap = keymap.of([
  { key: "Alt-ArrowLeft", run: () => (goBack(), true) },
  { key: "Backspace", run: () => (goBack(), true) },
  { key: "n", run: () => (nameCurrentLine(), true) },
  { key: "f", run: () => (toggleFunctionOnCurrentLine(), true) },
  { key: "Escape", run: () => (endLabelEdit(), true) },
  {
    key: "g",
    run: () => {
      ($("#goto") as HTMLInputElement).select();
      return true;
    },
  },
  {
    key: "Enter",
    run: () => {
      const address = currentAddress();
      if (address === null) return true;
      const row = analysis?.rows[disasmView.state.doc.lineAt(disasmView.state.selection.main.head).number - 1];
      const jump = row?.tokens.find((t) => t.kind === "operand")?.target;
      if (jump !== undefined) goToAddress(jump);
      return true;
    },
  },
]);

const disasmView = new EditorView({
  state: EditorState.create({
    doc: "Loading…",
    extensions: [
      arrowGutter,
      highlightActiveLine(),
      decorationField,
      editField,
      editDecorations,
      clickHandler,
      navKeymap,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      // A non-editable content DOM is not focusable on its own, so clicking a
      // line would leave the keymap (n, g, Enter, Backspace) with no listener.
      EditorView.contentAttributes.of({ tabindex: "0" }),
      oneDark,
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px" },
        ".cm-content": { fontFamily: "'SF Mono', Menlo, Consolas, monospace" },
        ".cm-gutters": {
          backgroundColor: "transparent",
          border: "none",
          color: "#5c6a7e",
        },
        ".cm-arrow-gutter .cm-gutterElement": {
          fontFamily: "'SF Mono', Menlo, Consolas, monospace",
          paddingLeft: "6px",
          whiteSpace: "pre",
        },
        ".cm-arrow-gutter .arrow-glyphs": {
          display: "inline-block",
          transform: "scaleY(1.45)",
          transformOrigin: "center",
        },
        ".label-edit": {
          font: "inherit",
          fontWeight: "600",
          color: "#9ae08a",
          background: "#232833",
          border: "1px solid #4a7a3f",
          borderRadius: "3px",
          padding: "0 4px",
          margin: "0 -4px",
          outline: "none",
        },
        ".label-edit::placeholder": { color: "#5c6a7e", fontWeight: "400" },
        // A new label has no row of its own, so the block widget supplies one
        // and indents it to where the label column starts.
        ".label-edit-row": { paddingLeft: "6ch" },
      }),
    ],
  }),
  parent: $("#disasm"),
});

const projectView = new EditorView({
  state: EditorState.create({
    doc: "",
    extensions: [
      lineNumbers(),
      history(),
      json(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        { key: "Mod-s", run: () => (void saveProjectFile(), true) },
      ]),
      oneDark,
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px" },
        ".cm-content": { fontFamily: "'SF Mono', Menlo, Consolas, monospace" },
      }),
    ],
  }),
  parent: $("#project"),
});

// --- Loading ----------------------------------------------------------

async function loadDisassembly(restoreAddress?: number): Promise<void> {
  const res = await fetch("/api/disasm");
  if (!res.ok) {
    setStatus((await res.json()).error ?? "Disassembly failed", true);
    return;
  }
  analysis = await res.json();
  const rows = analysis!.rows;

  disasmView.dispatch({
    changes: { from: 0, to: disasmView.state.doc.length, insert: rows.map((r) => r.text).join("\n") },
    effects: setRows.of(rows),
  });

  const { instructions, labels, regions, arrows, arrowsDemoted } = analysis!.stats;
  $("#stats").textContent =
    `${analysis!.name} · ${instructions} instructions · ${labels} labels · ${regions} regions` +
    ` · ${arrows} arrows` +
    (arrowsDemoted ? ` (${arrowsDemoted} as stubs)` : "") +
    (analysis!.warnings.length ? ` · ${analysis!.warnings.length} warnings` : "");

  if (restoreAddress !== undefined) goToAddress(restoreAddress, false);
}

async function loadProjectFile(): Promise<void> {
  const res = await fetch("/api/project");
  const { raw } = await res.json();
  projectView.dispatch({
    changes: { from: 0, to: projectView.state.doc.length, insert: raw },
  });
}

async function saveProjectFile(): Promise<void> {
  const res = await fetch("/api/project", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: projectView.state.doc.toString(),
  });
  if (!res.ok) {
    setStatus((await res.json()).error ?? "Save failed", true);
    return;
  }
  setStatus("Project saved — reanalyzing");
  await loadDisassembly();
  setStatus("Project saved");
}

// --- Shortcuts dialog -------------------------------------------------

const shortcuts = $("#shortcuts") as HTMLDialogElement;

/** True when typing should reach a field rather than trigger a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable // the project editor; the disassembly view is not editable
  );
}

function showShortcuts(): void {
  if (!shortcuts.open) shortcuts.showModal();
}

$("#shortcuts-close").addEventListener("click", () => shortcuts.close());

// Clicking the backdrop lands on the dialog element itself.
shortcuts.addEventListener("click", (event) => {
  if (event.target === shortcuts) shortcuts.close();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "?" || isTypingTarget(event.target)) return;
  event.preventDefault();
  showShortcuts();
});

// Spell the modifier the way the platform does.
if (navigator.platform.startsWith("Mac")) {
  for (const key of Array.from(document.querySelectorAll(".mod-key"))) {
    key.textContent = "⌘";
  }
}

// --- Memory map panel -------------------------------------------------

interface RegionNode {
  start: number;
  end: number;
  kind: string;
  name?: string;
  comment?: string;
  children: RegionNode[];
}

interface LayerView {
  depth: number;
  name: string;
  start: number;
  end: number;
  hasBytes: boolean;
  defaultKind: string;
  source: string;
  labelCount: number;
  regions: RegionNode[];
}

/**
 * Two shapes, because there are two relationships. Layers stack by z-order, so
 * they render as an ordered list; regions contain one another by address range,
 * so they render as a tree. Both are read-only for now — reordering the stack
 * and retyping spans are edits, and edits are a separate pass.
 */
function renderMap(layers: LayerView[]): void {
  const root = $("#map");
  root.textContent = "";

  for (const layer of layers) {
    const card = document.createElement("section");
    card.className = "map-layer" + (layer.hasBytes ? "" : " no-bytes");

    const head = document.createElement("div");
    head.className = "map-layer-head";
    head.innerHTML =
      `<span class="map-depth">${layer.depth === 0 ? "top" : layer.depth}</span>` +
      `<span class="map-name"></span>` +
      `<span class="map-range"></span>` +
      `<span class="map-meta"></span>`;
    head.querySelector(".map-name")!.textContent = layer.name;
    head.querySelector(".map-range")!.textContent = layer.hasBytes
      ? `${hex4(layer.start)}–${hex4(layer.end)}`
      : "no bytes";
    head.querySelector(".map-meta")!.textContent =
      `${layer.source} · ${layer.labelCount} label${layer.labelCount === 1 ? "" : "s"}` +
      (layer.hasBytes ? ` · default ${layer.defaultKind}` : "");
    card.appendChild(head);

    if (layer.hasBytes) {
      const body = document.createElement("div");
      body.className = "map-regions";
      if (layer.regions.length) {
        body.appendChild(renderRegions(layer.regions));
      } else {
        const empty = document.createElement("div");
        empty.className = "map-empty";
        empty.textContent = `No regions declared — all ${layer.defaultKind}.`;
        body.appendChild(empty);
      }
      card.appendChild(body);
    }

    root.appendChild(card);
  }
}

function renderRegions(nodes: RegionNode[]): HTMLElement {
  const list = document.createElement("ul");

  for (const node of nodes) {
    const item = document.createElement("li");

    const row = document.createElement("div");
    row.className = "map-region";
    row.title = node.comment ?? `Go to ${hex4(node.start)}`;
    row.innerHTML =
      `<span class="map-region-range"></span>` +
      `<span class="map-region-kind kind-${node.kind}"></span>` +
      `<span class="map-region-name"></span>`;
    row.querySelector(".map-region-range")!.textContent =
      `${hex4(node.start)}–${hex4(node.end)}`;
    row.querySelector(".map-region-kind")!.textContent = node.kind;
    row.querySelector(".map-region-name")!.textContent = node.name ?? "";
    row.addEventListener("click", () => {
      showTab("disasm");
      goToAddress(node.start);
    });
    item.appendChild(row);

    if (node.children.length) item.appendChild(renderRegions(node.children));
    list.appendChild(item);
  }

  return list;
}

async function loadMap(): Promise<void> {
  const res = await fetch("/api/map");
  if (!res.ok) {
    setStatus("Failed to load the memory map", true);
    return;
  }
  const { layers } = (await res.json()) as { layers: LayerView[] };
  renderMap(layers);
}

// --- Wiring -----------------------------------------------------------

type TabName = "disasm" | "map" | "project";

function showTab(name: TabName): void {
  for (const tab of Array.from(document.querySelectorAll(".tab"))) {
    tab.classList.toggle("active", tab.getAttribute("data-tab") === name);
  }
  for (const id of ["disasm", "map", "project"] as const) {
    $(`#${id}`).style.display = id === name ? "" : "none";
  }
  if (name === "disasm") disasmView.focus();
  else if (name === "project") projectView.focus();
}

for (const tab of Array.from(document.querySelectorAll(".tab"))) {
  tab.addEventListener("click", () =>
    showTab(tab.getAttribute("data-tab") as TabName)
  );
}

$("#back").addEventListener("click", goBack);
$("#reload").addEventListener("click", () => {
  void loadDisassembly(currentAddress() ?? undefined);
  void loadProjectFile();
  void loadMap();
});
$("#save").addEventListener("click", () => void saveProjectFile());

$("#goto").addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key !== "Enter") return;
  const value = ($("#goto") as HTMLInputElement).value.trim().replace(/^[$#]|^0x/i, "");
  const address = parseInt(value, 16);
  if (isNaN(address)) {
    setStatus(`Not an address: ${value}`, true);
    return;
  }
  goToAddress(address);
});

updateBackButton();
showTab("disasm");
void loadDisassembly();
void loadProjectFile();
void loadMap();
