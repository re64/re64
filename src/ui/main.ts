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
import { analyze, buildMapView } from "../core/index.js";
import { ProjectSession } from "../client/index.js";
import type SlSplitPanel from "@shoelace-style/shoelace/dist/components/split-panel/split-panel.js";
// Registers <sl-split-panel>. Components are imported individually so the
// bundle carries only what is used.
import "@shoelace-style/shoelace/dist/components/split-panel/split-panel.js";

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

/** True while an inline label editor is open, so repaints hold off. */
function editingLabel(): boolean {
  return disasmView.state.field(editField) !== null;
}

function endLabelEdit(): void {
  if (!editingLabel()) return;
  disasmView.dispatch({ effects: setEdit.of(null) });
  disasmView.focus();
  flushDeferredRepaint();
}

async function commitLabelEdit(target: EditTarget, value: string): Promise<void> {
  const name = value.trim();
  endLabelEdit();

  if (name === target.name) return;

  if (!name) {
    if (target.isNew) return;
    await edit(
      (s) => s.removeLabel(target.address),
      () => `Removed label at ${hex4(target.address)}`
    );
    return;
  }

  await edit(
    (s) => s.setLabel(target.address, name, undefined),
    () => `${target.isNew ? "Added" : "Renamed"} ${name} at ${hex4(target.address)}`
  );
}


/**
 * Apply an edit and repaint.
 *
 * There is no save. The edit lands in the shared document and is already
 * everyone's; the repaint is this browser catching up with itself through the
 * same path a collaborator's edit takes.
 */
async function edit(
  change: (s: ProjectSession) => void,
  describe: (delta: number) => string
): Promise<void> {
  if (!session) return;
  const before = analysis?.stats.instructions ?? 0;

  try {
    change(session);
    await session.refresh();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Edit failed", true);
    return;
  }

  const anchor = captureAnchor();
  render();
  restoreAnchor(anchor);
  setStatus(describe((analysis?.stats.instructions ?? 0) - before));
}

/**
 * Undo and redo the project edits made this session.
 *
 * Separate from CodeMirror's own history, which covers typing in the project
 * JSON editor. These are model edits — a rename, a region retype — and each
 * carries the operation that reverses it.
 */
/**
 * Keep the undo and redo buttons in step with what is actually available.
 *
 * The title carries what would happen, since a bare arrow says nothing about
 * whether pressing it reverts a rename or a deletion.
 */
function refreshEditButtons(): void {
  const undoable = session?.undoDescription();
  const redoable = session?.redoDescription();
  const undo = $("#undo") as HTMLButtonElement;
  const redo = $("#redo") as HTMLButtonElement;

  undo.disabled = undoable === undefined;
  redo.disabled = redoable === undefined;
  undo.title = undoable ? `Undo: ${undoable}` : "Nothing to undo";
  redo.title = redoable ? `Redo: ${redoable}` : "Nothing to redo";
}

async function undoEdit(): Promise<void> {
  if (!session) return;
  const undone = session.undo();
  if (!undone) {
    setStatus("Nothing to undo");
    return;
  }
  await session.settled(0);
  repaint();
  setStatus(`Undid: ${undone}`);
}

async function redoEdit(): Promise<void> {
  if (!session) return;
  const redone = session.redo();
  if (!redone) {
    setStatus("Nothing to redo");
    return;
  }
  await session.settled(0);
  repaint();
  setStatus(`Redid: ${redone}`);
}

/**
 * Repaint once per frame, and not at all while a label is being typed.
 *
 * Deferring during an edit is the blunt fix and the deliberate one. A repaint
 * replaces the document and rebuilds decorations, which destroys an open inline
 * editor — a collaborator renaming something would pull the field out from
 * under you mid-word. The disassembly view is not a collaborative text buffer
 * and should not start behaving like one.
 *
 * It also makes a latent bug unreachable: `LabelEditWidget.eq` compares by
 * label name, so a remote rename of the address being edited would rebuild the
 * widget even if the editor state survived. Anyone removing this deferral has
 * to fix that too — anchored on the label id, since several labels can share
 * an address.
 */
let repaintQueued = false;
let repaintDeferred = false;

function scheduleRepaint(): void {
  if (editingLabel()) {
    repaintDeferred = true;
    return;
  }
  if (repaintQueued) return;
  repaintQueued = true;
  requestAnimationFrame(() => {
    repaintQueued = false;
    void repaint();
  });
}

/** Catch up on whatever arrived while a label was being edited. */
function flushDeferredRepaint(): void {
  if (!repaintDeferred) return;
  repaintDeferred = false;
  scheduleRepaint();
}

function repaint(): void {
  if (!session) return;
  const anchor = captureAnchor();
  render();
  restoreAnchor(anchor);
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
  await edit(
    (s) => s.setLabel(address, name, type),
    (delta) =>
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
  await edit(
    (s) => s.removeLabel(address),
    () => `${name} is no longer a function`
  );
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
  { key: "Mod-z", run: () => (void undoEdit(), true) },
  { key: "Mod-Shift-z", run: () => (void redoEdit(), true) },
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
        { key: "Mod-s", run: () => (void exportProjectFile(), true) },
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

/** The project as this browser holds it; edits apply here first. */
let session: ProjectSession | null = null;

interface User {
  id: string;
  name: string;
  colour: string;
}

let users: User[] = [];
let me: User | undefined;
let projects: { id: string; name: string }[] = [];
let currentProject: string | undefined;

/** Which project this window is showing. The URL wins, then the first offered. */
async function loadProjects(): Promise<void> {
  try {
    const res = await fetch("/api/projects");
    projects = res.ok
      ? ((await res.json()) as { projects: { id: string; name: string }[] }).projects
      : [];
  } catch {
    projects = [];
  }

  const wanted = new URLSearchParams(location.search).get("project");
  currentProject = projects.find((p) => p.id === wanted)?.id ?? projects[0]?.id;

  const picker = $("#which") as HTMLSelectElement;
  picker.innerHTML = "";
  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    option.selected = project.id === currentProject;
    picker.appendChild(option);
  }
  // Nothing to choose between is not worth a control.
  picker.style.display = projects.length > 1 ? "" : "none";
}

$("#which").addEventListener("change", (event) => {
  const url = new URL(location.href);
  url.searchParams.set("project", (event.target as HTMLSelectElement).value);
  location.assign(url.toString());
});

/**
 * Who you are editing as.
 *
 * The URL wins so a second window can be opened as someone else for testing;
 * otherwise the last choice, otherwise the first name the server offers. There
 * is no authentication — picking a name is all it takes, and this only decides
 * what the history records and what other people see.
 */
function preferredUserId(): string | undefined {
  const fromUrl = new URLSearchParams(location.search).get("user");
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem("re64.user") ?? undefined;
  } catch {
    return undefined;
  }
}

async function loadUsers(): Promise<void> {
  try {
    const res = await fetch("/api/users");
    users = res.ok ? ((await res.json()) as { users: User[] }).users : [];
  } catch {
    users = [];
  }

  const wanted = preferredUserId();
  me = users.find((u) => u.id === wanted || u.name === wanted) ?? users[0];

  const picker = $("#who") as HTMLSelectElement;
  picker.innerHTML = "";
  for (const user of users) {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = user.name;
    option.selected = user.id === me?.id;
    picker.appendChild(option);
  }
  picker.style.display = users.length ? "" : "none";
}

$("#who").addEventListener("change", (event) => {
  const id = (event.target as HTMLSelectElement).value;
  store("re64.user", id);
  // A reload rather than a live swap: identity is fixed when the session
  // connects, and two identities on one document would be one peer pretending
  // to be two.
  const url = new URL(location.href);
  url.searchParams.set("user", id);
  location.assign(url.toString());
});

/** Who else is in this project, as coloured dots. */
function renderPresence(): void {
  const here = $("#here");
  here.innerHTML = "";
  if (!session) return;

  for (const person of session.participants()) {
    const dot = document.createElement("span");
    dot.className = person.isMe ? "dot me" : "dot";
    dot.style.background = person.colour;
    dot.title = person.isMe ? `${person.name} (you)` : person.name;
    here.appendChild(dot);
  }
}

/** Fetch the project and its bytes, then analyse in the browser. */
async function loadDisassembly(restoreAddress?: number): Promise<void> {
  try {
    session?.close();
    await loadProjects();
    await loadUsers();
    session = await ProjectSession.open({ project: currentProject, author: me?.id });
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Could not load the project", true);
    return;
  }

  // Every change arrives through the same door from here, whoever caused it.
  session.onChange(() => scheduleRepaint());
  session.onPresence(() => renderPresence());
  if (me) session.announce({ name: me.name, colour: me.colour });
  renderPresence();
  render(restoreAddress);
}

/**
 * Re-analyse the current model and repaint.
 *
 * Everything downstream of the project text is derived, so an edit just changes
 * the text and comes back through here — no network, no partial updates.
 */
/**
 * Where a line sits in the viewport, so a repaint can put it back there.
 *
 * Not the scroll offset: an edit can insert a line above the one you are
 * looking at — naming a previously unnamed address does exactly that — and
 * restoring a raw scrollTop would shift everything by a row. Anchoring on an
 * address and its distance from the top of the viewport survives that.
 */
interface ViewportAnchor {
  address: number;
  offsetFromTop: number;
}

function captureAnchor(): ViewportAnchor | null {
  if (!analysis) return null;
  const address = currentAddress();
  if (address === null) return null;

  const line = analysis.lineForAddress[address];
  if (line === undefined) return null;

  const coords = disasmView.coordsAtPos(disasmView.state.doc.line(line + 1).from);
  if (!coords) return null;

  return {
    address,
    offsetFromTop: coords.top - disasmView.scrollDOM.getBoundingClientRect().top,
  };
}

function restoreAnchor(anchor: ViewportAnchor | null): void {
  if (!anchor || !analysis) return;
  const line = analysis.lineForAddress[anchor.address];
  if (line === undefined) return;

  const pos = disasmView.state.doc.line(line + 1).from;
  disasmView.dispatch({ selection: { anchor: pos } });

  const coords = disasmView.coordsAtPos(pos);
  if (!coords) return;
  const now = coords.top - disasmView.scrollDOM.getBoundingClientRect().top;
  disasmView.scrollDOM.scrollTop += now - anchor.offsetFromTop;
}

/** How long the last render spent in each phase, for the debug view. */
const timings = { analyzeMs: 0, renderMs: 0 };

function render(restoreAddress?: number): void {
  const startedRender = performance.now();
  const loadedProject = session!.loaded;
  const startedAnalyze = performance.now();
  const result = analyze(loadedProject);
  timings.analyzeMs = performance.now() - startedAnalyze;
  analysis = {
    name: loadedProject.project.name ?? "untitled",
    ...result,
  };
  const rows = analysis.rows;

  // The map is derived from the same model, so it never lags the disassembly.
  renderMap(buildMapView(loadedProject).layers);

  disasmView.dispatch({
    changes: { from: 0, to: disasmView.state.doc.length, insert: rows.map((r) => r.text).join("\n") },
    effects: setRows.of(rows),
  });

  const { instructions, labels, regions, arrows, arrowsDemoted } = analysis.stats;
  $("#stats").textContent =
    `${analysis.name} · ${instructions} instructions · ${labels} labels · ${regions} regions` +
    ` · ${arrows} arrows` +
    (arrowsDemoted ? ` (${arrowsDemoted} as stubs)` : "") +
    (analysis.warnings.length ? ` · ${analysis.warnings.length} warnings` : "");

  if (restoreAddress !== undefined) goToAddress(restoreAddress, false);

  timings.renderMs = performance.now() - startedRender;
  refreshEditButtons();
  if (currentTab === "debug") void renderDebug();
}

function showExportedProject(): void {
  if (!session) return;
  projectView.dispatch({
    changes: {
      from: 0,
      to: projectView.state.doc.length,
      insert: session.exportedText(),
    },
  });
}

/** Write the project out as a file. A deliberate act now, not a save. */
async function exportProjectFile(): Promise<void> {
  if (!session) return;
  try {
    const res = await fetch("/api/export", { method: "POST" });
    if (!res.ok) {
      throw new Error(((await res.json()) as { error?: string }).error ?? "export failed");
    }
    setStatus("Exported");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Could not export", true);
  }
}

// --- Debug pane -------------------------------------------------------

/**
 * What the application currently believes, in one place.
 *
 * The interesting state is split across two machines: the undo stack, the
 * analysis timings and the fetched blobs are the browser's, while the CRDT
 * document, the crash log and the durable undo record are the server's and
 * invisible from here without asking. So this reads both and says which is
 * which — a value that disagrees with its counterpart is the thing worth
 * seeing.
 */
interface ServerDebug {
  storage: string;
  path: string;
  clients: number;
  version: string;
  storedRev: string;
  dirty: boolean;
  authors: string[];
  pendingOps: number;
  updates: { count: number; snapshotAt: number };
  ops: { total: number; undone: number };
  history: number;
}

let serverDebug: ServerDebug | { error: string } | undefined;

/**
 * Everything here can carry project content — label names, file paths — so it
 * is escaped rather than trusted. The rest of this file builds DOM and sets
 * `textContent`; a table of forty key/value rows is where that stops paying.
 */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

const ms = (value: number) => `${value.toFixed(1)} ms`;
const ago = (at: number | undefined) =>
  at === undefined ? "never" : `${Math.round((Date.now() - at) / 1000)}s ago`;

function definitions(rows: [string, string, string?][]): string {
  return (
    "<dl>" +
    rows
      .map(
        ([term, value, cls]) =>
          `<dt>${escapeHtml(term)}</dt><dd${cls ? ` class="${cls}"` : ""}>${escapeHtml(value)}</dd>`
      )
      .join("") +
    "</dl>"
  );
}

async function renderDebug(): Promise<void> {
  const pane = $("#debug");
  if (!session) {
    pane.innerHTML = '<p class="empty">No project loaded.</p>';
    return;
  }

  try {
    const res = await fetch(
      "/api/debug" + (currentProject ? `?project=${encodeURIComponent(currentProject)}` : "")
    );
    serverDebug = res.ok
      ? ((await res.json()) as ServerDebug)
      : { error: `server replied ${res.status}` };
  } catch (err) {
    serverDebug = { error: err instanceof Error ? err.message : "unreachable" };
  }

  const d = session.debug();
  const stats = analysis?.stats;
  let html = "";

  html += "<h3>This session</h3>";
  html += definitions([
    // Not "this user": two tabs are two sessions, two client ids and two
    // independent undo stacks, and they can conflict with each other.
    ["session", d.sessionId],
    ["connection", d.status, d.status === "connected" ? "good" : "warn"],
    ["project", currentProject ?? "—"],
    ["editing as", me ? `${me.name} (${me.id})` : "nobody — no users defined"],
    ["participants", String(d.participants)],
    ["can undo", d.undo.canUndo ? (d.undo.next ?? "yes") : "no"],
    ["can redo", d.undo.canRedo ? "yes" : "no"],
    ...d.blobs.map(
      (b) => [`blob ${b.path}`, `${b.bytes.toLocaleString()} bytes`] as [string, string]
    ),
  ]);

  html += "<h3>Analysis</h3>";
  html += definitions([
    ["analyze", ms(timings.analyzeMs)],
    ["build map", ms(d.lastBuildMs)],
    ["render total", ms(timings.renderMs)],
    ["rows", stats ? String(stats.rows) : "—"],
    ["instructions", stats ? String(stats.instructions) : "—"],
    ["labels", stats ? String(stats.labels) : "—"],
    ["regions", stats ? String(stats.regions) : "—"],
    ["arrows", stats ? `${stats.arrows} (${stats.arrowsDemoted} demoted)` : "—"],
    ["warnings", String(analysis?.warnings.length ?? 0)],
  ]);

  html += "<h3>Server</h3>";
  if (serverDebug === undefined || "error" in serverDebug) {
    html += definitions([
      ["reachable", "no", "bad"],
      ["detail", serverDebug?.error ?? "not asked", "bad"],
    ]);
  } else {
    const sv = serverDebug;
    html += definitions([
      ["storage", sv.storage],
      ["path", sv.path],
      ["connected clients", String(sv.clients)],
      ["document version", sv.version],
      // A version this browser does not share means someone else has edited.
      ["exported revision", sv.storedRev],
      ["unflattened session", sv.dirty ? "yes" : "no"],
      ["authors this session", sv.authors.length ? sv.authors.join(", ") : "—"],
      ["operations pending flatten", String(sv.pendingOps)],
    ]);

    html += "<h3>CRDT</h3>";
    html += definitions([
      // Both hold one now, and they are the same document.
      ["held by", "this browser and the server, in sync"],
      ["recorded updates", String(sv.updates.count)],
      // Nothing is deleted by a snapshot; it only says how much of the log a
      // fresh reader can skip.
      ["snapshot covers up to", sv.updates.snapshotAt ? String(sv.updates.snapshotAt) : "—"],
    ]);

    html += "<h3>Durable undo (server)</h3>";
    html += definitions([
      ["operations recorded", String(sv.ops.total)],
      ["marked undone", String(sv.ops.undone)],
      ["recorded sessions", String(sv.history)],
      // Two different features, deliberately. This one reverts by applying an
      // inverse as a new edit, which is the only thing that works in a CLI
      // process that starts, edits and exits; the stack above reverts structs
      // and needs a live document.
      ["reaches this session's stack", "no — that one is the document's", "warn"],
    ]);
  }

  pane.innerHTML = html;
}

$("#debug").addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("h3")) void renderDebug();
});

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
  /** Height in the stack: 0 is the bottom, higher numbers sit on top. */
  level: number;
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
 * so they render as a tree.
 *
 * The list is laid out bottom-up (CSS `column-reverse`), so the stack reads the
 * way it stacks — the platform layer at the foot, level 0 — and in the same
 * order as the project file declares them. Read-only for now: reordering the
 * stack and retyping spans are edits, and editing is a separate pass.
 */
function renderMap(layers: LayerView[]): void {
  const root = $("#map");
  root.textContent = "";

  const title = document.createElement("div");
  title.className = "map-title";
  title.textContent = "Memory map";
  root.appendChild(title);

  const stack = document.createElement("div");
  stack.className = "map-stack";

  for (const layer of layers) {
    const card = document.createElement("section");
    card.className =
      "map-layer" +
      (layer.hasBytes ? "" : " no-bytes") +
      (layer.hasBytes && layer.regions.length ? " has-regions" : "");

    const head = document.createElement("div");
    head.className = "map-layer-head";
    head.innerHTML =
      `<span class="map-level"></span>` +
      `<span class="map-name"></span>` +
      `<span class="map-range"></span>` +
      `<span class="map-meta"></span>`;
    head.querySelector(".map-level")!.textContent = String(layer.level);
    head.querySelector(".map-name")!.textContent = layer.name;
    head.querySelector(".map-range")!.textContent = layer.hasBytes
      ? `$${hex4(layer.start)}–$${hex4(layer.end)}`
      : "";
    head.querySelector(".map-meta")!.textContent =
      `${layer.source} · ${layer.labelCount} label${layer.labelCount === 1 ? "" : "s"}` +
      (layer.hasBytes ? ` · ${layer.defaultKind}` : "");
    card.appendChild(head);

    if (layer.hasBytes && layer.regions.length) {
      const body = document.createElement("div");
      body.className = "map-regions";
      body.appendChild(renderRegions(layer.regions));
      card.appendChild(body);
    }

    stack.appendChild(card);
  }

  root.appendChild(stack);
}

function renderRegions(nodes: RegionNode[]): HTMLElement {
  const list = document.createElement("ul");

  for (const node of nodes) {
    const item = document.createElement("li");

    const row = document.createElement("div");
    row.className = "map-region";
    // The column is too narrow for a kind column, so the kind is carried by
    // colour and spelled out in the tooltip.
    row.title =
      `${node.kind} · $${hex4(node.start)}–$${hex4(node.end)}` +
      (node.comment ? ` · ${node.comment}` : "");
    row.innerHTML =
      `<span class="map-region-range kind-${node.kind}"></span>` +
      `<span class="map-region-name"></span>`;
    row.querySelector(".map-region-range")!.textContent = `$${hex4(node.start)}`;
    row.querySelector(".map-region-name")!.textContent = node.name ?? node.kind;
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

// --- Wiring -----------------------------------------------------------

type TabName = "disasm" | "project" | "debug";

let currentTab: TabName = "disasm";

function showTab(name: TabName): void {
  currentTab = name;
  for (const tab of Array.from(document.querySelectorAll(".tab"))) {
    tab.classList.toggle("active", tab.getAttribute("data-tab") === name);
  }
  for (const id of ["disasm", "project", "debug"] as const) {
    $(`#${id}`).style.display = id === name ? "" : "none";
  }
  if (name === "disasm") disasmView.focus();
  else if (name === "project") {
    // Filled on show rather than kept in step: it is a view of what would be
    // exported, and regenerating it cannot promise the file's own layout.
    showExportedProject();
    projectView.focus();
  }
  else void renderDebug();
}

for (const tab of Array.from(document.querySelectorAll(".tab"))) {
  tab.addEventListener("click", () =>
    showTab(tab.getAttribute("data-tab") as TabName)
  );
}

/**
 * Sidebar width and visibility.
 *
 * Collapsing is just a zero-width split, so dragging the divider to the edge
 * and pressing the toolbar button reach the same state — and the width you
 * chose is still there when you reopen it.
 *
 * Both are remembered locally. Storage access is wrapped because it throws
 * outright in some contexts (private windows, blocked site data).
 */
const split = $("#split") as SlSplitPanel;
const DEFAULT_MAP_WIDTH = 24;
let lastMapWidth = DEFAULT_MAP_WIDTH;

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not worth surfacing: the setting still holds for this session.
  }
}

function setMapVisible(visible: boolean): void {
  split.classList.toggle("collapsed", !visible);
  split.position = visible ? lastMapWidth : 0;
  $("#toggle-map").classList.toggle("active", visible);
  store("re64.map", visible ? "1" : "0");
}

$("#toggle-map").addEventListener("click", () => {
  setMapVisible(split.position === 0);
});

// Dragging to the edge counts as collapsing, so the button stays in sync.
split.addEventListener("sl-reposition", () => {
  const collapsed = split.position < 1;
  $("#toggle-map").classList.toggle("active", !collapsed);
  if (collapsed) {
    store("re64.map", "0");
  } else {
    lastMapWidth = split.position;
    store("re64.map", "1");
    store("re64.mapWidth", String(lastMapWidth));
  }
});

$("#back").addEventListener("click", goBack);
$("#undo").addEventListener("click", () => void undoEdit());
$("#redo").addEventListener("click", () => void redoEdit());
$("#reload").addEventListener("click", () => {
  void loadDisassembly(currentAddress() ?? undefined);
});
$("#save").addEventListener("click", () => void exportProjectFile());

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

let mapVisible = true;
try {
  mapVisible = localStorage.getItem("re64.map") !== "0";
  const width = Number(localStorage.getItem("re64.mapWidth"));
  if (width > 0 && width < 100) lastMapWidth = width;
} catch {
  // Defaults: shown, at the standard width.
}
setMapVisible(mapVisible);
void loadDisassembly();
