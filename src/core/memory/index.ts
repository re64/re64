export { Layer, BytesLayer, layerRegionAt, layerKindAt } from "./layer.js";
export { FileLayer } from "./file-layer.js";
export { SymbolLayer } from "./symbol-layer.js";
export { MemoryMap, ReadResult } from "./memory-map.js";
export { LabelType } from "./label-type.js";
// The name index lives with the claims it holds. It was `LabelIndex` over a
// parallel record; the record is gone because a claim already carries every
// field it had, and a second structure holding the same ones had nothing to add
// but a chance to disagree.
export {
  NameIndex,
  ResolvedName,
  LabelUse,
  createLabelUse,
  CLAIM_RANK,
  labelTypeOf,
  platformClaim,
  layerClaim,
  autoClaim,
} from "../claims/names.js";
export { Region, RegionKind, RegionIndex, createUserRegion } from "./region.js";
export {
  Comment,
  CommentPlacement,
  CommentIndex,
  createComment,
} from "./comment.js";
export {
  Constant,
  ConstantUse,
  ConstantIndex,
  createConstant,
  createConstantUse,
} from "./constant.js";
