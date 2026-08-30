export {
  BASE_CLIENT_ID,
  CrdtDoc,
  docFromProject,
  docFromUpdates,
  emptyDoc,
  projectFromDoc,
  encodeDoc,
  applyUpdate,
  squashUpdates,
  stateVector,
  diffSince,
} from "./doc.js";
export { applyOpToDoc, applyOpsToDoc, undoManagerFor } from "./ops.js";
