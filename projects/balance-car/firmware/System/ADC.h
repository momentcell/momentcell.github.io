#ifndef __ADC_H
#define __ADC_H

// 【修改】改名，避免与标准库冲突
void My_ADC_Init(void); 
float ADC_GetVoltage(uint8_t ch); 

#endif

