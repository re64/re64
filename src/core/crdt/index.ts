export {
  BASE_CLIENT_ID,
  CrdtDoc,
  docFromProject,
  projectFromDoc,
  encodeDoc,
  applyUpdate,
  squashUpdates,
  stateVector,
  diffSince,
} from "./doc.js";
export { applyOpToDoc, undoManagerFor } from "./ops.js";
