/* Load LoRA Stack 🐈‍⬛ — front end for the 🐈‍⬛StackLoras node.

   The node itself is a plain stack of native widgets: one row per LoRA, and a
   row is "LoRA name + strength + on/off". Nothing here draws a panel or moves
   data — the rows are the declared inputs, so the workflow, the API format and
   a pasted node all carry the values without this script.

   Only the subject half lives here (which backend node this is); the row
   machine — visible rows, Add LoRA, collapsing the empty ones, the height
   correction — is ./lora_rows.js, shared with
   Load LoRA Stack (Model and CLIP) 🐈‍⬛.
*/

import { registerLoraRows } from "./lora_rows.js";

// Built from escapes so the mark survives any re-encoding of this file.
const BRAND = "\u{1F408}\u200D\u2B1B";

registerLoraRows({
  nodeId: `${BRAND}StackLoras`,
  name: "XXXXXLCat.LoraStack",
  // Must match ROW_FIELDS in nodes/lora_stack.py.
  fields: ["lora", "strength", "on"],
});
