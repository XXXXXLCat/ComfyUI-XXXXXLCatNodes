<script setup>
/**
 * 画布「LoRA 栈」节点面板（阶段 4）：手写 DOM 换成 shadcn-vue / reka-nova 官方组件。
 *
 * 数据仍沿用 data.loras = [{ name, strength, enabled }]，运行时的
 * window.__xcatLorasFor(nodeId) 与后端 _inject_loras() 都不用改。旧
 * assets/xcat-lora.js 继续负责数据签名、撤销栈和运行时收集，只是它的 DOM
 * 被 CSS 收起；本组件自己读 data.loras、写回 updateNodeData，并量高度。
 */
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Minus, Trash2, Layers3 } from "@lucide/vue";

const props = defineProps({
  state: { type: Object, required: true },
  actions: { type: Object, required: true },
});
const s = props.state;
const a = props.actions;

function baseName(name) {
  const i = Math.max(String(name).lastIndexOf("/"), String(name).lastIndexOf("\\"));
  return i >= 0 ? String(name).slice(i + 1) : String(name);
}
function dirName(name) {
  const i = Math.max(String(name).lastIndexOf("/"), String(name).lastIndexOf("\\"));
  return i > 0 ? String(name).slice(0, i) : "";
}
function fmt(v) {
  const n = Number(v);
  return (Math.round((Number.isFinite(n) ? n : 1) * 100) / 100).toFixed(2);
}

// LoRA 文件按子目录分组，和 ComfyUI 自己的下拉同源
const groups = computed(() => {
  const out = [];
  const byDir = new Map();
  for (const name of s.options) {
    const dir = dirName(name);
    if (!byDir.has(dir)) {
      const group = { dir, items: [] };
      byDir.set(dir, group);
      out.push(group);
    }
    byDir.get(dir).items.push(name);
  }
  return out;
});
</script>

<template>
  <div data-xcat-lv="1" class="xcat-lv flex min-h-0 w-full flex-1 flex-col gap-2 text-sm">
    <div class="flex shrink-0 items-center gap-2">
      <Layers3 class="size-4" />
      <span class="font-medium">LoRA 栈</span>
      <Badge variant="secondary">{{ s.rows.length || "未配置" }}</Badge>
      <Button
        class="ml-auto"
        size="sm"
        variant="outline"
        :disabled="s.rows.length >= s.maxRows"
        @click="a.add()"
      >
        <Plus />
        添加 LoRA
      </Button>
    </div>

    <p v-if="!s.rows.length" class="text-muted-foreground text-sm">
      点「添加 LoRA」选模型；运行时按顺序接在该工作流的模型加载器后面。
    </p>
    <p v-else-if="!s.options.length && !s.loading" class="text-muted-foreground text-sm">
      没有读到 LoRA 文件（检查 ComfyUI 的 models/loras 目录）。
    </p>

    <div class="flex min-h-0 flex-col gap-1.5">
      <div
        v-for="(row, i) in s.rows"
        :key="i"
        class="flex shrink-0 items-center gap-1.5"
        :class="row.enabled === false ? 'opacity-50' : ''"
      >
        <Select :model-value="row.name" @update:modelValue="a.setName(i, $event)">
          <SelectTrigger size="sm" class="min-w-0 flex-1 nodrag nopan">
            <SelectValue placeholder="选择 LoRA 文件" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup v-for="group in groups" :key="group.dir">
              <SelectLabel v-if="group.dir">{{ group.dir }}</SelectLabel>
              <SelectItem v-for="name in group.items" :key="name" :value="name">
                {{ baseName(name) }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Switch
          class="nodrag nopan"
          :model-value="row.enabled !== false"
          :title="row.enabled === false ? '已停用，点击启用' : '已启用，点击停用'"
          @update:modelValue="a.setEnabled(i, $event)"
        />

        <Button
          variant="outline"
          size="icon-sm"
          class="nodrag nopan"
          title="强度 −0.01"
          @click="a.stepStrength(i, -0.01)"
        >
          <Minus />
        </Button>
        <Input
          class="nodrag nopan w-16 shrink-0 text-center"
          :model-value="fmt(row.strength)"
          title="模型强度（−100 ~ 100，两位小数；0 表示不加载）"
          @update:modelValue="a.setStrength(i, $event)"
          @keydown.stop
        />
        <Button
          variant="outline"
          size="icon-sm"
          class="nodrag nopan"
          title="强度 +0.01"
          @click="a.stepStrength(i, 0.01)"
        >
          <Plus />
        </Button>

        <Button
          variant="destructive"
          size="icon-sm"
          class="nodrag nopan"
          title="删除这一行"
          @click="a.remove(i)"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  </div>
</template>
