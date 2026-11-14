<script setup>
/**
 * 「保存画布」对话框（阶段 11 batch 2）。
 *
 * 替换 #21 / 03-save-dialog.js.txt 里 3345 B 的手写 DOM。遮罩、容器、标题栏、
 * ESC / 焦点 / aria、右上角关闭全部交给官方组件：
 *
 *   自绘 .xcat-save-mask   -> 官方 DialogOverlay
 *   自绘 .xcat-save-dlg    -> 官方 DialogContent 类名配方
 *   自绘 .xcat-save-head   -> 官方 DialogHeader / DialogTitle
 *   自绘 .xcat-save-input  -> 官方 Input
 *   自绘 .xcat-save-confirm-> 官方 Button
 *   自绘 .xcat-save-x      -> 官方 DialogClose + Button + lucide XIcon
 *
 * 与阶段 7 的 XcatToolShell 同理，不用 shadcn 的 DialogContent.vue：它内部
 * 写死了 <DialogPortal>（默认 Teleport 到 body），会脱离 #app 上的 --cg-*
 * 令牌。这里用 reka-ui 原语组合，把 Portal 指回 #app 内的容器。
 */
import { XIcon } from "@lucide/vue";
import { DialogRoot, DialogPortal, DialogContent } from "reka-ui";
import {
  DialogOverlay,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const props = defineProps({
  state: { type: Object, required: true },
});

function confirm() {
  const cb = props.state.onConfirm;
  const value = props.state.value;
  props.state.open = false;
  if (typeof cb === "function") {
    try {
      cb(value);
    } catch (e) {
      /* 保存失败由 xcatSaveCurrent 自己吞掉，这里不再向上抛 */
    }
  }
}
</script>

<template>
  <DialogRoot v-model:open="state.open" :modal="true" data-slot="dialog">
    <DialogPortal :to="state.portalEl">
      <DialogOverlay class="xcat-sd-overlay" />

      <!-- 类名逐字沿用 src/components/ui/dialog/DialogContent.vue 的 cn() 配方 -->
      <DialogContent
        data-slot="dialog-content"
        class="xcat-sd-content bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-border shadow-2xl grid max-w-[calc(100%-2rem)] gap-4 rounded-xl p-4 text-sm ring-1 duration-100 sm:max-w-sm fixed top-1/2 left-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 outline-none"
      >
        <DialogHeader class="gap-1.5">
          <DialogTitle>保存画布</DialogTitle>
        </DialogHeader>

        <div class="grid gap-2 pt-4">
          <Label for="xcat-sd-name" class="text-sm">输入文件名：</Label>
          <Input
            id="xcat-sd-name"
            v-model="state.value"
            class="xcat-sd-input"
            autofocus
            @keydown.enter="confirm"
          />
          <Button class="w-full" @click="confirm">确认</Button>
        </div>

        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="absolute top-2 right-2">
            <XIcon />
            <span class="sr-only">关闭</span>
          </Button>
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
