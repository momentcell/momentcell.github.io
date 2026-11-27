/**
 * Sunshine 个人网站首页交互逻辑：
 * - 读取 data/site-config.js & data/projects.js 动态渲染全站
 * - 项目分类筛选 & 实时关键字搜索
 * - 零闪烁 60fps 首页微缩平衡车互动卡片
 * - 新增项目 JSON 模板生成器弹窗
 */
(function () {
  const cfg = window.SITE_CONFIG;
  const projects = window.PROJECTS_DATA || [];

  function showToast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2000);
  }

  function copyText(txt, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(() => showToast(okMsg)).catch(() => showToast(okMsg));
    } else {
      showToast(okMsg);
    }
  }

  function renderProfile() {
    if (!cfg) return;
    const b = cfg.brand;
    document.getElementById("navMonogram").textContent = b.monogram;
    document.getElementById("navBrandName").textContent = b.name;
    document.getElementById("navGithub").href = b.githubUrl;
    document.getElementById("heroStatus").textContent = b.status;
    document.getElementById("heroName").textContent = b.name;
    document.getElementById("heroRole").textContent = b.role;
    document.getElementById("heroTagline").textContent = b.tagline;
    document.getElementById("heroStudioImg").src = b.heroImage;
    document.getElementById("footerName").textContent = b.name;
    document.getElementById("footerYear").textContent = b.copyrightYear;

    const mailLink = document.getElementById("contactMailLink");
    mailLink.href = "mailto:" + b.email;
    mailLink.textContent = "发送邮件 · " + b.email;

    document.getElementById("btnCopyEmailHero").onclick = () => copyText(b.email, "已复制邮箱：" + b.email);
    document.getElementById("btnCopyEmailFooter").onclick = () => copyText(b.email, "已复制邮箱：" + b.email);

    document.getElementById("heroMetrics").innerHTML = cfg.metrics
      .map((m) => `<div class="metric-box"><div class="metric-val">${m.value}</div><div class="metric-lbl">${m.label}</div></div>`)
      .join("");

    document.getElementById("skillsGrid").innerHTML = cfg.skills
      .map(
        (s) => `
        <div class="card skill-card">
          <h3>${s.category}</h3>
          <ul class="skill-list">${s.items.map((it) => `<li>${it}</li>`).join("")}</ul>
        </div>`
      )
      .join("");

    document.getElementById("timelineGrid").innerHTML = cfg.timeline
      .map(
        (t) => `
        <div class="card timeline-item">
          <div class="timeline-date">${t.date}</div>
          <h3>${t.title}</h3>
          <p>${t.desc}</p>
        </div>`
      )
      .join("");
  }

  let currentCat = "全部";
  let currentQuery = "";

  function renderFilters() {
    const cats = ["全部", ...Array.from(new Set(projects.map((p) => p.category)))];
    const box = document.getElementById("filterTabs");
    box.innerHTML = cats
      .map((c) => `<button class="filter-btn ${c === currentCat ? "active" : ""}" data-cat="${c}" type="button">${c}</button>`)
      .join("");
    box.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentCat = btn.dataset.cat;
        renderFilters();
        renderProjects();
      });
    });
  }

  function renderProjects() {
    const q = currentQuery.trim().toLowerCase();
    const list = projects.filter((p) => {
      const matchCat = currentCat === "全部" || p.category === currentCat;
      const haystack = (p.title + " " + p.subtitle + " " + p.summary + " " + (p.tags || []).join(" ")).toLowerCase();
      return matchCat && (!q || haystack.includes(q));
    });

    document.getElementById("projectCountBadge").textContent = `显示 ${list.length} / ${projects.length} 个项目`;
    const grid = document.getElementById("projectsGrid");

    if (!list.length) {
      grid.innerHTML = `<div class="card" style="grid-column:1/-1;text-align:center;padding:38px;color:var(--text-muted);">未找到匹配“${currentQuery}”的项目，试试切换分类或清空搜索词。</div>`;
      return;
    }

    grid.innerHTML = list
      .map((p) => {
        const href = p.customUrl ? p.customUrl : `project.html?id=${encodeURIComponent(p.id)}`;
        const isFeatured = p.featured && currentCat === "全部" && !q;
        const coverHtml = p.cover
          ? `<img src="${p.cover}" alt="${p.title}" loading="lazy" />`
          : `<div class="project-cover-placeholder">
               <div style="font-size:2rem;">🛠️</div>
               <div style="font-weight:700;color:var(--text);">${p.category}</div>
               <div>${p.status}</div>
             </div>`;
        return `
        <article class="card card-interactive project-card ${isFeatured ? "featured" : ""}">
          <a href="${href}" class="project-cover">${coverHtml}</a>
          <div class="project-body">
            <div>
              <div class="project-meta">
                <span class="pill pill-warm">${p.category}</span>
                <span class="pill pill-sage">${p.status}</span>
                <span class="pill">${p.year}</span>
              </div>
              <h3 class="project-title"><a href="${href}">${p.title}</a></h3>
              <p class="project-summary">${p.summary}</p>
            </div>
            <div class="highlights-grid">
              ${(p.highlights || [])
                .map((h) => `<div class="highlight-chip"><div class="k">${h.label}</div><div class="v">${h.value}</div></div>`)
                .join("")}
            </div>
            <div class="tag-row">
              ${(p.tags || []).map((t) => `<span class="tag">${t}</span>`).join("")}
            </div>
            <div class="project-actions">
              <a href="${href}" class="btn btn-sm btn-primary">${p.customUrl ? "进入交互仿真展示页 →" : "查看项目详情 →"}</a>
              ${p.repoUrl ? `<a href="${p.repoUrl}" target="_blank" rel="noopener" class="btn btn-sm">源码仓库</a>` : ""}
            </div>
          </div>
        </article>`;
      })
      .join("");
  }

  // ==================== 首页零闪烁微缩平衡车互动动画 ====================
  function initMiniCar() {
    const el = document.getElementById("miniCarCanvas");
    if (!el || !window.CanvasEngine) return;
    const mc = window.CanvasEngine.createManagedCanvas(el);

    const s = { theta: 0.14, omega: 0, x: 0, v: 0, wheel: 0, acc: 0 };

    function nudge(dir) {
      s.theta += dir * 0.24;
      s.omega += dir * 1.1;
    }

    document.getElementById("btnMiniNudge").onclick = () => nudge(Math.random() > 0.5 ? 1 : -1);
    el.style.cursor = "pointer";
    el.addEventListener("click", () => nudge(s.theta >= 0 ? -1 : 1));

    let last = 0;
    function tick(ts) {
      if (!last) last = ts;
      const dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;

      if (mc.visible) {
        s.acc += dt;
        const h = 1 / 180;
        while (s.acc >= h) {
          const target = Math.max(-0.22, Math.min(0.22, -0.35 * s.v - 0.15 * s.x));
          const u = 42 * (s.theta - target) + 6.5 * s.omega;
          const aWheel = Math.max(-14, Math.min(14, u)) - s.v * 1.8;
          const alpha = (9.81 / 0.16) * Math.sin(s.theta) - (aWheel / 0.16) * Math.cos(s.theta) - s.omega * 0.4;
          s.v += aWheel * h;
          s.x += s.v * h;
          s.omega += alpha * h;
          s.theta += s.omega * h;
          s.wheel += (s.v / 0.03) * h;
          s.acc -= h;
        }

        const p = mc.beginFrame();
        const { ctx, w, h: ch } = mc;
        window.CanvasEngine.drawGrid(ctx, w, ch, 28, 28, p.grid);

        const gy = ch - 24;
        ctx.strokeStyle = p.axis;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();

        const cx = w * 0.5 + Math.max(-w * 0.3, Math.min(w * 0.3, s.x * 110));
        const R = 15;
        ctx.save();
        ctx.translate(cx, gy - R);

        ctx.save();
        ctx.rotate(s.theta);
        window.CanvasEngine.drawRoundRect(ctx, -9, -62, 18, 58, 5);
        ctx.fillStyle = p.card; ctx.fill();
        ctx.strokeStyle = p.c1; ctx.lineWidth = 2.2; ctx.stroke();
        ctx.fillStyle = p.c3; ctx.fillRect(-5, -55, 10, 7);
        ctx.restore();

        ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
        ctx.fillStyle = p.card; ctx.fill();
        ctx.strokeStyle = p.text; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = p.c2; ctx.lineWidth = 1.8;
        for (let i = 0; i < 4; i++) {
          const a = s.wheel + (i * Math.PI) / 2;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * (R - 4), Math.sin(a) * (R - 4)); ctx.stroke();
        }
        ctx.restore();

        ctx.fillStyle = p.muted;
        ctx.font = '600 11px "JetBrains Mono", Consolas, monospace';
        ctx.fillText(`Angle: ${(s.theta * 57.3).toFixed(1)}°  60fps 零闪烁`, 10, 18);
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ==================== 新增项目模板生成器 ====================
  function initTemplateModal() {
    const modal = document.getElementById("templateModal");
    const inputs = ["tplTitle", "tplCat", "tplTags", "tplRepo", "tplSummary"].map((id) => document.getElementById(id));
    const pre = document.getElementById("tplPreview");

    function updatePreview() {
      const title = (inputs[0].value || "我的新项目").trim();
      const cat = (inputs[1].value || "嵌入式与控制").trim();
      const tags = (inputs[2].value || "STM32,硬件,控制")
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const repo = (inputs[3].value || "https://github.com/").trim();
      const summary = (inputs[4].value || "用一句话介绍项目的核心功能与亮点。").trim();
      const slug = "project-" + Date.now().toString().slice(-4);

      const snippet = `{
  id: "${slug}",
  featured: false,
  title: "${title}",
  subtitle: "${summary}",
  category: "${cat}",
  status: "已完成",
  year: "2026",
  cover: "",
  customUrl: "",
  repoUrl: "${repo}",
  tags: ${JSON.stringify(tags)},
  highlights: [
    { label: "核心平台", value: "${tags[0] || "STM32"}" },
    { label: "状态", value: "实测通过" }
  ],
  summary: "${summary}",
  overview: "这里填写项目背景与完整设计思路。",
  architecture: ["模块一说明", "模块二说明"],
  challenges: [
    { problem: "遇到的工程难点", solution: "定位原因与最终解决方式" }
  ],
  bom: [
    { part: "核心器件", spec: "型号参数", note: "备注" }
  ]
},`;
      pre.textContent = snippet;
    }

    inputs.forEach((i) => i.addEventListener("input", updatePreview));
    updatePreview();

    const openModal = () => {
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
    };
    const closeModal = () => {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    };

    document.getElementById("btnOpenTemplate").onclick = openModal;
    document.getElementById("btnCloseModal").onclick = closeModal;
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("open")) closeModal();
    });
    document.getElementById("btnCopyTpl").onclick = () => copyText(pre.textContent, "已复制项目模板，直接粘贴到 data/projects.js 即可！");
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderProfile();
    renderFilters();
    renderProjects();
    initMiniCar();
    initTemplateModal();

    document.getElementById("projectSearch").addEventListener("input", (e) => {
      currentQuery = e.target.value;
      renderProjects();
    });
  });
})();
