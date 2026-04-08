// ==UserScript==
// @name         京东Cookie一键配置到青龙
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  一键获取京东Cookie并自动配置到青龙面板，支持电脑端和移动端
// @author       JD Helper
// @match        https://*.jd.com/*
// @match        https://*.jd.hk/*
// @match        https://*.m.jd.com/*
// @match        https://m.jd.com/*
// @icon         data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🍑</text></svg>
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_cookie
// @connect     *
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // ============ 配置区域 ============
    const CONFIG = {
        // 青龙面板配置（首次使用时请在界面填写）
        QINGLONG_URL: '',      // 青龙面板地址，如 http://localhost:5700
        QINGLONG_USERNAME: '',  // 青龙用户名
        QINGLONG_PASSWORD: '',  // 青龙密码

        // 自动发送模式
        AUTO_SEND: false,  // true: 自动发送, false: 手动点击发送

        // 显示设置
        SHOW_NOTIFICATION: true,  // 显示桌面通知
        LOG_DETAILS: false  // 控制台输出详细信息
    };

    // ============ 主程序 ============
    class JDCookieHelper {
        constructor() {
            this.cookieData = {};
            this.init();
        }

        init() {
            this.createUI();
            this.bindEvents();
            this.autoExtractCookie();
        }

        // 创建浮动按钮
        createUI() {
            // 添加样式
            GM_addStyle(`
                .jd-cookie-helper-btn {
                    position: fixed;
                    top: 100px;
                    right: 20px;
                    width: 50px;
                    height: 50px;
                    background: linear-gradient(135deg, #e2231a 0%, #ff6b6b 100%);
                    border: none;
                    border-radius: 50%;
                    color: white;
                    font-size: 24px;
                    cursor: pointer;
                    z-index: 999999;
                    box-shadow: 0 4px 15px rgba(226, 35, 26, 0.4);
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .jd-cookie-helper-btn:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 20px rgba(226, 35, 26, 0.6);
                }
                .jd-cookie-helper-btn.sending {
                    animation: pulse 1s infinite;
                }
                @keyframes pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                }
                .jd-cookie-panel {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: white;
                    border-radius: 15px;
                    padding: 25px;
                    width: 450px;
                    max-width: 90vw;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    z-index: 1000000;
                    display: none;
                }
                .jd-cookie-panel.show {
                    display: block;
                    animation: fadeIn 0.3s ease;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
                    to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                }
                .jd-cookie-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0,0,0,0.5);
                    z-index: 999998;
                    display: none;
                }
                .jd-cookie-overlay.show {
                    display: block;
                }
                .jd-cookie-panel h3 {
                    margin: 0 0 15px 0;
                    color: #e2231a;
                    font-size: 18px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .jd-cookie-panel .cookie-preview {
                    background: #f5f5f5;
                    padding: 10px;
                    border-radius: 8px;
                    font-family: monospace;
                    font-size: 11px;
                    max-height: 150px;
                    overflow: auto;
                    word-break: break-all;
                    margin: 10px 0;
                    color: #666;
                }
                .jd-cookie-panel .status {
                    padding: 10px;
                    border-radius: 8px;
                    margin: 10px 0;
                    font-size: 13px;
                }
                .jd-cookie-panel .status.success {
                    background: #d4edda;
                    color: #155724;
                }
                .jd-cookie-panel .status.error {
                    background: #f8d7da;
                    color: #721c24;
                }
                .jd-cookie-panel .status.warning {
                    background: #fff3cd;
                    color: #856404;
                }
                .jd-cookie-panel .btn-group {
                    display: flex;
                    gap: 10px;
                    margin-top: 15px;
                }
                .jd-cookie-panel button {
                    flex: 1;
                    padding: 10px 15px;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: all 0.3s ease;
                }
                .jd-cookie-panel .btn-primary {
                    background: linear-gradient(135deg, #e2231a 0%, #ff6b6b 100%);
                    color: white;
                }
                .jd-cookie-panel .btn-primary:hover {
                    opacity: 0.9;
                    transform: translateY(-2px);
                }
                .jd-cookie-panel .btn-secondary {
                    background: #6c757d;
                    color: white;
                }
                .jd-cookie-panel .btn-secondary:hover {
                    background: #5a6268;
                }
                .jd-cookie-panel .btn-copy {
                    background: #28a745;
                    color: white;
                    margin-left: 10px;
                }
                .jd-cookie-panel .close-btn {
                    position: absolute;
                    top: 15px;
                    right: 15px;
                    background: none;
                    border: none;
                    font-size: 24px;
                    cursor: pointer;
                    color: #999;
                }
                .jd-cookie-panel .close-btn:hover {
                    color: #333;
                }
                .jd-cookie-panel .config-section {
                    margin-top: 15px;
                    padding-top: 15px;
                    border-top: 1px solid #eee;
                }
                .jd-cookie-panel .config-section label {
                    display: block;
                    margin-bottom: 5px;
                    font-weight: 500;
                    color: #333;
                }
                .jd-cookie-panel .config-section input {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid #ddd;
                    border-radius: 6px;
                    font-size: 13px;
                    box-sizing: border-box;
                }
                .jd-cookie-panel .config-section input:focus {
                    outline: none;
                    border-color: #e2231a;
                }
                .jd-cookie-panel .cookie-info {
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 0;
                    border-bottom: 1px solid #eee;
                    font-size: 13px;
                }
                .jd-cookie-panel .cookie-info:last-child {
                    border-bottom: none;
                }
                .jd-cookie-panel .cookie-info span:first-child {
                    color: #666;
                }
                .jd-cookie-panel .cookie-info span:last-child {
                    color: #333;
                    font-weight: 500;
                }
                .jd-cookie-panel .btn-sponsor {
                    transition: all 0.3s ease;
                }
                .jd-cookie-panel .btn-sponsor:hover {
                    opacity: 0.85;
                    transform: scale(1.05);
                }
                .jd-sponsor-modal {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: white;
                    border-radius: 15px;
                    padding: 30px;
                    width: 320px;
                    max-width: 90vw;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    z-index: 1000001;
                    display: none;
                    text-align: center;
                }
                .jd-sponsor-modal.show {
                    display: block;
                    animation: fadeIn 0.3s ease;
                }
                .jd-sponsor-modal h4 {
                    margin: 0 0 15px 0;
                    color: #e2231a;
                    font-size: 18px;
                }
                .jd-sponsor-modal p {
                    margin: 0 0 15px 0;
                    color: #666;
                    font-size: 13px;
                    line-height: 1.5;
                }
                .jd-sponsor-modal img {
                    max-width: 250px;
                    border-radius: 10px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                }
                .jd-sponsor-modal .close-sponsor {
                    margin-top: 15px;
                    background: #6c757d;
                    color: white;
                    border: none;
                    padding: 8px 25px;
                    border-radius: 20px;
                    cursor: pointer;
                    font-size: 13px;
                }
                .jd-sponsor-modal .close-sponsor:hover {
                    background: #5a6268;
                }
            `);

            // 创建按钮
            const btn = document.createElement('button');
            btn.className = 'jd-cookie-helper-btn';
            btn.innerHTML = '🍑';
            btn.title = '京东Cookie助手';
            document.body.appendChild(btn);

            // 创建遮罩层
            const overlay = document.createElement('div');
            overlay.className = 'jd-cookie-overlay';
            document.body.appendChild(overlay);

            // 创建面板
            const panel = document.createElement('div');
            panel.className = 'jd-cookie-panel';
            panel.innerHTML = `
                <button class="close-btn">&times;</button>
                <h3>🍑 京东Cookie助手</h3>

                <div class="cookie-info">
                    <span>账号</span>
                    <span id="jd-pin">未检测到登录</span>
                </div>
                <div class="cookie-info">
                    <span>Cookie状态</span>
                    <span id="jd-cookie-status" style="color: #ffc107;">⏳ 检测中...</span>
                </div>

                <div class="cookie-preview" id="cookie-preview">
                    点击"提取Cookie"按钮获取...
                </div>

                <div id="status-box"></div>

                <div class="btn-group">
                    <button class="btn-primary" id="btn-extract">🔍 提取Cookie</button>
                    <button class="btn-secondary" id="btn-copy">📋 复制</button>
                </div>

                <div class="btn-group">
                    <button class="btn-primary" id="btn-send-qinglong" style="flex: 2;">🚀 发送到青龙</button>
                    <button class="btn-secondary" id="btn-refresh">🔄 刷新</button>
                </div>

                <div class="config-section">
                    <label>青龙面板地址</label>
                    <input type="text" id="qinglong-url" placeholder="http://localhost:5700">

                    <label style="margin-top: 10px;">青龙用户名</label>
                    <input type="text" id="qinglong-username" placeholder="用户名">

                    <label style="margin-top: 10px;">青龙密码</label>
                    <input type="password" id="qinglong-password" placeholder="密码">

                    <button class="btn-secondary" id="btn-save-config" style="margin-top: 10px; width: 100%;">💾 保存配置</button>
                </div>

                <div style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #ddd; text-align: center;">
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: #888;">💖 免费应用 · 自愿赞助 · 感谢支持</p>
                    <button class="btn-sponsor" id="btn-sponsor" style="background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%); color: white; border: none; padding: 8px 20px; border-radius: 20px; cursor: pointer; font-size: 13px;">🎁 赞赏支持</button>
                </div>
            `;
            document.body.appendChild(panel);

            // 创建赞助模态框
            const sponsorModal = document.createElement('div');
            sponsorModal.className = 'jd-sponsor-modal';
            sponsorModal.innerHTML = `
                <h4>🎁 赞赏支持</h4>
                <p>感谢您的支持！<br>您的赞助是我继续开发的动力~</p>
                <img src="https://s3.bmp.ovh/2026/04/08/vQ7p1Pyi.jpg" alt="赞助二维码" id="sponsor-qrcode">
                <button class="close-sponsor">关闭</button>
            `;
            document.body.appendChild(sponsorModal);

            // 保存元素引用
            this.elements = {
                btn, overlay, panel, sponsorModal,
                cookiePreview: panel.querySelector('#cookie-preview'),
                statusBox: panel.querySelector('#status-box'),
                jdPin: panel.querySelector('#jd-pin'),
                cookieStatus: panel.querySelector('#jd-cookie-status'),
                qinglongUrl: panel.querySelector('#qinglong-url'),
                qinglongUsername: panel.querySelector('#qinglong-username'),
                qinglongPassword: panel.querySelector('#qinglong-password'),
                btnExtract: panel.querySelector('#btn-extract'),
                btnCopy: panel.querySelector('#btn-copy'),
                btnSend: panel.querySelector('#btn-send-qinglong'),
                btnRefresh: panel.querySelector('#btn-refresh'),
                btnSaveConfig: panel.querySelector('#btn-save-config'),
                btnSponsor: panel.querySelector('#btn-sponsor'),
                closeBtn: panel.querySelector('.close-btn'),
                closeSponsorBtn: sponsorModal.querySelector('.close-sponsor')
            };
        }

        // 绑定事件
        bindEvents() {
            const el = this.elements;

            // 按钮点击显示面板
            el.btn.addEventListener('click', () => this.showPanel());

            // 关闭面板
            el.closeBtn.addEventListener('click', () => this.hidePanel());
            el.overlay.addEventListener('click', () => this.hidePanel());

            // ESC键关闭
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') this.hidePanel();
            });

            // 提取Cookie
            el.btnExtract.addEventListener('click', () => this.extractCookie());

            // 复制Cookie
            el.btnCopy.addEventListener('click', () => this.copyCookie());

            // 发送到青龙
            el.btnSend.addEventListener('click', () => this.sendToQinglong());

            // 刷新
            el.btnRefresh.addEventListener('click', () => this.extractCookie());

            // 保存配置
            el.btnSaveConfig.addEventListener('click', () => this.saveConfig());

            // 赞助按钮
            el.btnSponsor.addEventListener('click', () => {
                el.sponsorModal.classList.add('show');
            });

            // 关闭赞助模态框
            el.closeSponsorBtn.addEventListener('click', () => {
                el.sponsorModal.classList.remove('show');
            });

            // 点击模态框外部关闭
            el.sponsorModal.addEventListener('click', (e) => {
                if (e.target === el.sponsorModal) {
                    el.sponsorModal.classList.remove('show');
                }
            });
        }

        showPanel() {
            this.elements.overlay.classList.add('show');
            this.elements.panel.classList.add('show');
            this.loadConfig();
            this.extractCookie();
        }

        hidePanel() {
            this.elements.overlay.classList.remove('show');
            this.elements.panel.classList.remove('show');
        }

        // 自动提取Cookie
        autoExtractCookie() {
            if (CONFIG.AUTO_SEND) {
                setTimeout(() => {
                    this.extractCookie();
                    // 支持电脑端和移动端Cookie检测
                    if ((this.cookieData.pt_pin && this.cookieData.pt_key) || 
                        (this.cookieData.pin || this.cookieData.unick)) {
                        this.sendToQinglong();
                    }
                }, 2000);
            }
        }

        // 提取Cookie
        extractCookie() {
            // 先用GM_cookie尝试获取HttpOnly Cookie
            if (typeof GM_cookie !== 'undefined') {
                GM_cookie.list({ url: window.location.origin + '/' }, (cookies, error) => {
                    if (cookies && cookies.length > 0) {
                        const cookieObj = {};
                        cookies.forEach(c => cookieObj[c.name] = c.value);
                        this.processCookie(cookieObj);
                    } else {
                        // GM_cookie失败，用document.cookie
                        this.extractFromDocument();
                    }
                });
            } else {
                this.extractFromDocument();
            }
        }

        // 从document提取
        extractFromDocument() {
            const el = this.elements;
            const cookies = document.cookie;
            
            if (!cookies) {
                this.showStatus('未检测到Cookie，请确保已登录京东！', 'warning');
                el.cookieStatus.textContent = '❌ 未登录';
                el.cookieStatus.style.color = '#dc3545';
                return;
            }

            const cookieObj = {};
            cookies.split(';').forEach(c => {
                const [key, value] = c.trim().split('=');
                if (key && value) cookieObj[key.trim()] = value.trim();
            });

            this.processCookie(cookieObj);
        }

        // 处理Cookie - 只获取pt_key和pt_pin
        processCookie(cookieObj) {
            const el = this.elements;
            
            // 必须有pt_key和pt_pin
            if (!cookieObj.pt_key || !cookieObj.pt_pin) {
                this.showStatus('未检测到pt_key，请尝试电脑端登录', 'error');
                el.cookieStatus.textContent = '❌ Cookie不完整';
                el.cookieStatus.style.color = '#dc3545';
                return;
            }

            this.cookieData = cookieObj;

            // 直接使用pt_key和pt_pin
            const cookieStr = `pt_key=${cookieObj.pt_key}; pt_pin=${cookieObj.pt_pin};`;
            
            el.cookieStatus.textContent = '✅ 已获取';
            el.cookieStatus.style.color = '#28a745';
            el.jdPin.textContent = cookieObj.pt_pin;
            el.cookiePreview.textContent = cookieStr;
            this.showStatus('Cookie提取成功！可以发送到青龙了。', 'success');

            if (CONFIG.LOG_DETAILS) {
                console.log('【京东Cookie助手】Cookie提取成功:', cookieObj);
            }
        }

        // 复制Cookie
        async copyCookie() {
            const el = this.elements;
            const cookieStr = el.cookiePreview.textContent;
            if (!cookieStr || cookieStr.includes('点击"提取Cookie"')) {
                this.showStatus('请先提取Cookie！', 'warning');
                return;
            }

            try {
                await navigator.clipboard.writeText(cookieStr);
                this.showStatus('Cookie已复制到剪贴板！', 'success');
            } catch (error) {
                // 降级方案
                const textarea = document.createElement('textarea');
                textarea.value = cookieStr;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                this.showStatus('Cookie已复制到剪贴板！', 'success');
            }
        }

        // 发送到青龙
        async sendToQinglong() {
            const url = this.elements.qinglongUrl.value.trim();
            const username = this.elements.qinglongUsername.value.trim();
            const password = this.elements.qinglongPassword.value.trim();

            if (!url || !username || !password) {
                this.showStatus('请先配置青龙面板地址、用户名和密码！', 'warning');
                return;
            }

            const cookieStr = this.elements.cookiePreview.textContent;
            if (!cookieStr || cookieStr.includes('点击"提取Cookie"')) {
                this.showStatus('请先提取Cookie！', 'warning');
                return;
            }

            this.elements.btnSend.classList.add('sending');
            this.showStatus('正在登录青龙...', 'warning');

            try {
                // 第一步：登录青龙获取Token
                const loginResponse = await this.loginQinglong(url, username, password);
                
                if (!loginResponse.code || loginResponse.code !== 200) {
                    this.showStatus('青龙登录失败: ' + (loginResponse.message || '用户名或密码错误'), 'error');
                    return;
                }

                const token = loginResponse.data.token;
                if (!token) {
                    this.showStatus('青龙登录失败: 未获取到Token', 'error');
                    return;
                }

                this.showStatus('登录成功，正在发送Cookie...', 'warning');

                // 第二步：用Token发送Cookie
                const apiUrl = `${url}/api/envs`;
                const sendResponse = await this.requestQinglong(apiUrl, token, cookieStr);

                if (sendResponse.code === 200) {
                    this.showStatus('✅ 成功配置到青龙！Cookie已更新。', 'success');
                    this.notifySuccess();
                } else {
                    this.showStatus('青龙返回: ' + (sendResponse.message || '未知错误'), 'error');
                }

            } catch (error) {
                console.error('【京东Cookie助手】发送失败:', error);
                this.showStatus('发送失败: ' + error.message, 'error');
            } finally {
                this.elements.btnSend.classList.remove('sending');
            }
        }

        // 青龙登录
        loginQinglong(url, username, password) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `${url}/api/user/login`,
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    data: JSON.stringify({
                        username: username,
                        password: password
                    }),
                    onload: (response) => {
                        try {
                            const data = JSON.parse(response.responseText);
                            resolve(data);
                        } catch (e) {
                            resolve({ code: 500, message: '登录响应解析失败' });
                        }
                    },
                    onerror: (error) => {
                        reject(new Error('青龙登录失败，请检查面板地址'));
                    }
                });
            });
        }

        // 青龙API请求
        requestQinglong(url, token, cookieStr) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: url,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    // /api/envs 需要数组格式
                    data: JSON.stringify([{
                        name: 'JD_COOKIE',
                        value: cookieStr,
                        remarks: '京东Cookie - 油猴脚本自动配置'
                    }]),
                    onload: (response) => {
                        try {
                            const data = JSON.parse(response.responseText);
                            resolve(data);
                        } catch (e) {
                            resolve({ code: response.status, message: response.responseText });
                        }
                    },
                    onerror: (error) => {
                        reject(new Error('网络请求失败，请检查青龙面板地址是否正确'));
                    }
                });
            });
        }

        // 保存配置
        saveConfig() {
            const url = this.elements.qinglongUrl.value.trim();
            const username = this.elements.qinglongUsername.value.trim();
            const password = this.elements.qinglongPassword.value.trim();

            GM_setValue('qinglong_url', url);
            GM_setValue('qinglong_username', username);
            GM_setValue('qinglong_password', password);

            this.showStatus('配置已保存！', 'success');
        }

        // 加载配置
        loadConfig() {
            const url = GM_getValue('qinglong_url', CONFIG.QINGLONG_URL);
            const username = GM_getValue('qinglong_username', CONFIG.QINGLONG_USERNAME);
            const password = GM_getValue('qinglong_password', CONFIG.QINGLONG_PASSWORD);

            this.elements.qinglongUrl.value = url;
            this.elements.qinglongUsername.value = username;
            this.elements.qinglongPassword.value = password;
        }

        // 显示状态
        showStatus(message, type) {
            const el = this.elements.statusBox;
            const iconMap = {
                success: '✅',
                error: '❌',
                warning: '⚠️'
            };

            el.innerHTML = `<div class="status ${type}">${iconMap[type]} ${message}</div>`;

            // 3秒后清除成功/警告消息
            if (type !== 'error') {
                setTimeout(() => {
                    if (el.innerHTML.includes(message)) {
                        el.innerHTML = '';
                    }
                }, 3000);
            }
        }

        // 通知成功
        notifySuccess() {
            if (CONFIG.SHOW_NOTIFICATION && Notification.permission === 'granted') {
                new Notification('京东Cookie助手', {
                    body: 'Cookie已成功配置到青龙面板！',
                    icon: '✅'
                });
            }
        }
    }

    // 初始化
    const el = document.createElement('div');
    document.body.appendChild(el);

    // 等待页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new JDCookieHelper());
    } else {
        new JDCookieHelper();
    }

})();
