#ifndef __LED_H
#define __LED_H

/* 障碍物报警 LED 引脚定义 */
#define OBSTACLE_LED_PIN GPIO_Pin_11
#define OBSTACLE_LED_PORT GPIOA

void LED_Init(void);
void LED_ON(void);
void LED_OFF(void);
void LED_Turn(void);


/* 新增函数声明 */
void ObstacleLED_FlashTick(void); // 在中断中调用，处理闪烁逻辑
void ObstacleLED_Control(float Distance); // 根据距离控制闪烁状态

#endif
