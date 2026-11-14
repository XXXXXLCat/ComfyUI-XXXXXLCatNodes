<script setup>
/**
 * 工具弹窗的官方 Dialog 外壳（阶段 7）。
 *
 * 阶段 6 已把 head 的 ×、foot 的按钮、body 的 Input / Slider / Button 换成
 * shadcn-vue 官方组件，但遮罩、容器、标题栏、入场动画仍是三个 xcat 脚本
 * 自绘的 .xcat-ae-* 骨架。这一层把「外壳」也交给官方组件：
 *
 *   .xcat-ae-backdrop      → 官方 DialogOverlay
 *   .xcat-ae-dialog 外壳   → 官方 DialogContent（bg-popover / ring-1 / rounded-xl / animate-in）
 *   .xcat-ae-title / -sub  → 官方 DialogTitle / DialogDescription
 *   ESC / focus / aria     → reka-ui DialogRoot 托管（脚本仍可自行 close）
 *
 * 为什么不用官方 shadcn 的 DialogContent.vue：它内部写死了 <DialogPortal>，
 * 默认 Teleport 到 body。一旦脱离 #app，--cg-* 令牌（定义在 #app 上）全部失效，
 * 脚本的 q(id, modal) 也查不到任何控件。所以这里用 reka-ui 官方原语自行组合
 * Portal，并把 :to 指向原 .xcat-ae-modal；类名逐字沿用 DialogContent.vue 的
 * cn() 配方，视觉与官方组件完全一致，只由 CSS 覆盖尺寸（760px 宽弹窗不是
 * 官方默认的 sm:max-w-sm 小卡片）。
 *
 * 原 .xcat-ae-dialog 由 main.js 整体 appendChild 进 .xcat-ts-slot —— 是同一个
 * DOM 节点，脚本闭包里的引用、q(id, modal) 查询、CSS 后代选择器全部成立。
 */
import { DialogRoot, DialogPortal, DialogContent } from "reka-ui";
import {
  DialogOverlay,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

defineProps({
  state: { type: Object, required: true },
});
</script>

<template>
  <!-- 弹窗的生死由三个脚本的 modal.remove() 决定：这里只固定 defaultOpen，
       ESC 与 outside 事件一概不接管 open，脚本关掉 DOM 后挂载器 unmount 整个 app。 -->
  <DialogRoot default-open :modal="true" data-slot="dialog">
    <DialogPortal :to="state.modalEl">
      <DialogOverlay class="xcat-ts-overlay" />

      <!-- 类名与 src/components/ui/dialog/DialogContent.vue 的 cn() 配方一致 -->
      <DialogContent
        data-slot="dialog-content"
        class="xcat-ts-content bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-border shadow-2xl grid max-w-[calc(100%-2rem)] gap-4 rounded-xl p-4 text-sm ring-1 duration-100 sm:max-w-sm fixed top-1/2 left-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 outline-none"
      >
        <!-- 原 .xcat-ae-dialog 会被 main.js 移进这个空槽 -->
        <div class="xcat-ts-slot"></div>

        <!-- 标题栏 Teleport 到原 head。放在 DialogContent 内部是必要的：
             reka 的 Content 在 mounted 时会检查 DialogTitle 是否注册，子组件
             先于父组件 mounted，顺序反了会打一条 aria 警告。 -->
        <Teleport :to="state.headEl">
          <!-- 官方默认 gap-2 + text-sm 是为独立卡片设计的；这里的 head 原本
               是 16px 标题 + 11px 小字的紧凑组，用官方刻度收一档保持密度。 -->
          <DialogHeader class="xcat-ts-head gap-1.5">
            <DialogTitle class="xcat-ts-title">{{ state.title }}</DialogTitle>
            <DialogDescription v-if="state.sub" class="xcat-ts-sub text-xs">
              {{ state.sub }}
            </DialogDescription>
          </DialogHeader>
        </Teleport>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
