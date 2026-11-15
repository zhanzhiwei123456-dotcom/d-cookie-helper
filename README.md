# 京东Cookie助手 - 青龙面板自动配置

> 一键获取京东Cookie并自动配置到青龙面板，省时省力！

> 原作者：[zhanzhiwei123456-dotcom/d-cookie-helper](https://github.com/zhanzhiwei123456-dotcom/d-cookie-helper)，本仓库为个人维护的 fork。

## 功能特点

- 🔍 **自动提取Cookie** - 跨 `.jd.com` 各子域读取，支持 HttpOnly 的 `pt_key`，兼容电脑端和移动端
- 🧩 **多脚本管理器兼容** - 支持 Tampermonkey、Violentmonkey、ScriptCat 的 Cookie API
- 🩺 **失败原因诊断** - 明确区分「未登录」「HttpOnly 权限未开启」「管理器不支持」
- ✍️ **手动粘贴兜底** - 自动获取失败时可直接粘贴 `pt_key/pt_pin`
- 🚀 **一键发送到青龙** - 按 `pt_pin` 更新或追加，不会重复创建 `JD_COOKIE`
- 💾 **配置本地保存** - 青龙地址、用户名密码保存到本地
- 🎨 **双页签可视化界面** - 「获取 Cookie」与「青龙配置」分开展示，操作更清晰
- 💖 **免费开源** - 完全免费，自愿赞助

## 使用前提

1. 安装脚本管理器（任选其一）
   - **Tampermonkey 5.3+**：Chrome / Edge / Firefox
     - Chrome: https://chrome.google.com/webstore/detail/tampermonkey
     - Edge: https://microsoftedge.microsoft.com/addons/detail/tampermonkey
     - Firefox: https://addons.mozilla.org/firefox/addon/tampermonkey/
   - **Violentmonkey** 或 **ScriptCat**（对 HttpOnly Cookie 支持更直接）

   > ⚠️ 京东的 `pt_key` 是 **HttpOnly Cookie**，普通 `document.cookie` 读不到。
   > 使用 Tampermonkey 时请务必开启 HttpOnly Cookie 访问权限：
   > **设置 → 配置模式「高级」→ 允许访问 HttpOnly Cookie**（不同版本菜单名称略有差异）；
   > 或直接使用 Tampermonkey Beta、Violentmonkey（设置中开启 HTTP-only 权限）、ScriptCat。

2. 已部署 **青龙面板**
   - 如果还没有安装青龙面板，推荐使用 Docker 部署
   - 部署教程: https://github.com/whyour/qinglong

## 安装步骤

### 手动安装

1. 一键安装链接（Tampermonkey 会直接弹出安装页）：
   https://www.tampermonkey.net/script_installation.php#url=https://github.com/junyi5d/jd-cookie-helper/raw/refs/heads/main/jd-cookie-helper.user.js
2. 或下载本仓库中的 `jd-cookie-helper.user.js` 文件
3. 打开 Tampermonkey 扩展管理页面
4. 点击"实用工具"选项卡
5. 将文件URL粘贴到"从URL安装"输入框
6. 点击"安装"

## 使用教程

### 第一步：安装脚本

按照上述安装步骤完成脚本安装。

### 第二步：访问京东并登录

> ⚠️ **建议使用移动端页面**：`https://m.jd.com/` 或 `https://home.m.jd.com/myJd/newhome.action`

1. 在浏览器中打开上述地址
2. 使用账号密码或扫码登录京东
3. 登录成功后停留在该页面（脚本面板右上角会显示当前账号 `pt_pin`）

### 第三步：配置青龙面板

1. 点击页面右上角的 🍑 按钮打开助手面板
2. 切换到「**⚙️ 青龙配置**」页签，填写：
   - **青龙面板地址**: 例如 `http://localhost:5700`
   - **青龙用户名**: 你的青龙登录用户名
   - **青龙密码**: 你的青龙登录密码
3. 点击"保存配置"按钮（配置会保存到本地）

### 第四步：提取并发送Cookie

1. 确保已登录京东
2. 切换到「**🔐 获取 Cookie**」页签
3. 点击"提取 Cookie"按钮
4. Cookie状态显示"✅ 已获取"后，点击"发送到青龙"
5. 等待发送成功提示

> 若自动获取失败，面板会给出具体原因。此时可：
> - 按提示开启脚本管理器的 HttpOnly Cookie 权限后重试；或
> - 在「获取 Cookie」页签底部展开「自动获取失败？手动粘贴 Cookie」，粘贴 `pt_key=...; pt_pin=...;` 后点击「使用此 Cookie」。

### 第五步：验证配置

1. 登录青龙面板后台
2. 进入"环境变量"页面
3. 确认 `JD_COOKIE` 环境变量已创建
4. 值为类似 `pt_key=AA...; pt_pin=xxx;` 的格式

## 常见问题

### Q: 为什么推荐使用手机端网站？

A: 京东在移动端（`m.jd.com` / `home.m.jd.com`）登录后一定会写入 `pt_key` 和 `pt_pin`，且 `pt_key` 通常是 HttpOnly Cookie。青龙的京东脚本需要这两个字段才能工作。电脑端也可以登录，但部分环境不会下发 `pt_key`。

### Q: 为什么读取不到 `pt_key`（只读到其他 Cookie）？

A: `pt_key` 是 **HttpOnly Cookie**，必须通过脚本管理器的 Cookie API 才能读取：
1. **Tampermonkey**：升级到 5.3 及以上，并在设置中开启「允许访问 HttpOnly Cookie」；必要时安装 Tampermonkey Beta。
2. **Violentmonkey**：在扩展设置和脚本设置中开启 HTTP-only Cookie 权限。
3. **ScriptCat**：默认支持。
4. 如果仍然失败，可在「获取 Cookie」页签底部手动粘贴 `pt_key=...; pt_pin=...;` 使用。

### Q: 提示"Cookie不完整"怎么办？

A: 请确保：
1. 已在 `https://m.jd.com/` 或 `https://home.m.jd.com/myJd/newhome.action` 登录京东账号
2. 已按上面的说明开启 HttpOnly Cookie 权限
3. 刷新页面后重新点击"提取Cookie"，或使用手动粘贴

### Q: 发送到青龙后会创建重复的 `JD_COOKIE` 吗？

A: 不会。脚本会先查询已有 `JD_COOKIE`，并按 `pt_pin` 判断账号：
- 同一账号：替换原值；
- 新账号：以换行追加到已有变量末尾，支持多账号。

### Q: 提示"jwt malformed"或登录失败？

A: 这是青龙面板认证问题，请确认：
1. 青龙面板地址是否正确（可只填 `localhost:5700`，脚本会自动补 `http://`）
2. 用户名和密码是否正确
3. 青龙面板是否可以正常访问
4. 青龙版本是否 ≥ 2.9（过旧版本 API 不兼容）

### Q: Cookie信息安全吗？

A: 本脚本：
- ✅ 只在你的浏览器本地运行
- ✅ Cookie信息只发送到你自己配置的青龙面板
- ✅ 不会上传到任何第三方服务器
- ✅ 脚本代码开源可审查

## 更新日志

### v1.2.0
- 面板界面重做：渐变头部、账户信息卡片、按钮与输入框全面美化
- 配置与获取拆分为「🔐 获取 Cookie」「⚙️ 青龙配置」两个页签
- 页签切换带过渡动画，面板支持内容区滚动与移动端适配
- 发送时若未配置青龙，自动跳转到配置页签并提示
- 赞赏二维码更新：微信支付与支付宝裁剪后合并为一张图，去除卡片背景与多余文字，微信码中心改为微信图标
- 修复面板右上角关闭按钮悬停时「×」偏离中心的问题（改用 SVG 图标）

### v1.1.0
- 修复无法获取京东 Cookie 的问题：改为跨 `.jd.com` 各子域查询，兼容 Tampermonkey / Violentmonkey / ScriptCat 三种 Cookie API 形态
- 增加失败原因诊断：区分「未登录」「HttpOnly 权限未开启」「管理器不支持」，并给出对应解决方式
- 增加「打开移动端京东登录页」和「手动粘贴 Cookie」兜底入口
- 修复发送青龙时重复创建 `JD_COOKIE` 的问题：按 `pt_pin` 更新或追加，支持多账号
- 发送前自动保存青龙配置；补充请求超时与错误提示
- 增加 `@updateURL` / `@downloadURL`，便于自动更新

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
