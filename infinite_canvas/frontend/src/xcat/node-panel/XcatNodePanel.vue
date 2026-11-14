<script setup>
/**
 * 通用生成节点面板（阶段 4：把 shadcn-vue 试点从 gen-audio 铺到其它节点）。
 *
 * 覆盖所有「.node-panel 里有上游控件」的非音频 role（实测 gen-image / gen-video /
 * gen-text）。控件全部用官方 reka-nova 组件：Label / Textarea / Input / Select /
 * Switch / Slider / Button / Badge / lucide 图标。
 *
 * 与音频面板一致，数据不进 Vue Flow 的 store：props.state 是桥接层持有的 reactive
 * 对象，交互交给 props.actions 写回上游「影子控件」，上游状态变化由轮询反向同步。
 * 这样不用碰固化的画布应用主体，面板可以独立迭代。
 */
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Square, Dices } from "@lucide/vue";

const props = defineProps({
  state: { type: Object, required: true },
  actions: { type: Object, required: true },
});
const s = props.state;
const a = props.actions;

// 工作流下拉按左栏那套分类分组（组名来自 .xcat-wf-pill-g 药丸）
const groups = computed(() => {
  const out = [];
  const byName = new Map();
  for (const wf of s.workflows) {
    const name = wf.group || "";
    if (!byName.has(name)) {
      const group = { name, items: [] };
      byName.set(name, group);
      out.push(group);
    }
    byName.get(name).items.push(wf);
  }
  return out;
});

const activeGroup = computed(() => {
  const hit = s.workflows.find((w) => w.name === s.activeWorkflow);
  return hit ? hit.group : "";
});

function sliderOf(row) {
  const n = Number(row.value);
  return [Number.isFinite(n) ? n : Number(row.min || 0)];
}
function onSlider(row, val) {
  a.setField(row, Array.isArray(val) ? val[0] : val);
}
</script>

<template>
  <div data-xcat-np="1" class="xcat-np flex w-full min-w-0 flex-col gap-2.5 text-sm">
    <!-- 工作流：原左侧悬浮药丸换成官方 Select，按分类分组 -->
    <div v-if="s.workflows.length" class="flex min-w-0 items-center gap-2">
      <Label class="shrink-0">工作流</Label>
      <Select :model-value="s.activeWorkflow" @update:modelValue="a.pickWorkflow($event)">
        <SelectTrigger size="sm" class="min-w-0 flex-1">
          <SelectValue placeholder="选择工作流" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup v-for="group in groups" :key="group.name">
            <SelectLabel v-if="group.name">{{ group.name }}</SelectLabel>
            <SelectItem v-for="wf in group.items" :key="wf.name" :value="wf.name">
              {{ wf.label }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Badge v-if="activeGroup" variant="secondary" class="shrink-0">{{ activeGroup }}</Badge>
    </div>

    <!-- 主提示词 -->
    <div class="flex min-w-0 flex-col gap-1.5">
      <Label>提示词</Label>
      <Textarea
        :model-value="s.promptText"
        :readonly="s.promptReadonly"
        :placeholder="s.workflows.length ? '请输入提示词内容' : '请选择左侧的工作流'"
        class="h-24 min-h-0 resize-none"
        spellcheck="false"
        @update:modelValue="a.setPrompt($event)"
        @focus="a.setEditing('prompt', true)"
        @blur="a.setEditing('prompt', false)"
        @keydown.stop
      />
    </div>

    <!-- 其余字段：两列网格；文本型字段占满一行 -->
    <div v-if="s.fields.length" class="grid min-w-0 grid-cols-2 gap-2">
      <div
        v-for="row in s.fields"
        :key="row.key"
        class="flex min-w-0 flex-col gap-1.5"
        :class="row.type === 'textarea' ? 'col-span-2' : ''"
      >
        <Label :title="row.key">{{ row.label }}</Label>

        <Textarea
          v-if="row.type === 'textarea'"
          :model-value="row.value"
          :placeholder="row.label"
          class="h-24 min-h-0 resize-none"
          spellcheck="false"
          @update:modelValue="a.setField(row, $event)"
          @focus="a.setEditing(row.key, true)"
          @blur="a.setEditing(row.key, false)"
          @keydown.stop
        />
        <Input
          v-else-if="row.type === 'text' || row.type === 'number'"
          :type="row.type === 'number' ? 'number' : 'text'"
          :model-value="row.value"
          :min="row.min"
          :max="row.max"
          :step="row.step"
          :placeholder="row.label"
          @update:modelValue="a.setField(row, $event)"
          @keydown.stop
        />
        <Select
          v-else-if="row.type === 'select'"
          :model-value="row.value"
          @update:modelValue="a.setField(row, $event)"
        >
          <SelectTrigger size="sm" class="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="opt in row.options" :key="opt" :value="opt">{{ opt }}</SelectItem>
          </SelectContent>
        </Select>
        <Switch
          v-else-if="row.type === 'switch'"
          :model-value="!!row.value"
          @update:modelValue="a.setField(row, $event)"
        />
        <div v-else-if="row.type === 'slider'" class="flex min-w-0 items-center gap-2">
          <Slider
            :model-value="sliderOf(row)"
            :min="Number(row.min ?? 0)"
            :max="Number(row.max ?? 100)"
            :step="Number(row.step ?? 1)"
            @update:modelValue="onSlider(row, $event)"
          />
          <span class="text-muted-foreground w-10 shrink-0 text-right">{{ row.value }}</span>
        </div>
        <div v-else-if="row.type === 'random'" class="flex min-w-0 items-center gap-1.5">
          <Input
            type="number"
            class="min-w-0"
            :model-value="row.value"
            :readonly="row.random"
            :min="row.min"
            :max="row.max"
            :step="row.step"
            @update:modelValue="a.setField(row, $event)"
            @keydown.stop
          />
          <Button
            variant="outline"
            size="icon-sm"
            :title="row.random ? '每次运行自动刷新（点击恢复固定值）' : '点击后每次运行随机刷新'"
            @click="a.toggleRandom(row)"
          >
            <Dices />
          </Button>
        </div>
      </div>
    </div>
    <p v-else-if="s.hint" class="text-muted-foreground text-sm">{{ s.hint }}</p>

    <!-- 运行 -->
    <div class="flex min-w-0 items-center gap-2">
      <span v-if="s.error" class="text-destructive min-w-0 flex-1 text-sm">{{ s.error }}</span>
      <Button
        class="xcat-np-run ml-auto"
        size="sm"
        :disabled="s.runDisabled"
        @click="a.run()"
      >
        <Square v-if="s.runStop" />
        <Play v-else />
        {{ s.runLabel }}
      </Button>
    </div>
  </div>
</template>
