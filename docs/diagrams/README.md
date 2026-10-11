# OV2640 Web 控制图

这两张图是第一批绘图样板：

- `ov2640-web-module-map.mmd`：浏览器、HTTP 服务、相机驱动和 OV2640 之间的基本功能传递。
- `xclk-signal-flow.mmd`：从点击 XCLK 的 Set 按钮，到 GPIO 15 输出新时钟信号的完整调用顺序。

XCLK 图的颜色约定：

- 黄色：用户的手机或电脑端。
- 蓝色：手机/电脑与 ESP32 之间的无线 Wi-Fi 请求或返回。
- 绿色：ESP32-S3 内部的软件处理和硬件信号链。

代码依据：

- `web/2640index_no_facial.js`：`setXclkButton.onclick()`、`setXclk()`、`fetchUrl()`。
- `test/src-camweb/app_httpd.cpp`：`startCameraServer()`、`xclk_uri`、`xclk_handler()`。
- `test/src-camweb/camera_pins.h`：`CAMERA_MODEL_ESP32S3_EYE` 的 `XCLK_GPIO_NUM` 为 15。
- ESP32 Camera `sensor_t::set_xclk`：相机驱动函数指针；具体实现位于预编译的 `esp32-camera` 库。

注意：当前网页只用 `parseInt()`，服务端只用 `atoi()`，没有限定合理的 XCLK 范围。图中按现有代码画出，没有擅自加入参数校验。
