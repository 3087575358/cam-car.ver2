# 相机小车控制页面开发记录

这份记录从修改相机网页开始，只保留影响后续开发的重要决定。

## 1. 页面原型

最初从 OV2640 相机网页中拆出 HTML、CSS 和 JavaScript，删除人脸识别相关内容，保留相机预览和基础设置。

随后增加桌面端小车控制页面：

- 上方显示相机画面。
- 底部划分三个控制区。
- 左侧为 `W / A S D` 键盘与鼠标控制。
- 中间显示车辆输出和紧急停车按钮。
- 右侧放置画面翻转、速度滑块以及 `J / K` 调速按钮。
- 右上角显示域名、IP 和 Web 状态，并提供相机设置入口。

主要页面文件：

- `test/src-camcar/car-control-desktop-demo.html`
- `test/src-camcar/car-control-desktop-demo.css`
- `test/src-camcar/car-control-desktop-demo.js`
- `test/src-camcar/car-control-mobile-demo.html`

后续相机小车开发统一以 `test/src-camcar` 为主要工作目录。

## 2. HTML、CSS、JavaScript 分离

桌面原型最初把样式写在 HTML 内，之后改成三个独立文件。

这样做是为了：

- 避免后续修改时单个文件过长。
- 让 HTML 只描述页面结构。
- 让按钮动画和响应式布局集中在 CSS。
- 让键盘、鼠标、网络请求和状态管理集中在 JavaScript。

相机设置菜单限制为最高 `70vh`，内部使用独立滚动区域，避免设置项超过浏览器窗口。

## 3. 输入方式

方向控制同时支持：

- 键盘 `W / A / S / D`
- 鼠标按住页面按钮
- 触屏按住页面按钮

没有为键盘和鼠标分别维护两个简单布尔值，而是为每个动作保存输入源集合。

例如同时使用键盘和鼠标按住 W 时：

```text
forward
├─ key:KeyW
└─ pointer:3
```

鼠标松开时只删除 `pointer:3`。只要 `key:KeyW` 仍然存在，前进状态就不会被错误取消。

窗口失焦或页面隐藏时会清空所有输入源并发送停止命令，防止网页失去焦点后车辆继续运动。

## 4. 按键分配

当前桌面端按键：

| 按键 | 功能 |
|---|---|
| W | 前进 |
| S | 后退 |
| A | 左转 |
| D | 右转 |
| J | PWM 减小 1% |
| K | PWM 增加 1% |
| Space | 紧急停车 |

所有页面按钮也能通过鼠标或触屏操作。

按钮按下状态统一使用 `.is-pressed`，不同按钮在 CSS 中使用不同动画；画面翻转的持续开启状态使用 `.is-on`，不与短暂按压动画混用。

## 5. 车辆控制请求版本

第一版把动作和速度拆成两个 URI：

```text
GET /car-control?action=forward,left
GET /carspeed?value=42
```

之后将 `/carspeed` 合并回 `/car-control`。当前实际代码每次发送完整车辆状态：

```text
GET /car-control?drive=forward&steer=left&speed=42&session=…&seq=105&emergency=0
```

`car-control-desktop-demo.js` 新增：

- `currentCarState()`：把输入源集合整理为 `drive、steer、speed`。
- `sendCarState()`：加入页面会话、递增序号和急停状态，然后发送完整快照。

方向键按住期间每 `20 ms` 发送一次。J/K 或滑块改变速度时也立即发送完整状态，不再调用独立速度接口。

紧急停车仍使用同一个 URI：

```text
GET /car-control?...&emergency=1
```

当前急停不会锁存。它会清空输入并立即制动，但之后收到新的合法方向命令时仍可恢复运动。

## 6. ESP32 控制副本

为了不直接破坏原相机示例，在以下目录建立了独立版本：

```text
test/src-camcar
```

该目录包含相机示例、网页源文件以及修改后的 `app_httpd.cpp`。

当前引脚分配：

| 功能 | 引脚 / 通道 |
|---|---|
| TB6612FNG 模块 PWMA | GPIO 41，LEDC 通道 6 |
| TB6612FNG 模块 AIN1 | GPIO 1 |
| TB6612FNG 模块 AIN2 | GPIO 42 |
| 转向舵机 PWM | GPIO 14，LEDC 通道 7 |
| 后期扩展 | GPIO 21、GPIO 47 |

这些引脚没有被当前 `CAMERA_MODEL_ESP32S3_EYE` 相机配置占用。

## 7. PWM 设计

电机速度使用：

```text
20 kHz，8 位 PWM，范围 0～255
```

网页中的 `0～100%` 会映射到 `0～255`。

舵机使用：

```text
50 Hz，14 位 PWM
左转 1100 μs
回中 1500 μs
右转 1900 μs
```

舵机脉宽只是初始安全值，装车后还需要根据机械极限校准。

## 8. 失联保护

ESP32 每 `20 ms` 检查一次最后控制包时间。

如果车辆处于活动状态，而且连续 `100 ms` 没有收到有效的方向控制包，就会：

- 清除前进、后退、左转和右转状态。
- 将电机 PWM 设为 0。
- 将方向引脚置于停止状态。
- 将舵机回中。

该版本已经通过 PlatformIO 编译：

```text
RAM   19.0%
Flash 25.9%
```

## 9. 单一 URI 的后端实现

`app_httpd.cpp` 删除了 `carspeed_handler()` 和 `carspeed_uri`，所有底盘状态由 `car_handler()` 处理。

主要变化：

- 检查 `drive、steer、speed、session、seq、emergency` 是否完整合法。
- 同一临界区内一次更新行驶、转向、速度和最后收包时间。
- 页面刷新时生成新的 16 位 `session`，ESP32 收到新会话后重置序号判断。
- 同一会话中重复或延迟到达的 `seq` 返回 HTTP 409，不覆盖新状态。
- 参数缺失或越界返回 HTTP 400。

`car-control-flow.mmd` 和 `car-control-sequence.mmd` 已按这个接口重新绘制。

## 10. CarState 与厕所锁

原来分散的方向、转向、速度、最后收包时间、会话和序号，已经合并为一个 `CarState` 结构体。

主要变化：

- `car_state` 成为唯一的车辆状态实例。
- 正式锁名由 `car_mux` 改成 `car_state_lock`。
- 读取输出时在锁内复制 `snapshot`，GPIO 和 PWM 操作放在锁外完成。
- handler、安全定时器和输出函数通过同一把锁保护共享状态。

笔记中把 `car_state_lock` 叫作“厕所锁”：一个任务进入临界区后锁门，其他任务等待它修改完状态并开锁。

<small>和真实的厕所很像，一般人三急的时候只能排队（难道还能睡觉的时候拉裤子里面吗？）</small>

## 11. TB6612FNG 模块与引脚调整

最终电机驱动选择 TB6612FNG 模块，不直接集成驱动芯片。

主要变化：

- GPIO 41 改为 `DRIVE_PWMA`，输出 20 kHz 电机 PWM。
- GPIO 1、42 分别改为 `DRIVE_AIN1`、`DRIVE_AIN2`。
- GPIO 14 改为 `STEER_SERVO_PWM`。
- GPIO 21、47 留作后期 I2C、SPI 或其他外设扩展。
- 模块 `STBY` 在硬件上固定拉高，不占用 GPIO。
- 急停继续由 `/car-control` 停车命令和 100 ms 通信超时完成。

控制线集中后，载板走线更直接，也保留了后续外设扩展空间。

## 12. 第一阶段原理图与 PCB

载板原理图已整理为 `PCB/原理图设计逻辑文件.md`。

当前硬件结构：

- 12V 经 XL1509 生成 5V，再经 TLV62568 生成 3.3V。
- 12V 供 TB6612FNG 模块的电机侧，5V 供主板和舵机，3.3V 供驱动模块逻辑侧。
- Freenove ESP32-S3 使用双排插座安装，车辆引脚与程序保持一致。
- TB6612 的 `PWMA / AIN1 / AIN2` 使用 10 kΩ 下拉，启动时默认停车；`STBY` 固定接 3.3V。
- 两个电机插座目前并接在 A 通道 `AO1/AO2`，属于同一路输出。
- GPIO 21、47 继续保留为后期扩展接口。

第一阶段收尾前仍需确认电机额定电压、并联电机堵转总电流、5V 舵机瞬态供电，以及所有模块和排针的实物尺寸。
