# APEX Telemetry — Web MVP

零 npm 依赖的响应式网页：模拟车辆遥测、赛道选择、自动过线计圈、本地驾驶记录、轨迹回看与 JSON 导出。界面适配手机与桌面。

## 启动

需要 Node.js 22+（运行测试）和 Python 3（静态服务器）。

```sh
npm start
```

打开 http://localhost:5173。运行 `npm test` 验证计时核心。

默认模拟 GPS + 模拟 OBD，点击「开始记录」即可体验，4× 演示速度下约 20 秒完成一圈。时长和圈速均使用模拟时间。两条预设赛道是虚构路线，不代表实际赛道。

## Mapbox

在「地图设置」输入 Mapbox 公共 Access Token（`pk.` 开头），并在 Mapbox 限制允许的网站 URL。不要填写 `sk.` 私密 Token。Token 只存在当前浏览器的 localStorage，不提交进仓库。Mapbox GL JS 3.32.0 的脚本和样式在配置 Token 后才从官方 CDN 加载。

没有 Token 时显示明确标注的本地赛道示意图，模拟功能仍完整可用。地图加载或认证失败时回退到示意图；修改 Token 后刷新重试。地图使用受 Mapbox 账号配额和计费约束。地图底图使用 `mapbox://styles/mapbox/dark-v11`，赛道与起终点使用 GeoJSON 图层，车辆位置使用 Marker。

## 手机 GPS

切换到「手机 GPS」，在地图上点击一次放置起点 A，图钉可拖动。支持两种模式：

- **绕圈计时**：首次过起点开始计时，再次同向过线完成一圈。有效圈至少 10 秒、100 米。
- **起终点计时**：放置起点 A 后再放终点 B（至少相距 50 米）；首次经过起点开始，经过终点自动结束并保存。完成时间使用 GPS 采样间的过线插值。

系统以图钉为中心生成 30 米宽的计时线。「微调计时线方向」可旋转短线，让它横跨道路；绕圈模式默认道路朝向为南北，起终点模式首次放齐两点后按两点连线估算道路朝向，弯曲路线应分别调整。设置保存在当前浏览器，刷新后切到手机 GPS 即可继续使用。点击「准备开始」后显示「等待过线」，真正过线后才显示 REC；轨迹和“记录时长”从准备时开始记录。

搜索框使用 Mapbox Search Box `/forward`，点击搜索或回车时发起请求，结果仅用于移动地图，不保存搜索结果；之后在实际道路上点击设点。网络、无结果和权限错误会显示提示。搜索受 Mapbox 账号权限、地区覆盖及计费约束。未连接地图时仍可运行演示。

新西兰赛道快捷入口：Hampton Downs、Taupō Motorsport Park、Manfeild · Circuit Chris Amon。入口仅定位赛道区域，不代表已标定的官方起终点或赛道轮廓；应根据当天使用的赛道布局放置计时线。场地中心坐标参考 [Hampton Downs](https://en.wikipedia.org/wiki/Hampton_Downs_Motorsport_Park)、[Taupō](https://en.wikipedia.org/wiki/Taupo_International_Motorsport_Park)、[Manfeild](https://en.wikipedia.org/wiki/Manfeild:_Circuit_Chris_Amon)。

定位需要 HTTPS、用户授权以及支持 Geolocation 的浏览器；`localhost` 可用于本机开发，但手机打开电脑的普通 HTTP 局域网地址不能使用定位。需要手机测试时部署到 HTTPS 静态站点。轨迹使用真实定位，但转速、水温、油门、刹车始终是模拟数据，不连接任何车辆。

拒绝精度超过 30 米的定位，排除过期定位、逆序时间、超过 5 秒的相邻采样间隔和超过 120 m/s 的跳点。计圈使用线段相交与时间插值。定位不可靠时当前圈可能丢弃；这不是经过实车标定的竞赛计时器。页面进入后台或检测到挂起时自动结束并保存，不承诺锁屏连续记录。

## 数据与范围

每 10 秒及结束时保存到 localStorage，历史记录可查看圈速、轨迹并导出完整 JSON（包含车辆模拟采样）。单次记录最多 60 分钟；浏览器容量不足时提示导出，内存中的记录仍可访问。清除站点数据会丢失记录，重要记录请导出。无账号、后端、云同步、真实 OBD 或视频功能。

文件：`dist/index.html` 页面、`dist/style.css` 样式、`dist/app.js` 浏览器交互、`dist/map-setup.js` 搜索/图钉/赛道设置、`dist/engine.js` 轨迹/计时核心，`tests/engine.test.js` 使用 Node 内置测试器。部署只需静态托管 `dist/`。

## 官方参考

- [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/guides/)
- [Mapbox GeoJSON 数据源](https://docs.mapbox.com/mapbox-gl-js/api/sources/)
- [Geolocation watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition)

- [Mapbox Search Box API](https://docs.mapbox.com/api/search/search-box/)


## 自定义路线与模拟

切换到「手机 GPS」并连接 Mapbox，点击「开始绘制路线」，在地图上按行驶顺序点击节点，结束绘制后输入名称并保存。顶部「当前赛道」可以选择已保存路线，再切回「路线模拟」开始沿路线自动模拟驾驶。路线保存在当前浏览器的 `apex.routes.v1`，可加载、编辑或删除；不支持跨设备自动同步。原有两条预制虚拟路线已移除。模拟车辆平均约 60 km/h，速度、发动机、油门与刹车均是模拟值；不是导航或真实车辆数据。
