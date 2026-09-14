// Any Switch 🐈‍⬛ — generic single-active-input switch.
// Strategy: addInput / removeInput mutate the real node.inputs array (not the
// `hidden` flag, which is unreliable for connection inputs in current ComfyUI).
// slot.name is always kept equal to the backend schema id (input_1..input_9);
// only the visible label is rewritten. Ports grow with connections (two by
// default, up to nine); the first connection locks the type for all ports.

import { app } from "../../scripts/app.js";

const NODE_TYPE = "🐈‍⬛AnySwitch";
const MAX_SLOTS = 9;
const MIN_SLOTS = 2;
const NODE_HEADER_HEIGHT = 30;
const INPUT_ROW_HEIGHT = 20;
const BOTTOM_PADDING = 10;

// Localized display names for common ComfyUI data types; raw type is fallback.
const TYPE_LABELS = {
    IMAGE: "图像",
    VIDEO: "视频",
    AUDIO: "音频",
    MASK: "遮罩",
    LATENT: "潜空间",
    MODEL: "模型",
    CLIP: "CLIP",
    CLIP_VISION: "视觉编码",
    VAE: "VAE",
    CONDITIONING: "条件",
    CONTROL_NET: "控制网络",
    STYLE_MODEL: "风格模型",
    SAMPLER: "采样器",
    SIGMAS: "噪声调度",
    NOISE: "噪声",
    GUIDER: "引导器",
    TENSOR: "张量",
    COMBO: "选项",
    STRING: "字符串",
    INT: "整数",
    FLOAT: "浮点",
    BOOLEAN: "布尔",
    SEGS: "分割区域",
    LIST: "列表",
};

const slotName = (index) => `input_${index + 1}`;
const slotNumber = (index) => String(index + 1);
const isConnected = (slot) => slot != null && slot.link != null;
const heightForCount = (count) =>
    NODE_HEADER_HEIGHT + Math.max(0, Number(count) || 0) * INPUT_ROW_HEIGHT + BOTTOM_PADDING;

// Resolve the single locked type from the actually wired outputs; "ANY" when
// none / mixed. Reading the origin node's output type is more reliable than link.type.
function getConnectedType(node) {
    const types = new Set();
    for (const slot of node.inputs || []) {
        if (!isConnected(slot)) continue;
        const link = node.graph?.links?.[slot.link];
        const origin = link && node.graph?.getNodeById?.(link.origin_id);
        const output = origin?.outputs?.[link.origin_slot];
        const type = output?.type && String(output.type).toUpperCase();
        if (type && type !== "*" && type !== "ANY") types.add(type);
    }
    return types.size === 1 ? [...types][0] : "ANY";
}

function sync(node) {
    let slots = node.inputs || [];

    // A restored/copied node can carry stale trailing inputs. Hard cap first.
    while (slots.length > MAX_SLOTS) {
        node.removeInput(slots.length - 1);
        slots = node.inputs || [];
    }

    // Highest wired index decides how many slots must stay visible.
    let lastConnected = -1;
    slots.forEach((slot, index) => {
        if (isConnected(slot)) lastConnected = index;
    });
    const target = Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, lastConnected + 2));

    // Only strip trailing EMPTY slots, so a middle gap keeps its position and
    // backend input priority stays stable.
    while ((node.inputs || []).length > target) {
        const index = node.inputs.length - 1;
        if (isConnected(node.inputs[index])) break;
        node.removeInput(index);
    }
    while ((node.inputs || []).length < target) {
        node.addInput(slotName(node.inputs.length), "*");
    }

    slots = node.inputs || [];
    const type = getConnectedType(node);
    const slotType = type === "ANY" ? "*" : type;

    slots.forEach((slot, index) => {
        // name = backend schema id, never change it. Only the label is visible.
        slot.name = slotName(index);
        slot.label = type === "ANY"
            ? slot.name
            : `${TYPE_LABELS[type] || type}_${slotNumber(index)}`;
        slot.type = slotType;
    });

    const out = node.outputs?.[0];
    if (out) {
        out.name = "output";
        out.label = type === "ANY" ? "output" : (TYPE_LABELS[type] || type);
        out.type = slotType;
    }

    const width = Number(node.size?.[0]) || 300;
    node.setSize?.([width, heightForCount(slots.length)]);
    node.setDirtyCanvas?.(true, true);
}

function scheduleSync(node) {
    if (node._xxAnySyncScheduled) return;
    node._xxAnySyncScheduled = true;
    requestAnimationFrame(() => {
        node._xxAnySyncScheduled = false;
        sync(node);
    });
}

app.registerExtension({
    name: "XXXXXLCat.AnySwitch",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onCreated ? onCreated.apply(this, arguments) : undefined;
            scheduleSync(this);
            return r;
        };

        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function () {
            const r = onConnectionsChange ? onConnectionsChange.apply(this, arguments) : undefined;
            scheduleSync(this);
            return r;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
            scheduleSync(this);
            return r;
        };
    },
});
