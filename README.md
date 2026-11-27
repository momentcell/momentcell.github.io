# Sunshine · 个人硬件与工程项目网站

访问线上站点：**https://momentcell.github.io/**

## 本地预览
直接双击 `preview.bat`（自动选择空闲端口并打开浏览器），或直接双击 `index.html`。

## 自己如何新增新项目（仅限本人在本地修改 `data/projects.js` 后推送）
复制下面这段模板，粘贴到 `data/projects.js` 的 `PROJECTS_DATA` 数组中，改好文字后 `git add . && git commit -m "add project" && git push` 即可自动更新线上网站：

```js
{
  id: "my-new-project",
  featured: false,
  title: "我的新项目标题",
  subtitle: "一句话副标题",
  category: "嵌入式与控制",
  status: "已完成",
  year: "2026",
  cover: "assets/img/你的图片.jpg", // 没有图片可留空 ""
  customUrl: "",                    // 普通项目留空自动生成详情页；有专属页填 "projects/xxx/index.html"
  repoUrl: "https://github.com/momentcell",
  tags: ["STM32", "硬件", "小点子"],
  highlights: [
    { label: "核心芯片", value: "STM32F103" },
    { label: "状态", value: "已实测" }
  ],
  summary: "首页卡片上显示的简短介绍。",
  overview: "详情页里的完整项目背景与设计思路。",
  architecture: ["设计要点 1", "设计要点 2"],
  challenges: [
    { problem: "踩过的坑", solution: "最后怎么解决的" }
  ],
  bom: [
    { part: "核心器件", spec: "型号参数", note: "备注" }
  ]
},
```
