<script setup lang="ts">
import { keepLocalForConflict, state, useRemoteForConflict } from "../store";

/**
 * 远端更新与本地未保存改动冲突时的确认框。
 * 关闭（点遮罩/取消）等价于「先保留本地」，不会自动覆盖。
 */
function keepLocal() {
  keepLocalForConflict();
}
</script>

<template>
  <Transition name="fade">
    <div v-if="state.syncConflict" class="conflict-mask" @pointerdown.self="keepLocal">
      <div class="conflict-card" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <div id="conflict-title" class="conflict-title">远端版本已更新</div>
        <div class="conflict-body">
          {{ state.syncConflict.name }} 在远端有新的修改，本地还有未保存的内容。选择如何继续：
        </div>

        <button class="conflict-option primary" @click="useRemoteForConflict()">
          <span class="conflict-option-title">使用远端版本</span>
          <span class="conflict-option-sub">丢弃本地未保存改动，重新载入编辑器</span>
        </button>

        <button class="conflict-option" @click="keepLocal">
          <span class="conflict-option-title">先保留本地</span>
          <span class="conflict-option-sub">本次不同步该文档，下次拉取再提示</span>
        </button>

        <div class="conflict-actions">
          <button class="conflict-btn" @click="keepLocal">取消</button>
          <button class="conflict-btn primary" @click="useRemoteForConflict()">使用远端版本</button>
        </div>
      </div>
    </div>
  </Transition>
</template>
