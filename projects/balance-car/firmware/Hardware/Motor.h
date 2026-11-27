#ifndef __MOTOR_H
#define __MOTOR_H

#define MOTOR_PWM_ARR		3600

void Motor_Init(void);
void Motor_SetPWM(uint8_t n, int8_t PWM);
void Motor_SetPWM_Float(uint8_t n, float PWM_Pct);

#endif
