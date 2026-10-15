# TRICK3 / CAMCAR

基于 Freenove ESP32-S3 WROOM 摄像头板的 Wi-Fi 阿克曼小车。

浏览器同时负责显示 OV2640 视频流和发送车辆控制指令，不需要安装专用 App。桌面端支持键盘与鼠标，手机端支持触屏；ESP32-S3 统一处理网页请求、电机输出、舵机转向和失联保护。

> 当前状态：第一阶段的软件结构、控制页面和载板设计已经完成；实车供电、堵转电流、舵机极限和无线环境仍待装车验证。

<img width="1545" height="896" alt="UI_design" src="https://github.com/user-attachments/assets/0b6687fc-f22a-4f82-9773-264428dc54b5" />


## 第一阶段完成内容

- OV2640 相机预览和基础参数设置。
- 键盘、鼠标和触屏共用一套输入状态。
- `W / A / S / D` 控制方向，`J / K` 调整速度，`Space` 紧急停车。
- `/car-control` 接收完整车辆状态，不再拆分速度与转向接口。
- 使用 `session` 和 `seq` 拒绝旧请求，避免延迟数据覆盖新状态。
- 活动状态下连续 100 ms 没有有效控制包，ESP32 自动停车并让舵机回中。
- `CarState` 集中保存车辆状态，并通过临界区保护并发访问。
- 完成 12V、5V、3.3V 电源路径以及 TB6612FNG 模块载板设计。

## 三个主要设计点

### 1. 完整状态，而不是零散按键

前端为每个动作保存输入源集合。鼠标和键盘同时按住同一方向时，释放其中一种输入不会错误地取消另一种输入。

`currentCarState()` 将所有输入整理为 `drive`、`steer` 和 `speed`，活动期间每 20 ms 发送一次完整快照。

<img width="1482" height="1876" alt="car-control-flow" src="https://github.com/user-attachments/assets/cb671562-244c-4d79-957b-2ca83ea9618e" />


### 2. 对无线延迟做基本防护

当前控制接口形式如下：

```text
GET /car-control
    ?drive=forward
    &steer=left
    &speed=42
    &session=xxxx
    &seq=105
    &emergency=0
```

| 参数 | 含义 |
|---|---|
| `drive` | `forward`、`backward` 或 `stop` |
| `steer` | `left`、`right` 或 `center` |
| `speed` | 电机占空比，范围 0～100 |
| `session` | 当前网页会话标识 |
| `seq` | 当前会话内递增的请求序号 |
| `emergency` | 为 `1` 时立即停车 |

ESP32 只接受新会话或更新的序号。参数错误返回 HTTP 400，旧序号返回 HTTP 409，合法状态写入 `CarState` 后再统一更新硬件输出。

### 3. 软件定义与载板对应

车辆控制线集中在主控板两侧容易布线的位置，并与程序中的逻辑名保持一致。

| 逻辑名 | GPIO | 用途 |
|---|---:|---|
| `DRIVE_PWMA` | 41 | TB6612FNG A 通道速度 PWM |
| `DRIVE_AIN1` | 1 | 电机方向输入 1 |
| `DRIVE_AIN2` | 42 | 电机方向输入 2 |
| `STEER_SERVO_PWM` | 14 | 转向舵机 PWM |
| 扩展接口 | 21、47 | 后续 I2C、SPI 或其他外设 |

电机 PWM 为 20 kHz、8 位；舵机 PWM 为 50 Hz。TB6612FNG 模块的 `STBY` 在硬件上固定拉高，急停由停车命令和通信超时完成。

<img width="934" height="636" alt="PCB_LAYOUT" src="https://github.com/user-attachments/assets/0cb553a8-c1a4-4650-b956-7bb47eadbb69" />

<img width="912" height="779" alt="PCB_3D" src="https://github.com/user-attachments/assets/457c4b3c-866d-4511-ba3c-6613ba1d1547" />

## 页面反馈

按钮的业务输入与视觉动画分开处理。键盘、鼠标或触屏按下时添加 `.is-pressed`，释放、取消、页面失焦或隐藏时移除；画面翻转一类持续状态使用 `.is-on`，不与瞬时按压动画混用。

<img width="1482" height="1876" alt="car-control-animation-logic" src="https://github.com/user-attachments/assets/abed1328-5466-44f8-b164-447f71e71a7a" />

## 硬件结构

```text
12V 输入
├─ TB6612FNG VM → 驱动电机
└─ XL1509 → 5V
   ├─ Freenove ESP32-S3
   ├─ 转向舵机
   └─ TLV62568 → 3.3V → TB6612FNG VCC / STBY
```

- Freenove 主控板通过 2.54 mm 双排插座安装，方便拆卸。
- `PWMA`、`AIN1`、`AIN2` 使用 10 kΩ 下拉，主控复位时默认停车。
- 当前两个电机插座并接在 TB6612FNG 的 `AO1/AO2`，属于同一路输出，不能独立调速或反向。
- GPIO 21、47 只作扩展预留，具体总线确定后再补充接口定义。

## 代码位置

当前相机小车版本以 [`test/src-camcar`](https://github.com/3087575358/cam-car.ver2/tree/main/test/src-camcar) 为主要开发目录：

- `app_httpd.cpp`：HTTP URI、车辆状态、PWM 输出和失联保护。
- `car-control-desktop-demo.html`：桌面控制页面结构。
- `car-control-desktop-demo.css`：布局、响应式样式和按钮动画。
- `car-control-desktop-demo.js`：输入源、完整状态请求和网络状态。
- `car-control-mobile-demo.html`：手机端页面原型。

简要开发日志记录详见文件 [`car-control-development-notes.md`](https://github.com/3087575358/cam-car.ver2/blob/main/test/src-camcar/car-control-development-notes.md)

## 编译与使用

1. 使用 VS Code 打开项目，并安装 PlatformIO。
2. 选择 `freenove_esp32_s3_wroom` 环境。
3. 检查网络配置和上述 GPIO 定义。
4. 执行 PlatformIO Build，然后上传到 ESP32-S3。
5. 让电脑或手机与设备处于可访问的网络中，通过设备域名或 IP 打开控制页面。
6. 第一次测试时架空车轮，依次确认电机方向、急停、失联停车和舵机范围。

