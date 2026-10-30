<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  loginServer,
  logoutServer,
  registerServer,
  state,
  updateServerProfile,
} from "../store";
import { avatarStyle, fileToAvatar, normalizeAvatar } from "../ui/avatar";
import { rememberFocus, trapFocus } from "../ui/dialogFocus";

const AVATARS = ["#7F77DD", "#1D9E75", "#D85A30", "#D4537E", "#378ADD", "#639922", "#BA7517", "#5F5E5A"];

const mode = ref<"login" | "register" | "edit">("login");
const username = ref("");
const email = ref("");
const password = ref("");
const avatar = ref(AVATARS[0]);
const busy = ref(false);
const error = ref("");
const cardEl = ref<HTMLElement | null>(null);
const firstInput = ref<HTMLInputElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

let releaseTrap: (() => void) | null = null;
let restoreFocus: (() => void) | null = null;

const loggedIn = computed(() => !!state.serverToken);
const initial = computed(() => {
  const name = state.serverUsername || state.serverEmail || "·";
  return name.trim().charAt(0).toUpperCase();
});
const isRegister = computed(() => mode.value === "register");
const title = computed(() => {
  if (mode.value === "edit") return "编辑资料";
  return isRegister.value ? "创建账号" : "登录到同步服务器";
});
const subtitle = computed(() => {
  if (mode.value === "edit") return "修改昵称或头像，保存后立即生效";
  return isRegister.value ? "注册后即可在多台设备间同步笔记" : "使用你的邮箱继续";
});

function close() {
  state.accountOpen = false;
}

function switchMode(next: "login" | "register") {
  mode.value = next;
  error.value = "";
}

/** 左右方向键切换登录/注册，符合 tablist 习惯 */
async function onTabKey(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  switchMode(mode.value === "login" ? "register" : "login");
  await nextTick();
  document.querySelector<HTMLElement>(".account-tab.active")?.focus();
}

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    if (mode.value === "login") {
      await loginServer(email.value.trim(), password.value);
    } else if (mode.value === "register") {
      await registerServer(email.value.trim(), password.value, username.value.trim(), avatar.value);
    } else {
      await updateServerProfile(username.value.trim(), avatar.value);
    }
    password.value = "";
    close();
  } catch (err) {
    error.value = String((err as Error).message || err);
  } finally {
    busy.value = false;
  }
}

async function onPickFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  error.value = "";
  try {
    avatar.value = await fileToAvatar(file);
  } catch (err) {
    error.value = String((err as Error).message || err);
  }
}

async function doLogout() {
  await logoutServer();
  close();
}

watch(
  () => state.accountOpen,
  async (open) => {
    if (!open) {
      releaseTrap?.();
      releaseTrap = null;
      restoreFocus?.();
      restoreFocus = null;
      return;
    }
    mode.value = "login";
    username.value = state.serverUsername;
    email.value = state.serverEmail;
    avatar.value = state.serverAvatar || AVATARS[0];
    password.value = "";
    error.value = "";
    await nextTick();
    firstInput.value?.focus();
    if (cardEl.value) {
      restoreFocus = rememberFocus();
      releaseTrap = trapFocus(cardEl.value);
    }
  },
);

function onKeydown(event: KeyboardEvent) {
  if (!state.accountOpen || event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  close();
}

document.addEventListener("keydown", onKeydown, true);
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown, true);
  releaseTrap?.();
});
</script>

<template>
  <Transition name="fade">
    <div v-if="state.accountOpen" class="account-mask" @pointerdown.self="close">
      <div ref="cardEl" class="account-card" role="dialog" aria-modal="true" :aria-label="title">
        <header class="account-head">
          <div class="account-brand">
            <img class="account-logo" src="/app-icon.png" alt="" />
            <span class="account-brand-name">Inksight</span>
            <span class="account-brand-divider" aria-hidden="true">/</span>
            <span class="account-brand-scope">账号</span>
          </div>
          <button class="account-close" aria-label="关闭" title="关闭" @click="close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            </svg>
          </button>
        </header>

        <template v-if="loggedIn && mode !== 'edit'">
          <div class="account-hero">
            <span class="account-avatar hero" :style="avatarStyle(normalizeAvatar(state.serverAvatar, AVATARS[0]))">
              <template v-if="!state.serverAvatar?.startsWith('data:image/')">{{ initial }}</template>
            </span>
            <div class="account-hero-name">{{ state.serverUsername || "未命名" }}</div>
            <div class="account-hero-mail">{{ state.serverEmail }}</div>
          </div>
          <p class="account-note">已登录同步服务器，笔记会同步到该账号。</p>
          <button class="account-primary" @click="close">完成</button>
          <div class="account-footer">
            <button class="account-link" @click="mode = 'edit'; error = ''">编辑资料</button>
            <span class="account-dot" aria-hidden="true">·</span>
            <button class="account-link danger" @click="doLogout">退出登录</button>
          </div>
        </template>

        <template v-else>
          <div class="account-intro">
            <h2 class="account-title">{{ title }}</h2>
            <p class="account-subtitle">{{ subtitle }}</p>
          </div>

          <div
            v-if="mode !== 'edit'"
            class="account-tabs"
            role="tablist"
            aria-label="账号操作"
            @keydown="onTabKey"
          >
            <button
              class="account-tab"
              :class="{ active: mode === 'login' }"
              role="tab"
              :aria-selected="mode === 'login'"
              @click="switchMode('login')"
            >
              登录
            </button>
            <button
              class="account-tab"
              :class="{ active: mode === 'register' }"
              role="tab"
              :aria-selected="mode === 'register'"
              @click="switchMode('register')"
            >
              注册
            </button>
          </div>

          <div v-if="isRegister || mode === 'edit'" class="account-avatar-block">
            <button class="account-avatar hero" :style="avatarStyle(avatar)" title="上传头像" @click="fileInput?.click()">
              <template v-if="!avatar.startsWith('data:image/')">
                <span v-if="(username || email).trim()" class="account-avatar-initial">
                  {{ (username || email).charAt(0).toUpperCase() }}
                </span>
                <svg v-else class="account-avatar-person" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="9" r="3.4" stroke="currentColor" stroke-width="1.5" />
                  <path d="M5.5 19c.9-3.1 3.4-4.6 6.5-4.6s5.6 1.5 6.5 4.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </template>
            </button>
            <div class="account-avatar-hint">点击头像可上传自己的图片</div>
            <div class="account-avatars">
              <button
                v-for="color in AVATARS"
                :key="color"
                class="account-swatch"
                :class="{ selected: avatar === color }"
                :style="{ background: color }"
                :aria-label="`选择颜色 ${color}`"
                :aria-pressed="avatar === color"
                @click="avatar = color"
              />
            </div>
            <input ref="fileInput" type="file" accept="image/*" hidden @change="onPickFile" />
          </div>

          <div class="account-form">
            <label v-if="isRegister || mode === 'edit'" class="account-field">
              <span class="account-label">用户名</span>
              <input v-model="username" class="account-input" maxlength="20" placeholder="2–20 个字符" />
            </label>

            <template v-if="mode !== 'edit'">
              <label class="account-field">
                <span class="account-label">邮箱</span>
                <input
                  :ref="mode === 'login' ? (el) => (firstInput = el as HTMLInputElement) : undefined"
                  v-model="email"
                  class="account-input"
                  type="email"
                  autocomplete="username"
                  placeholder="you@example.com"
                />
              </label>
              <label class="account-field">
                <span class="account-label">密码</span>
                <input
                  v-model="password"
                  class="account-input"
                  type="password"
                  autocomplete="current-password"
                  placeholder="至少 6 位"
                  @keydown.enter="submit"
                />
              </label>
            </template>
          </div>

          <p v-if="error" class="account-error" role="alert">{{ error }}</p>

          <button class="account-primary" :disabled="busy" @click="submit">
            {{ busy ? "处理中…" : mode === "login" ? "登录" : mode === "register" ? "注册并登录" : "保存修改" }}
          </button>

          <div class="account-footer">
            <template v-if="mode === 'login'">
              还没有账号？
              <button class="account-link" @click="switchMode('register')">立即注册</button>
            </template>
            <template v-else-if="mode === 'register'">
              已有账号？
              <button class="account-link" @click="switchMode('login')">直接登录</button>
            </template>
            <template v-else>
              <button class="account-link" @click="mode = 'login'; error = ''">返回</button>
            </template>
          </div>
        </template>
      </div>
    </div>
  </Transition>
</template>
