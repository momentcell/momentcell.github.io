# Sunshine · 个人硬件与工程项目网站

一套**零构建、零外部依赖、治愈暖色调**的个人项目作品集网站，内置可独立交付的 **STM32 自平衡小车 & 30cm 下台阶稳姿系统（零闪烁 60fps 交互仿真页）**。

## 1. 一键本地预览
双击本目录下的 **`preview.bat`**（或在终端运行 `python -m http.server 8080`），浏览器会自动打开 `http://127.0.0.1:8080/`。

## 2. 如何自定义个人信息与添加新项目
- **修改个人名片 / GitHub 链接 / 技能 / 经历**：编辑 `data/site-config.js`。
- **往个人网站里存新项目**：
  1. 在首页右上角点击 **“+ 新增项目模板”**，填好标题、分类、标签与简介后点击复制；
  2. 粘贴到 `data/projects.js` 的 `PROJECTS_DATA` 数组中保存；
  3. 刷新页面即可自动出现在首页项目仓库并生成专属详情页（`project.html?id=...`）。

## 3. 5 步免费部署到 GitHub Pages（永久公网访问）
1. 登录 GitHub，点击右上角 `+` → `New repository`；
2. 仓库名填 **`<你的GitHub用户名>.github.io`**（例如用户名是 `sunshine-dev`，就填 `sunshine-dev.github.io`），勾选 Public 后创建；
3. 在 `portfolio-site` 目录打开终端执行：
   ```bash
   git init
   git add .
   git commit -m "Initial Sunshine portfolio & STM32 balance car showcase"
   git branch -M main
   git remote add origin https://github.com/<你的GitHub用户名>/<你的GitHub用户名>.github.io.git
   git push -u origin main
   ```
4. 打开该仓库的 **Settings → Pages**，在 `Build and deployment` 中选择 `Deploy from a branch`，分支选 **`main`**、目录选 **`/ (root)`**，点击 **Save**；
5. 等待约 1 分钟，访问 `https://<你的GitHub用户名>.github.io` 即可向任何人分享你的个人网站与平衡小车交互页！
