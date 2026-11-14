<script setup>
import { cn } from "cn";

const props = defineProps({
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
});
</script>

<template>
  <div
    data-slot="popover-header"
    :class="cn('flex flex-col gap-0.5 text-sm', props.class)"
  >
    <slot />
  </div>
</template>
