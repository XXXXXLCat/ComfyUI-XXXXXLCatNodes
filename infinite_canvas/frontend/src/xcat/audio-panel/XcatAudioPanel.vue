<script setup>
/**
 * 生成音频节点面板（阶段 3 试点）：全部控件用 shadcn-vue / reka-nova 官方组件。
 *
 * 这个组件不是挂在 App.vue 的组件树里，而是由同目录 main.js 用 createApp()
 * 单独挂载到每个 role === "gen-audio" 的 .node-panel 中。原因见 main.js 文件头：
 * 现有 bundle 补丁插件会校验主 chunk 与上游基线逐字节一致，组件代码不能进主 chunk。
 *
 * 数据不走 Vue Flow 的 store：props.state 是桥接层持有的 reactive 对象，
 * 组件只负责渲染 + 把交互交给 props.actions（由桥接层写回上游「影子控件」）。
 * 上游状态变化（切工作流 / 种子刷新 / 运行按钮）由桥接层反向写进同一个 state。
 */
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Settings2, Dices, Play, Square } from "@lucide/vue";

const props = defineProps({
  state: { type: Object, required: true },
  actions: { type: Object, required: true },
});

const s = props.state;
const a = props.actions;

// 工作流下拉按左栏那套分类分组显示（组名来自 .xcat-wf-pill-g 药丸）
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
</script>

<template>
  <div data-xcat-ap="1" class="xcat-ap flex w-full min-w-0 flex-col gap-2.5 text-sm">
    <!-- 风格提示词 / 歌词 -->
    <div class="grid min-w-0 gap-2" :class="s.hasLyrics ? 'grid-cols-2' : 'grid-cols-1'">
      <div class="flex min-w-0 flex-col gap-1.5">
        <Label>风格提示词</Label>
        <Textarea
          :model-value="s.styleText"
          placeholder="必填，音乐类型 / 情绪 / BPM / 乐器…"
          class="h-[92px] min-h-0 resize-none"
          spellcheck="false"
          @update:modelValue="a.setStyle($event)"
          @focus="a.setEditing('style', true)"
          @blur="a.setEditing('style', false)"
          @keydown.stop
        />
      </div>
      <div v-if="s.hasLyrics" class="flex min-w-0 flex-col gap-1.5">
        <Label>{{ s.lyricsLabel }}</Label>
        <Textarea
          :model-value="s.lyricsText"
          placeholder="必填，在此输入或粘贴歌词…"
          class="h-[92px] min-h-0 resize-none"
          spellcheck="false"
          @update:modelValue="a.setLyrics($event)"
          @focus="a.setEditing('lyrics', true)"
          @blur="a.setEditing('lyrics', false)"
          @keydown.stop
        />
      </div>
    </div>

    <!-- 底部工具条：音乐/语音 → 工作流 → 设置 → 运行 -->
    <div class="flex min-w-0 items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        :model-value="s.mode"
        @update:modelValue="a.setMode($event)"
      >
        <ToggleGroupItem value="music">音乐</ToggleGroupItem>
        <ToggleGroupItem value="voice">语音</ToggleGroupItem>
      </ToggleGroup>

      <Select :model-value="s.activeWorkflow" @update:modelValue="a.pickWorkflow($event)">
        <SelectTrigger size="sm" class="max-w-[190px]">
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

      <Popover>
        <PopoverTrigger as-child>
          <Button variant="outline" size="icon-sm" title="设置" aria-label="设置">
            <Settings2 />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" class="w-72">
          <PopoverHeader>
            <PopoverTitle>设置</PopoverTitle>
          </PopoverHeader>
          <Separator />
          <div
            v-for="row in s.settings"
            :key="row.key"
            class="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-2"
          >
            <Label :title="row.key">{{ row.label }}</Label>
            <div class="flex min-w-0 items-center gap-1.5">
              <Input
                v-if="row.kind === 'number'"
                type="number"
                :model-value="row.value"
                :min="row.min"
                :max="row.max"
                :step="row.step"
                @update:modelValue="a.setNumber(row, $event)"
                @keydown.stop
              />

              <template v-else-if="row.kind === 'random'">
                <Input
                  type="number"
                  class="min-w-0"
                  :model-value="row.value"
                  :readonly="row.random"
                  :min="row.min"
                  :max="row.max"
                  :step="row.step"
                  @update:modelValue="a.setSeed(row, $event)"
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
              </template>

              <template v-else-if="row.kind === 'format'">
                <Select :model-value="row.fmt" @update:modelValue="a.setFormat(row, $event)">
                  <SelectTrigger size="sm" class="w-[84px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="fmt in row.formats" :key="fmt" :value="fmt">
                      {{ fmt }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  v-if="row.qualities.length"
                  :model-value="row.quality"
                  @update:modelValue="a.setQuality(row, $event)"
                >
                  <SelectTrigger size="sm" class="w-[92px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="q in row.qualities" :key="q" :value="q">
                      {{ q }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </template>

              <Switch
                v-else-if="row.kind === 'switch'"
                :model-value="row.value"
                @update:modelValue="a.setSwitch(row, $event)"
              />
            </div>
          </div>
          <p v-if="!s.settings.length" class="text-muted-foreground text-sm">
            该工作流没有可调参数
          </p>
        </PopoverContent>
      </Popover>

      <Button class="xcat-ap-run ml-auto" size="sm" :disabled="s.runDisabled" @click="a.run()">
        <Square v-if="s.runStop" />
        <Play v-else />
        {{ s.runLabel }}
      </Button>
    </div>
  </div>
</template>
