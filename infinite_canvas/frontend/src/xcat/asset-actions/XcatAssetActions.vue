<script setup>
/**
 * 节点上方操作按钮行（阶段 5）。
 *
 * 上游 NodeActions.vue + 6 个 xcat 脚本往 .node-actions 里塞的 .fan-btn 全部
 * 保留在 DOM 中作为「影子控件」，这里只负责用 shadcn-vue 官方组件重画外观：
 *   - Button variant="secondary" size="sm"：与原来 28px 文字按钮等高
 *   - Separator：把「编辑类 / 下载类 / 删除」三组分开（原来靠 flex order）
 * 点击由 main.js 转发给影子按钮，业务逻辑（预览 / 下载 / 截取 / 删除…）
 * 完全走上游，不在这里重写。
 */
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

defineProps({
  state: { type: Object, required: true },
  actions: { type: Object, required: true },
});
</script>

<template>
  <div
    class="xcat-aa"
    data-xcat-aa
    @pointerdown.stop
    @mousedown.stop
    @dblclick.stop
    @click.stop="actions.onClick"
  >
    <template v-for="(group, gi) in state.groups" :key="gi">
      <template v-if="group.length">
        <Separator
          v-if="gi > 0"
          orientation="vertical"
          class="xcat-aa-sep"
        />
        <Button
          v-for="b in group"
          :key="b.key"
          type="button"
          variant="secondary"
          size="sm"
          class="xcat-aa-btn"
          :data-key="b.key"
          :disabled="b.disabled"
          :title="b.label"
        >
          {{ b.label }}
        </Button>
      </template>
    </template>
  </div>
</template>
