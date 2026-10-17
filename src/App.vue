<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import EditorPane from "./components/EditorPane.vue";
import OutlineDrawer from "./components/OutlineDrawer.vue";
import SidebarTree from "./components/SidebarTree.vue";
import StatusBar from "./components/StatusBar.vue";
import TabBar from "./components/TabBar.vue";
import Toolbar from "./components/Toolbar.vue";
import { closeTab, init, newDoc, state } from "./store";

function onKeydown(event: KeyboardEvent) {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod) return;
  const key = event.key.toLowerCase();

  if (key === "n") {
    event.preventDefault();
    void newDoc();
  } else if (key === "w" && state.activePath) {
    event.preventDefault();
    void closeTab(state.activePath);
  } else if (event.key === "\\") {
    event.preventDefault();
    state.railCollapsed = !state.railCollapsed;
  } else if (key === "o" && event.shiftKey) {
    event.preventDefault();
    state.outlineOpen = !state.outlineOpen;
  }
}

onMounted(() => {
  void init();
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div class="app" :class="{ 'rail-collapsed': state.railCollapsed }">
    <SidebarTree />
    <div class="main">
      <TabBar />
      <Toolbar />
      <EditorPane />
      <OutlineDrawer />
    </div>
    <StatusBar />
  </div>
</template>
