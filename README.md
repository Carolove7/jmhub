# JMHub

自动监测镜像发布页并提供油猴自动跳转。

## 工作方式

1. GitHub Actions 每 30 分钟抓取 `https://jmcomicmi.net/`。
2. 根据发布页中的「国际通用网络 / 内地网络 / 分流1 / 分流2」栏目提取地址。
3. 从 GitHub Actions 环境检查地址是否可访问。
4. 将最新结果保存到 `data/mirror.json`。
5. 油猴脚本读取 `mirror.json`，访问国际通用地址时优先使用内地地址，随后按分流1、分流2回退。

## 油猴脚本

安装：

`https://raw.githubusercontent.com/Carolove7/jmhub/main/jmhub.user.js`

安装一次即可。镜像地址变化后不需要重新安装脚本，脚本会读取最新的 `mirror.json`。

## GitHub Actions

可以在仓库的 **Actions → Update mirror addresses → Run workflow** 手动执行一次。

定时任务默认每小时的第 17、47 分钟运行，避免集中在整点执行。
