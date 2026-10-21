<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { closeImageLightbox, imageLightboxState } from "../ui/imageLightbox";

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && imageLightboxState.open) {
    e.preventDefault();
    closeImageLightbox();
  }
}

onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <div
    v-if="imageLightboxState.open"
    class="img-lightbox"
    role="dialog"
    aria-label="图片预览"
    @click="closeImageLightbox"
  >
    <img :src="imageLightboxState.src" :alt="imageLightboxState.caption" @click.stop />
    <p v-if="imageLightboxState.caption" class="img-lightbox-caption">
      {{ imageLightboxState.caption }}
    </p>
  </div>
</template>
