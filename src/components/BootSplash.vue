<script setup lang="ts">
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { finishBoot, state } from "../store";
import { avatarStyle, normalizeAvatar } from "../ui/avatar";
import { INK_GLYPHS, INK_STROKE_WIDTH, INK_VIEWBOX } from "./inkGlyphs";

gsap.registerPlugin(DrawSVGPlugin);

const cardEl = ref<HTMLElement | null>(null);
const copyEl = ref<HTMLElement | null>(null);
const barEl = ref<HTMLElement | null>(null);
const pctEl = ref<HTMLElement | null>(null);
const pathEls = ref<SVGPathElement[]>([]);
const penEl = ref<SVGCircleElement | null>(null);
const swashEl = ref<SVGPathElement | null>(null);
const swashDotEl = ref<SVGCircleElement | null>(null);

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const accountInitial = computed(() =>
  (state.serverUsername || state.serverEmail || "·").trim().charAt(0).toUpperCase(),
);

let tl: gsap.core.Timeline | null = null;
let safety = 0;

function showFull() {
  pathEls.value.forEach((p) => {
    p.style.strokeDasharray = "none";
    p.style.strokeDashoffset = "0";
  });
  if (penEl.value) penEl.value.style.opacity = "0";
  if (copyEl.value) copyEl.value.style.opacity = "1";
  if (barEl.value) barEl.value.style.transform = "scaleX(1)";
  if (pctEl.value) pctEl.value.textContent = "100%";
}

function finish() {
  if (!state.boot.active || state.boot.done) return;
  state.boot.done = true;
  clearTimeout(safety);
  if (tl) tl.kill();
  showFull();
}

/** 收尾动画：字定格 → 遮罩淡出 → 交还编辑器 */
function playOutro() {
  finish();
  if (!window.gsap || reduce) {
    finishBoot();
    return;
  }
  const out = gsap.timeline({ onComplete: finishBoot });
  out.to(cardEl.value, { opacity: 0, duration: 0.4, ease: "power1.out", delay: 0.18 });
}

function playIntro() {
  const paths = pathEls.value;
  if (!window.gsap || reduce) {
    showFull();
    if (barEl.value) barEl.value.style.transform = "scaleX(0.9)";
    return;
  }

  // 书写起点：所有笔画从 0 开始
  gsap.set(paths, { drawSVG: "0% 0%" });

  const timeline = gsap.timeline({ onComplete: finish });
  tl = timeline;

  // 逐字母书写，笔尖跟随当前笔画的端点
  paths.forEach((path, i) => {
    timeline.to(path, {
      drawSVG: "100%",
      duration: 0.38,
      ease: "power1.inOut",
      onStart: () => {
        if (penEl.value) {
          penEl.value.style.opacity = "1";
          penEl.value.style.fill = INK_GLYPHS[i].color;
        }
      },
      onUpdate: function () {
        const p = this.progress();
        const len = path.getTotalLength();
        const pt = path.getPointAtLength(len * p);
        if (penEl.value) {
          penEl.value.setAttribute("cx", pt.x.toFixed(2));
          penEl.value.setAttribute("cy", pt.y.toFixed(2));
        }
      },
    }, i * 0.22);
  });

  timeline.to(penEl.value, { opacity: 0, duration: 0.16 })
    .to(swashEl.value, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, "-=0.05")
    .to(swashDotEl.value, { opacity: 1, duration: 0.14 }, "-=0.05")
    .to(copyEl.value, { opacity: 1, duration: 0.35 }, "-=0.2");

  const progress = { v: 0.05 };
  timeline.to(progress, {
    v: 0.9,
    duration: 2.6,
    ease: "power1.inOut",
    onUpdate: function () {
      if (barEl.value) barEl.value.style.transform = `scaleX(${progress.v})`;
      if (pctEl.value) pctEl.value.textContent = Math.round(progress.v * 100) + "%";
    }
  }, "-=0.25");

  // 兜底：动画没走完也在 3.2s 后定格完整字（不等同步）
  safety = window.setTimeout(() => finish(), 4500);
}

onMounted(() => {
  if (state.boot.done) {
    playOutro();
    return;
  }
  playIntro();
});

onBeforeUnmount(() => {
  clearTimeout(safety);
  if (tl) tl.kill();
});

watch(
  () => state.boot.done,
  (done) => {
    if (done) playOutro();
  },
);
</script>

<template>
  <div ref="cardEl" class="boot-mask" role="status" aria-live="polite" :aria-label="state.boot.label">
    <div class="boot-inner">
      <div class="boot-word-wrap">
        <svg
          class="boot-glyph-svg"
          :viewBox="`0 ${INK_VIEWBOX.top} ${INK_VIEWBOX.width} ${INK_VIEWBOX.height}`"
          fill="none"
          aria-label="InkSight"
          role="img"
        >
          <path
            v-for="(g, i) in INK_GLYPHS"
            :key="i"
            :ref="(el) => (pathEls[i] = el as SVGPathElement)"
            :d="g.d"
            :transform="`translate(${g.x} 0)`"
            :stroke="g.color"
            :stroke-width="INK_STROKE_WIDTH"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle ref="penEl" class="boot-pen" r="0.85" cx="0" cy="0" />
        </svg>
      </div>

      <div ref="copyEl" class="boot-copy">
        <span class="boot-copy-dot" />
        <span>{{ state.boot.label }}</span>
      </div>

      <div class="boot-bar-track">
        <div ref="barEl" class="boot-bar" />
      </div>
      <div ref="pctEl" class="boot-pct">0%</div>
    </div>

    <div v-if="state.serverToken" class="boot-account" :title="state.serverUsername || state.serverEmail">
      <span class="boot-account-avatar" :style="avatarStyle(normalizeAvatar(state.serverAvatar))">
        <template v-if="!normalizeAvatar(state.serverAvatar).startsWith('data:image/')">{{ accountInitial }}</template>
      </span>
    </div>
  </div>
</template>
