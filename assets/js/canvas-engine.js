/**
 * ============================================================================
 * 零闪烁 HiDPI Canvas 渲染引擎 (canvas-engine.js)
 *
 * 彻底根除闪屏与 ResizeObserver 反馈环的 4 大设计：
 * 1. canvas 在 .canvas-shell 内采用绝对定位 (inset:0; width:100%; height:100%)，
 *    画布像素缓冲绝不反推父容器尺寸；
 * 2. 使用 clientWidth / clientHeight（不含边框）仅在 ResizeObserver 中同步一次
 *    backing store，绝不在 requestAnimationFrame 中改写 canvas.width/height；
 * 3. beginFrame 先挂载再执行首次 syncSize，保证静态重绘回调立即可用；
 * 4. IntersectionObserver 在滚出视口时自动暂停渲染。
 * ============================================================================
 */
(function () {
  function readCanvasPalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (cs.getPropertyValue(name) || "").trim() || fallback;
    return {
      bg: v("--canvas-bg", "#FAF4EA"),
      card: v("--bg-elevated", "#FFFDF9"),
      subtle: v("--bg-subtle", "#F4ECE0"),
      border: v("--border", "#E8DBC9"),
      grid: v("--canvas-grid", "rgba(164,132,100,0.18)"),
      axis: v("--canvas-axis", "rgba(120,92,68,0.38)"),
      text: v("--canvas-text", "#4A392E"),
      muted: v("--canvas-muted", "#8B7566"),
      c1: v("--canvas-c1", "#D47234"),
      c2: v("--canvas-c2", "#4B8B6B"),
      c3: v("--canvas-c3", "#D99B26"),
      c4: v("--canvas-c4", "#D4594B"),
      c5: v("--canvas-c5", "#8B638E")
    };
  }

  let cachedPalette = null;
  function getPalette() {
    if (!cachedPalette) cachedPalette = readCanvasPalette();
    return cachedPalette;
  }

  window.addEventListener("sunshine:themechange", () => {
    cachedPalette = readCanvasPalette();
  });

  function createManagedCanvas(canvas, onStaticRedraw) {
    const ctx = canvas.getContext("2d", { alpha: false });
    const parent = canvas.parentElement || canvas;

    // 绝对定位铺满父容器，彻底切断子元素撑大父容器的 ResizeObserver 循环
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    const state = {
      canvas,
      ctx,
      w: 0,
      h: 0,
      dpr: 1,
      visible: true
    };

    state.beginFrame = function () {
      const p = getPalette();
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, state.w, state.h);
      return p;
    };

    function syncSize() {
      const cssW = Math.max(200, Math.floor(parent.clientWidth));
      const cssH = Math.max(100, Math.floor(parent.clientHeight));
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);

      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);

      if (canvas.width !== targetW || canvas.height !== targetH || state.dpr !== dpr) {
        canvas.width = targetW;
        canvas.height = targetH;
        state.w = cssW;
        state.h = cssH;
        state.dpr = dpr;
        if (typeof onStaticRedraw === "function") {
          onStaticRedraw(state);
        }
      }
    }

    state.syncSize = syncSize;

    // 首次同步尺寸（此时 state.beginFrame 已就绪）
    syncSize();

    if (typeof ResizeObserver !== "undefined") {
      let rafResize = 0;
      const ro = new ResizeObserver(() => {
        if (rafResize) cancelAnimationFrame(rafResize);
        rafResize = requestAnimationFrame(() => {
          rafResize = 0;
          syncSize();
        });
      });
      ro.observe(parent);
    } else {
      window.addEventListener("resize", syncSize);
    }

    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            state.visible = e.isIntersecting;
          });
        },
        { threshold: 0.01 }
      );
      io.observe(parent);
    }

    if (typeof onStaticRedraw === "function") {
      window.addEventListener("sunshine:themechange", () => {
        cachedPalette = readCanvasPalette();
        onStaticRedraw(state);
      });
    }

    return state;
  }

  function drawGrid(ctx, w, h, stepX, stepY, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = stepX; x < w; x += stepX) {
      ctx.moveTo(Math.floor(x) + 0.5, 0);
      ctx.lineTo(Math.floor(x) + 0.5, h);
    }
    for (let y = stepY; y < h; y += stepY) {
      ctx.moveTo(0, Math.floor(y) + 0.5);
      ctx.lineTo(w, Math.floor(y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawRoundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function drawLegend(ctx, items, x, y) {
    ctx.save();
    ctx.font = '600 11.5px "PingFang SC", "Microsoft YaHei", sans-serif';
    let cx = x;
    items.forEach((it) => {
      ctx.strokeStyle = it.color;
      ctx.lineWidth = it.lw || 2.5;
      ctx.setLineDash(it.dash || []);
      ctx.beginPath();
      ctx.moveTo(cx, y - 4);
      ctx.lineTo(cx + 16, y - 4);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = it.textColor || getPalette().text;
      ctx.fillText(it.label, cx + 21, y);
      cx += 21 + ctx.measureText(it.label).width + 16;
    });
    ctx.restore();
  }

  window.CanvasEngine = {
    getPalette,
    createManagedCanvas,
    drawGrid,
    drawRoundRect,
    drawLegend
  };
})();
