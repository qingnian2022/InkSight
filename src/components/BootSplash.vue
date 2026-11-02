<script setup lang="ts">
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { finishBoot, state } from "../store";
import { avatarStyle, normalizeAvatar } from "../ui/avatar";
import { INK_GLYPHS, INK_STROKE_WIDTH, INK_VIEWBOX } from "./inkGlyphs";

gsap.registerPlugin(DrawSVGPlugin);

const cardEl = ref<HTMLElement | null>(null);
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
    p.style.opacity = "1";
    p.style.strokeDasharray = "none";
    p.style.strokeDashoffset = "0";
  });
  if (penEl.value) penEl.value.style.opacity = "0";
  if (swashEl.value) swashEl.value.style.strokeDashoffset = "0";
  if (swashDotEl.value) swashDotEl.value.style.opacity = "1";
}

function close() {
  clearTimeout(safety);
  if (tl) tl.kill();
  finishBoot();
}

function playIntro() {
  const paths = pathEls.value;

  if (reduce) {
    // 系统要求减少动效：静态展示后直接进入
    showFull();
    window.setTimeout(close, 450);
    return;
  }

  // 书写起点：所有笔画从 0 开始；先隐藏，避免 0 长度圆头 dash 留下小圆点
  gsap.set(paths, { drawSVG: "0% 0%", opacity: 0 });

  const timeline = gsap.timeline({
    onComplete: () => {
      // 动画结束 → 直接进入，不等同步
      gsap.to(cardEl.value, {
        opacity: 0,
        duration: 0.4,
        ease: "power1.out",
        delay: 0.12,
        onComplete: finishBoot,
      });
    },
  });
  tl = timeline;

  paths.forEach((path, i) => {
    timeline.to(
      path,
      {
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
          // 笔画刚起步时 dash 长度为 0，圆头会留下一个小点；有进度后再显形
          if (p > 0.06) path.style.opacity = "1";
          const len = path.getTotalLength();
          const pt = path.getPointAtLength(len * p);
          if (penEl.value) {
            penEl.value.setAttribute("cx", (pt.x + INK_GLYPHS[i].x).toFixed(2));
            penEl.value.setAttribute("cy", pt.y.toFixed(2));
          }
        },
      },
      i * 0.22,
    );
  });

  timeline
    .to(penEl.value, { opacity: 0, duration: 0.16 })
    .to(swashEl.value, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, "-=0.05")
    .to(swashDotEl.value, { opacity: 1, duration: 0.14 }, "-=0.05")
    .to({}, { duration: 0.35 });

  // 兜底：动画异常时也不把用户挡在启动页
  safety = window.setTimeout(close, 4500);
}

onMounted(() => {
  playIntro();
});

onBeforeUnmount(() => {
  clearTimeout(safety);
  if (tl) tl.kill();
});
</script>

<template>
  <div ref="cardEl" class="boot-mask" role="status" aria-label="正在启动 InkSight">
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

        <svg class="boot-swash" width="340" height="24" viewBox="0 0 360 26" fill="none" aria-hidden="true">
          <path
            ref="swashEl"
            d="M6 18 C 96 6, 262 4, 354 14"
            stroke="#2fd8f0"
            stroke-width="5"
            stroke-linecap="round"
            stroke-dasharray="360"
            stroke-dashoffset="360"
          />
          <circle ref="swashDotEl" cx="354" cy="14" r="4.5" fill="#f09048" opacity="0" />
        </svg>
      </div>
    </div>

    <div v-if="state.serverToken" class="boot-account" :title="state.serverUsername || state.serverEmail">
      <span class="boot-account-avatar" :style="avatarStyle(normalizeAvatar(state.serverAvatar))">
        <template v-if="!normalizeAvatar(state.serverAvatar).startsWith('data:image/')">{{ accountInitial }}</template>
      </span>
    </div>
  </div>
</template>
