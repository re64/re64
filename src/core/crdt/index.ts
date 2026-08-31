export {
  BASE_CLIENT_ID,
  CrdtDoc,
  docFromProject,
  docFromUpdates,
  emptyDoc,
  projectFromDoc,
  encodeDoc,
  applyUpdate,
  clientsInUpdate,
  squashUpdates,
  stateVector,
  diffSince,
} from "./doc.js";
export { applyOpToDoc, applyOpsToDoc, undoManagerFor } from "./ops.js";
export { newPresenceClientId, presenceUpdateFor } from "./presence.js";
export {
  ChatMessage,
  OutgoingMessage,
  MAX_MESSAGE_LENGTH,
  chatMessages,
  postChatMessage,
  onChatChange,
  chatLength,
} from "./chat.js";
