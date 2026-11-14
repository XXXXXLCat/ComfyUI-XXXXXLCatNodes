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
  <p
    data-slot="popover-description"
    :class="cn('text-muted-foreground', props.class)"
  >
    <slot />
  </p>
</template>
