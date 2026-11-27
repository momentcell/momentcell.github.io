 #include "stm32f10x.h"                  // Device header
#include "Delay.h"
#include "Serial.h"

/*定义全局变量*/
float Distance;  // 测距数值（单位：cm）
uint32_t RawTime;  // 原始计数值，用于校准

/**
  * 函    数：超声波模块初始化
  * 参    数：无
  * 返 回 值：无
  * 说    明：Echo引脚接PA10，Trig引脚接PA9
  */
void UR_Init(void)
{
	/*开启时钟*/
	RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOA, ENABLE);	//开启GPIOA的时钟
	
	/*GPIO初始化*/
	GPIO_InitTypeDef GPIO_InitStructure;
	
	// Trig引脚（PA9）- 输出模式
	GPIO_InitStructure.GPIO_Mode = GPIO_Mode_Out_PP;
	GPIO_InitStructure.GPIO_Pin = GPIO_Pin_9;
	GPIO_InitStructure.GPIO_Speed = GPIO_Speed_50MHz;
	GPIO_Init(GPIOA, &GPIO_InitStructure);					//将PA9引脚初始化为推挽输出
	
	// Echo引脚（PA10）- 输入模式
	GPIO_InitStructure.GPIO_Mode = GPIO_Mode_IPD;			//下拉输入
	GPIO_InitStructure.GPIO_Pin = GPIO_Pin_10;
	GPIO_Init(GPIOA, &GPIO_InitStructure);					//将PA10引脚初始化为下拉输入
	
	/*初始状态设置*/
	GPIO_ResetBits(GPIOA, GPIO_Pin_9);	//Trig引脚初始化为低电平
}

/**
  * 函    数：获取单次测量距离
  * 参    数：无
  * 返 回 值：距离值（单位：cm），返回-1表示测量超时
  */
float UR_GetDistance(void)
{
	uint32_t Time;
	uint32_t Count;
	
	/*发送触发信号*/
	GPIO_SetBits(GPIOA, GPIO_Pin_9);	//Trig引脚置高
	Delay_us(15);						//保持15us高电平
	GPIO_ResetBits(GPIOA, GPIO_Pin_9);	//Trig引脚置低
	
	/*等待Echo引脚变为高电平*/
	Count = 0;
	while (GPIO_ReadInputDataBit(GPIOA, GPIO_Pin_10) == 0)
	{
		Count++;
		if (Count > 12000)  // 缩短无模块/丢波超时时间，避免主循环长阻塞影响NRF/蓝牙响应
		{
			RawTime = 0;
			return -1;      // 返回-1表示超时
		}
	}
	
	/*记录Echo高电平持续时间*/
	/*使用简单的循环计数，需要校准系数*/
	Time = 0;
	while (GPIO_ReadInputDataBit(GPIOA, GPIO_Pin_10) == 1)
	{
		Time++;
		if (Time > 30000)   // 最大测距约2.6m即超时退出，减少阻塞时间
		{
			RawTime = 0;
			return -1;      // 返回-1表示超时
		}
	}
	/*保存原始计数值到全局变量*/
	RawTime = Time;
	

	/*计算距离*/
	/*注意：这里的系数需要根据实际测试校准*/
	/*理论值：Time * 1us / 58，但由于Delay_us(1)的实际延时约为1.5-2us*/
	/*所以实际系数应该调整为：Time * 实际延时 / 58*/
	/*建议先打印Time值，用已知距离进行校准*/
	
	/*初步估算：假设Delay_us(1)实际延时约1.8us*/
	/*则距离 = Time * 1.8 / 58 = Time / 32.2*/
	/*这个系数需要根据实测调整！*/
	return Time / 115.0f;
}

void UR_Update(void)
{
	static float FilterBuffer[4] = {0}; // 静态缓冲区，初始化为0
	static uint8_t BufIndex = 0;
	static uint8_t ValidCount = 0;      // 记录有效数据的个数
	
	float Temp = UR_GetDistance();
	
	// 如果测量有效，存入滤波缓冲区
	if (Temp > 2.0f && Temp < 400.0f)
	{
		FilterBuffer[BufIndex] = Temp;
		BufIndex = (BufIndex + 1) % 4;
		
		if (ValidCount < 4) 
		{
			ValidCount++;
		}
		
		// 计算平均值
		float Sum = 0;
		uint8_t i; // 变量定义移到最前面，兼容 Keil 默认编译标准
		for (i = 0; i < ValidCount; i++)
		{
			Sum += FilterBuffer[i];
		}
		Distance = Sum / ValidCount;
	}
	else
	{
		// 如果测量无效，可以选择保持上次值不变，或者标记为无效
		// 这里选择保持不变，避免距离跳变
	}
	
	// 优化：去除了 Delay_us(10)
	// 只要主循环中有 OLED 刷新或蓝牙处理等耗时操作，自然间隔就足够传感器恢复
	// 如果主循环极快，建议在 main 循环里加一个 Delay_ms(10) 即可，不要放在底层驱动里
}
