#include "stm32f10x.h"                  // Device header
#include "LED.h"

/* 内部变量：用于记录闪烁计时 */
static uint16_t s_ObstacleLedTick = 0;
static uint8_t s_IsFlashing = 0;

/**
  * 函    数：LED初始化
  * 参    数：无
  * 返 回 值：无
  */
void LED_Init(void)
{
	/*开启时钟*/
	RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOC, ENABLE);	//开启GPIOC的时钟
	RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOA, ENABLE);
	/*GPIO初始化*/
	GPIO_InitTypeDef GPIO_InitStructure;
	GPIO_InitStructure.GPIO_Mode = GPIO_Mode_Out_PP;
	GPIO_InitStructure.GPIO_Pin = GPIO_Pin_13;
	GPIO_InitStructure.GPIO_Speed = GPIO_Speed_50MHz;
	GPIO_Init(GPIOC, &GPIO_InitStructure);					//将PC13引脚初始化为推挽输出
	
	// PA11 障碍物报警灯
	GPIO_InitStructure.GPIO_Mode = GPIO_Mode_Out_PP;
	GPIO_InitStructure.GPIO_Pin = OBSTACLE_LED_PIN;
	GPIO_InitStructure.GPIO_Speed = GPIO_Speed_50MHz;
	GPIO_Init(OBSTACLE_LED_PORT, &GPIO_InitStructure);
	GPIO_SetBits(OBSTACLE_LED_PORT, OBSTACLE_LED_PIN);  

	/*设置GPIO初始化后的默认电平*/
	GPIO_SetBits(GPIOC, GPIO_Pin_13);						//设置PC13引脚为高电平
}

/**
  * 函    数：LED开启
  * 参    数：无
  * 返 回 值：无
  */
void LED_ON(void)
{
	GPIO_ResetBits(GPIOC, GPIO_Pin_13);			//设置PC13引脚为低电平
}

/**
  * 函    数：LED关闭
  * 参    数：无
  * 返 回 值：无
  */
void LED_OFF(void)
{
	GPIO_SetBits(GPIOC, GPIO_Pin_13);			//设置PC13引脚为高电平
}

/**
  * 函    数：LED状态翻转
  * 参    数：无
  * 返 回 值：无
  */
void LED_Turn(void)
{
	if (GPIO_ReadOutputDataBit(GPIOC, GPIO_Pin_13) == 0)	//获取输出寄存器的状态，如果当前引脚输出低电平
	{
		GPIO_SetBits(GPIOC, GPIO_Pin_13);					//设置PC13引脚为高电平
	}
	else													//否则，即当前引脚输出高电平
	{
		GPIO_ResetBits(GPIOC, GPIO_Pin_13);					//设置PC13引脚为低电平
	}
}

/**
  * 函    数：障碍物 LED 闪烁计时处理
  * 参    数：无
  * 返 回 值：无
  * 说    明：此函数应放在定时中断中调用（建议每50ms调用一次）
  */
void ObstacleLED_FlashTick(void)
{
	if (s_IsFlashing)
	{
		s_ObstacleLedTick++;
		if (s_ObstacleLedTick >= 5) // 每 5 * 50ms = 250ms 翻转一次
		{
			s_ObstacleLedTick = 0;
			// 翻转 PA11 电平
			if (GPIO_ReadOutputDataBit(OBSTACLE_LED_PORT, OBSTACLE_LED_PIN))
				GPIO_ResetBits(OBSTACLE_LED_PORT, OBSTACLE_LED_PIN);
			else
				GPIO_SetBits(OBSTACLE_LED_PORT, OBSTACLE_LED_PIN);
		}
	}
	else
	{
		// 不闪烁时保持熄灭
		GPIO_SetBits(OBSTACLE_LED_PORT, OBSTACLE_LED_PIN);
		s_ObstacleLedTick = 0;
	}
}

/**
  * 函    数：根据距离控制障碍物 LED 状态
  * 参    数：Distance 当前测量距离
  * 返 回 值：无
  * 说    明：在主循环中调用，用于更新闪烁标志位
  */
void ObstacleLED_Control(float Distance)
{	
	if (Distance > 0 && Distance < 30.0f)
	{
		s_IsFlashing = 1; // 开启闪烁模式
	}
	else
	{
		s_IsFlashing = 0; // 关闭闪烁模式
	}
}
