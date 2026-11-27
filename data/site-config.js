/**
 * ============================================================================
 * Sunshine 个人网站全局配置文件（谦虚真诚 · 嵌入式新手小点子风格）
 * 修改本文件即可随时更新昵称、简介、邮箱、GitHub 链接、学习清单与记录
 * ============================================================================
 */
window.SITE_CONFIG = {
  brand: {
    name: "Sunshine",
    monogram: "S",
    role: "嵌入式新手 · 爱折腾奇思妙想的 Idea 记录者",
    tagline: "刚踏入嵌入式与硬件世界的新手，带着许多好奇心与小点子，边学边踩坑，认真记下每一次让电路板和代码顺利跑起来的温暖瞬间。",
    location: "Sunshine's Learning Desk",
    status: "嵌入式学习中 · 持续把脑海里的小点子做成小作品",
    email: "2486989147a@gmail.com",
    githubUrl: "https://github.com/momentcell",
    githubHandle: "@momentcell",
    heroImage: "assets/img/studio-hero.jpg",
    copyrightYear: "2026"
  },

  metrics: [
    { value: "500 Hz", label: "姿态内环学习实践" },
    { value: "3600 级", label: "20kHz 细化 PWM 尝试" },
    { value: "30 cm", label: "下台阶防摔实验" }
  ],

  skills: [
    {
      category: "正在学习的嵌入式基础",
      icon: "cpu",
      items: ["STM32F103 入门开发", "定时器中断与优先级理解", "软件 I2C / SPI / 串口基础", "编码器测速实践", "基础供电与防掉压排查"]
    },
    {
      category: "控制算法边学边试",
      icon: "wave",
      items: ["串级 PID 调参入门", "互补滤波姿态解算", "陀螺仪角速度阻尼尝试", "死区补偿与防积分饱和", "简单的跌落状态机思路"]
    },
    {
      category: "硬件上手与调试工具",
      icon: "board",
      items: ["看懂基础 PCB 原理图", "TB6612FNG 电机驱动接线", "MPU6050 传感器模块使用", "NRF24L01 无线遥控通信", "正点原子 XCOM 串口调参"]
    },
    {
      category: "记录与想法实现",
      icon: "spark",
      items: ["把思路做成可视化小动画", "整理入门友好的笔记", "Git 与 GitHub Pages 建站", "把踩过的坑写成复盘", "持续收集新的硬件 Idea"]
    }
  ],

  timeline: [
    {
      date: "2026 · 近期折腾",
      title: "尝试给 STM32 平衡小车加上 30cm 下台阶稳姿思路，并搭起个人小站",
      desc: "从零开始排查低速晃动、速度环滞后、电池欠压闪屏等问题，把学习过程和仿真动画整理进这个小站，方便自己复盘，也希望能帮到同为新手的朋友。"
    },
    {
      date: "2026 · 调参踩坑",
      title: "一点点把平衡车从“原地乱抖”调到相对顺滑",
      desc: "试着打开 MPU6050 内部滤波、把 PWM 细分到 3600 级、改用 40ms 滑动窗口测速，还学着给串口加上了正点原子 XCOM 热调参，省去了反复烧录的麻烦。"
    },
    {
      date: "2026 · 新手启程",
      title: "点亮第一块 STM32，开始把脑海里的硬件小点子记下来",
      desc: "作为一个嵌入式新手，很多知识都还在慢慢补课中，希望一步一个脚印，把每一个小小的 Idea 真正动手做出来。"
    }
  ]
};
