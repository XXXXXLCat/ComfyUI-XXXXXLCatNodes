<script setup>
/**
 * 资产弹层侧栏（阶段 5，配套 asset-actions 的按钮行）。
 *
 * 上游 NodeActions.vue 的 Teleport 弹层是整套资产编辑的入口：右上角关闭按钮、
 * 右列 6 枚 .tool-btn（裁切 / 扩图 / 预览 / 宫格 / 下载 / 全部下载）。
 * 这两处仍是自绘 DOM，这里用 shadcn-vue 官方 Button + lucide 图标重画，
 * 原生按钮保留为影子控件，点击由 main.js 转发，编辑器与参数区一律不碰。
 *
 * 激活态用官方 variant 表达（secondary / default），不手写 hover / 颜色。
 * 这里不用 ghost：上游全局 button 规则是 unlayered，会把无背景的 ghost 压成
 * 浅底，和深色弹层打架；secondary 有明确的 --secondary 背景，层叠稳定。
 */
import { Button } from "@/components/ui/button";
import {
  X, Crop, Maximize2, Eye, Grid2X2, Download, Package, Circle,
} from "@lucide/vue";

defineProps({
  mode: { type: String, required: true }, // "close" | "tools"
  state: { type: Object, required: true },
  actions: { type: Object, required: true },
});

const ICONS = {
  裁切: Crop,
  扩图: Maximize2,
  预览: Eye,
  宫格: Grid2X2,
  下载: Download,
  全部下载: Package,
};
function iconFor(label) {
  return ICONS[label] || Circle;
}
</script>

<template>
  <div
    v-if="mode === 'close'"
    class="xcat-ad xcat-ad-close"
    @click.stop="actions.onClick"
  >
    <Button
      type="button"
      variant="secondary"
      size="icon-sm"
      data-key="__close"
      title="关闭"
      aria-label="关闭"
    >
      <X />
    </Button>
  </div>

  <div
    v-else
    class="xcat-ad xcat-ad-tools"
    @pointerdown.stop
    @mousedown.stop
    @click.stop="actions.onClick"
  >
    <Button
      v-for="b in state.tools"
      :key="b.key"
      type="button"
      :variant="b.active ? 'default' : 'secondary'"
      size="sm"
      class="xcat-ad-tool"
      :data-key="b.key"
      :disabled="b.disabled"
      :title="b.label"
    >
      <component :is="iconFor(b.label)" />
      <span>{{ b.label }}</span>
    </Button>
  </div>
</template>
