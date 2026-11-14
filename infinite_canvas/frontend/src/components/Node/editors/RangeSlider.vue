<template>
  <div class="range-field">
    <span class="range-label">{{ label }}</span>
    <div class="range-slider">
      <div class="range-track">
        <span class="range-fill" :style="{ width: `${percent}%` }" />
      </div>
      <input
        class="range-input"
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        @input="onInput"
      />
      <span class="range-knob" :style="{ left: knobLeft }">{{ modelValue }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  label: { type: String, default: "" },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 10 },
  step: { type: Number, default: 1 },
});

const emit = defineEmits(["update:modelValue"]);

const percent = computed(() => {
  const span = props.max - props.min;
  if (span <= 0) return 0;
  return ((props.modelValue - props.min) / span) * 100;
});

// 圆钮 24px：中心始终压在填充分界点上
const knobLeft = computed(() => `calc(${percent.value}% - ${percent.value * 0.24}px)`);

function onInput(event) {
  emit("update:modelValue", Number(event.target.value));
}
</script>

<style scoped>
.range-field {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  font-size: 12px;
  color: var(--c-text);
}

.range-label {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--c-muted);
  white-space: nowrap;
}

.range-slider {
  position: relative;
  width: 100%;
  height: 28px;
}

.range-track {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 6px;
  transform: translateY(-50%);
  border-radius: 3px;
  background: color-mix(in srgb, var(--c-text) 22%, transparent);
  overflow: hidden;
}

.range-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--accent-yellow);
  opacity: 0.55;
}

.range-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
  z-index: 2;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
}

.range-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 24px;
  height: 24px;
}

.range-input::-moz-range-thumb {
  width: 24px;
  height: 24px;
  border: 0;
}

.range-knob {
  position: absolute;
  top: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(-0px, -50%);
  border-radius: 50%;
  background: var(--accent-yellow);
  color: var(--c-on-accent);
  font-size: 10px;
  font-weight: 600;
  pointer-events: none;
  overflow: hidden;
}
</style>
