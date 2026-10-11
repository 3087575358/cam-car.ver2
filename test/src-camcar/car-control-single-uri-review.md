# 小车控制单 URI 合并说明

本次将 `/carspeed` 合并进 `/car-control`，让一次请求携带完整车辆状态，并同步更新前端、ESP32 后端和 Mermaid 图。

## 完成结果

- 删除独立的 `/carspeed` URI。
- 删除 `carspeed_handler()` 和 `carspeed_uri`。
- 方向、转向、速度、急停状态统一交给 `car_handler()`。
- 前端每个控制包都携带完整车辆状态。
- 增加页面会话 ID 和递增序号，拒绝重复或延迟到达的旧请求。
- 保留 20 ms 控制心跳和 100 ms 失联制动。

编译验证：

```text
PlatformIO 环境：freenove_esp32_s3_wroom
RAM：19.0%
Flash：25.9%
结果：SUCCESS
```

## 主要修改文件

### 前端

- `car-control-desktop-demo.js`

### ESP32 后端

- `app_httpd.cpp`

### 同步文档

- `../../docs/diagrams/car-control-flow.mmd`
- `../../docs/diagrams/car-control-sequence.mmd`
- `../../docs/car-control-development-notes.md`

## 1. 新的请求格式

当前请求：

```text
GET /car-control
    ?drive=forward
    &steer=left
    &speed=42
    &session=9d02d7d49e156b3a
    &seq=105
    &emergency=0
```

参数含义：

| 参数 | 可用值 | 含义 |
|---|---|---|
| `drive` | `forward`、`backward`、`stop` | 行驶方向 |
| `steer` | `left`、`center`、`right` | 舵机方向 |
| `speed` | `0～100` | 电机 PWM 百分比 |
| `session` | 16 位十六进制字符串 | 当前页面控制会话 |
| `seq` | 大于 0 的递增整数 | 控制包顺序 |
| `emergency` | `0`、`1` | 是否紧急停车 |

主要行为：

- 每次请求都描述完整车辆状态。
- ESP32 不需要把多个 URI 的结果重新拼成当前状态。
- 即使 J/K 只改变速度，前端也会同时发送当前行驶和转向状态。

## 2. 前端会话与序号

位置：`car-control-desktop-demo.js:12`

```js
const controlSession = (() => {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
})();

let controlSequence = 0;
```

主要含义：

- 页面每次加载都会生成新的 `session`。
- 同一页面中的 `seq` 从 1 开始递增。
- 页面刷新后虽然序号重新开始，但新的 `session` 会通知 ESP32 接受这组新序号。

## 3. 前端生成完整车辆状态

位置：`car-control-desktop-demo.js:105`

```js
function currentCarState() {
  const actions = active();
  const forward = actions.includes("forward");
  const backward = actions.includes("backward");
  const left = actions.includes("left");
  const right = actions.includes("right");

  return {
    drive:
      forward === backward
        ? "stop"
        : (forward > backward
          ? "forward"
          : "backward"),
    steer:
      left === right
        ? "center"
        : (left > right
          ? "left"
          : "right"),
    speed: Number($("speed-range").value),
  };
}
```

主要行为：

- W 和 S 都没按时为 `stop`。
- W 和 S 同时按下时也为 `stop`，避免方向冲突。
- A 和 D 都没按或同时按下时为 `center`。
- 速度始终读取当前滑块值。

## 4. 前端统一发送入口

位置：`car-control-desktop-demo.js:117`

```js
function sendCarState(emergency = false) {
  controlSequence = (controlSequence + 1) >>> 0;

  return request(API.drive, {
    ...currentCarState(),
    session: controlSession,
    seq: controlSequence,
    emergency: Number(emergency),
  }).catch(markOffline);
}
```

调用这个函数的情况：

- WASD 按住期间的 20 ms 心跳。
- 松开最后一个方向输入。
- 页面失焦或隐藏。
- J/K 改变速度。
- 拖动速度滑块后确认新值。
- 空格或页面急停按钮。

速度变化不再访问 `/carspeed`：

```js
function setSpeed(value, send = true) {
  value = Math.max(+speed.min, Math.min(+speed.max, +value));
  speed.value = value;
  $("speed-value").textContent = `${value}%`;
  $("throttle-output").textContent = `${value}%`;

  if (send) sendCarState();
}
```

## 5. CarState 结构体与状态锁

原来分散的车辆状态已经合并为一个结构体：

```cpp
struct CarState {
  bool forward = false;
  bool backward = false;
  bool left = false;
  bool right = false;
  int speed_percent = 42;
  int64_t last_command_us = 0;
  char session[17] = "";
  uint32_t last_sequence = 0;
};

static CarState car_state;

static portMUX_TYPE car_state_lock =
  portMUX_INITIALIZER_UNLOCKED;
```

主要含义：

- `car_state` 是车辆当前状态的唯一实例。
- `car_state_lock` 是正式代码名称，保护整个状态实例。
- 读输出时先在锁内复制一份 `snapshot`，离开临界区后再操作 GPIO 和 PWM。
- 网络 handler 和安全定时器不会同时读写到一半更新的车辆状态。

笔记中把 `car_state_lock` 简称为“厕所锁”：进去修改共享状态前锁门，出来后立即开锁；锁被占用时，其他任务只能在门外等待。

<small>和真实的厕所很像，一般人三急的时候只能排队（难道还能睡觉的时候拉裤子里面吗？）</small>

## 6. ESP32 参数读取

位置：`app_httpd.cpp:166`

`car_handler()` 一次读取：

```cpp
char drive[10];
char steer[8];
char speed_text[8];
char session[17];
char sequence_text[12];
char emergency_text[4] = "0";
```

必要参数缺失时：

```cpp
return httpd_resp_send_err(
  req,
  HTTPD_400_BAD_REQUEST,
  "missing car state"
);
```

以下情况返回 HTTP 400：

- `drive` 或 `steer` 不是允许值。
- `speed` 不在 `0～100`。
- `session` 不是 16 位十六进制字符串。
- `seq` 不是有效的正整数。
- `emergency` 不是 `0` 或 `1`。

## 7. 会话和旧控制包判断

会话和序号现在也是 `CarState` 的成员：

```cpp
char session[17];
uint32_t last_sequence;
```

主要逻辑：

```cpp
if (strcmp(car_state.session, session)) {
  strlcpy(
    car_state.session,
    session,
    sizeof(car_state.session)
  );
  car_state.last_sequence = (uint32_t)sequence;
} else if (
  (int32_t)((uint32_t)sequence - car_state.last_sequence) <= 0
) {
  stale = true;
} else {
  car_state.last_sequence = (uint32_t)sequence;
}
```

行为：

- 新 `session`：作为新的控制页面接管车辆。
- 相同 `session` 且序号增大：接受请求。
- 相同 `session` 且序号重复或变小：返回 HTTP 409。
- 旧请求不会覆盖更新的车辆状态。

## 8. 一次更新全部车辆状态

校验成功后，在同一个临界区中更新：

```cpp
car_state.speed_percent = (int)speed;
car_state.forward = !emergency && !strcmp(drive, "forward");
car_state.backward = !emergency && !strcmp(drive, "backward");
car_state.left = !emergency && !strcmp(steer, "left");
car_state.right = !emergency && !strcmp(steer, "right");
car_state.last_command_us = esp_timer_get_time();
```

随后只调用一次：

```cpp
apply_car_output();
```

主要行为：

- 行驶、转向和速度不会分成两个 HTTP 请求更新。
- `emergency=1` 会忽略方向值并强制清除运动状态。
- 正常停止仍保留当前速度设定，下一次启动可以继续使用。

## 9. TB6612FNG 模块与 PWM 输出

位置：`app_httpd.cpp:56` 和 `app_httpd.cpp:88`

```cpp
#define DRIVE_PWMA_GPIO 1
#define DRIVE_AIN1_GPIO 41
#define DRIVE_AIN2_GPIO 42
#define STEER_SERVO_GPIO 14

#define DRIVE_PWM_CHANNEL 6
#define STEER_PWM_CHANNEL 7
```

- GPIO 1 连接 TB6612FNG 模块 PWMA，输出 20 kHz、8 位电机 PWM。
- GPIO 41、42 分别连接模块 AIN1、AIN2。
- GPIO 14 输出 50 Hz、14 位舵机 PWM。
- 模块 STBY 在硬件上固定拉高，不占用 GPIO。
- GPIO 21、47 留作后期外设扩展。
- 速度百分比映射到 `0～255`。
- 舵机使用 `1100 / 1500 / 1900 μs` 表示左转、回中、右转。

## 10. 失联保护保持不变

位置：`app_httpd.cpp:130`

```cpp
if (
  moving &&
  esp_timer_get_time() - last_command >
    CAR_COMMAND_TIMEOUT_US
) {
  stop_car_output();
}
```

- 安全定时器每 20 ms 检查一次。
- 活动状态连续 100 ms 没有收到有效新包时自动停止。
- 参数错误和过期序号不会刷新最后收包时间。

## 11. URI 注册

位置：`app_httpd.cpp:1003`

```cpp
httpd_uri_t car_uri = {
  .uri = "/car-control",
  .method = HTTP_GET,
  .handler = car_handler,
  .user_ctx = NULL
};
```

注册位置：`app_httpd.cpp:1026`

```cpp
httpd_register_uri_handler(
  camera_httpd,
  &car_uri
);
```

现在不再注册：

```text
/carspeed
```

## 12. 当前仍需实车确认

- GPIO 1 是否正确连接 TB6612FNG 模块 PWMA。
- GPIO 41、42 是否分别连接模块 AIN1、AIN2。
- GPIO 14 是否正确连接转向舵机信号。
- 模块 STBY 是否在硬件上固定拉高。
- GPIO 21、47 是否保持为未占用扩展接口。
- 实际前进方向是否与 AIN1、AIN2 定义一致。
- 电机最低可启动 PWM。
- 舵机机械中心位置。
- `1100～1900 μs` 是否超过实际转向机构极限。
- 相机串流同时运行时，20 ms HTTP 心跳是否稳定。
- 是否需要把急停改成锁存状态，并增加手动解除按钮。
