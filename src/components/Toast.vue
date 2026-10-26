<script setup lang="ts">
import { hideToast, toastState } from "../ui/toast";
</script>

<template>
  <Transition name="toast">
    <div
      v-if="toastState.open"
      :key="toastState.seq"
      class="toast"
      :class="toastState.kind"
      role="status"
      aria-live="polite"
      @click="hideToast"
    >
      <span class="toast-dot" />
      <span class="toast-text">{{ toastState.text }}</span>
    </div>
  </Transition>
</template>
