<script setup lang="ts">
import {
  beginRename,
  cancelRename,
  closeSession,
  newSession,
  renameSession,
  setActive,
  termStore,
} from "../terminal";
import Icon from "./Icon.vue";

/** 重命名输入框挂载后立刻聚焦并全选，像资源管理器的 F2 */
function focusRename(el: unknown) {
  if (!(el instanceof HTMLInputElement)) return;
  el.focus();
  el.select();
}

function onRenameBlur(id: number, event: FocusEvent) {
  // 回车 / Esc 已经结束重命名时不再重复提交（否则 Esc 会把输入框里的内容写回去）
  if (termStore.renamingId !== id) return;
  renameSession(id, (event.target as HTMLInputElement).value);
}
</script>

<template>
  <aside class="sidebar" aria-label="终端会话">
    <div class="rail-head">
      <span class="mp-title">终端</span>
      <span class="rail-head-spacer" />
      <button
        class="tool-btn"
        title="新建终端 Ctrl+Shift+`"
        aria-label="新建终端"
        @click="newSession()"
      >
        <Icon name="plus" :size="15" />
      </button>
    </div>

    <div class="term-list">
      <div
        v-for="s in termStore.sessions"
        :key="s.id"
        class="term-row"
        :class="{ on: s.id === termStore.activeId }"
        role="button"
        tabindex="0"
        :data-term-id="s.id"
        :title="s.alive ? s.title : `${s.title}（进程已退出）`"
        @click="setActive(s.id)"
        @dblclick="beginRename(s.id)"
        @keydown.enter="setActive(s.id)"
        @keydown.f2.prevent="beginRename(s.id)"
      >
        <span class="term-dot" :class="{ dead: !s.alive }" />
        <input
          v-if="termStore.renamingId === s.id"
          :ref="focusRename"
          class="term-rename"
          :value="s.title"
          @click.stop
          @dblclick.stop
          @keydown.enter.prevent="renameSession(s.id, ($event.target as HTMLInputElement).value)"
          @keydown.esc.prevent="cancelRename"
          @blur="onRenameBlur(s.id, $event)"
        />
        <span v-else class="term-row-name">{{ s.title }}</span>
        <span
          class="term-x"
          role="button"
          aria-label="关闭终端"
          @click.stop="closeSession(s.id)"
        >
          <Icon name="close" :size="11" />
        </span>
      </div>

      <div v-if="!termStore.sessions.length" class="mp-body">
        <Icon name="terminal" :size="20" />
        <p>还没有终端会话</p>
        <span>会话列在这一栏；终端开在右侧，可以同时开多个。</span>
        <button class="term-cta" @click="newSession()">新建 PowerShell</button>
      </div>
    </div>

    <div class="rail-footer">Ctrl+` 回到笔记</div>
  </aside>
</template>
