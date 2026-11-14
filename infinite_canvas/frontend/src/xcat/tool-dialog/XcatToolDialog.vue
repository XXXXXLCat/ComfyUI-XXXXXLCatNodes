<script setup>
/**
 * 工具弹窗的官方组件覆盖层（阶段 6）。
 *
 * 三个 xcat 脚本（image-tools / video-edit / audio-edit）自建的 7 个弹窗共用
 * .xcat-ae-modal 骨架，但 body 里是裁剪画布、时间轴、波形、宫格预览这类专用
 * 可视化，官方组件无法等价表达。所以这里只把「通用 UI 控件」换成官方组件：
 *
 *   head 的 ×              → Button(secondary, icon-sm, lucide X)
 *   foot 的 .xcat-ae-btn   → Button(default / outline / destructive，同步 disabled)
 *   单选/动作按钮组         → Button(outline / secondary，同步 is-active)
 *   input[type=number]     → Input（双向 value）
 *   input[type=range]      → Slider（双向 value）
 *
 * 一个弹窗只挂一个 Vue app：每个影子控件旁边插一个 host，组件用 Teleport 把
 * 官方组件渲染过去。影子控件全部留作转发目标，脚本原本的 getElementById /
 * 事件委托 / CSS 层级一律不动 —— 只是被 CSS 收起来。
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { X } from "@lucide/vue";

defineProps({
  state: { type: Object, required: true },
  actions: { type: Object, required: true },
});

function sliderOf(item) {
  const n = Number(item.value);
  return [Number.isFinite(n) ? n : Number(item.min || 0)];
}

// 激活态一律用官方 variant 表达，不手写 hover / 颜色
function variantOf(item) {
  if (item.kind === "close") return "secondary";
  if (item.tone === "primary") return "default";
  if (item.tone === "danger") return "destructive";
  if (item.tone === "toggle") return item.active ? "secondary" : "outline";
  return item.active ? "secondary" : "outline";
}
</script>

<template>
  <template v-for="item in state.items" :key="item.key">
    <Teleport :to="item.hostEl">
      <Button
        v-if="item.kind === 'close'"
        type="button"
        :variant="variantOf(item)"
        size="icon-sm"
        class="xcat-td-btn"
        :data-key="item.key"
        title="关闭"
        aria-label="关闭"
        @click="actions.click(item)"
      >
        <X />
      </Button>

      <Button
        v-else-if="item.kind === 'button'"
        type="button"
        :variant="variantOf(item)"
        :size="item.size || 'sm'"
        :disabled="item.disabled"
        class="xcat-td-btn"
        :class="['xcat-td-btn--' + item.tone, 'xcat-td-shape--' + (item.shape || 'inline')]"
        :data-key="item.key"
        :title="item.title || ''"
        :aria-pressed="item.tone === 'toggle' ? !!item.active : undefined"
        @click="actions.click(item)"
      >
        <span class="xcat-td-body" v-html="item.bodyHtml"></span>
      </Button>

      <Input
        v-else-if="item.kind === 'number'"
        type="number"
        :model-value="item.value"
        :min="item.min"
        :max="item.max"
        :step="item.step"
        :aria-label="item.title || ''"
        :data-key="item.key"
        class="xcat-td-input"
        @update:modelValue="(v) => actions.setValue(item, v)"
      />

      <Slider
        v-else-if="item.kind === 'range'"
        :model-value="sliderOf(item)"
        :min="Number(item.min)"
        :max="Number(item.max)"
        :step="Number(item.step)"
        :data-key="item.key"
        class="xcat-td-slider"
        @update:modelValue="(a) => actions.setValue(item, Array.isArray(a) ? a[0] : a)"
      />
    </Teleport>
  </template>
</template>
