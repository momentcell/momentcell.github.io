#include "stm32f10x.h"
#include "ADC.h"

// 定义分压系数，根据你的电阻调整！
// 如果 R1=10k, R2=5.1k, 系数约为 2.96
// 如果 R1=20k, R2=10k, 系数为 3.0
#define VOLTAGE_RATIO 3.0f 

void My_ADC_Init(void)
{
    ADC_InitTypeDef ADC_InitStructure;
    GPIO_InitTypeDef GPIO_InitStructure;

    // 开启时钟 (假设使用 PA0)
    RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOA | RCC_APB2Periph_ADC1, ENABLE);

    // 配置 PA0 为模拟输入
    GPIO_InitStructure.GPIO_Pin = GPIO_Pin_4;
    GPIO_InitStructure.GPIO_Mode = GPIO_Mode_AIN; 
    GPIO_Init(GPIOA, &GPIO_InitStructure);

    // 配置 ADC
    ADC_InitStructure.ADC_Mode = ADC_Mode_Independent;
    ADC_InitStructure.ADC_ScanConvMode = DISABLE;
    ADC_InitStructure.ADC_ContinuousConvMode = DISABLE;
    ADC_InitStructure.ADC_ExternalTrigConv = ADC_ExternalTrigConv_None;
    ADC_InitStructure.ADC_DataAlign = ADC_DataAlign_Right;
    ADC_InitStructure.ADC_NbrOfChannel = 1;
    ADC_Init(ADC1, &ADC_InitStructure);

    ADC_Cmd(ADC1, ENABLE);

    // 校准
    ADC_ResetCalibration(ADC1);
    while(ADC_GetResetCalibrationStatus(ADC1));
    ADC_StartCalibration(ADC1);
    while(ADC_GetCalibrationStatus(ADC1));
}

float ADC_GetVoltage(uint8_t ch)
{
    // 设置规则通道
    ADC_RegularChannelConfig(ADC1, ch, 1, ADC_SampleTime_239Cycles5);
    
    // 启动转换
    ADC_SoftwareStartConvCmd(ADC1, ENABLE);
    
    // 等待完成
    while(!ADC_GetFlagStatus(ADC1, ADC_FLAG_EOC));
    
    // 读取原始值 (0-4095)
    uint16_t val = ADC_GetConversionValue(ADC1);
    
    // 计算实际电压: (Val / 4096) * 3.3V * 分压系数
    float voltage = (float)val / 4096.0 * 3.3 * VOLTAGE_RATIO;
    
    return voltage;
}
