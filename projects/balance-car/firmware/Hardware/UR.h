#ifndef __UR_H
#define __UR_H

#include "stm32f10x.h"

/*外部变量声明*/
extern float Distance;  // 测距数值（单位：cm）
extern uint32_t RawTime;  // 原始计数值，用于校准
/**
  * 函    数：超声波模块初始化
  * 参    数：无
  * 返 回 值：无
  * 说    明：Echo引脚接PA10，Trig引脚接PA9
  */
void UR_Init(void);

/**
  * 函    数：获取单次测量距离
  * 参    数：无
  * 返 回 值：距离值（单位：cm），返回-1表示测量超时
  */
float UR_GetDistance(void);

/**
  * 函    数：连续测量并更新距离值
  * 参    数：RunFlag 运行标志位，为1时启动测距
  * 返 回 值：无
  * 说    明：只有当RunFlag=1时才执行测距，否则距离值保持不变
  */
void UR_Update(void);
extern float Distance; // 声明全局变量供外部使用

#endif
