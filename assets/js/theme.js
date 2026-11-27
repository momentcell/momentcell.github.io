/**
 * Sunshine Studio 双主题控制器（默认暖阳白昼 light，支持一键切壁炉暖夜 dark）
 */
(function () {
  const STORAGE_KEY = "sunshine-studio-theme";

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (_) {}

    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      const isDark = theme === "dark";
      btn.setAttribute("aria-label", isDark ? "切换到暖阳浅色模式" : "切换到壁炉暗色模式");
      btn.title = isDark ? "切换到暖阳浅色模式" : "切换到壁炉暗色模式";
      btn.innerHTML = isDark ? "☀️" : "🌙";
    });

    window.dispatchEvent(new CustomEvent("sunshine:themechange", { detail: { theme } }));
  }

  // 默认治愈暖阳浅色，除非用户主动切过暗色
  let initial = "light";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") initial = saved;
  } catch (_) {}

  document.documentElement.setAttribute("data-theme", initial);

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(initial);
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme") || "light";
        applyTheme(cur === "dark" ? "light" : "dark");
      });
    });
  });

  window.SunshineTheme = {
    get: () => document.documentElement.getAttribute("data-theme") || "light",
    set: applyTheme
  };
})();
