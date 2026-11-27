/**
 * 通用项目详情页渲染器 (project.html?id=xxx)
 * 供未来新增到 data/projects.js 中的任何项目自动复用
 */
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("detailRoot");
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const projects = window.PROJECTS_DATA || [];
    const p = projects.find((item) => item.id === id) || projects[1] || projects[0];

    if (!p) {
      root.innerHTML = `<div class="card"><h2>未找到该项目</h2><a href="index.html" class="btn btn-primary">返回首页</a></div>`;
      return;
    }

    if (p.customUrl) {
      window.location.replace(p.customUrl);
      return;
    }

    document.title = `${p.title} — Sunshine`;

    root.innerHTML = `
      <div class="card" style="margin-bottom:20px;">
        <div class="project-meta" style="margin-bottom:10px;">
          <span class="pill pill-warm">${p.category}</span>
          <span class="pill pill-sage">${p.status}</span>
          <span class="pill">${p.year}</span>
        </div>
        <h1 class="hero-title" style="margin-top:8px;">${p.title}</h1>
        <p class="hero-subtitle">${p.subtitle || p.summary}</p>
        <div class="tag-row" style="margin-top:14px;">
          ${(p.tags || []).map((t) => `<span class="tag">${t}</span>`).join("")}
        </div>
        ${(p.repoUrl || p.downloadUrl) ? `
        <div class="hero-cta" style="margin-top:16px;">
          ${p.repoUrl ? `<a href="${p.repoUrl}" target="_blank" rel="noopener" class="btn btn-sm btn-primary">在线查看源码 →</a>` : ""}
          ${p.downloadUrl ? `<a href="${p.downloadUrl}" download class="btn btn-sm btn-soft">打包下载完整资料</a>` : ""}
        </div>` : ""}
        <div class="highlights-grid" style="margin-top:18px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">
          ${(p.highlights || []).map((h) => `<div class="highlight-chip"><div class="k">${h.label}</div><div class="v">${h.value}</div></div>`).join("")}
        </div>
      </div>

      <div class="lab-grid-equal" style="margin-bottom:20px;">
        <div class="card">
          <h2 style="margin:0 0 10px;font-size:1.15rem;">项目概述</h2>
          <p style="margin:0;color:var(--text-secondary);font-size:0.92rem;">${p.overview || p.summary}</p>
        </div>
        <div class="card">
          <h2 style="margin:0 0 10px;font-size:1.15rem;">核心设计要点</h2>
          <ul class="skill-list">
            ${(p.architecture || []).map((a) => `<li>${a}</li>`).join("")}
          </ul>
        </div>
      </div>

      ${(p.challenges && p.challenges.length) ? `
      <div class="card" style="margin-bottom:20px;">
        <h2 style="margin:0 0 14px;font-size:1.15rem;">工程难点与排查复盘</h2>
        <div class="story-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));">
          ${p.challenges.map((c, i) => `
            <div class="story-card">
              <span class="pill pill-coral">难点 #${i + 1}</span>
              <h4>${c.problem}</h4>
              <p><strong>解决：</strong>${c.solution}</p>
            </div>`).join("")}
        </div>
      </div>` : ""}

      ${(p.bom && p.bom.length) ? `
      <div class="card">
        <h2 style="margin:0 0 12px;font-size:1.15rem;">关键器件 / 模块清单</h2>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr><th>名称</th><th>规格 / 说明</th><th>备注</th></tr></thead>
            <tbody>
              ${p.bom.map((b) => `<tr><td><strong>${b.part}</strong></td><td>${b.spec}</td><td>${b.note || "-"}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>` : ""}
    `;
  });
})();
