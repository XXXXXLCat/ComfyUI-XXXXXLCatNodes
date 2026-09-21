/* Load LoRA Stack (Model and CLIP) 🐈‍⬛ — front end for 🐈‍⬛StackLorasClip.

   Same behaviour as Load LoRA Stack 🐈‍⬛ — the only differences are which
   backend node this is and that a row carries two strengths (model and CLIP),
   because the backend patches both sides. So this file is deliberately just the
   subject half; the row machine lives in ./lora_rows.js.
*/

import { registerLoraRows } from "./lora_rows.js";

// Built from escapes so the mark survives any re-encoding of this file.
const BRAND = "\u{1F408}\u200D\u2B1B";

registerLoraRows({
  nodeId: `${BRAND}StackLorasClip`,
  name: "XXXXXLCat.LoraStackClip",
  // Must match ROW_FIELDS in nodes/lora_stack_clip.py.
  fields: ["lora", "strength_model", "strength_clip", "on"],
});
