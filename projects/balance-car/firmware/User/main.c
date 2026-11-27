#include "stm32f10x.h"
#include "Delay.h"
#include "OLED.h"
#include "LED.h"
#include "Timer.h"
#include "Key.h"
#include "MPU6050.h"
#include "Motor.h"
#include "Encoder.h"
#include "Serial.h"
#include "BlueSerial.h"
#include "PID.h"
#include "UR.h"
#include "NRF24L01.h"
#include <math.h>
#include <string.h>
#include <stdlib.h>

/* ==================== 传感器与控制周期参数宏 ==================== */
#define ANGLE_ZERO_OFFSET       3.0f        // 机械平衡零点偏置（度），与原车保持一致
#define DEFAULT_GYRO_Y_BIAS     (-3.6f)     // 陀螺仪Y轴默认零漂（开机静止时会自动校准覆盖）
#define DEFAULT_GYRO_Z_BIAS     (-30.0f)    // 陀螺仪Z轴默认零漂（开机静止时会自动校准覆盖）
#define ACCEL_1G_LSB            2048.0f     // ±16g 满量程对应 1g 的原始值
#define GYRO_LSB_TO_DPS         (2000.0f / 32768.0f) // ±2000°/s 转 deg/s
#define RAD_TO_DEG              57.2957795f

#define ANGLE_LOOP_PERIOD_MS    2           // 角度内环周期 2ms (500Hz)，与MPU6050 500Hz采样同步
#define ANGLE_LOOP_DT           0.002f
#define SPEED_LOOP_PERIOD_MS    10          // 速度/转向外环周期 10ms (100Hz)，极低相位滞后，丝滑且下坡稳
#define SPEED_LOOP_DT           0.010f
#define SPEED_WIN_SLOTS         4           // 4*10ms = 40ms 滑动窗口：滞后仅20ms且平滑无阶跃
#define SPEED_WIN_DT            (SPEED_LOOP_DT * SPEED_WIN_SLOTS)
#define ENCODER_CPR_OUT         (44.0f * 9.27666f) // 输出轴每转编码器脉冲数

/* 角度环陀螺仪阻尼缩放系数：Kd=2.8 对应 0.070 PWM/(deg/s)，取中黄金阻尼（不顿挫也不发晃） */
#define GYRO_D_SCALE            0.025f

/* ==================== 30cm 下台阶稳定姿态参数宏 ==================== */
/* 30cm自由落体约247ms、落地速度约2.43m/s */
#define DROP_FREEFALL_G         0.58f       // 总加速度低于 0.58g 判定失重离地
#define DROP_FREEFALL_TICKS     6           // 连续 6*2ms = 12ms（下落仅约0.7mm即响应）
#define DROP_IMPACT_G           1.45f       // 触地瞬间冲击峰值 > 1.45g 立即切入落地恢复（2ms延迟）
#define DROP_SOFTLAND_G         0.78f       // 软地面/地毯触地判定阈值
#define DROP_SOFTLAND_TICKS     6           // 软地面连续 6*2ms = 12ms 判定触地
#define DROP_MAX_AIR_MS         850         // 空中状态超时保护（ms）

#define AIR_WHEEL_MATCH_KP      10.0f       // 空中闭环轮速匹配离地前地速，触地瞬间不打滑不绊脚
#define AIR_GYRO_KD             0.04f       // 空中轻度俯仰角速度阻尼，抑制下台阶前翻角速度
#define AIR_PWM_LIMIT           35.0f       // 空中输出限幅

#define LAND_SHOCK_MUTE_MS      120         // 触地后屏蔽加速度计融合时长（ms），彻底免疫高g冲击毛刺
#define LAND_FREE_ROLL_MS       140         // 触地初期顺势卸力时长（ms），优先立稳车身不急刹
#define LAND_RAMP_MS            280         // 速度环权值与增益平滑恢复过渡时长（ms）
#define LAND_MAX_TIME_MS        650         // 落地恢复态最长保持时间（ms）
#define LAND_KP_BOOST           1.45f       // 触地瞬间角度环 Kp 增强倍率
#define LAND_KD_BOOST           1.75f       // 触地瞬间角速度阻尼 Kd 增强倍率（等效~0.122 PWM/(deg/s)）

#define FALL_ANGLE_GROUND       52.0f       // 正常地面倾倒保护角度（度）
#define FALL_ANGLE_DROP         68.0f       // 下台阶/落地瞬态放宽保护角，防止大倾角救车时误停机
#define FALL_CONFIRM_TICKS      20          // 连续超限 20*2ms = 40ms 才停机，防毛刺误触发

typedef enum {
	DROP_STATE_GROUND   = 0,    // 正常地面/上下坡平衡
	DROP_STATE_AIRBORNE = 1,    // 离地失重 / 空中轮速匹配与轻阻尼稳姿
	DROP_STATE_LANDING  = 2     // 触地冲击吸收与强阻尼平滑稳态恢复
} DropState_t;

/* ==================== 全局变量 ==================== */
int16_t AX, AY, AZ, GX, GY, GZ;         // MPU6050 原始数据
volatile uint8_t TimerErrorFlag = 0;    // 定时中断超时标志位
volatile uint16_t TimerCount = 0;       // 定时中断执行耗时计数值（us）

float GyroY_Offset = DEFAULT_GYRO_Y_BIAS; // 陀螺仪Y轴零漂（浮点）
float GyroZ_Offset = DEFAULT_GYRO_Z_BIAS; // 陀螺仪Z轴零漂

float AngleAcc = 0.0f;                  // 加速度计倾角（度）
float AngleGyro = 0.0f;                 // 陀螺仪积分倾角（度）
float Angle = 0.0f;                     // 自适应互补滤波后倾角（度）
float GyroY_dps = 0.0f;                 // 俯仰角速度（deg/s）
float GyroY_Filt = 0.0f;                // 低通滤波后的俯仰角速度（deg/s）
float GyroZ_dps = 0.0f;                 // 偏航角速度（deg/s）
float AccMagG = 1.0f;                   // 合加速度模长（单位：g）

volatile uint8_t KeyNum = 0;
volatile uint8_t RunFlag = 0;

int16_t LeftPWM = 0, RightPWM = 0;      // 兼容NRF回传的整数PWM
int16_t AvePWM = 0, DifPWM = 0;
float LeftPWM_F = 0.0f, RightPWM_F = 0.0f;
float AvePWM_F = 0.0f, DifPWM_F = 0.0f;

float LeftSpeed = 0.0f, RightSpeed = 0.0f;
float AveSpeed = 0.0f, DifSpeed = 0.0f;
float AveSpeedFilt = 0.0f, DifSpeedFilt = 0.0f;
static float GroundSpeedMemo = 0.0f;    // 离地前平地接近速度记忆（慢滤波，防台阶边缘打滑干扰）

float SpeedTargetCmd = 0.0f;            // 期望速度指令（经斜坡平滑后送入SpeedPID.Target）
float TurnTargetCmd = 0.0f;             // 期望转向指令

float TurnAngle = 0.0f;                 // GZ积分累计转向角度（度）

/* 自动控制相关变量 */
volatile uint8_t AutoModeFlag = 0;      // 0: 手动遥控模式, 1: 自动避障模式
static uint8_t ObsState = 0;            // 0: 正常前进, 1: 后退避障, 2: 停车稳姿, 3: 原地转弯
static uint16_t TimerCnt = 0;
static int8_t TurnDir = 1;              // 1: 向右转, -1: 向左转

/* 30cm 下台阶状态机变量 */
volatile DropState_t DropState = DROP_STATE_GROUND;
static uint16_t FreeFallCnt = 0;
static uint16_t SoftLandCnt = 0;
static uint16_t AirTimeMs = 0;
static uint16_t LandTimeMs = 0;
static uint16_t StableRecoverCnt = 0;
static uint16_t FallConfirmCnt = 0;
static uint8_t LandSpeedInit = 0;       // 落地外环顺势接管初始化标志
static float PreDropSpeed = 0.0f;

/* 编码器 40ms 滑动窗口缓冲区（每10ms更新一次：低滞后 + 平滑无阶跃） */
static int16_t EncLeftWin[SPEED_WIN_SLOTS] = {0};
static int16_t EncRightWin[SPEED_WIN_SLOTS] = {0};
static uint8_t EncWinIdx = 0;

/* 主循环非阻塞定时刷新标志位 */
volatile uint8_t OLED_RefreshFlag = 0;
volatile uint8_t UR_RefreshFlag = 0;
volatile uint8_t Plot_RefreshFlag = 0;

/* 正点原子XCOM在线可调运行时参数（无需重烧即可调零点与下台阶参数） */
float AngleZeroOffset = ANGLE_ZERO_OFFSET;
float LandKpBoost = LAND_KP_BOOST;
float LandKdBoost = LAND_KD_BOOST;
uint16_t LandFreeRollMs = LAND_FREE_ROLL_MS;
uint8_t XcomPlotMode = 0;               // 0:关闭刷屏(推荐调参时用), 1:文本状态监视, 2:纯CSV波形(A,G,V,D)

/* ==================== PID结构体参数 ==================== */
PID_t AnglePID = {
	.Kp = 4.8f,             // 角度比例权重（小倾角丝滑，大倾角/下坡自动平滑增强）
	.Ki = 0.0f,             // 串级内环关闭Ki，避免与速度环积分互搏引起低频晃动
	.Kd = 2.8f,             // 配合GYRO_D_SCALE=0.025 -> 0.070 PWM/(deg/s) 黄金阻尼
	
	.OutMax = 100.0f,
	.OutMin = -100.0f,
	
	.OutOffset = 2.0f,      // 配合PID平滑死区补偿，消除静摩擦且无过零跳变
	
	.ErrorIntMax = 400.0f,
	.ErrorIntMin = -400.0f,
};

PID_t SpeedPID = {
	.Kp = 2.20f,            // 强响应速度比例，下坡压车与稳速能力强
	.Ki = 0.012f,           // 适配10ms(100Hz)周期的积分权重（等效1.2/s）
	.Kd = 0.0f,             // 速度环不加微分，彻底杜绝编码器脉冲抖动
	
	.OutMax = 22.0f,        // 放宽至±22°目标倾角，提供充足陡坡/下坡后仰制动力
	.OutMin = -22.0f,
	
	.OutOffset = 0.0f,
	
	.ErrorIntMax = 900.0f,  // 900 * 0.012 = ±10.8° 重心与坡度自动补偿空间
	.ErrorIntMin = -900.0f,
};

PID_t TurnPID = {
	.Kp = 3.0f,             // 100Hz平滑差速转向控制
	.Ki = 0.0f,
	.Kd = 0.0f,
	
	.OutMax = 50.0f,
	.OutMin = -50.0f,
	
	.OutOffset = 0.0f,
	
	.ErrorIntMax = 20.0f,
	.ErrorIntMin = -20.0f,
};

/* ==================== 辅助函数 ==================== */

static float ClampFloat(float val, float minVal, float maxVal)
{
	if (val > maxVal) {return maxVal;}
	if (val < minVal) {return minVal;}
	return val;
}

static float SlewTowards(float current, float target, float maxStep)
{
	float diff = target - current;
	if (diff > maxStep) {return current + maxStep;}
	if (diff < -maxStep) {return current - maxStep;}
	return target;
}

/**
  * 函    数：重置全部控制状态（平地启停或模式切换时调用）
  */
static void Control_ResetAll(void)
{
	uint8_t i;
	PID_Init(&AnglePID);
	PID_Init(&SpeedPID);
	PID_Init(&TurnPID);
	
	AnglePID.Actual = Angle;
	AnglePID.Actual1 = Angle;
	
	SpeedTargetCmd = 0.0f;
	TurnTargetCmd = 0.0f;
	AveSpeed = 0.0f;
	DifSpeed = 0.0f;
	AveSpeedFilt = 0.0f;
	DifSpeedFilt = 0.0f;
	GroundSpeedMemo = 0.0f;
	LeftSpeed = 0.0f;
	RightSpeed = 0.0f;
	AvePWM_F = 0.0f;
	DifPWM_F = 0.0f;
	LeftPWM_F = 0.0f;
	RightPWM_F = 0.0f;
	LeftPWM = 0;
	RightPWM = 0;
	AvePWM = 0;
	DifPWM = 0;
	
	TurnAngle = 0.0f;
	ObsState = 0;
	TimerCnt = 0;
	
	DropState = DROP_STATE_GROUND;
	FreeFallCnt = 0;
	SoftLandCnt = 0;
	AirTimeMs = 0;
	LandTimeMs = 0;
	StableRecoverCnt = 0;
	FallConfirmCnt = 0;
	LandSpeedInit = 0;
	PreDropSpeed = 0.0f;
	
	for (i = 0; i < SPEED_WIN_SLOTS; i++)
	{
		EncLeftWin[i] = 0;
		EncRightWin[i] = 0;
	}
	EncWinIdx = 0;
	
	Encoder_Get(1);
	Encoder_Get(2);
}

/**
  * 函    数：开机快速零漂自动校准与初始倾角初始化（耗时约160ms）
  */
static void IMU_CalibrateOnBoot(void)
{
	const uint16_t samples = 160;
	int32_t sumAX = 0, sumAZ = 0;
	int32_t sumGY = 0, sumGZ = 0;
	int16_t minGY = 32767, maxGY = -32768;
	uint16_t i;
	
	Delay_ms(40);
	
	for (i = 0; i < samples; i++)
	{
		MPU6050_GetData(&AX, &AY, &AZ, &GX, &GY, &GZ);
		sumAX += AX;
		sumAZ += AZ;
		sumGY += GY;
		sumGZ += GZ;
		if (GY < minGY) {minGY = GY;}
		if (GY > maxGY) {maxGY = GY;}
		Delay_ms(1);
	}
	
	if ((maxGY - minGY) < 250)
	{
		GyroY_Offset = (float)sumGY / (float)samples;
		GyroZ_Offset = (float)sumGZ / (float)samples;
	}
	else
	{
		GyroY_Offset = DEFAULT_GYRO_Y_BIAS;
		GyroZ_Offset = DEFAULT_GYRO_Z_BIAS;
	}
	
	AngleAcc = -atan2f((float)sumAX, (float)sumAZ) * RAD_TO_DEG - AngleZeroOffset;
	Angle = AngleAcc;
	AngleGyro = AngleAcc;
	AnglePID.Actual = Angle;
	AnglePID.Actual1 = Angle;
}

/**
  * 函    数：30cm 下台阶离地/触地状态机更新（2ms调用一次）
  */
static void DropStateMachine_Update(void)
{
	switch (DropState)
	{
		case DROP_STATE_GROUND:
			if (AccMagG < DROP_FREEFALL_G)
			{
				FreeFallCnt++;
				if (FreeFallCnt >= DROP_FREEFALL_TICKS)
				{
					DropState = DROP_STATE_AIRBORNE;
					FreeFallCnt = 0;
					SoftLandCnt = 0;
					AirTimeMs = 0;
					
					/* 锁存离地前平地接近速度，空中保持同速滚转，落地零绊脚冲击 */
					PreDropSpeed = ClampFloat(GroundSpeedMemo, -3.0f, 3.0f);
					
					PID_Init(&SpeedPID);
					PID_Init(&TurnPID);
					AnglePID.Target = 0.0f;
					DifPWM_F = 0.0f;
				}
			}
			else
			{
				FreeFallCnt = 0;
			}
			break;
		
		case DROP_STATE_AIRBORNE:
			AirTimeMs += ANGLE_LOOP_PERIOD_MS;
			
			/* 硬质地面触地冲击单帧立即响应（2ms延迟） */
			if (AccMagG > DROP_IMPACT_G)
			{
				DropState = DROP_STATE_LANDING;
				LandTimeMs = 0;
				StableRecoverCnt = 0;
				SoftLandCnt = 0;
				LandSpeedInit = 0;
				
				PID_Init(&SpeedPID);
				PID_Init(&TurnPID);
				AnglePID.ErrorInt = 0.0f;
				AnglePID.Target = 0.0f;
				DifPWM_F = 0.0f;
			}
			else if (AccMagG > DROP_SOFTLAND_G)
			{
				/* 地毯/软垫等软着陆持续12ms恢复重力判定触地 */
				SoftLandCnt++;
				if (SoftLandCnt >= DROP_SOFTLAND_TICKS)
				{
					DropState = DROP_STATE_LANDING;
					LandTimeMs = 0;
					StableRecoverCnt = 0;
					SoftLandCnt = 0;
					LandSpeedInit = 0;
					
					PID_Init(&SpeedPID);
					PID_Init(&TurnPID);
					AnglePID.ErrorInt = 0.0f;
					AnglePID.Target = 0.0f;
					DifPWM_F = 0.0f;
				}
			}
			else
			{
				SoftLandCnt = 0;
			}
			
			if (AirTimeMs >= DROP_MAX_AIR_MS)
			{
				DropState = DROP_STATE_GROUND;
				FreeFallCnt = 0;
				SoftLandCnt = 0;
			}
			break;
		
		case DROP_STATE_LANDING:
			LandTimeMs += ANGLE_LOOP_PERIOD_MS;
			
			if (LandTimeMs >= 260)
			{
				if (fabsf(Angle) < 8.0f && fabsf(GyroY_Filt) < 35.0f)
				{
					StableRecoverCnt++;
					if (StableRecoverCnt >= 30) // 60ms稳定后平滑切回地面态
					{
						DropState = DROP_STATE_GROUND;
						StableRecoverCnt = 0;
					}
				}
				else
				{
					StableRecoverCnt = 0;
				}
			}
			
			if (LandTimeMs >= LAND_MAX_TIME_MS)
			{
				DropState = DROP_STATE_GROUND;
				StableRecoverCnt = 0;
			}
			break;
	}
}

/**
  * 函    数：正点原子XCOM串口调参指令解析（支持大小写无关、单行多参数空格/逗号分隔）
  * 示    例：akp=4.8  |  akd=2.8 off=2.5  |  skp=2.2 ski=0.012  |  zero=3.0  |  run=1  |  show  |  plot=1
  */
static void XCOM_PrintParams(void)
{
	BlueSerial_Printf("=== PID Params ===\r\n");
	BlueSerial_Printf("Angle: akp=%.2f aki=%.3f akd=%.2f off=%.2f zero=%.2f\r\n",
		AnglePID.Kp, AnglePID.Ki, AnglePID.Kd, AnglePID.OutOffset, AngleZeroOffset);
	BlueSerial_Printf("Speed: skp=%.2f ski=%.4f skd=%.2f | Turn: tkp=%.2f\r\n",
		SpeedPID.Kp, SpeedPID.Ki, SpeedPID.Kd, TurnPID.Kp);
	BlueSerial_Printf("Drop : lkp=%.2f lkd=%.2f lroll=%dms\r\n",
		LandKpBoost, LandKdBoost, (int)LandFreeRollMs);
	BlueSerial_Printf("State: run=%d A=%.2f G=%.2f V=%.2f err=%d cnt=%dus\r\n",
		(int)RunFlag, Angle, AccMagG, AveSpeedFilt, (int)TimerErrorFlag, (int)TimerCount);
}

static void XCOM_ProcessCommand(char *cmdLine)
{
	char *p;
	char *tok;
	uint8_t handled = 0;
	
	/* 统一转为小写，兼容大小写输入 */
	for (p = cmdLine; *p != '\0'; p++)
	{
		if (*p >= 'A' && *p <= 'Z')
		{
			*p = (char)(*p - 'A' + 'a');
		}
	}
	
	/* 支持用空格、逗号或分号分隔多条指令，例如 "akp=4.8 akd=2.6 off=2.5" */
	tok = strtok(cmdLine, " ,;");
	while (tok != NULL)
	{
		char *eq = strchr(tok, '=');
		if (eq != NULL)
		{
			float val;
			*eq = '\0';
			val = (float)atof(eq + 1);
			
			if (strcmp(tok, "akp") == 0)
			{
				AnglePID.Kp = val;
				BlueSerial_Printf("OK akp=%.2f\r\n", AnglePID.Kp);
				handled = 1;
			}
			else if (strcmp(tok, "aki") == 0)
			{
				AnglePID.Ki = val;
				BlueSerial_Printf("OK aki=%.4f\r\n", AnglePID.Ki);
				handled = 1;
			}
			else if (strcmp(tok, "akd") == 0)
			{
				AnglePID.Kd = val;
				BlueSerial_Printf("OK akd=%.2f\r\n", AnglePID.Kd);
				handled = 1;
			}
			else if (strcmp(tok, "off") == 0 || strcmp(tok, "offset") == 0)
			{
				AnglePID.OutOffset = val;
				BlueSerial_Printf("OK off=%.2f\r\n", AnglePID.OutOffset);
				handled = 1;
			}
			else if (strcmp(tok, "zero") == 0)
			{
				float diff = val - AngleZeroOffset;
				AngleZeroOffset = val;
				Angle -= diff;
				BlueSerial_Printf("OK zero=%.2f\r\n", AngleZeroOffset);
				handled = 1;
			}
			else if (strcmp(tok, "skp") == 0)
			{
				SpeedPID.Kp = val;
				BlueSerial_Printf("OK skp=%.2f\r\n", SpeedPID.Kp);
				handled = 1;
			}
			else if (strcmp(tok, "ski") == 0)
			{
				SpeedPID.Ki = val;
				BlueSerial_Printf("OK ski=%.4f\r\n", SpeedPID.Ki);
				handled = 1;
			}
			else if (strcmp(tok, "skd") == 0)
			{
				SpeedPID.Kd = val;
				BlueSerial_Printf("OK skd=%.3f\r\n", SpeedPID.Kd);
				handled = 1;
			}
			else if (strcmp(tok, "tkp") == 0)
			{
				TurnPID.Kp = val;
				BlueSerial_Printf("OK tkp=%.2f\r\n", TurnPID.Kp);
				handled = 1;
			}
			else if (strcmp(tok, "lkp") == 0)
			{
				LandKpBoost = ClampFloat(val, 1.0f, 2.5f);
				BlueSerial_Printf("OK lkp=%.2f\r\n", LandKpBoost);
				handled = 1;
			}
			else if (strcmp(tok, "lkd") == 0)
			{
				LandKdBoost = ClampFloat(val, 1.0f, 3.0f);
				BlueSerial_Printf("OK lkd=%.2f\r\n", LandKdBoost);
				handled = 1;
			}
			else if (strcmp(tok, "lroll") == 0)
			{
				LandFreeRollMs = (uint16_t)ClampFloat(val, 40.0f, 350.0f);
				BlueSerial_Printf("OK lroll=%dms\r\n", (int)LandFreeRollMs);
				handled = 1;
			}
			else if (strcmp(tok, "spd") == 0)
			{
				AutoModeFlag = 0;
				SpeedTargetCmd = ClampFloat(val, -4.0f, 4.0f);
				BlueSerial_Printf("OK spd=%.2f\r\n", SpeedTargetCmd);
				handled = 1;
			}
			else if (strcmp(tok, "trn") == 0)
			{
				AutoModeFlag = 0;
				TurnTargetCmd = ClampFloat(val, -4.0f, 4.0f);
				BlueSerial_Printf("OK trn=%.2f\r\n", TurnTargetCmd);
				handled = 1;
			}
			else if (strcmp(tok, "run") == 0)
			{
				if (val > 0.5f)
				{
					Control_ResetAll();
					RunFlag = 1;
					BlueSerial_Printf("OK run=1 (START)\r\n");
				}
				else
				{
					RunFlag = 0;
					AutoModeFlag = 0;
					BlueSerial_Printf("OK run=0 (STOP)\r\n");
				}
				handled = 1;
			}
			else if (strcmp(tok, "plot") == 0)
			{
				int mode = (int)val;
				if (mode < 0 || mode > 2) {mode = 0;}
				XcomPlotMode = (uint8_t)mode;
				BlueSerial_Printf("OK plot=%d\r\n", (int)XcomPlotMode);
				handled = 1;
			}
		}
		else
		{
			if (strcmp(tok, "show") == 0 || strcmp(tok, "?") == 0 || strcmp(tok, "help") == 0)
			{
				XCOM_PrintParams();
				handled = 1;
			}
			else if (strcmp(tok, "stop") == 0)
			{
				RunFlag = 0;
				AutoModeFlag = 0;
				BlueSerial_Printf("OK STOP\r\n");
				handled = 1;
			}
			else if (strcmp(tok, "start") == 0)
			{
				Control_ResetAll();
				RunFlag = 1;
				BlueSerial_Printf("OK START\r\n");
				handled = 1;
			}
		}
		
		tok = strtok(NULL, " ,;");
	}
	
	if (!handled)
	{
		BlueSerial_Printf("ERR! Send 'show' or e.g. akp=4.8 akd=2.8 off=2.0 skp=2.2 ski=0.012\r\n");
	}
}

/* ==================== 主函数 ==================== */
int main(void)
{
	/*模块初始化*/
	OLED_Init();
	MPU6050_Init();
	BlueSerial_Init();
	LED_Init();
	Key_Init();
	Motor_Init();
	Encoder_Init();
	Serial_Init();
	UR_Init();
	NRF24L01_Init();
	// My_ADC_Init();
	
	IMU_CalibrateOnBoot();

	Timer_Init();
	
	BlueSerial_Printf("\r\nBalanceCar Ready! Send 'show' for PID params.\r\n");
	
	while (1)
	{
		if (RunFlag) {LED_ON();} else {LED_OFF();}
		
		/*按键控制*/
		KeyNum = Key_GetNum();
		if (KeyNum == 1)
		{
			if (RunFlag == 0)
			{
				Control_ResetAll();
				RunFlag = 1;
			}
			else
			{
				RunFlag = 0;
				AutoModeFlag = 0;
			}
		}
		
		if (KeyNum == 2 && RunFlag == 1)
		{
			AutoModeFlag = !AutoModeFlag;
			PID_Init(&SpeedPID);
			PID_Init(&TurnPID);
			SpeedTargetCmd = 0.0f;
			TurnTargetCmd = 0.0f;
			ObsState = 0;
			TimerCnt = 0;
		}

		if (KeyNum == 3 && AutoModeFlag == 1)
		{
			TurnDir = -TurnDir;
		}

		/* 50ms 非阻塞刷新 OLED */
		if (OLED_RefreshFlag == 1)
		{
			char stateChar = (DropState == DROP_STATE_GROUND) ? 'G' :
			                 ((DropState == DROP_STATE_AIRBORNE) ? 'A' : 'L');
			OLED_RefreshFlag = 0;
		
			OLED_Clear();
		
			OLED_Printf(0, 0, OLED_6X8, "  Angle");
			OLED_Printf(0, 8, OLED_6X8, "P:%05.2f", AnglePID.Kp);
			OLED_Printf(0, 16, OLED_6X8, "I:%05.2f", AnglePID.Ki);
			OLED_Printf(0, 24, OLED_6X8, "D:%05.2f", AnglePID.Kd);
			OLED_Printf(0, 32, OLED_6X8, "T:%+05.1f", AnglePID.Target);
		
			OLED_Printf(50, 0, OLED_6X8, "Speed");
			OLED_Printf(50, 8, OLED_6X8, "%05.2f", SpeedPID.Kp);
			OLED_Printf(50, 16, OLED_6X8, "%05.2f", SpeedPID.Ki);
			OLED_Printf(50, 24, OLED_6X8, "%05.2f", SpeedPID.Kd);
			OLED_Printf(50, 32, OLED_6X8, "%+05.1f", SpeedPID.Target);
		
			OLED_Printf(88, 0, OLED_6X8, "Turn");
			OLED_Printf(88, 8, OLED_6X8, "%05.2f", TurnPID.Kp);
			OLED_Printf(88, 16, OLED_6X8, "%05.2f", TurnPID.Ki);
			OLED_Printf(88, 24, OLED_6X8, "%05.2f", TurnPID.Kd);
			OLED_Printf(88, 32, OLED_6X8, "%+05.1f", TurnPID.Target);
		
			OLED_Printf(0, 42, OLED_6X8, "A:%+05.1f", Angle);
			OLED_Printf(50, 42, OLED_6X8, "O:%02.0f", AnglePID.OutOffset);
			OLED_Printf(88, 42, OLED_6X8, "D:%.1f", Distance);
		
			OLED_Printf(0, 50, OLED_6X8, "M:%d%c", AutoModeFlag, stateChar);
			OLED_Printf(32, 50, OLED_6X8, "TA:%04.0f", TurnAngle);
			OLED_Printf(88, 50, OLED_6X8, "OB:%d%s", ObsState, TimerErrorFlag ? "!" : "");
			OLED_Update();
		}
		
		/* 60ms 节拍更新超声波 */
		if (UR_RefreshFlag == 1)
		{
			UR_RefreshFlag = 0;
			UR_Update();
			ObstacleLED_Control(Distance);
		}
    
		/* NRF24L01接收数据包处理 */
		if (NRF24L01_Receive() == 1)
		{
			uint8_t ID = NRF24L01_RxPacket[0];
			
			if (ID == 0x00 || ID == 0x01)
			{
				if (ID == 0x01)
				{
					NRF24L01_TxPacket[0] = 0x02;
					NRF24L01_TxPacket[1] = (int8_t)LeftPWM;
					NRF24L01_TxPacket[2] = (int8_t)RightPWM;
					*(float *)&NRF24L01_TxPacket[4] = Angle;
					*(float *)&NRF24L01_TxPacket[8] = LeftSpeed;
					*(float *)&NRF24L01_TxPacket[12] = RightSpeed;
					
					NRF24L01_Send();
				}
				
				int8_t LV = (int8_t)NRF24L01_RxPacket[2];
				int8_t RH = (int8_t)NRF24L01_RxPacket[3];
				uint8_t KEY = NRF24L01_RxPacket[5];
				
				if (LV > -4 && LV < 4) {LV = 0;}
				if (RH > -4 && RH < 4) {RH = 0;}
				
				AutoModeFlag = 0;
				SpeedTargetCmd = (float)LV / 25.0f;
				TurnTargetCmd = (float)RH / 25.0f;
				
				if (KEY == 1)
				{
					if (RunFlag == 0)
					{
						Control_ResetAll();
						RunFlag = 1;
					}
					else
					{
						RunFlag = 0;
						AutoModeFlag = 0;
					}
				}
			}
		}
	
		/* 蓝牙串口接收数据包处理 */
		if (BlueSerial_RxFlag == 1)
		{
			char *Tag = strtok(BlueSerial_RxPacket, ",");
			if (Tag != NULL && strcmp(Tag, "key") == 0)
			{
				char *Name = strtok(NULL, ",");
				char *Action = strtok(NULL, ",");
				
				if (Name != NULL && Action != NULL)
				{
					if (strcmp(Name, "K1") == 0)
					{
						if (strcmp(Action, "down") == 0)
						{
							if (RunFlag == 0)
							{
								Control_ResetAll();
								RunFlag = 1;
							}
							else
							{
								RunFlag = 0;
								AutoModeFlag = 0;
							}
						}
						else if (strcmp(Action, "up") == 0)
						{
							RunFlag = 0;
							AutoModeFlag = 0;
						}
					}
					else if (strcmp(Name, "K2") == 0)
					{
						if (strcmp(Action, "down") == 0)
						{
							if (RunFlag == 1)
							{
								TurnAngle = 0.0f;
								AutoModeFlag = !AutoModeFlag;
								PID_Init(&SpeedPID);
								PID_Init(&TurnPID);
								SpeedTargetCmd = 0.0f;
								TurnTargetCmd = 0.0f;
								ObsState = 0;
								TimerCnt = 0;
							}
						}
						else if (strcmp(Action, "up") == 0)
						{
							AutoModeFlag = 0;
						}
					}
					else if (strcmp(Name, "K3") == 0)
					{
						if (strcmp(Action, "down") == 0)
						{
							TurnDir = -1;
						}
						else if (strcmp(Action, "up") == 0)
						{
							TurnDir = 1;
						}
					}
				}
			}
			else if (Tag != NULL && strcmp(Tag, "slider") == 0)
			{
				char *Name = strtok(NULL, ",");
				char *Value = strtok(NULL, ",");
				
				if (Name != NULL && Value != NULL)
				{
					if (strcmp(Name, "AngleKp") == 0)        {AnglePID.Kp = (float)atof(Value);}
					else if (strcmp(Name, "AngleKi") == 0)   {AnglePID.Ki = (float)atof(Value);}
					else if (strcmp(Name, "AngleKd") == 0)   {AnglePID.Kd = (float)atof(Value);}
					else if (strcmp(Name, "SpeedKp") == 0)   {SpeedPID.Kp = (float)atof(Value);}
					else if (strcmp(Name, "SpeedKi") == 0)   {SpeedPID.Ki = (float)atof(Value);}
					else if (strcmp(Name, "SpeedKd") == 0)   {SpeedPID.Kd = (float)atof(Value);}
					else if (strcmp(Name, "TurnKp") == 0)    {TurnPID.Kp = (float)atof(Value);}
					else if (strcmp(Name, "TurnKi") == 0)    {TurnPID.Ki = (float)atof(Value);}
					else if (strcmp(Name, "TurnKd") == 0)    {TurnPID.Kd = (float)atof(Value);}
					else if (strcmp(Name, "Offset") == 0)    {AnglePID.OutOffset = (float)atof(Value);}
				}
			}
			else if (Tag != NULL && strcmp(Tag, "joystick") == 0)
			{
				char *sLH = strtok(NULL, ",");
				char *sLV = strtok(NULL, ",");
				char *sRH = strtok(NULL, ",");
				char *sRV = strtok(NULL, ",");
				(void)sLH;
				(void)sRV;
				
				if (sLV != NULL && sRH != NULL)
				{
					int8_t LV = (int8_t)atoi(sLV);
					int8_t RH = (int8_t)atoi(sRH);
					if (LV > -4 && LV < 4) {LV = 0;}
					if (RH > -4 && RH < 4) {RH = 0;}
					
					AutoModeFlag = 0;
					SpeedTargetCmd = (float)LV / 25.0f;
					TurnTargetCmd = (float)RH / 25.0f;
				}
			}
			
			BlueSerial_RxFlag = 0;
		}
		
		/* 正点原子 XCOM 串口文本调参指令处理（发送新行） */
		if (BlueSerial_CmdFlag == 1)
		{
			XCOM_ProcessCommand(BlueSerial_CmdPacket);
			BlueSerial_CmdFlag = 0;
		}
		
		/* 60ms 节拍发送监控数据（默认关闭防刷屏，发 plot=1 文本监视，发 plot=2 纯CSV波形） */
		if (Plot_RefreshFlag == 1)
		{
			Plot_RefreshFlag = 0;
			if (XcomPlotMode == 1)
			{
				char sc = (DropState == DROP_STATE_GROUND) ? 'G' :
				          ((DropState == DROP_STATE_AIRBORNE) ? 'A' : 'L');
				BlueSerial_Printf("A=%+.2f G=%.2f V=%+.2f P=%+d S=%c\r\n",
					Angle, AccMagG, AveSpeedFilt, (int)AvePWM, sc);
			}
			else if (XcomPlotMode == 2)
			{
				BlueSerial_Printf("%.2f,%.2f,%.2f,%.2f\r\n", Angle, AccMagG, AveSpeedFilt, Distance);
			}
		}
	}
}

/* ==================== 1ms 定时中断（核心实时控制） ==================== */
void TIM1_UP_IRQHandler(void)
{
	static uint8_t AngleDivCnt = 0;
	static uint8_t SpeedDivCnt = 1; // 初值设为1，与2ms角度环错开奇偶毫秒执行，避免同一毫秒内叠加超时
	static uint8_t Slow50msCnt = 0;
	static uint8_t Slow60msCnt = 0;
	
	if (TIM_GetITStatus(TIM1, TIM_IT_Update) == SET)
	{
		TIM_ClearITPendingBit(TIM1, TIM_IT_Update);
		
		/* 1ms 节拍：按键扫描 */
		Key_Tick();
		
		/* 2ms 节拍 (500Hz)：IMU读取 + 自适应姿态解算 + 下台阶状态机 + 角度内环 */
		AngleDivCnt++;
		if (AngleDivCnt >= ANGLE_LOOP_PERIOD_MS)
		{
			float accErr;
			float alpha;
			float fallLimit;
			
			AngleDivCnt = 0;
			
			/* 1. 读取 MPU6050（500Hz同步采样 + 42Hz DLPF） */
			MPU6050_GetData(&AX, &AY, &AZ, &GX, &GY, &GZ);
			
			/* 2. 计算浮点去偏角速度与合加速度模长（g） */
			GyroY_dps = ((float)GY - GyroY_Offset) * GYRO_LSB_TO_DPS;
			GyroZ_dps = ((float)GZ - GyroZ_Offset) * GYRO_LSB_TO_DPS;
			GyroY_Filt = 0.72f * GyroY_Filt + 0.28f * GyroY_dps; // ~30Hz低通，清晰阻尼且无高频毛刺
			
			AccMagG = sqrtf((float)AX * (float)AX + (float)AY * (float)AY + (float)AZ * (float)AZ) / ACCEL_1G_LSB;
			
			if (AutoModeFlag == 1)
			{
				TurnAngle += GyroZ_dps * ANGLE_LOOP_DT;
			}
			
			/* 3. 更新下台阶状态机 */
			if (RunFlag == 1)
			{
				DropStateMachine_Update();
			}
			else
			{
				DropState = DROP_STATE_GROUND;
				FreeFallCnt = 0;
				SoftLandCnt = 0;
			}
			
			/* 4. 自适应互补滤波：降低稳态Alpha至0.0015抑制行进加速度耦合，失重与冲击期间完全屏蔽加速度计 */
			AngleGyro = Angle + GyroY_dps * ANGLE_LOOP_DT;
			
			accErr = fabsf(AccMagG - 1.0f);
			if (DropState == DROP_STATE_AIRBORNE ||
				(DropState == DROP_STATE_LANDING && LandTimeMs < LAND_SHOCK_MUTE_MS) ||
				accErr >= 0.20f)
			{
				alpha = 0.0f;
			}
			else
			{
				AngleAcc = -atan2f((float)AX, (float)AZ) * RAD_TO_DEG - AngleZeroOffset;
				if (accErr <= 0.06f)
				{
					alpha = 0.0015f; // 时间常数~1.33s，慢速加减速不受水平加速度干扰，平稳无漂移
				}
				else
				{
					alpha = 0.0015f * (0.20f - accErr) / (0.20f - 0.06f);
				}
			}
			Angle = (alpha > 0.0f) ? (alpha * AngleAcc + (1.0f - alpha) * AngleGyro) : AngleGyro;
			
			/* 5. 倾倒停机保护（40ms防抖，下台阶瞬态放宽角度上限以便救车） */
			fallLimit = (DropState == DROP_STATE_GROUND) ? FALL_ANGLE_GROUND : FALL_ANGLE_DROP;
			if (Angle > fallLimit || Angle < -fallLimit)
			{
				FallConfirmCnt++;
				if (FallConfirmCnt >= FALL_CONFIRM_TICKS)
				{
					RunFlag = 0;
					AutoModeFlag = 0;
					DropState = DROP_STATE_GROUND;
					FallConfirmCnt = 0;
				}
			}
			else
			{
				FallConfirmCnt = 0;
			}
			
			/* 6. 执行角度内环与下台阶控制 */
			if (RunFlag == 1)
			{
				if (AutoModeFlag == 1 && DropState == DROP_STATE_GROUND)
				{
					switch (ObsState)
					{
						case 0:
							SpeedTargetCmd = 2.0f;
							TurnTargetCmd = 0.0f;
							TurnAngle = 0.0f;
							if (Distance > 0.0f && Distance <= 20.0f)
							{
								ObsState = 1;
								TimerCnt = 0;
							}
							break;

						case 1:
							SpeedTargetCmd = -2.0f;
							TurnTargetCmd = 0.0f;
							if (Distance > 20.0f)
							{
								ObsState = 2;
								TimerCnt = 0;
							}
							break;

						case 2:
							SpeedTargetCmd = 0.0f;
							TurnTargetCmd = 0.0f;
							TimerCnt += ANGLE_LOOP_PERIOD_MS;
							if (TimerCnt >= 500)
							{
								ObsState = 3;
								TimerCnt = 0;
							}
							break;

						case 3:
							SpeedTargetCmd = 0.0f;
							TurnTargetCmd = 4.0f * (float)TurnDir;
							TimerCnt += ANGLE_LOOP_PERIOD_MS;
							if (TimerCnt >= 800)
							{
								ObsState = 0;
								TurnTargetCmd = 0.0f;
							}
							break;
					}
				}
				
				if (DropState == DROP_STATE_AIRBORNE)
				{
					/* 空中态：闭环将轮速精准维持在离地前水平地速（触地不绊脚）+ 轻度俯仰速率阻尼 */
					float speedMatchPWM = -AIR_WHEEL_MATCH_KP * (PreDropSpeed - AveSpeedFilt);
					float pitchDampPWM = -AIR_GYRO_KD * GyroY_Filt;
					
					AvePWM_F = ClampFloat(speedMatchPWM + pitchDampPWM, -AIR_PWM_LIMIT, AIR_PWM_LIMIT);
					DifPWM_F = 0.0f;
				}
				else if (DropState == DROP_STATE_LANDING)
				{
					/* 落地恢复态：触地瞬间高刚度强阻尼全力接稳车身，随后平滑回落至正常增益 */
					float blend;
					float kpScale, kdScale;
					
					if (LandTimeMs <= LandFreeRollMs)
					{
						blend = 0.0f;
					}
					else if (LandTimeMs < (LandFreeRollMs + LAND_RAMP_MS))
					{
						blend = (float)(LandTimeMs - LandFreeRollMs) / (float)LAND_RAMP_MS;
					}
					else
					{
						blend = 1.0f;
					}
					
					kpScale = LandKpBoost - (LandKpBoost - 1.0f) * blend;
					kdScale = LandKdBoost - (LandKdBoost - 1.0f) * blend;
					
					AnglePID.Actual = Angle;
					PID_UpdateWithDeriv(&AnglePID, GyroY_Filt * GYRO_D_SCALE, kpScale, kdScale);
					AvePWM_F = AnglePID.Out;
				}
				else
				{
					/* 正常地面/上下坡态：小倾角柔和丝滑，大倾角(>8°)自动平滑增强刚度以稳住陡坡与急扰 */
					float absAng = fabsf(Angle);
					float kpScale = 1.0f;
					if (absAng > 8.0f)
					{
						kpScale = 1.0f + (absAng - 8.0f) * 0.02f;
						if (kpScale > 1.25f) {kpScale = 1.25f;}
					}
					
					AnglePID.Actual = Angle;
					PID_UpdateWithDeriv(&AnglePID, GyroY_Filt * GYRO_D_SCALE, kpScale, 1.0f);
					AvePWM_F = AnglePID.Out;
				}
				
				LeftPWM_F = ClampFloat(AvePWM_F + DifPWM_F * 0.5f, AnglePID.OutMin, AnglePID.OutMax);
				RightPWM_F = ClampFloat(AvePWM_F - DifPWM_F * 0.5f, AnglePID.OutMin, AnglePID.OutMax);
				
				AvePWM = (int16_t)AvePWM_F;
				DifPWM = (int16_t)DifPWM_F;
				LeftPWM = (int16_t)LeftPWM_F;
				RightPWM = (int16_t)RightPWM_F;
				
				Motor_SetPWM_Float(1, LeftPWM_F);
				Motor_SetPWM_Float(2, RightPWM_F);
			}
			else
			{
				AvePWM_F = 0.0f;
				DifPWM_F = 0.0f;
				LeftPWM_F = 0.0f;
				RightPWM_F = 0.0f;
				LeftPWM = 0;
				RightPWM = 0;
				Motor_SetPWM_Float(1, 0.0f);
				Motor_SetPWM_Float(2, 0.0f);
			}
		}
		
		/* 10ms 节拍 (100Hz)：40ms滑动窗口低滞后编码器测速 + 速度外环 + 转向环 */
		SpeedDivCnt++;
		if (SpeedDivCnt >= SPEED_LOOP_PERIOD_MS)
		{
			int32_t sumLeft = 0, sumRight = 0;
			uint8_t i;
			
			SpeedDivCnt = 0;
			
			/* 10ms刷新 + 40ms滑动窗口：相位滞后压缩至~35ms同时保持丝滑无脉冲台阶 */
			EncLeftWin[EncWinIdx] = Encoder_Get(1);
			EncRightWin[EncWinIdx] = Encoder_Get(2);
			EncWinIdx = (uint8_t)((EncWinIdx + 1) % SPEED_WIN_SLOTS);
			
			for (i = 0; i < SPEED_WIN_SLOTS; i++)
			{
				sumLeft += EncLeftWin[i];
				sumRight += EncRightWin[i];
			}
			
			LeftSpeed = -(float)sumLeft / ENCODER_CPR_OUT / SPEED_WIN_DT;
			RightSpeed = -(float)sumRight / ENCODER_CPR_OUT / SPEED_WIN_DT;
			
			AveSpeed = (LeftSpeed + RightSpeed) * 0.5f;
			DifSpeed = LeftSpeed - RightSpeed;
			
			/* 轻度一阶低通（tau仅15ms），极快响应下坡与慢速微调 */
			AveSpeedFilt = 0.60f * AveSpeedFilt + 0.40f * AveSpeed;
			DifSpeedFilt = 0.60f * DifSpeedFilt + 0.40f * DifSpeed;
			
			if (DropState == DROP_STATE_GROUND)
			{
				/* 慢速跟踪平地速度，用于下台阶离地前记住真实接近速度 */
				GroundSpeedMemo = 0.88f * GroundSpeedMemo + 0.12f * AveSpeedFilt;
			}
			
			if (RunFlag == 1)
			{
				if (DropState == DROP_STATE_AIRBORNE)
				{
					AnglePID.Target = 0.0f;
					DifPWM_F = 0.0f;
				}
				else if (DropState == DROP_STATE_LANDING)
				{
					/* 触地前140ms释放速度环顺势卸力；140ms后从当前实际滚速顺势减速至目标速度，防急刹后仰 */
					if (LandTimeMs <= LandFreeRollMs)
					{
						SpeedPID.ErrorInt = 0.0f;
						SpeedPID.Out = 0.0f;
						AnglePID.Target = 0.0f;
						DifPWM_F = 0.0f;
						LandSpeedInit = 0;
					}
					else
					{
						float speedBlend = (float)(LandTimeMs - LandFreeRollMs) / (float)LAND_RAMP_MS;
						if (speedBlend > 1.0f) {speedBlend = 1.0f;}
						
						if (LandSpeedInit == 0)
						{
							SpeedPID.Target = ClampFloat(AveSpeedFilt * 0.70f, -2.5f, 2.5f);
							LandSpeedInit = 1;
						}
						
						SpeedPID.Target = SlewTowards(SpeedPID.Target, SpeedTargetCmd, 0.08f);
						SpeedPID.Actual = AveSpeedFilt;
						PID_Update(&SpeedPID);
						AnglePID.Target = SpeedPID.Out * speedBlend;
						
						TurnPID.Target = SlewTowards(TurnPID.Target, TurnTargetCmd, 0.20f);
						TurnPID.Actual = DifSpeedFilt;
						PID_Update(&TurnPID);
						DifPWM_F = TurnPID.Out * speedBlend;
					}
				}
				else
				{
					float difInput = DifSpeedFilt;
					if (fabsf(TurnTargetCmd) < 0.05f && fabsf(difInput) < 0.03f)
					{
						difInput = 0.0f;
					}
					
					/* 100Hz 丝滑斜坡跟随 */
					SpeedPID.Target = SlewTowards(SpeedPID.Target, SpeedTargetCmd, 0.15f);
					SpeedPID.Actual = AveSpeedFilt;
					PID_Update(&SpeedPID);
					AnglePID.Target = SpeedPID.Out;
					
					TurnPID.Target = SlewTowards(TurnPID.Target, TurnTargetCmd, 0.25f);
					TurnPID.Actual = difInput;
					PID_Update(&TurnPID);
					DifPWM_F = TurnPID.Out;
				}
			}
		}
		
		/* 50ms 节拍：OLED刷新标志与障碍物LED闪烁 */
		Slow50msCnt++;
		if (Slow50msCnt >= 50)
		{
			Slow50msCnt = 0;
			OLED_RefreshFlag = 1;
			ObstacleLED_Control(Distance);
			ObstacleLED_FlashTick();
		}
		
		/* 60ms 节拍：超声波采样与蓝牙波形发送 */
		Slow60msCnt++;
		if (Slow60msCnt >= 60)
		{
			Slow60msCnt = 0;
			UR_RefreshFlag = 1;
			Plot_RefreshFlag = 1;
		}
		
		/* 检查中断是否超时 */
		if (TIM_GetITStatus(TIM1, TIM_IT_Update) == SET)
		{
			TimerErrorFlag = 1;
			TIM_ClearITPendingBit(TIM1, TIM_IT_Update);
		}
		
		TimerCount = TIM_GetCounter(TIM1);
	}
}
