#include "stm32f10x.h"                  // Device header
#include "PID.h"
#include <math.h>

/**
  * 函    数：PID初始化
  * 参    数：p 指定结构体的地址
  * 返 回 值：无
  */
void PID_Init(PID_t *p)
{
	/*把PID表示状态的参数清零，避免之前遗留的参数对本次启动造成影响*/
	p->Target = 0;
	p->Actual = 0;
	p->Actual1 = 0;
	p->Out = 0;
	p->Error0 = 0;
	p->Error1 = 0;
	p->ErrorInt = 0;
}

/**
  * 函    数：平滑死区补偿（避免过零瞬间 ±OutOffset 阶跃跳变引起原地抖动）
  */
static float PID_ApplySmoothOffset(float out, float offset)
{
	if (offset <= 0.0f)
	{
		return out;
	}
	
	float absOut = fabsf(out);
	const float deadBand = 0.05f;      /* 极小死区，防止静态零点微颤 */
	const float rampSpan = 1.0f;       /* 0~1.0范围内快速线性过渡，兼顾消除过零跳变与低速防粘滑卡顿 */
	
	if (absOut < deadBand)
	{
		return out;
	}
	else if (absOut < rampSpan)
	{
		float comp = offset * ((absOut - deadBand) / (rampSpan - deadBand));
		return (out > 0.0f) ? (out + comp) : (out - comp);
	}
	else
	{
		return (out > 0.0f) ? (out + offset) : (out - offset);
	}
}

/**
  * 函    数：带外部测量导数与动态增益缩放的PID更新（用于角度环直接融合陀螺仪角速度及落地强阻尼）
  * 参    数：p 指定结构体的地址
  * 参    数：measDeriv 测量值的变化率（如归一化陀螺仪角速度，正方向与Actual增大一致）
  * 参    数：kpScale 比例增益缩放系数（正常为1.0f，落地瞬态恢复可适当提高）
  * 参    数：kdScale 微分增益缩放系数（正常为1.0f，落地瞬态恢复可适当提高）
  * 返 回 值：无
  */
void PID_UpdateWithDeriv(PID_t *p, float measDeriv, float kpScale, float kdScale)
{
	float rawOut;
	float kpEff = p->Kp * kpScale;
	float kdEff = p->Kd * kdScale;
	
	/*获取本次误差和上次误差*/
	p->Error1 = p->Error0;
	p->Error0 = p->Target - p->Actual;
	
	/*先计算不含新积分的预输出，用于条件积分抗饱和*/
	rawOut = kpEff * p->Error0 + p->Ki * p->ErrorInt - kdEff * measDeriv;
	
	/*抗积分饱和：仅在未同向饱和时累加积分*/
	if (p->Ki != 0.0f)
	{
		if (!((rawOut >= p->OutMax && p->Error0 > 0.0f) || (rawOut <= p->OutMin && p->Error0 < 0.0f)))
		{
			p->ErrorInt += p->Error0;
			if (p->ErrorInt > p->ErrorIntMax) {p->ErrorInt = p->ErrorIntMax;}
			if (p->ErrorInt < p->ErrorIntMin) {p->ErrorInt = p->ErrorIntMin;}
		}
	}
	else
	{
		p->ErrorInt = 0.0f;
	}
	
	/*位置式PID计算（微分先行/直接速率阻尼）*/
	p->Out = kpEff * p->Error0 + p->Ki * p->ErrorInt - kdEff * measDeriv;
	
	/*平滑死区补偿*/
	p->Out = PID_ApplySmoothOffset(p->Out, p->OutOffset);
	
	/*输出限幅*/
	if (p->Out > p->OutMax) {p->Out = p->OutMax;}
	if (p->Out < p->OutMin) {p->Out = p->OutMin;}
	
	/*记录上次实际值*/
	p->Actual1 = p->Actual;
}

/**
  * 函    数：标准PID计算及结构体变量值更新（用于速度环、转向环）
  * 参    数：p 指定结构体的地址
  * 返 回 值：无
  */
void PID_Update(PID_t *p)
{
	PID_UpdateWithDeriv(p, p->Actual - p->Actual1, 1.0f, 1.0f);
}
