# File identity — issue #27

A captured output could change beneath its capture record when a later upload
reused its filename. Reading the document's content hash fixed the first byte
substitution, but the name-keyed file entity still allowed that hash to change.

Files now have their own ids. Content is immutable; the display name is an
independently editable field. Layers and captures reference ids. A D64 member
is a selector on the layer, not part of the file's identity. Fresh uploads and
captures mint fresh ids. Names are optional aliases resolved against the caller's
replica, with ambiguity reported before operations are emitted.

Legacy exports and stored Yjs snapshots derive the same file id from a normalized
filename. Layer ids are persisted before their old paths disappear. Snapshot
migration retains unrelated Yjs items and is persisted before later edits can
reference it. Old files may lack a registry or hashes: migration records a file
reference without inventing content, and a byte-aware import or database load
fills an absent hash from the available legacy resource. After that boundary,
reads use the recorded hash and never fall back to the mutable SQL name table.

Old operation history needs its old semantics. A no-id `file.add` may replace
content at the deterministic legacy id, and its inverse must restore the previous
content. New id-bearing adds are insert-only once content is recorded. The text
diff adapter recognizes changes to deterministic legacy entries for old history
and external-file reconciliation; an attempt to replace a modern file's content
under its existing id is refused. This exception is not emitted by new upload or
capture APIs. It remains explicit until old history has a separate versioned
representation.

File URLs identify records; hash URLs identify content and can be cached
immutably. Deleting a record may leave dangling references, as with other document
entities. Neither deletion nor a missing blob permits a same-name substitution.

The round-trip suite covers all three file operations. Migration tests cover
exports and stored snapshots, and MCP transport tests exercise duplicate names,
rename stability, repeated captures and retrieval of earlier bytes.
