# JMHub

JMHub 使用 GitHub Actions 定时抓取 [JM 镜像发布页](https://jmcomicmi.net/)，提取“内地网络、分流 1、分流 2”地址并保存到 [`data/mirror.json`](data/mirror.json)。

## GitHub Actions

- 每小时第 17、47 分钟自动运行。
- 支持在 Actions 页面手动运行 **Update mirror addresses**。
- 检测镜像的 HTTP 状态及重定向目标。
- `safe` 和重定向检测结果只用于展示，不再阻止浏览器尝试发布页给出的中国区地址。
- 数据没有变化时不会产生无意义提交。

## Chrome 扩展

扩展位于 [`extension/`](extension/)，使用 Manifest V3。

主要功能：

- 访问 `18comic.vip`、`18comic.ink` 及其子页面时转向安全的中国区镜像。
- 优先通过 `g.blfrp.cn` 加速读取 GitHub 上的镜像 JSON，失败后回退到 GitHub Raw。
- 始终按“内地网络 → 分流 1 → 分流 2”的顺序选择中国区地址。
- 直接访问 `jmcomic-zzz.one`、`jmcomic-zzz.org`，或主站自动跳到这些域名时，动态规则都会再次将请求改回当前首选中国区镜像。
- 弹窗显示镜像状态，并允许刷新、启停和手动选择安全线路。

## 安装扩展

1. 下载或克隆本仓库。
2. 打开 `chrome://extensions/`。
3. 启用“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择仓库中的 `extension` 文件夹。

更新测试版扩展时，建议先删除旧版本，再重新加载最新的 `extension` 文件夹，避免 Chrome 保留旧 service worker 或动态规则。

## 数据格式

`data/mirror.json` 中的 `checked` 对象包含每条候选线路的检测结果：

- `safe`: Actions 环境判断是否可直接访问，仅供参考，不决定扩展是否尝试该地址。
- `ok`: 是否获得成功响应。
- `status`: HTTP 状态码。
- `redirect_to`: 地址发生重定向时的目标。
