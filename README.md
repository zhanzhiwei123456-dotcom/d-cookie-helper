# d-cookie-helper
京东Cookie一键配置到青龙面板 - 油猴脚本
# 京东Cookie助手 - 青龙面板自动配置

> 一键获取京东Cookie并自动配置到青龙面板，省时省力！

## 功能特点

- 🔍 **自动提取Cookie** - 支持HttpOnly Cookie读取，兼容电脑端和移动端
- 🚀 **一键发送到青龙** - 无需手动复制粘贴，自动配置环境变量
- 💾 **配置本地保存** - 青龙地址、用户名密码保存到本地
- 🎨 **可视化界面** - 简洁美观的浮动按钮和操作面板
- 💖 **免费开源** - 完全免费，自愿赞助

## 使用前提

1. 安装 **Tampermonkey** 浏览器扩展
   - Chrome: https://chrome.google.com/webstore/detail/tampermonkey
   - Edge: https://microsoftedge.microsoft.com/addons/detail/tampermonkey
   - Firefox: https://addons.mozilla.org/firefox/addon/tampermonkey/

2. 已部署 **青龙面板**
   - 如果还没有安装青龙面板，推荐使用 Docker 部署
   - 部署教程: https://github.com/whyour/qinglong

## 安装步骤

### 方法一：GreasyFork 安装（推荐）

1. 访问 [GreasyFork 脚本页面](https://greasyfork.org)
2. 点击搜索京东Cookie，"安装此脚本"
3. 浏览器扩展会自动识别并安装

### 方法二：手动安装

1. 下载本仓库中的 `jd-cookie-helper.user.js` 文件
2. 打开 Tampermonkey 扩展管理页面
3. 点击"实用工具"选项卡
4. 将文件URL粘贴到"从URL安装"输入框
5. 点击"安装"

## 使用教程

### 第一步：安装脚本

按照上述安装步骤完成脚本安装。

### 第二步：访问京东并登录

> ⚠️ **重要**：必须使用**移动端网站** `https://m.jd.com/` 登录京东账号

1. 在浏览器中打开 `https://m.jd.com/`
2. 使用账号密码或扫码登录京东
3. 确保已成功登录，可以看到用户信息

### 第三步：配置青龙面板

1. 点击页面右下角的 🍑 按钮打开助手面板
2. 在面板中填写青龙面板配置：
   - **青龙面板地址**: 例如 `http://localhost:5700`
   - **青龙用户名**: 你的青龙登录用户名
   - **青龙密码**: 你的青龙登录密码
3. 点击"保存配置"按钮（配置会保存到本地）

### 第四步：提取并发送Cookie

1. 确保已在移动端京东网站登录
2. 点击"提取Cookie"按钮
3. Cookie状态显示"✅ 已获取"后，点击"发送到青龙"
4. 等待发送成功提示

### 第五步：验证配置

1. 登录青龙面板后台
2. 进入"环境变量"页面
3. 确认 `JD_COOKIE` 环境变量已创建
4. 值为类似 `pt_key=AA...; pt_pin=xxx;` 的格式

## 常见问题

### Q: 为什么必须用手机端网站？

A: 京东在手机端（m.jd.com）会设置 `pt_key` 和 `pt_pin` 这两个Cookie，而电脑端京东网站可能不会设置或设置了不同的Cookie格式。青龙面板的京东脚本需要这两个字段才能正常工作。

### Q: GM_cookie 是什么？

A: `GM_cookie` 是 Tampermonkey 扩展提供的API，可以读取设置了 HttpOnly 属性的Cookie。这是本脚本能获取到 `pt_key` 的关键技术。

### Q: 提示"Cookie不完整"怎么办？

A: 请确保：
1. 已在 https://m.jd.com/ 登录京东账号
2. 登录后有用户信息显示
3. 尝试刷新页面后重新点击"提取Cookie"

### Q: 提示"jwt malformed"错误？

A: 这是青龙面板认证问题，请确认：
1. 青龙面板地址是否正确（包含 http:// 或 https://）
2. 用户名和密码是否正确
3. 青龙面板是否可以正常访问

### Q: Cookie信息安全吗？

A: 本脚本：
- ✅ 只在你的浏览器本地运行
- ✅ Cookie信息只发送到你自己配置的青龙面板
- ✅ 不会上传到任何第三方服务器
- ✅ 脚本代码开源可审查

## 更新日志

### v1.0
- 初始版本发布
- 支持HttpOnly Cookie读取
- 支持一键发送到青龙面板
- 添加赞助功能

## 免责声明

1. 本脚本仅供学习交流使用
2. 请勿用于任何商业用途
3. 使用本脚本产生的任何问题，概由使用者自行承担
4. 京东、青龙等 trademarks 归其各自所有者所有

## 许可证

本项目采用 MIT 许可证

## 赞赏支持

💖 如果这个工具对你有帮助，欢迎赞赏支持！

点击脚本面板底部的"🎁 赞赏支持"按钮查看二维码。

---

*如果觉得好用，请给个 Star ⭐*
