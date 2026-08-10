# JMHub

自动抓取 [jmcomicmi.net](https://jmcomicmi.net/) 发布页中的「内地网络、分流1、分流2」地址，并保存到 [`data/mirror.json`](data/mirror.json)。GitHub Actions 每小时第 17、47 分钟运行，也支持手动运行。

## Chrome 扩展

`extension/` 是 Manifest V3 扩展。加载该文件夹后，访问 `https://18comic.vip`、`https://18comic.ink` 及其子页面会保留原路径、查询参数和锚点，自动跳转到 JSON 中按「内地网络 → 分流1 → 分流2」顺序排列的首个镜像。

扩展优先通过以下加速地址读取数据：

`https://g.blfrp.cn/https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json`

如果加速地址失败，则回退到 GitHub Raw。

### 安装扩展

1. 打开 `chrome://extensions/`。
2. 启用“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库的 `extension` 文件夹。

### 手动更新

在仓库 Actions 页面手动运行 **Update mirror addresses**。工作流需要 `contents: write` 权限。
