/**
 * ============================================================================
 * Sunshine 个人项目仓库数据库
 * 以后每完成一个新小作品，只需在 PROJECTS_DATA 数组里新增一条对象，
 * 首页卡片、分类筛选、关键字搜索以及详情页 (project.html?id=xxx) 会自动生成。
 * ============================================================================
 */
window.PROJECTS_DATA = [
  {
    id: "stm32-balance-car",
    featured: true,
    title: "STM32 两轮平衡小车 · 减晃优化与 30cm 下台阶稳姿实验",
    subtitle: "一个嵌入式新手边学边改的第一个完整小作品：记录从原地晃动到相对丝滑、并尝试下 30cm 台阶防摔的全过程",
    category: "嵌入式与控制",
    status: "学习实战 · 含交互演示",
    year: "2026",
    cover: "assets/img/balance-car-hero.jpg",
    customUrl: "projects/balance-car/index.html",
    repoUrl: "https://github.com/momentcell/momentcell.github.io",
    tags: ["STM32F103", "串级 PID", "MPU6050", "互补滤波", "30cm下台阶", "NRF24L01", "XCOM调参"],
    highlights: [
      { label: "控制周期", value: "500Hz / 100Hz" },
      { label: "PWM 分辨率", value: "20kHz · 3600级" },
      { label: "小实验目标", value: "30cm 下台阶稳姿" },
      { label: "测速改进", value: "91ms → 35ms" }
    ],
    summary: "在开源 STM32 平衡车模板基础上，带着“想让车更稳一点、还能下个 30cm 小台阶”的想法一步步折腾出来的小项目。试着开启了 MPU6050 42Hz 滤波、细化 3600 级 PWM 与平滑死区、改用 40ms 滑窗测速，并写了一个简单的三态跌落恢复状态机（GROUND → AIRBORNE → LANDING），把整个原理做成了入门也能看懂的互动动画笔记。"
  },
  {
    id: "xcom-pid-tuner-protocol",
    featured: false,
    title: "正点原子 XCOM 串口在线调参小工具（USART2）",
    subtitle: "为了少拔几次 ST-Link 写的小脚本协议：支持单行改多个 PID 参数与零点微调",
    category: "工具与通信",
    status: "已在小车上使用",
    year: "2026",
    cover: "",
    customUrl: "",
    repoUrl: "https://github.com/momentcell/momentcell.github.io",
    tags: ["USART2", "C99 状态机", "XCOM", "串口调参", "新手友好"],
    highlights: [
      { label: "解析方式", value: "中断双协议状态机" },
      { label: "可调参数", value: "14 项实时微调" },
      { label: "波特率", value: "9600 bps" },
      { label: "防踩坑", value: "静态缓冲防溢栈" }
    ],
    summary: "调 PID 时每次改一个小数都要重新编译烧录太费时间，于是试着在 USART2 串口里加了一套简单的文本命令解析（如 akp=4.8 akd=2.8 off=2.5 zero=3.0），配合正点原子 XCOM 就能边测边改，非常适合新手上手调参。",
    overview: "初学 PID 调参时最头疼的就是反复改代码重烧。这个小模块用不到 200 行简单的 C 代码，让电脑上的正点原子 XCOM 串口助手直接变成实时调参小控制台。",
    architecture: [
      "USART2 中断双模识别：保留原本 '[' 开头的数据包，同时支持普通换行文本命令。",
      "把 printf 的缓冲数组改成 static，避免中断嵌套时把 STM32 原本 1KB 的小栈挤爆。",
      "支持一行里用空格分隔同时改几个参数，每次修改立刻回显确认，方便核对。"
    ],
    challenges: [
      {
        problem: "一开始串口不停打印数据把主循环拖慢了，导致遥控有点卡顿",
        solution: "默认关闭持续刷屏（plot=0），需要看数据时再发 plot=1 按 60ms 节拍慢速打印。"
      },
      {
        problem: "发现 PA9/PA10 (USART1) 已经被超声波模块占用了，差点接错线",
        solution: "把调参串口统一放到空闲的 USART2 (PA2/PA3)，并把它的中断优先级放低，不打扰平衡控制。"
      }
    ],
    bom: [
      { part: "STM32F103C8T6", spec: "USART2 (PA2 TX / PA3 RX)", note: "9600 8N1" },
      { part: "USB 转 TTL 模块", spec: "CH340 / CP2102", note: "TX/RX 交叉接并共地" },
      { part: "正点原子 XCOM", spec: "串口调试助手", note: "记得勾选发送新行" }
    ]
  },
  {
    id: "next-hardware-project",
    featured: false,
    title: "下一个奇思妙想预留位（Idea 笔记本）",
    subtitle: "留给未来想做的小玩意：编辑 data/projects.js 就能随时上架新作品",
    category: "想法与规划",
    status: "构思中",
    year: "2026+",
    cover: "",
    customUrl: "",
    repoUrl: "https://github.com/momentcell/momentcell.github.io",
    tags: ["奇思妙想", "新手成长", "持续更新"],
    highlights: [
      { label: "新增方式", value: "复制模板粘贴" },
      { label: "托管平台", value: "GitHub Pages" },
      { label: "目标", value: "保持好奇与动手" }
    ],
    summary: "这里先留一个空位，记录我之后冒出来的嵌入式小点子——也许是一个桌面小摆件、一个小传感器玩具，或者更有趣的机器人尝试。点首页右上角“+ 新增项目模板”就能快速添进来。",
    overview: "这个个人网站特意做成了纯静态数据驱动，不需要复杂的前端工具链。以后每实现一个小点子，在 data/projects.js 里加一段小记录就可以永久存档。",
    architecture: [
      "在 data/projects.js 的 PROJECTS_DATA 里追加一个新的项目对象。",
      "把拍好的小作品照片放到 assets/img/ 并在 cover 字段写上路径。",
      "如果只是图文记录直接复用通用详情页；想做互动演示就单独放一个 HTML 到 projects/ 目录。"
    ],
    challenges: [
      {
        problem: "作为新手怎么把学习过程长期沉淀下来？",
        solution: "每次把踩过的坑、画过的草图和调通的参数都存进这个小站，回头看就能看到自己一点点的进步。"
      }
    ],
    bom: [
      { part: "data/site-config.js", spec: "个人名片与学习清单", note: "随时更新成长记录" },
      { part: "data/projects.js", spec: "项目小仓库", note: "收纳每一个实现的 Idea" }
    ]
  }
];
