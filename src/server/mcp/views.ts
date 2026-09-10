/**
 * Which tools answer for a **view**, and which answer for the document.
 *
 * A target is a view over the layer stack, and it is a parameter of the
 * request. It used to be injected onto all ninety-four tools, "declared here
 * rather than seventy times" — convenient, and a lie in the one place agents
 * read: a tool that advertises an argument it cannot use is telling a reader it
 * matters. Worse than cosmetic, it made a view able to *break* a call whose
 * meaning it could not change — `add_evidence` refused three writes during a
 * silver-image build because the claims were framed on a layer the view nobody
 * had chosen did not link.
 *
 * **The rule is: does the answer contain an address.** Not "is the subject an
 * id", which is the obvious rule and the wrong one — `retire_claim` takes an id
 * and needs no view, while `list_retired` takes nothing and reports where the
 * retired claims *are*, which exists only inside a view. An address is a fact
 * about a stack; everything else in this document is a fact about the project.
 *
 * Three borderline calls, decided and written down because the next person will
 * have to decide the same way:
 *
 * - **`list_types` keeps `target`** though a record layout is project-level.
 *   Its answer carries `usedAt` — the addresses claims bind each layout at — and
 *   that is the half a reader is usually after. It degrades rather than
 *   refusing: no view named, no addresses, and it says so.
 * - **`list_constants` keeps `target`** for the same reason: a constant is a
 *   name for a value, but the answer reports the sites bound to it.
 * - **`undo` keeps `target`** because it replays arbitrary operations and
 *   reports what they did to the decode. It cannot know in advance that it is
 *   not undoing a claim.
 *
 * Scenarios and comments are **not** in this list and want a second pass. A
 * scenario's steps carry addresses the author typed rather than addresses this
 * resolved, and a comment is addressed by id but lives inside a layer; both are
 * arguable and neither is argued yet.
 */
export const VIEWLESS: ReadonlySet<string> = new Set([
  // The server and the session, which have no project to have a view of.
  "list_projects",
  "whoami",
  "create_project",
  "list_participants",
  "post_message",
  "edit_message",
  "remove_message",
  "read_messages",

  // **The views themselves.** `list_targets` is the case that makes the whole
  // rule unarguable: asking which views a project has cannot require choosing
  // one, and it used to.
  "list_targets",
  "add_target",
  "edit_target",
  "remove_target",

  // The stack, as declared. Which layers exist and what they hold is what a
  // view is *made of* — a target that hides a layer must not make removing it
  // impossible.
  "add_layer",
  "add_byte_layer",
  "add_rom_layer",
  "remove_layer",
  "prepare_upload",
  "list_disk_files",

  // The project as a whole.
  "set_project_description",
  "export_project",
  "changes_since",
  "tag_project",
  "list_tags",
  "remove_tag",

  // Declarations: a way of *reading* bytes describes none of its own.
  "list_decoders",
  "add_decoder",
  "edit_decoder",
  "remove_decoder",
  "add_type",
  "edit_type",
  "remove_type",
  "add_field",
  "edit_field",
  "remove_field",
  "add_constant",
  "add_constants",
  "edit_constant",
  "remove_constant",

  // Evidence is said about a **claim**, not about an address — which is the
  // sentence the tool descriptions have always opened with, and which the
  // schema contradicted.
  "list_evidence",
  "add_evidence",
  "edit_evidence",
  "remove_evidence",
  "retire_claim",
  "restore_claim",
]);
