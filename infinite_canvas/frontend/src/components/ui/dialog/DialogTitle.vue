<script setup>
import { reactiveOmit } from "@vueuse/core";
import { cn } from "cn";
import { DialogTitle, useForwardProps } from "reka-ui";

const props = defineProps({
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
});

const delegatedProps = reactiveOmit(props, "class");

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DialogTitle
    data-slot="dialog-title"
    v-bind="forwardedProps"
    :class="
      cn('text-base leading-none font-medium cn-font-heading', props.class)
    "
  >
    <slot />
  </DialogTitle>
</template>
