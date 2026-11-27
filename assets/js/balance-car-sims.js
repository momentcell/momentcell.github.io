/**
 * ============================================================================
 * STM32 平衡小车 5 大零闪烁 60fps 交互仿真模块 (balance-car-sims.js)
 * 依赖: canvas-engine.js, theme.js
 * ============================================================================
 */
(function () {
  const { createManagedCanvas, drawGrid, drawRoundRect, drawLegend } = window.CanvasEngine;

  // ==================== Toast 工具 ====================
  function showToast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 1900);
  }
  window.showSunshineToast = showToast;

  // ==================== 1. 软硬件架构点击检查器 ====================
  const HW_INFO = {
    power: {
      title: "电源树：锂电池 + 开关 + 5V / 3.3V 双级稳压",
      file: "Objects/小车PCB引脚原理图.pdf",
      pins: "BAT1 (XH2.54-2P) → 开关 U9 → VM (TB6612) & 5V (U7/U8) → 3.3V (U6/U4)",
      points: [
        "电池直供 TB6612FNG 电机驱动 VM，同时经 5V 降压与 3.3V LDO 为 STM32、MPU6050、OLED 与 NRF24L01 供电。",
        "支持 2S (7.4V~8.4V) 或 3S (11.1V~12.6V) 高倍率锂电池；底板无板载充电电路，需拔出电池外部平衡充。"
      ],
      tip: "安全红线：TB6612 与 AMS1117 耐压上限 15V，严禁接 4S (16.8V)；当电池掉压低于 6.3V 时会引发欠压反复重启与 OLED 闪屏。"
    },
    mpu: {
      title: "MPU6050 六轴 IMU 姿态传感器",
      file: "Hardware/MPU6050.c · Hardware/MyI2C.c",
      pins: "PB10 = M-SCL · PB11 = M-SDA · 软件 I2C (~350kHz) · 地址 0xD0",
      points: [
        "配置 CONFIG=0x03 开启 42Hz 硬件数字低通滤波，先在传感器芯片内滤除齿轮箱与电机高频抖动。",
        "采样率 SMPLRT_DIV=0x01 锁定 500Hz，与 2ms 角度环严格同步；加速度保持 ±16g 量程防止 30cm 落地瞬间饱和。"
      ],
      tip: "优化点：软件 I2C 改用 BSRR/BRR 寄存器直操 + 轻量 __nop() 延时，14 字节连读仅约 220μs，绝不拖慢 1ms 实时中断。"
    },
    encoder: {
      title: "双路霍尔正交编码器 (TIM3 / TIM4)",
      file: "Hardware/Encoder.c",
      pins: "左轮 TIM3: PA6(E1A) / PA7(E1B) · 右轮 TIM4: PB6(E2A) / PB7(E2B)",
      points: [
        "STM32 硬件定时器正交解码 4 倍频：磁铁 44 脉冲/圈 × 9.27666 减速比 = 输出轴 408.17 脉冲/圈。",
        "右电机对称安装，TIM4 通过 Rising/Falling 自动硬件反相，无需软件额外判断方向。"
      ],
      tip: "优化点：每 10ms 读取增量并维护 4 格（40ms）环形滑动窗口求和，将测速滞后压至 ~35ms 同时消除慢速脉冲台阶抖动。"
    },
    ur: {
      title: "超声波避障模块 (HC-SR04)",
      file: "Hardware/UR.c",
      pins: "PA9 = Trig (推挽输出) · PA10 = Echo (下拉输入)",
      points: [
        "发出 15μs 触发脉冲并测回波宽度，配合 4 点滑动均值滤波；自动模式下 ≤20cm 自动后退→停稳→原地转弯。",
        "在主循环中按 60ms 节拍非阻塞更新，并缩短无回波超时时间，避免拖慢 NRF24L01 和串口响应。"
      ],
      tip: "引脚注意：PA9/PA10 与 USART1 复用，因此正点原子 XCOM 调参统一放在独立的 USART2 (PA2/PA3)，完全不冲突。"
    },
    key: {
      title: "按键扫描与 LED 状态指示",
      file: "Hardware/Key.c · Hardware/LED.c",
      pins: "K1=PB1 · K2=PB0 · K3=PA5 · K4=PA4 · 运行灯=PC13 · 警报灯=PA11",
      points: [
        "Key_Tick() 位于 1ms 中断内，每 20ms 状态机消抖、松手触发，手感清脆无误触。",
        "K1 启停平衡（自动清零积分与历史状态）；K2 切换自动避障模式；K3 切换避障左右转方向。"
      ],
      tip: "安全保护：正常地面倾角连续 40ms 超过 52° 自动停机；下台阶救车瞬态自动放宽至 68°，防止大倾角救车中途误切断动力。"
    },
    isr: {
      title: "TIM1 1ms 实时控制内核 (全系统最高优先级 0)",
      file: "System/Timer.c · User/main.c (TIM1_UP_IRQHandler)",
      pins: "TIM1 72MHz / 72 / 1000 = 1kHz · NVIC PreemptionPriority = 0",
      points: [
        "偶数毫秒 (2ms / 500Hz)：读取 MPU6050 → 自适应互补滤波 → 30cm 跌落状态机 → 角度内环 PD → 3600 级 PWM 输出。",
        "奇数毫秒 (10ms / 100Hz)：40ms 滑窗编码器测速 → 速度外环 PI (输出目标倾角) + 转向环 P。"
      ],
      tip: "稳定性加固：奇偶毫秒错峰彻底杜绝叠加超时；启动文件栈扩至 2KB (0x800)，OLED 右下角 OB:0 后无 '!' 即代表零超时。"
    },
    mainloop: {
      title: "main() 非阻塞业务主循环",
      file: "User/main.c",
      pins: "标志位驱动：OLED_RefreshFlag (50ms) · UR/Plot_RefreshFlag (60ms)",
      points: [
        "开机先执行 IMU_CalibrateOnBoot() 静止 160ms 自动测量浮点零漂并立即初始化倾角，实现上电即稳。",
        "主循环只处理低实时性任务：OLED 仪表盘刷新、超声波采样、NRF24L01 遥控收发与 XCOM 在线热调参。"
      ],
      tip: "小贴士：给小车上电瞬间保持机身静止约 0.2 秒，陀螺仪零漂自动校准最精准。"
    },
    motor: {
      title: "TB6612FNG 双 H 桥驱动 & 减速电机",
      file: "Hardware/PWM.c · Hardware/Motor.c",
      pins: "TIM2: PA0(PWMA) / PA1(PWMB) · 方向: PB12/13(左) · PB14/15(右)",
      points: [
        "TIM2 配置 PSC=0, ARR=3599，产生 20.000kHz 无啸叫 PWM，占空比精细度从原版 100 级跃升 36 倍至 3600 级。",
        "Motor_SetPWM_Float() 直接接收浮点百分比 -100%~+100%，与平滑死区过渡结合后原点附近完全不抽动。"
      ],
      tip: "动力建议：搭配 3S (11.1V~12.6V) 高倍率动力电池时电机扭矩比 7.4V 强 50%，下 30cm 台阶落地救车爆发力更足。"
    },
    oled: {
      title: "0.96寸 I2C OLED 实时仪表盘",
      file: "Hardware/OLED.c",
      pins: "PB8 = O-SCL · PB9 = O-SDA · 50ms 非阻塞刷新",
      points: [
        "同屏展示角度环 / 速度环 / 转向环的 P/I/D/Target、实时倾角 A、死区补偿 O、超声波距离 D。",
        "底行 M:0G / M:0A / M:0L 实时显示跌落状态机（G=地面, A=空中, L=落地恢复），串口改参立刻可见。"
      ],
      tip: "调试看盘：若 OB:0 后出现 '!' 说明定时中断曾超时；正常情况下应始终保持干净无叹号。"
    },
    comm: {
      title: "NRF24L01 2.4G 无线遥控 & USART2 XCOM 调参口",
      file: "Hardware/NRF24L01.c · Hardware/BlueSerial.c",
      pins: "NRF: PA8/PA15/PB3~5 · USART2: PA2(TX)/PA3(RX) 9600bps (优先级 2)",
      points: [
        "NRF24L01 负责手持遥控器低延迟操控（带 ±4 摇杆死区）及实时回传左右 PWM、倾角和轮速。",
        "USART2 双协议中断同时支持正点原子 XCOM 换行调参指令（akp/akd/off/skp/ski/zero/lkp/lkd/lroll/show）与方括号控件帧。"
      ],
      tip: "接线方式：USB 转 TTL 接 PA2→RXD、PA3→TXD、GND→GND，XCOM 波特率 9600 勾选“发送新行”，发 show 即回显全套参数。"
    }
  };

  function initArchInspector() {
    const nodes = document.querySelectorAll(".hw-node");
    if (!nodes.length) return;

    function selectNode(key) {
      const info = HW_INFO[key];
      if (!info) return;
      nodes.forEach((n) => n.classList.toggle("selected", n.dataset.hw === key));
      const t = document.getElementById("hwTitle");
      const f = document.getElementById("hwFileTag");
      const p = document.getElementById("hwPins");
      const d = document.getElementById("hwDesc");
      const tip = document.getElementById("hwTip");
      if (t) t.textContent = info.title;
      if (f) f.textContent = info.file;
      if (p) p.textContent = info.pins;
      if (d) d.innerHTML = info.points.map((x) => `<p style="margin:0 0 8px;">${x}</p>`).join("");
      if (tip) tip.textContent = info.tip;
    }

    nodes.forEach((n) => n.addEventListener("click", () => selectNode(n.dataset.hw)));
    selectNode("isr");
  }

  // ==================== 2. 倒立摆 & 串级 PID 实时物理实验室 ====================
  function initPidLab() {
    const carEl = document.getElementById("pidCanvas");
    const scopeEl = document.getElementById("pidScope");
    if (!carEl || !scopeEl) return null;

    const carC = createManagedCanvas(carEl);
    const scopeC = createManagedCanvas(scopeEl);

    const slAkp = document.getElementById("slAkp");
    const slAkd = document.getElementById("slAkd");
    const slSkp = document.getElementById("slSkp");
    const slSki = document.getElementById("slSki");
    const slOff = document.getElementById("slOff");
    const slSpd = document.getElementById("slSpd");
    const chkHard = document.getElementById("chkHardDeadzone");

    const sim = {
      theta: 0.05,
      omega: 0,
      x: 0,
      v: 0,
      wheelAngle: 0,
      speedInt: 0,
      targetAngDeg: 0,
      pwmPct: 0,
      slopeDeg: 0,
      fell: false,
      dragging: false,
      dragStartX: 0,
      acc: 0,
      sampleAcc: 0,
      histAngle: [],
      histTarget: [],
      histSpeed: [],
      histPwm: []
    };

    function reset() {
      sim.theta = 0.03;
      sim.omega = 0;
      sim.x = 0;
      sim.v = 0;
      sim.speedInt = 0;
      sim.targetAngDeg = 0;
      sim.pwmPct = 0;
      sim.fell = false;
      sim.histAngle.length = 0;
      sim.histTarget.length = 0;
      sim.histSpeed.length = 0;
      sim.histPwm.length = 0;
    }

    function syncLabels() {
      document.getElementById("valAkp").textContent = (+slAkp.value).toFixed(1);
      document.getElementById("valAkd").textContent = (+slAkd.value).toFixed(1);
      document.getElementById("valSkp").textContent = (+slSkp.value).toFixed(1);
      document.getElementById("valSki").textContent = (+slSki.value).toFixed(3);
      document.getElementById("valOff").textContent = (+slOff.value).toFixed(1);
      document.getElementById("valSpd").textContent = (+slSpd.value).toFixed(1) + " rps";
    }
    [slAkp, slAkd, slSkp, slSki, slOff, slSpd].forEach((s) => s.addEventListener("input", syncLabels));
    syncLabels();

    document.getElementById("btnPushFwd").onclick = () => {
      if (sim.fell) reset();
      sim.theta += (14 * Math.PI) / 180;
      sim.omega += 1.25;
    };
    document.getElementById("btnPushBack").onclick = () => {
      if (sim.fell) reset();
      sim.theta -= (14 * Math.PI) / 180;
      sim.omega -= 1.25;
    };
    document.getElementById("btnSlope").onclick = (e) => {
      sim.slopeDeg = sim.slopeDeg === 0 ? -10 : 0;
      e.target.textContent = sim.slopeDeg === 0 ? "下坡模式: 关" : "下坡模式: -10° 斜坡";
      if (sim.fell) reset();
    };
    document.getElementById("btnNoSpeed").onclick = (e) => {
      const turningOff = parseFloat(slSkp.value) > 0.05;
      slSkp.value = turningOff ? "0" : "2.2";
      slSki.value = turningOff ? "0" : "0.012";
      e.target.textContent = turningOff ? "恢复速度外环" : "体验: 关速度外环";
      syncLabels();
    };
    document.getElementById("btnResetPid").onclick = () => {
      slAkp.value = "4.8";
      slAkd.value = "2.8";
      slSkp.value = "2.2";
      slSki.value = "0.012";
      slOff.value = "2.0";
      slSpd.value = "0.0";
      chkHard.checked = false;
      sim.slopeDeg = 0;
      document.getElementById("btnSlope").textContent = "下坡模式: 关";
      document.getElementById("btnNoSpeed").textContent = "体验: 关速度外环";
      syncLabels();
      reset();
    };

    // 鼠标/触摸直接拖拽车身互动
    carEl.addEventListener("pointerdown", (e) => {
      sim.dragging = true;
      sim.dragStartX = e.clientX;
      if (sim.fell) reset();
      carEl.setPointerCapture(e.pointerId);
    });
    carEl.addEventListener("pointermove", (e) => {
      if (!sim.dragging) return;
      const dx = e.clientX - sim.dragStartX;
      sim.dragStartX = e.clientX;
      sim.theta = Math.max(-0.75, Math.min(0.75, sim.theta + dx * 0.0055));
      sim.omega = dx * 0.05;
    });
    const endDrag = () => { sim.dragging = false; };
    carEl.addEventListener("pointerup", endDrag);
    carEl.addEventListener("pointercancel", endDrag);

    function physicsSubstep(dt) {
      if (sim.fell || sim.dragging) return;
      const akp = +slAkp.value;
      const akd = +slAkd.value;
      const skp = +slSkp.value;
      const ski = +slSki.value;
      const off = +slOff.value;
      const targetSpd = +slSpd.value;

      const speedRps = sim.v / 0.204;
      const spdErr = targetSpd - speedRps;
      if (ski > 0) {
        sim.speedInt = Math.max(-900, Math.min(900, sim.speedInt + spdErr * (dt / 0.01)));
      } else {
        sim.speedInt = 0;
      }
      let targetAng = Math.max(-22, Math.min(22, skp * spdErr + ski * sim.speedInt));
      sim.targetAngDeg = targetAng;

      const angleDeg = (sim.theta * 180) / Math.PI;
      const gyroDps = (sim.omega * 180) / Math.PI;

      let kpScale = 1.0;
      if (Math.abs(angleDeg) > 8) kpScale = Math.min(1.25, 1 + (Math.abs(angleDeg) - 8) * 0.02);

      let u = akp * kpScale * (targetAng - angleDeg) - akd * (gyroDps * 0.025);
      if (chkHard.checked) {
        if (u > 0.03) u += off + 2.8;
        else if (u < -0.03) u -= off + 2.8;
        u = Math.trunc(u); // 模拟旧版 100 级截断
      } else {
        const absU = Math.abs(u);
        if (absU > 0.05) {
          const comp = absU < 1.0 ? off * ((absU - 0.05) / 0.95) : off;
          u += u > 0 ? comp : -comp;
        }
      }
      u = Math.max(-100, Math.min(100, u));
      sim.pwmPct = u;

      // 真实电机静摩擦死区 (~2.0%)
      let effU = u;
      if (Math.abs(effU) < 2.0) effU = 0;
      else effU -= Math.sign(effU) * 2.0;

      const slopeRad = (sim.slopeDeg * Math.PI) / 180;
      const wheelAccel = -effU * 0.145 - sim.v * 1.45 - Math.sin(slopeRad) * 9.81 * 0.55;
      const g = 9.81, L = 0.14;
      const alpha = (g / L) * Math.sin(sim.theta) - (wheelAccel / L) * Math.cos(sim.theta) - sim.omega * 0.32;

      sim.v += wheelAccel * dt;
      sim.x += sim.v * dt;
      sim.omega += alpha * dt;
      sim.theta += sim.omega * dt;
      sim.wheelAngle += (sim.v / 0.0325) * dt;

      if (Math.abs((sim.theta * 180) / Math.PI) > 54) {
        sim.fell = true;
      }
    }

    function updateAndDraw(dt) {
      if (!carC.visible && !scopeC.visible) return;
      // 固定步长物理积分，60/120/144Hz 屏幕表现完全一致且丝滑
      sim.acc += Math.min(0.05, dt);
      const step = 1 / 240;
      while (sim.acc >= step) {
        physicsSubstep(step);
        sim.acc -= step;
      }

      sim.sampleAcc += dt;
      if (sim.sampleAcc >= 1 / 60) {
        sim.sampleAcc = 0;
        sim.histAngle.push((sim.theta * 180) / Math.PI);
        sim.histTarget.push(sim.targetAngDeg);
        sim.histSpeed.push(sim.v / 0.204);
        sim.histPwm.push(sim.pwmPct);
        if (sim.histAngle.length > 240) {
          sim.histAngle.shift();
          sim.histTarget.shift();
          sim.histSpeed.shift();
          sim.histPwm.shift();
        }
      }

      // ---- 绘制物理小车 ----
      const p = carC.beginFrame();
      const { ctx, w, h } = carC;
      drawGrid(ctx, w, h, 36, 36, p.grid);

      const slopeRad = (sim.slopeDeg * Math.PI) / 180;
      const cx = w * 0.5;
      const groundY = h * 0.79;

      ctx.save();
      ctx.translate(cx, groundY);
      ctx.rotate(-slopeRad);

      // 地面柔和投影带
      ctx.fillStyle = p.subtle;
      ctx.fillRect(-w, 0, w * 2, h);
      ctx.strokeStyle = p.axis;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.lineTo(w, 0);
      ctx.stroke();

      // 滚动地面刻度
      const scrollPx = ((sim.x * 160) % 44 + 44) % 44;
      ctx.strokeStyle = p.muted;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.4;
      for (let gx = -w; gx < w; gx += 44) {
        ctx.beginPath();
        ctx.moveTo(gx - scrollPx, 0);
        ctx.lineTo(gx - scrollPx - 10, 12);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const R = 26;
      ctx.save();
      ctx.translate(0, -R);

      // 目标倾角虚线基准
      ctx.save();
      ctx.rotate((sim.targetAngDeg * Math.PI) / 180 + slopeRad);
      ctx.strokeStyle = p.c3;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -138);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 车身主体（双层结构）
      ctx.save();
      ctx.rotate(sim.theta + slopeRad);

      // 车身阴影光晕
      drawRoundRect(ctx, -17, -118, 34, 112, 8);
      ctx.fillStyle = p.card;
      ctx.fill();
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = sim.fell ? p.c4 : p.c1;
      ctx.stroke();

      // 内部电池包 (暖鼠尾草绿)
      drawRoundRect(ctx, -12, -52, 24, 34, 4);
      ctx.fillStyle = p.c2;
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.c2;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // 顶层控制板 + OLED 指示条
      drawRoundRect(ctx, -13, -108, 26, 12, 3);
      ctx.fillStyle = p.c3;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;

      // 重心 CG 标记
      ctx.beginPath();
      ctx.arc(0, -72, 5, 0, Math.PI * 2);
      ctx.fillStyle = p.c1;
      ctx.fill();
      ctx.strokeStyle = p.card;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // 车轮
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fillStyle = p.card;
      ctx.fill();
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = p.text;
      ctx.stroke();

      // 轮辐
      ctx.strokeStyle = p.c3;
      ctx.lineWidth = 2.2;
      for (let i = 0; i < 6; i++) {
        const a = sim.wheelAngle + (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * (R - 5), Math.sin(a) * (R - 5));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = p.c1;
      ctx.fill();

      // 推力方向矢量箭头
      if (Math.abs(sim.pwmPct) > 2.5 && !sim.fell) {
        const dir = sim.pwmPct < 0 ? 1 : -1;
        const len = Math.min(72, Math.abs(sim.pwmPct) * 0.95);
        ctx.strokeStyle = p.c4;
        ctx.fillStyle = p.c4;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(0, R + 14);
        ctx.lineTo(dir * len, R + 14);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(dir * (len + 7), R + 14);
        ctx.lineTo(dir * (len - 2), R + 9);
        ctx.lineTo(dir * (len - 2), R + 19);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
      ctx.restore();

      // 顶角提示
      ctx.font = '600 12px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = p.muted;
      ctx.fillText("支持直接用鼠标按住车身左右拖拽 · 虚线为速度外环目标倾角", 14, 22);
      if (sim.fell) {
        ctx.fillStyle = p.c4;
        ctx.font = '700 13px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText("倾角超 54° 触发倒地停机保护 — 点击「重置」重新立起", 14, 44);
      }

      // ---- 绘制 4 通道示波器 ----
      const ps = scopeC.beginFrame();
      const sctx = scopeC.ctx;
      drawGrid(sctx, scopeC.w, scopeC.h, 48, 32, ps.grid);
      const midY = scopeC.h * 0.56;
      sctx.strokeStyle = ps.axis;
      sctx.lineWidth = 1.2;
      sctx.beginPath();
      sctx.moveTo(0, midY);
      sctx.lineTo(scopeC.w, midY);
      sctx.stroke();

      const drawLine = (arr, scale, color, lw, dash) => {
        if (arr.length < 2) return;
        sctx.save();
        sctx.strokeStyle = color;
        sctx.lineWidth = lw;
        sctx.setLineDash(dash || []);
        sctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
          const px = (i / 240) * scopeC.w;
          const py = midY - arr[i] * scale;
          if (i === 0) sctx.moveTo(px, py);
          else sctx.lineTo(px, py);
        }
        sctx.stroke();
        sctx.restore();
      };

      drawLine(sim.histPwm, 0.45, ps.c4, 1.4, [3, 3]);
      drawLine(sim.histSpeed, 14, ps.c2, 1.9);
      drawLine(sim.histTarget, 2.0, ps.c3, 1.8, [5, 3]);
      drawLine(sim.histAngle, 2.0, ps.c1, 2.5);

      drawLegend(sctx, [
        { label: "倾角 Angle", color: ps.c1 },
        { label: "目标倾角 Target", color: ps.c3, dash: [5, 3] },
        { label: "轮速 Speed", color: ps.c2 },
        { label: "PWM", color: ps.c4, dash: [3, 3] }
      ], 12, 18);

      // 更新数字遥测
      document.getElementById("roAngle").textContent = ((sim.theta * 180) / Math.PI).toFixed(1) + "°";
      document.getElementById("roTarget").textContent = sim.targetAngDeg.toFixed(1) + "°";
      document.getElementById("roSpeed").textContent = (sim.v / 0.204).toFixed(2) + " rps";
      document.getElementById("roPwm").textContent = Math.round(sim.pwmPct) + "%";
    }

    return { updateAndDraw };
  }

  // ==================== 3. 姿态解算 & 自适应互补滤波示波器 ====================
  function initImuLab() {
    const el = document.getElementById("imuCanvas");
    if (!el) return null;
    const mc = createManagedCanvas(el);

    const sim = {
      mode: "normal",
      t: 0,
      tickAcc: 0,
      gyroDrift: 0,
      fusedCur: 0,
      accG: 1.0,
      alpha: 0.0015,
      strat: "稳态互补融合",
      trueArr: [],
      accArr: [],
      gyroArr: [],
      fusedArr: []
    };

    const btns = document.querySelectorAll(".imu-mode-btn");
    btns.forEach((b) => {
      b.addEventListener("click", () => {
        sim.mode = b.dataset.mode;
        btns.forEach((x) => {
          x.classList.remove("btn-primary");
        });
        b.classList.add("btn-primary");
      });
    });

    function step() {
      sim.t += 0.04;
      const t = sim.t;
      const trueA = 6.5 * Math.sin(t * 1.35) + 2.2 * Math.sin(t * 2.9);
      const prevA = 6.5 * Math.sin((t - 0.04) * 1.35) + 2.2 * Math.sin((t - 0.04) * 2.9);
      const dTrue = trueA - prevA;

      let accG = 1.0 + (Math.random() - 0.5) * 0.035;
      let accA = trueA + (Math.random() - 0.5) * 3.6;

      if (sim.mode === "accel") {
        const sgn = Math.sin(t * 2.3) >= 0 ? 1 : -1;
        accG = 1.12 + Math.abs(Math.sin(t * 2.3)) * 0.22;
        accA = trueA + sgn * 15 + (Math.random() - 0.5) * 4.5;
      } else if (sim.mode === "freefall") {
        accG = 0.08 + Math.random() * 0.14;
        accA = (Math.random() - 0.5) * 76;
      } else if (sim.mode === "impact") {
        const hit = Math.sin(t * 3.6) > 0.58;
        accG = hit ? 4.8 + Math.random() * 3.8 : 1.02 + (Math.random() - 0.5) * 0.08;
        accA = hit ? trueA + (Math.random() > 0.5 ? 36 : -36) : trueA + (Math.random() - 0.5) * 5;
      }

      sim.gyroDrift += 0.042;
      if (sim.gyroDrift > 15) sim.gyroDrift = 0;
      const gyroOnly = trueA + sim.gyroDrift;

      const accErr = Math.abs(accG - 1.0);
      let alpha = 0;
      let strat = "α=0 纯陀螺仪抗干扰";
      if (accErr <= 0.06) {
        alpha = 0.0015;
        strat = "稳态轻权重融合";
      } else if (accErr < 0.20) {
        alpha = (0.0015 * (0.20 - accErr)) / 0.14;
        strat = "扰动线性衰减";
      }

      const visAlpha = alpha * 24;
      if (sim.fusedArr.length === 0) sim.fusedCur = trueA;
      else sim.fusedCur = (1 - visAlpha) * (sim.fusedCur + dTrue + 0.004) + visAlpha * accA;

      sim.accG = accG;
      sim.alpha = alpha;
      sim.strat = strat;

      sim.trueArr.push(trueA);
      sim.accArr.push(Math.max(-42, Math.min(42, accA)));
      sim.gyroArr.push(gyroOnly);
      sim.fusedArr.push(sim.fusedCur);
      if (sim.trueArr.length > 180) {
        sim.trueArr.shift();
        sim.accArr.shift();
        sim.gyroArr.shift();
        sim.fusedArr.shift();
      }

      document.getElementById("imuAccG").textContent = accG.toFixed(2) + " g";
      document.getElementById("imuAlpha").textContent = alpha.toFixed(4);
      document.getElementById("imuStrategy").textContent = strat;
      document.getElementById("imuErrInfo").textContent = Math.abs(sim.fusedCur - trueA).toFixed(2) + "°";
    }

    function updateAndDraw(dt) {
      if (!mc.visible) return;
      sim.tickAcc += Math.min(0.08, dt);
      while (sim.tickAcc >= 0.04) {
        step();
        sim.tickAcc -= 0.04;
      }

      const p = mc.beginFrame();
      const { ctx, w, h } = mc;
      drawGrid(ctx, w, h, 46, 36, p.grid);

      const midY = h * 0.54;
      ctx.strokeStyle = p.axis;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();

      const plot = (arr, color, lw, dash) => {
        if (arr.length < 2) return;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
          const x = (i / 180) * w;
          const y = midY - arr[i] * 2.8;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      };

      plot(sim.accArr, p.c4, 1.35);
      plot(sim.gyroArr, p.c3, 1.8, [6, 4]);
      plot(sim.trueArr, p.muted, 1.2, [2, 3]);
      plot(sim.fusedArr, p.c1, 2.8);

      drawLegend(ctx, [
        { label: "纯加速度计 AngleAcc (易受扰)", color: p.c4, lw: 1.6 },
        { label: "纯陀螺仪 AngleGyro (会漂移)", color: p.c3, dash: [6, 4] },
        { label: "自适应融合 Angle (稳准不漂)", color: p.c1, lw: 2.8 }
      ], 14, 20);
    }

    return { updateAndDraw };
  }

  // ==================== 4. 30cm 下台阶双车慢动作对比动画 ====================
  function initDropLab() {
    const stageEl = document.getElementById("dropCanvas");
    const chartEl = document.getElementById("dropChart");
    if (!stageEl || !chartEl) return null;

    const stageC = createManagedCanvas(stageEl);
    const chartC = createManagedCanvas(chartEl);

    const anim = {
      t: 0,
      playing: true,
      speed: 0.35,
      mode: "compare"
    };

    const scrub = document.getElementById("slDropScrub");
    const scrubVal = document.getElementById("dropTimeLabel");

    document.getElementById("btnDropPlay").onclick = () => {
      anim.t = 0;
      anim.playing = true;
      document.getElementById("btnDropPause").textContent = "暂停";
    };
    document.getElementById("btnDropPause").onclick = (e) => {
      anim.playing = !anim.playing;
      e.target.textContent = anim.playing ? "暂停" : "继续";
    };
    document.getElementById("btnDropSlow").onclick = (e) => {
      anim.speed = anim.speed < 0.5 ? 1.0 : 0.35;
      e.target.textContent = anim.speed < 0.5 ? "倍速: 0.35x 慢动作" : "倍速: 1.0x 原速";
    };
    document.getElementById("selDropMode").onchange = (e) => {
      anim.mode = e.target.value;
      anim.t = 0;
      anim.playing = true;
    };
    scrub.addEventListener("input", () => {
      anim.t = parseFloat(scrub.value);
      anim.playing = false;
      document.getElementById("btnDropPause").textContent = "继续";
    });

    function evalSmart(t) {
      let x, y, angDeg, accG, state, spin;
      if (t < 0.45) {
        x = 0.06 + t * 0.54;
        y = 0.30;
        angDeg = 4.2 + Math.sin(t * 7) * 0.5;
        accG = 1.0;
        state = "G";
        spin = t * 14;
      } else if (t < 0.70) {
        const ft = t - 0.45;
        x = 0.06 + 0.45 * 0.54 + ft * 0.54;
        y = Math.max(0, 0.30 - 0.5 * 9.81 * ft * ft);
        angDeg = 4.2 + ft * 44;
        accG = ft < 0.015 ? 0.55 : 0.08;
        state = "A";
        spin = 0.45 * 14 + ft * 14;
      } else if (t < 1.15) {
        const lt = t - 0.70;
        x = 0.06 + 0.70 * 0.54 + 0.54 * lt - 0.46 * lt * lt;
        y = 0;
        if (lt < 0.14) {
          angDeg = 15.2 + 8.5 * Math.sin((lt / 0.14) * Math.PI * 0.72) * Math.exp(-lt * 3.8);
          accG = lt < 0.045 ? 6.6 * Math.exp(-lt * 52) + 1.0 : 1.06;
        } else {
          const rt = lt - 0.14;
          angDeg = 11.2 * Math.exp(-rt * 7.5) * Math.cos(rt * 11);
          accG = 1.0 + 0.12 * Math.exp(-rt * 8);
        }
        state = "L";
        spin = 0.70 * 14 + lt * 10;
      } else {
        const gt = t - 1.15;
        x = 0.06 + 0.70 * 0.54 + 0.54 * 0.45 - 0.46 * 0.45 * 0.45 + 0.045 * (1 - Math.exp(-gt * 4));
        y = 0;
        angDeg = 1.4 * Math.exp(-gt * 5) * Math.cos(gt * 9);
        accG = 1.0;
        state = "G";
        spin = 0.70 * 14 + 4.5 + gt * 0.4;
      }
      return { x, y, angDeg, accG, state, spin };
    }

    function evalNaive(t) {
      let x, y, angDeg, spin;
      if (t < 0.45) {
        x = 0.06 + t * 0.54;
        y = 0.30;
        angDeg = 4.6;
        spin = t * 14;
      } else if (t < 0.70) {
        const ft = t - 0.45;
        x = 0.06 + 0.45 * 0.54 + ft * 0.54;
        y = Math.max(0, 0.30 - 0.5 * 9.81 * ft * ft);
        angDeg = 4.6 + ft * 96;
        spin = 0.45 * 14 + ft * 56;
      } else {
        const lt = t - 0.70;
        x = 0.06 + 0.70 * 0.54 + Math.min(0.16, lt * 0.34);
        y = 0;
        angDeg = Math.min(86, 28.6 + lt * 168);
        spin = 0.45 * 14 + 0.25 * 56;
      }
      return { x, y, angDeg, spin };
    }

    function updateAndDraw(dt) {
      if (!stageC.visible && !chartC.visible) return;
      if (anim.playing) {
        anim.t += Math.min(0.05, dt) * anim.speed;
        if (anim.t > 2.2) anim.t = 0;
        scrub.value = anim.t.toFixed(2);
      }
      scrubVal.textContent = anim.t.toFixed(2) + " s";

      // ---- 绘制台阶场景 ----
      const p = stageC.beginFrame();
      const { ctx, w, h } = stageC;
      drawGrid(ctx, w, h, 40, 40, p.grid);

      const floorY = h - 38;
      const stepH = 112;
      const stepX = w * 0.36;

      // 台阶实体（暖木质平台质感）
      ctx.fillStyle = p.subtle;
      ctx.strokeStyle = p.axis;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, floorY - stepH);
      ctx.lineTo(stepX, floorY - stepH);
      ctx.lineTo(stepX, floorY);
      ctx.lineTo(w, floorY);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 30cm 高度标注
      ctx.strokeStyle = p.c3;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(stepX - 16, floorY - stepH + 4);
      ctx.lineTo(stepX - 16, floorY - 4);
      ctx.stroke();
      ctx.fillStyle = p.c3;
      ctx.font = '700 12px "JetBrains Mono", Consolas, monospace';
      ctx.fillText("30 cm", stepX - 62, floorY - stepH / 2 + 4);

      const mapX = (xm) => stepX - (0.303 - xm) * (w * 0.78);
      const mapY = (ym) => floorY - (ym / 0.30) * stepH;

      // 抛物线参考轨迹
      ctx.save();
      ctx.strokeStyle = p.c1;
      ctx.globalAlpha = 0.28;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let s = 0.45; s <= 0.70; s += 0.01) {
        const pt = evalSmart(s);
        const px = mapX(pt.x), py = mapY(pt.y) - 18;
        if (s === 0.45) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();

      const drawCar = (car, color, label, ghost) => {
        const px = mapX(car.x);
        const py = mapY(car.y);
        const R = 18;

        ctx.save();
        ctx.globalAlpha = ghost ? 0.42 : 1;
        ctx.translate(px, py - R);

        // 触地冲击波纹 + 暖金粒子
        if (!ghost && car.state === "L" && anim.t >= 0.70 && anim.t < 0.90) {
          const prog = (anim.t - 0.70) / 0.20;
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, R, prog * 54, Math.PI, Math.PI * 2);
          ctx.strokeStyle = p.c3;
          ctx.lineWidth = 2.6 * (1 - prog);
          ctx.globalAlpha = 1 - prog;
          ctx.stroke();
          ctx.restore();
        }

        // 机身
        ctx.save();
        ctx.rotate((car.angDeg * Math.PI) / 180);
        drawRoundRect(ctx, -11, -78, 22, 74, 6);
        ctx.fillStyle = p.card;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillRect(-7, -70, 14, 9);
        ctx.restore();

        // 车轮
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, Math.PI * 2);
        ctx.fillStyle = p.card;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3.2;
        ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const a = car.spin + (i * Math.PI) / 2;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * (R - 4), Math.sin(a) * (R - 4));
          ctx.stroke();
        }

        ctx.fillStyle = color;
        ctx.font = '700 12px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(label, -34, -88);
        ctx.restore();
      };

      const smart = evalSmart(anim.t);
      const naive = evalNaive(anim.t);

      if (anim.mode === "compare" || anim.mode === "naive") {
        drawCar(naive, p.c4, naive.angDeg > 60 ? "原版 PID (前栽翻车)" : "原版 PID", anim.mode === "compare");
      }
      if (anim.mode === "compare" || anim.mode === "smart") {
        drawCar(smart, p.c2, `优化三态 [${smart.state}] ${smart.angDeg.toFixed(0)}°`, false);
      }

      // 高亮当前阶段卡片
      const idx = anim.t < 0.45 ? 0 : anim.t < 0.70 ? 1 : anim.t < 0.84 ? 2 : 3;
      for (let i = 0; i < 4; i++) {
        const card = document.getElementById("phaseCard" + i);
        if (card) card.classList.toggle("active", i === idx);
      }

      // ---- 同步时间轴波形 ----
      const pc = chartC.beginFrame();
      const cctx = chartC.ctx;
      drawGrid(cctx, chartC.w, chartC.h, 52, 32, pc.grid);
      const padL = 32, padR = 14, gw = chartC.w - padL - padR;
      const tx = (s) => padL + (s / 2.2) * gw;

      // 空中与落地色块
      cctx.fillStyle = pc.c3; cctx.globalAlpha = 0.13;
      cctx.fillRect(tx(0.45), 22, tx(0.70) - tx(0.45), chartC.h - 36);
      cctx.fillStyle = pc.c2; cctx.globalAlpha = 0.13;
      cctx.fillRect(tx(0.70), 22, tx(1.15) - tx(0.70), chartC.h - 36);
      cctx.globalAlpha = 1;

      const drawCurve = (fn, color, lw) => {
        cctx.strokeStyle = color;
        cctx.lineWidth = lw;
        cctx.beginPath();
        for (let i = 0; i <= 150; i++) {
          const s = (i / 150) * 2.2;
          const x = tx(s), y = fn(evalSmart(s));
          if (i === 0) cctx.moveTo(x, y);
          else cctx.lineTo(x, y);
        }
        cctx.stroke();
      };

      drawCurve((d) => chartC.h - 24 - Math.min(7, d.accG) * 14, pc.c3, 2.0);
      drawCurve((d) => chartC.h - 32 - d.angDeg * 2.6, pc.c1, 2.4);

      // 播放游标
      const curX = tx(anim.t);
      cctx.strokeStyle = pc.text;
      cctx.lineWidth = 1.6;
      cctx.beginPath();
      cctx.moveTo(curX, 20);
      cctx.lineTo(curX, chartC.h - 14);
      cctx.stroke();

      const isNarrow = chartC.w < 480;
      drawLegend(cctx, [
        { label: isNarrow ? "AccMagG (g)" : "合加速度 AccMagG (0g失重 / 6.6g触地)", color: pc.c3 },
        { label: isNarrow ? "倾角 Angle (°)" : "优化版倾角 Angle (落地迅速回 0°)", color: pc.c1 }
      ], padL, 15, chartC.w - 10);
      cctx.fillStyle = pc.muted;
      cctx.font = '600 11px "PingFang SC", sans-serif';
      cctx.fillText(isNarrow ? "空中 A" : "空中 A (247ms)", tx(0.46), chartC.h - 4);
      cctx.fillText(isNarrow ? "落地 L" : "触地稳姿恢复 L", tx(0.74), chartC.h - 4);
    }

    return { updateAndDraw };
  }

  // ==================== 5. 1ms 奇偶错峰调度 + 40ms 滑动窗口 + 3600级 PWM ====================
  function initRtosLab() {
    const schedEl = document.getElementById("schedCanvas");
    const encEl = document.getElementById("encCanvas");
    const pwmEl = document.getElementById("pwmCanvas");
    if (!schedEl || !encEl || !pwmEl) return null;

    const schedC = createManagedCanvas(schedEl);
    const encC = createManagedCanvas(encEl);
    const pwmC = createManagedCanvas(pwmEl, drawPwm);

    let schedPhase = 0;
    const slEnc = document.getElementById("slEncSpeed");
    const encVal = document.getElementById("encSpeedVal");
    slEnc.addEventListener("input", () => {
      encVal.textContent = (+slEnc.value).toFixed(2) + " rps";
    });

    const enc = { accum: 0, slots: [0, 0, 0, 0], idx: 0, filt: 0, tickAcc: 0, rawH: [], winH: [] };

    function drawPwm(mc) {
      const p = mc.beginFrame();
      const { ctx, w, h } = mc;
      drawGrid(ctx, w, h, 44, 30, p.grid);
      const midX = w * 0.5, midY = h * 0.56;
      ctx.strokeStyle = p.axis;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(20, midY); ctx.lineTo(w - 20, midY);
      ctx.moveTo(midX, 16); ctx.lineTo(midX, h - 14);
      ctx.stroke();

      // 旧版硬跳变 + 1% 阶梯
      ctx.strokeStyle = p.c4;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      for (let i = -60; i <= 60; i++) {
        const u = i * 0.1;
        let out = u;
        if (out > 0) out += 2.0; else if (out < 0) out -= 2.0;
        out = Math.trunc(out);
        const px = midX + (u / 6) * (w * 0.43);
        const py = midY - (out / 9) * (h * 0.42);
        if (i === -60) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // 新版平滑过渡 + 3600 级连续曲线
      ctx.strokeStyle = p.c2;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      for (let i = -60; i <= 60; i++) {
        const u = i * 0.1;
        const au = Math.abs(u);
        let out = u;
        if (au >= 0.05) {
          const comp = au < 1.0 ? 2.0 * ((au - 0.05) / 0.95) : 2.0;
          out += u > 0 ? comp : -comp;
        }
        const px = midX + (u / 6) * (w * 0.43);
        const py = midY - (out / 9) * (h * 0.42);
        if (i === -60) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();

      drawLegend(ctx, [
        { label: "旧版：过零 ±2% 硬跳变 + 100 级截断 (原点抽动)", color: p.c4, dash: [5, 3] },
        { label: "新版：0~1% 线性平滑死区 + 3600 级浮点 PWM", color: p.c2, lw: 2.8 }
      ], 14, 20);
    }

    drawPwm(pwmC);

    function updateAndDraw(dt) {
      if (schedC.visible) {
        schedPhase += Math.min(0.05, dt) * 2.2;
        const p = schedC.beginFrame();
        const { ctx, w, h } = schedC;
        const cols = 12, padL = 88, padR = 14, gw = w - padL - padR, colW = gw / cols;
        const rows = [
          { label: "角度内环 500Hz", y: 30, h: 32 },
          { label: "速度外环 100Hz", y: 78, h: 32 },
          { label: "main() 主循环", y: 126, h: 32 }
        ];

        ctx.font = '11px "JetBrains Mono", Consolas, monospace';
        for (let i = 0; i <= cols; i++) {
          const x = padL + i * colW;
          ctx.strokeStyle = p.grid;
          ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, 170); ctx.stroke();
          if (i < cols) {
            ctx.fillStyle = p.muted;
            ctx.fillText(i + "ms", x + 4, 186);
          }
        }
        rows.forEach((r) => {
          ctx.fillStyle = p.text;
          ctx.font = '600 11.5px "PingFang SC", sans-serif';
          ctx.fillText(r.label, 8, r.y + 20);
        });

        for (let ms = 0; ms < cols; ms++) {
          const x = padL + ms * colW;
          if (ms % 2 === 0) {
            drawRoundRect(ctx, x + 2, rows[0].y, colW * 0.36, rows[0].h, 4);
            ctx.fillStyle = p.c1; ctx.fill();
            drawRoundRect(ctx, x + colW * 0.42, rows[2].y, colW * 0.54, rows[2].h, 4);
            ctx.fillStyle = p.c3; ctx.globalAlpha = 0.36; ctx.fill(); ctx.globalAlpha = 1;
          } else if (ms === 1 || ms === 11) {
            drawRoundRect(ctx, x + 2, rows[1].y, colW * 0.24, rows[1].h, 4);
            ctx.fillStyle = p.c2; ctx.fill();
            drawRoundRect(ctx, x + colW * 0.30, rows[2].y, colW * 0.66, rows[2].h, 4);
            ctx.fillStyle = p.c3; ctx.globalAlpha = 0.36; ctx.fill(); ctx.globalAlpha = 1;
          } else {
            drawRoundRect(ctx, x + 2, rows[2].y, colW * 0.92, rows[2].h, 4);
            ctx.fillStyle = p.c3; ctx.globalAlpha = 0.42; ctx.fill(); ctx.globalAlpha = 1;
          }
        }

        const cx = padL + ((schedPhase % cols) / cols) * gw;
        ctx.strokeStyle = p.c4;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, 18); ctx.lineTo(cx, 172); ctx.stroke();
      }

      if (encC.visible) {
        enc.tickAcc += Math.min(0.05, dt);
        if (enc.tickAcc >= 0.06) {
          enc.tickAcc = 0;
          const trueRps = +slEnc.value;
          enc.accum += trueRps * 408.17 * 0.01;
          const ticks = Math.floor(enc.accum);
          enc.accum -= ticks;

          const curIdx = enc.idx;
          enc.slots[curIdx] = ticks;
          enc.idx = (enc.idx + 1) % 4;
          for (let i = 0; i < 4; i++) {
            const box = document.getElementById("slotBox" + i);
            const val = document.getElementById("slotVal" + i);
            if (val) val.textContent = enc.slots[i];
            if (box) box.classList.toggle("current", i === curIdx);
          }

          const rawRps = ticks / 408.17 / 0.01;
          const sum4 = enc.slots[0] + enc.slots[1] + enc.slots[2] + enc.slots[3];
          const winRps = sum4 / 408.17 / 0.04;
          enc.filt = 0.60 * enc.filt + 0.40 * winRps;

          enc.rawH.push(rawRps);
          enc.winH.push(enc.filt);
          if (enc.rawH.length > 100) { enc.rawH.shift(); enc.winH.shift(); }
        }

        const p = encC.beginFrame();
        const { ctx, w, h } = encC;
        drawGrid(ctx, w, h, 42, 30, p.grid);
        const trueRps = +slEnc.value;
        const maxY = Math.max(1.2, trueRps * 2.1);
        const mapY = (v) => h - 18 - (v / maxY) * (h - 42);

        ctx.strokeStyle = p.axis;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(0, mapY(trueRps)); ctx.lineTo(w, mapY(trueRps)); ctx.stroke();
        ctx.setLineDash([]);

        const plot = (arr, color, lw) => {
          if (arr.length < 2) return;
          ctx.strokeStyle = color; ctx.lineWidth = lw;
          ctx.beginPath();
          for (let i = 0; i < arr.length; i++) {
            const x = (i / 100) * w, y = mapY(arr[i]);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        };
        plot(enc.rawH, p.c4, 1.4);
        plot(enc.winH, p.c1, 2.7);
        drawLegend(ctx, [
          { label: "裸 10ms 测速 (剧烈台阶)", color: p.c4, lw: 1.5 },
          { label: "40ms 滑窗 + 滤波 (丝滑低滞后)", color: p.c1, lw: 2.7 }
        ], 10, 18);
      }
    }

    return { updateAndDraw };
  }

  // ==================== 6. 交互式故障诊断器 ====================
  const SYMPTOMS = {
    flicker: {
      title: "启动不了 + OLED 屏幕一闪一闪",
      cause: "90% 是锂电池电量低（如 2S 14500 跌破 6.3V 或启动电流瞬间拉压）触发 5V 稳压掉压，STM32 反复重启重跑 OLED_Init()；软件上此前 1KB 栈偏紧和 I2C 耗时偏长也已全部加固根除。",
      fix: "充满电（2S 达 8.4V / 3S 达 12.6V）后拔掉 ST-Link 单独用电池开机；确认 OLED 右下角 OB:0 后无 '!'。",
      cmd: "show"
    },
    hf_shake: {
      title: "原地细碎高频嗡嗡抖动",
      cause: "角度环陀螺仪阻尼 Kd 偏大（放大 9.28:1 齿轮间隙冲击）或死区补偿 off 略高。",
      fix: "在 XCOM 中每次把 akd 降 0.3（例如 2.8 → 2.2）；若原地仍有轻微咔哒声，把 off 降至 1.5。",
      cmd: "akd=2.2 off=1.5"
    },
    slow_wobble: {
      title: "慢速卡顿 / 前后缓慢摇摆",
      cause: "电机静摩擦死区补偿 off 偏小产生“粘滑”，或速度环参数略猛拉扯车身。",
      fix: "发 spd=0.5 慢走测试，把 off 在 1.5~4.0 之间每次加 0.5 找最丝滑临界点；若仍大周期慢晃，微调 skp=1.9 ski=0.010。",
      cmd: "off=2.8 skp=1.9 ski=0.010"
    },
    slope: {
      title: "下坡压不住、越滑越快",
      cause: "速度外环向后仰车的比例/积分制动力偏小，或 7.4V 电池电压下电机极限扭矩不足。",
      fix: "增大 skp 与 ski 增强下坡拉车力度；硬件上换 3S (11.1V) 动力电池可直接提升 50% 扭矩。",
      cmd: "skp=2.8 ski=0.018"
    },
    drop_fwd: {
      title: "30cm 下台阶触地瞬间向前栽倒",
      cause: "触地瞬间角度环刚度/阻尼不够，或电量不足导致车轮没来得及追到重心正下方。",
      fix: "务必满电测试！增大落地增强倍率 lkp 与 lkd，并拉长顺势卸力时间 lroll。",
      cmd: "lkp=1.65 lkd=2.10 lroll=180"
    },
    drop_back: {
      title: "30cm 下台阶站住了但急刹后仰翻车",
      cause: "触地后速度环接管过早，车身还在吸收冲击时就猛力后仰刹车。",
      fix: "拉长顺势卸力时长 lroll（140 → 200ms），让车落地后顺势向前多缓冲一点再停稳。",
      cmd: "lroll=200"
    }
  };

  function initTroubleshooter() {
    const out = document.getElementById("symResult");
    const btns = document.querySelectorAll(".sym-btn");
    if (!out || !btns.length) return;

    function show(key) {
      const s = SYMPTOMS[key];
      if (!s) return;
      out.innerHTML = `
        <div style="font-weight:800;font-size:0.98rem;margin-bottom:8px;">${s.title}</div>
        <p style="margin:0 0 6px;"><strong>根因分析：</strong>${s.cause}</p>
        <p style="margin:0 0 10px;"><strong>处理步骤：</strong>${s.fix}</p>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="color:var(--text-muted);font-size:0.82rem;">建议 XCOM 发送：</span>
          <code style="font-weight:700;">${s.cmd}</code>
          <button class="btn btn-sm btn-soft" type="button" id="copySymCmd">复制指令</button>
        </div>
      `;
      const cp = document.getElementById("copySymCmd");
      if (cp) {
        cp.onclick = () => {
          if (navigator.clipboard) navigator.clipboard.writeText(s.cmd).catch(() => {});
          showToast("已复制指令：" + s.cmd);
        };
      }
    }

    btns.forEach((b) => {
      b.addEventListener("click", () => {
        btns.forEach((x) => x.classList.remove("btn-primary"));
        b.classList.add("btn-primary");
        show(b.dataset.sym);
      });
    });
    show("flicker");
  }

  // ==================== 吸顶目录自动跟随滚动高亮 ====================
  function initTocScrollSpy() {
    const chips = Array.from(document.querySelectorAll(".toc-chip[href^='#']"));
    if (!chips.length) return;
    const pairs = chips
      .map((chip) => ({ chip, sec: document.querySelector(chip.getAttribute("href")) }))
      .filter((p) => p.sec);

    let lastCurrent = null;
    function updateActive() {
      const y = window.scrollY + 155;
      let current = pairs[0];
      for (const item of pairs) {
        if (item.sec.offsetTop <= y) current = item;
      }
      pairs.forEach((p) => p.chip.classList.toggle("active", p === current));
      if (current && current !== lastCurrent) {
        lastCurrent = current;
        const bar = current.chip.parentElement;
        if (bar && bar.scrollWidth > bar.clientWidth) {
          const targetLeft = current.chip.offsetLeft - (bar.clientWidth - current.chip.clientWidth) / 2;
          bar.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
        }
      }
    }

    window.addEventListener("scroll", updateActive, { passive: true });
    updateActive();
  }

  // ==================== 启动统一 60fps 零闪烁主循环 ====================
  document.addEventListener("DOMContentLoaded", () => {
    initArchInspector();
    initTroubleshooter();
    initTocScrollSpy();

    const pidLab = initPidLab();
    const imuLab = initImuLab();
    const dropLab = initDropLab();
    const rtosLab = initRtosLab();

    // XCOM 指令一键复制
    document.querySelectorAll("[data-copy-cmd]").forEach((el) => {
      el.style.cursor = "pointer";
      el.title = "点击复制该 XCOM 指令";
      el.addEventListener("click", () => {
        const cmd = el.dataset.copyCmd;
        if (navigator.clipboard) navigator.clipboard.writeText(cmd).catch(() => {});
        showToast("已复制：" + cmd);
      });
    });

    let lastTs = 0;
    function frame(ts) {
      if (!lastTs) lastTs = ts;
      const dt = Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
      lastTs = ts;

      if (pidLab) pidLab.updateAndDraw(dt);
      if (imuLab) imuLab.updateAndDraw(dt);
      if (dropLab) dropLab.updateAndDraw(dt);
      if (rtosLab) rtosLab.updateAndDraw(dt);

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
})();
