// ==UserScript==
// @name         京东Cookie一键配置到青龙
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  一键获取京东Cookie并自动配置到青龙面板，支持电脑端和移动端
// @author       JD Helper
// @match        https://jd.com/*
// @match        https://*.jd.com/*
// @match        https://jd.hk/*
// @match        https://*.jd.hk/*
// @icon         data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🍑</text></svg>
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_cookie
// @connect      jd.com
// @connect      *
// @run-at       document-idle
// @noframes
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/zhanzhiwei123456-dotcom/d-cookie-helper/main/jd-cookie-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/zhanzhiwei123456-dotcom/d-cookie-helper/main/jd-cookie-helper.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ============ 配置区域 ============
    const CONFIG = {
        // 青龙面板配置（首次使用时请在界面填写）
        QINGLONG_URL: '',       // 青龙面板地址，如 http://localhost:5700
        QINGLONG_USERNAME: '',  // 青龙用户名
        QINGLONG_PASSWORD: '',  // 青龙密码

        // 自动发送模式
        AUTO_SEND: false,       // true: 自动发送, false: 手动点击发送

        // 显示设置
        SHOW_NOTIFICATION: true, // 显示桌面通知
        LOG_DETAILS: false       // 控制台输出详细信息
    };

    // 京东 Cookie 可能存在的域名（pt_key / pt_pin 通常挂在 .jd.com 上）
    const COOKIE_QUERIES = [
        { domain: '.jd.com' },
        { domain: 'jd.com' },
        { url: 'https://m.jd.com/' },
        { url: 'https://www.jd.com/' },
        { url: 'https://home.m.jd.com/' },
        { url: 'https://my.m.jd.com/' },
        { url: 'https://passport.jd.com/' },
        { domain: '.jd.hk' }
    ];

    const ICON = {
        success: '✅',
        error: '❌',
        warning: '⚠️'
    };

    // ============ Cookie 读取工具 ============

    // 不同脚本管理器的 GM_cookie 形态不同：
    // - Tampermonkey: GM_cookie.list(details, callback)
    // - Violentmonkey: GM.cookie.list(details) => Promise / GM_cookie.list(details) => Promise
    // - ScriptCat: GM_cookie('list', details, callback)
    function hasCookieAPI() {
        try {
            if (typeof GM_cookie !== 'undefined' && GM_cookie) {
                if (typeof GM_cookie.list === 'function' || typeof GM_cookie === 'function') {
                    return true;
                }
            }
            if (typeof GM !== 'undefined' && GM && GM.cookie && typeof GM.cookie.list === 'function') {
                return true;
            }
        } catch (e) {
            // ignore
        }
        return false;
    }

    // 统一成 Promise，超时兜底，避免某个管理器不回调导致界面卡死
    function queryCookies(details) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (cookies, error) => {
                if (settled) return;
                settled = true;
                resolve({
                    cookies: Array.isArray(cookies) ? cookies : [],
                    error: error || null
                });
            };
            const timer = setTimeout(() => finish([], new Error('GM_cookie 调用超时')), 3000);

            try {
                if (typeof GM_cookie !== 'undefined' && GM_cookie) {
                    // Tampermonkey 标准写法
                    if (typeof GM_cookie.list === 'function') {
                        const ret = GM_cookie.list(details, (cookies, error) => {
                            clearTimeout(timer);
                            finish(cookies, error);
                        });
                        if (ret && typeof ret.then === 'function') {
                            ret.then((cookies) => { clearTimeout(timer); finish(cookies); })
                                .catch((e) => { clearTimeout(timer); finish([], e); });
                        }
                        return;
                    }
                    // ScriptCat 写法
                    if (typeof GM_cookie === 'function') {
                        const ret = GM_cookie('list', details, (cookies, error) => {
                            clearTimeout(timer);
                            finish(cookies, error);
                        });
                        if (ret && typeof ret.then === 'function') {
                            ret.then((cookies) => { clearTimeout(timer); finish(cookies); })
                                .catch((e) => { clearTimeout(timer); finish([], e); });
                        }
                        return;
                    }
                }
                // Violentmonkey / 新版 Tampermonkey
                if (typeof GM !== 'undefined' && GM && GM.cookie && typeof GM.cookie.list === 'function') {
                    GM.cookie.list(details)
                        .then((cookies) => { clearTimeout(timer); finish(cookies); })
                        .catch((e) => { clearTimeout(timer); finish([], e); });
                    return;
                }
                clearTimeout(timer);
                finish([], new Error('当前脚本管理器不支持 GM_cookie'));
            } catch (e) {
                clearTimeout(timer);
                finish([], e);
            }
        });
    }

    // 解析 document.cookie（无法读取 HttpOnly，仅作兜底）
    function parseCookieString(str) {
        const map = {};
        if (!str) return map;
        str.split(';').forEach((segment) => {
            const index = segment.indexOf('=');
            if (index > 0) {
                const key = segment.slice(0, index).trim();
                const value = segment.slice(index + 1).trim();
                if (key) map[key] = value;
            }
        });
        return map;
    }

    function safeDecode(value) {
        try {
            return decodeURIComponent(value);
        } catch (e) {
            return value;
        }
    }

    /**
     * 汇总京东所有相关域名下的 Cookie
     * @returns {Promise<{cookieMap: Object, storeSupported: boolean, storeReadable: boolean}>}
     */
    async function collectCookieMap() {
        const cookieMap = {};
        const storeSupported = hasCookieAPI();
        let storeReadable = false;

        if (storeSupported) {
            const results = await Promise.all(COOKIE_QUERIES.map((query) => queryCookies(query)));
            results.forEach(({ cookies }) => {
                if (cookies.length) storeReadable = true;
                cookies.forEach((cookie) => {
                    // 同名 Cookie 保留先取到的（域越具体越优先由查询顺序保证）
                    if (cookie && cookie.name && cookieMap[cookie.name] === undefined) {
                        cookieMap[cookie.name] = cookie.value;
                    }
                });
            });
        }

        // document.cookie 兜底：能读到 pt_key 时说明未被 HttpOnly 限制
        const docCookies = parseCookieString(document.cookie);
        Object.keys(docCookies).forEach((name) => {
            if (cookieMap[name] === undefined) {
                cookieMap[name] = docCookies[name];
            }
        });

        if (CONFIG.LOG_DETAILS) {
            console.log('【京东Cookie助手】读取到的 Cookie:', cookieMap);
        }

        return { cookieMap, storeSupported, storeReadable };
    }

    // ============ Cookie 处理工具 ============
    function normalizeQinglongUrl(url) {
        let result = (url || '').trim().replace(/\/+$/, '');
        if (!result) return '';
        if (!/^https?:\/\//i.test(result)) {
            result = 'http://' + result;
        }
        return result;
    }

    // ============ 主程序 ============
    class JDCookieHelper {
        constructor() {
            this.cookieData = null;      // { pt_key, pt_pin, pt_pin_decoded }
            this.cookieString = '';      // pt_key=xxx; pt_pin=yyy;
            this.init();
        }

        init() {
            if (!document.body) {
                document.addEventListener('DOMContentLoaded', () => this.init());
                return;
            }
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
                    max-height: 90vh;
                    overflow-y: auto;
                    box-sizing: border-box;
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
                    line-height: 1.5;
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
                .jd-cookie-panel .config-section input,
                .jd-cookie-panel .config-section textarea {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid #ddd;
                    border-radius: 6px;
                    font-size: 13px;
                    box-sizing: border-box;
                }
                .jd-cookie-panel .config-section textarea {
                    min-height: 64px;
                    font-family: monospace;
                    font-size: 12px;
                    resize: vertical;
                }
                .jd-cookie-panel .config-section input:focus,
                .jd-cookie-panel .config-section textarea:focus {
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
                    text-align: right;
                    word-break: break-all;
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

            // ===== v1.2 新界面样式（覆盖上方基础样式） =====
            GM_addStyle(`
                .jd-cookie-overlay {
                    background: rgba(17, 24, 39, 0.45);
                    backdrop-filter: blur(2px);
                    -webkit-backdrop-filter: blur(2px);
                }
                .jd-cookie-helper-btn {
                    width: 54px;
                    height: 54px;
                    background: linear-gradient(135deg, #e2231a 0%, #ff5b4d 100%);
                    box-shadow: 0 10px 24px rgba(226, 35, 26, 0.35);
                    border: 2px solid rgba(255, 255, 255, 0.9);
                }
                .jd-cookie-helper-btn:hover {
                    transform: scale(1.08) rotate(-4deg);
                    box-shadow: 0 14px 30px rgba(226, 35, 26, 0.45);
                }
                .jd-cookie-panel {
                    padding: 0;
                    width: 480px;
                    max-width: calc(100vw - 24px);
                    max-height: 88vh;
                    border-radius: 20px;
                    overflow: hidden;
                    display: none;
                    flex-direction: column;
                    background: #ffffff;
                    color: #1f2329;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
                    box-shadow: 0 24px 70px rgba(16, 24, 40, 0.28), 0 2px 8px rgba(16, 24, 40, 0.08);
                    transform: translate(-50%, -50%);
                }
                .jd-cookie-panel.show {
                    display: flex;
                    animation: jdPanelIn 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
                }
                @keyframes jdPanelIn {
                    from { opacity: 0; transform: translate(-50%, -50%) scale(0.94); }
                    to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                }
                .jd-cookie-panel .panel-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 20px 56px 14px 22px;
                    background: linear-gradient(135deg, #fff5f4 0%, #ffffff 62%);
                }
                .jd-cookie-panel .panel-logo {
                    width: 44px;
                    height: 44px;
                    flex: 0 0 44px;
                    border-radius: 14px;
                    background: linear-gradient(135deg, #e2231a 0%, #ff6f61 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 22px;
                    box-shadow: 0 8px 18px rgba(226, 35, 26, 0.28);
                }
                .jd-cookie-panel .panel-title {
                    min-width: 0;
                }
                .jd-cookie-panel .panel-title h3 {
                    margin: 0;
                    color: #1f2329;
                    font-size: 17px;
                    font-weight: 700;
                    line-height: 1.3;
                    display: block;
                }
                .jd-cookie-panel .panel-title p {
                    margin: 3px 0 0;
                    color: #8a919c;
                    font-size: 12px;
                    line-height: 1.4;
                }
                .jd-cookie-panel .panel-badge {
                    margin-left: auto;
                    flex: 0 0 auto;
                    padding: 3px 9px;
                    border-radius: 999px;
                    background: #fff0ef;
                    border: 1px solid #ffd9d6;
                    color: #e2231a;
                    font-size: 11px;
                    font-weight: 600;
                }
                .jd-cookie-panel .close-btn {
                    position: absolute;
                    top: 14px;
                    right: 14px;
                    width: 30px;
                    height: 30px;
                    flex: 0 0 auto;
                    padding: 0;
                    border-radius: 50%;
                    background: #f2f3f5;
                    color: #8a919c;
                    font-size: 20px;
                    line-height: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 2;
                    transition: transform 0.2s ease, background 0.2s ease, color 0.2s ease;
                }
                .jd-cookie-panel .close-btn:hover {
                    background: #e9eaec;
                    color: #1f2329;
                    transform: rotate(90deg);
                }
                .jd-cookie-panel .tab-bar {
                    display: flex;
                    gap: 6px;
                    margin: 4px 22px 0;
                    padding: 5px;
                    background: #f5f6f7;
                    border-radius: 13px;
                }
                .jd-cookie-panel .tab-btn {
                    flex: 1;
                    padding: 9px 8px;
                    border: none;
                    border-radius: 9px;
                    background: transparent;
                    color: #6b7280;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
                }
                .jd-cookie-panel .tab-btn:hover {
                    color: #1f2329;
                }
                .jd-cookie-panel .tab-btn.active {
                    background: #ffffff;
                    color: #e2231a;
                    box-shadow: 0 2px 8px rgba(16, 24, 40, 0.10);
                }
                .jd-cookie-panel .panel-body {
                    flex: 1 1 auto;
                    min-height: 0;
                    padding: 14px 22px 20px;
                    overflow-y: auto;
                    scrollbar-width: thin;
                }
                .jd-cookie-panel .panel-body::-webkit-scrollbar {
                    width: 6px;
                }
                .jd-cookie-panel .panel-body::-webkit-scrollbar-thumb {
                    background: #dcdfe4;
                    border-radius: 3px;
                }
                .jd-cookie-panel .tab-panel {
                    display: none;
                }
                .jd-cookie-panel .tab-panel.active {
                    display: block;
                    animation: jdTabIn 0.22s ease;
                }
                @keyframes jdTabIn {
                    from { opacity: 0; transform: translateY(5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .jd-cookie-panel #status-box:empty {
                    display: none;
                }
                .jd-cookie-panel .status {
                    padding: 11px 13px;
                    border-radius: 12px;
                    margin: 0 0 12px;
                    font-size: 12.5px;
                    line-height: 1.6;
                    border: 1px solid transparent;
                    animation: jdTabIn 0.2s ease;
                }
                .jd-cookie-panel .status.success {
                    background: #f0fbf3;
                    color: #11693b;
                    border-color: #c9efd6;
                }
                .jd-cookie-panel .status.error {
                    background: #fff2f1;
                    color: #a61b14;
                    border-color: #ffd6d3;
                }
                .jd-cookie-panel .status.warning {
                    background: #fff9e8;
                    color: #8a6100;
                    border-color: #ffe9ad;
                }
                .jd-cookie-panel .account-card {
                    background: #fafbfc;
                    border: 1px solid #eef0f3;
                    border-radius: 14px;
                    padding: 2px 14px;
                    margin-bottom: 12px;
                }
                .jd-cookie-panel .cookie-info {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 12px;
                    padding: 10px 0;
                    border-bottom: 1px solid #eef0f3;
                    font-size: 13px;
                }
                .jd-cookie-panel .cookie-info:last-child {
                    border-bottom: none;
                }
                .jd-cookie-panel .cookie-info span:first-child {
                    color: #8a919c;
                    flex: 0 0 auto;
                }
                .jd-cookie-panel .cookie-info span:last-child {
                    color: #1f2329;
                    font-weight: 600;
                    text-align: right;
                    word-break: break-all;
                }
                .jd-cookie-panel .cookie-preview {
                    background: #f7f8fa;
                    border: 1px dashed #e3e6ea;
                    border-radius: 12px;
                    padding: 12px;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                    font-size: 11px;
                    line-height: 1.6;
                    max-height: 120px;
                    overflow: auto;
                    word-break: break-all;
                    margin: 0 0 2px;
                    color: #667085;
                }
                .jd-cookie-panel button {
                    flex: 1;
                    padding: 11px 14px;
                    border: none;
                    border-radius: 11px;
                    font-size: 13.5px;
                    font-weight: 600;
                    font-family: inherit;
                    cursor: pointer;
                    transition: transform 0.15s ease, box-shadow 0.2s ease, background 0.2s ease, opacity 0.2s ease, border-color 0.2s ease, color 0.2s ease;
                }
                .jd-cookie-panel .btn-group {
                    display: flex;
                    gap: 10px;
                    margin-top: 12px;
                }
                .jd-cookie-panel .btn-primary {
                    background: linear-gradient(135deg, #e2231a 0%, #ff5b4d 100%);
                    color: #ffffff;
                    box-shadow: 0 6px 16px rgba(226, 35, 26, 0.25);
                }
                .jd-cookie-panel .btn-primary:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 9px 22px rgba(226, 35, 26, 0.32);
                    opacity: 1;
                }
                .jd-cookie-panel .btn-primary:active {
                    transform: translateY(0);
                }
                .jd-cookie-panel .btn-primary.sending {
                    opacity: 0.7;
                    pointer-events: none;
                }
                .jd-cookie-panel .btn-secondary {
                    background: #f2f3f5;
                    color: #3f4650;
                }
                .jd-cookie-panel .btn-secondary:hover {
                    background: #e9ebee;
                }
                .jd-cookie-panel .btn-ghost {
                    background: #ffffff;
                    color: #5a6270;
                    border: 1px solid #e3e6ea;
                }
                .jd-cookie-panel .btn-ghost:hover {
                    background: #fff7f6;
                    border-color: #ffc9c4;
                    color: #e2231a;
                }
                .jd-cookie-panel .btn-full {
                    width: 100%;
                    flex: none;
                }
                .jd-cookie-panel .manual-box {
                    margin-top: 14px;
                    border: 1px solid #eef0f3;
                    border-radius: 12px;
                    background: #fafbfc;
                    overflow: hidden;
                }
                .jd-cookie-panel .manual-box summary {
                    list-style: none;
                    cursor: pointer;
                    padding: 11px 14px;
                    font-size: 12.5px;
                    font-weight: 600;
                    color: #6b7280;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .jd-cookie-panel .manual-box summary::-webkit-details-marker {
                    display: none;
                }
                .jd-cookie-panel .manual-box summary::after {
                    content: "⌄";
                    color: #9aa1ab;
                    font-size: 14px;
                    transition: transform 0.2s ease;
                }
                .jd-cookie-panel .manual-box[open] summary::after {
                    transform: rotate(180deg);
                }
                .jd-cookie-panel .manual-inner {
                    padding: 0 14px 14px;
                }
                .jd-cookie-panel .manual-inner textarea {
                    width: 100%;
                    min-height: 64px;
                    padding: 10px 12px;
                    margin-bottom: 8px;
                    border: 1px solid #e3e6ea;
                    border-radius: 10px;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                    font-size: 12px;
                    line-height: 1.5;
                    color: #1f2329;
                    background: #ffffff;
                    box-sizing: border-box;
                    resize: vertical;
                }
                .jd-cookie-panel .manual-inner textarea:focus {
                    outline: none;
                    border-color: #ff8a80;
                    box-shadow: 0 0 0 3px rgba(226, 35, 26, 0.10);
                }
                .jd-cookie-panel .field {
                    margin-bottom: 13px;
                }
                .jd-cookie-panel .field label {
                    display: block;
                    margin-bottom: 6px;
                    font-size: 12.5px;
                    font-weight: 600;
                    color: #5a6270;
                }
                .jd-cookie-panel .field input {
                    width: 100%;
                    height: 42px;
                    padding: 0 12px;
                    border: 1px solid #e3e6ea;
                    border-radius: 11px;
                    background: #ffffff;
                    color: #1f2329;
                    font-size: 13.5px;
                    box-sizing: border-box;
                    transition: border-color 0.2s ease, box-shadow 0.2s ease;
                }
                .jd-cookie-panel .field input:focus {
                    outline: none;
                    border-color: #ff8a80;
                    box-shadow: 0 0 0 3px rgba(226, 35, 26, 0.10);
                }
                .jd-cookie-panel .hint {
                    margin-top: 13px;
                    padding: 11px 13px;
                    border: 1px solid #eef0f3;
                    border-radius: 12px;
                    background: #fafbfc;
                    color: #8a919c;
                    font-size: 12px;
                    line-height: 1.7;
                }
                .jd-cookie-panel .sponsor-box {
                    margin-top: 18px;
                    padding-top: 14px;
                    border-top: 1px dashed #e9ebee;
                    text-align: center;
                }
                .jd-cookie-panel .sponsor-box p {
                    margin: 0 0 8px;
                    font-size: 11.5px;
                    color: #9aa1ab;
                }
                .jd-cookie-panel .btn-sponsor {
                    flex: none;
                    padding: 8px 20px;
                    border-radius: 999px;
                    background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
                    color: #ffffff;
                    font-size: 12.5px;
                    box-shadow: 0 4px 12px rgba(238, 90, 90, 0.25);
                }
                .jd-cookie-panel .btn-sponsor:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 7px 16px rgba(238, 90, 90, 0.32);
                }
                .jd-sponsor-modal {
                    border-radius: 20px;
                    padding: 28px 26px;
                    box-shadow: 0 24px 70px rgba(16, 24, 40, 0.30);
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
                <button class="close-btn" aria-label="关闭">&times;</button>

                <div class="panel-header">
                    <div class="panel-logo">🍑</div>
                    <div class="panel-title">
                        <h3>京东 Cookie 助手</h3>
                        <p>一键同步登录态到青龙面板</p>
                    </div>
                    <span class="panel-badge">v1.2.0</span>
                </div>

                <div class="tab-bar" role="tablist">
                    <button class="tab-btn active" data-tab="cookie" role="tab" aria-selected="true">🔐 获取 Cookie</button>
                    <button class="tab-btn" data-tab="config" role="tab" aria-selected="false">⚙️ 青龙配置</button>
                </div>

                <div class="panel-body">
                    <div id="status-box"></div>

                    <section class="tab-panel active" data-panel="cookie">
                        <div class="account-card">
                            <div class="cookie-info">
                                <span>账号</span>
                                <span id="jd-pin">未检测到登录</span>
                            </div>
                            <div class="cookie-info">
                                <span>Cookie 状态</span>
                                <span id="jd-cookie-status" style="color: #d48806;">⏳ 检测中...</span>
                            </div>
                            <div class="cookie-info">
                                <span>获取方式</span>
                                <span id="jd-cookie-source">-</span>
                            </div>
                        </div>

                        <div class="cookie-preview" id="cookie-preview">点击「提取 Cookie」获取登录凭证...</div>

                        <div class="btn-group">
                            <button class="btn-primary" id="btn-extract">🔍 提取 Cookie</button>
                            <button class="btn-secondary" id="btn-copy">📋 复制</button>
                        </div>

                        <div class="btn-group">
                            <button class="btn-primary" id="btn-send-qinglong" style="flex: 2;">🚀 发送到青龙</button>
                            <button class="btn-secondary" id="btn-refresh">🔄 刷新</button>
                        </div>

                        <div class="btn-group">
                            <button class="btn-ghost btn-full" id="btn-open-login">📱 打开移动端京东登录页</button>
                        </div>

                        <details class="manual-box">
                            <summary>自动获取失败？手动粘贴 Cookie</summary>
                            <div class="manual-inner">
                                <textarea id="manual-cookie" placeholder="pt_key=AAJ...; pt_pin=jd_xxx;"></textarea>
                                <button class="btn-secondary btn-full" id="btn-use-manual">✅ 使用此 Cookie</button>
                            </div>
                        </details>
                    </section>

                    <section class="tab-panel" data-panel="config">
                        <div class="field">
                            <label>青龙面板地址</label>
                            <input type="text" id="qinglong-url" placeholder="http://localhost:5700">
                        </div>
                        <div class="field">
                            <label>青龙用户名</label>
                            <input type="text" id="qinglong-username" placeholder="用户名">
                        </div>
                        <div class="field">
                            <label>青龙密码</label>
                            <input type="password" id="qinglong-password" placeholder="密码">
                        </div>

                        <button class="btn-primary btn-full" id="btn-save-config">💾 保存配置</button>

                        <div class="hint">
                            青龙地址可只填 <b>localhost:5700</b>，脚本会自动补全 http://<br>
                            账号密码仅保存在浏览器本地，不会上传到第三方。
                        </div>

                        <div class="sponsor-box">
                            <p>💖 免费应用 · 自愿赞助 · 感谢支持</p>
                            <button class="btn-sponsor" id="btn-sponsor">🎁 赞赏支持</button>
                        </div>
                    </section>
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
                cookieSource: panel.querySelector('#jd-cookie-source'),
                qinglongUrl: panel.querySelector('#qinglong-url'),
                qinglongUsername: panel.querySelector('#qinglong-username'),
                qinglongPassword: panel.querySelector('#qinglong-password'),
                manualCookie: panel.querySelector('#manual-cookie'),
                btnExtract: panel.querySelector('#btn-extract'),
                btnCopy: panel.querySelector('#btn-copy'),
                btnSend: panel.querySelector('#btn-send-qinglong'),
                btnRefresh: panel.querySelector('#btn-refresh'),
                btnOpenLogin: panel.querySelector('#btn-open-login'),
                btnUseManual: panel.querySelector('#btn-use-manual'),
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

            // 页签切换
            el.panel.querySelectorAll('.tab-btn').forEach((tabBtn) => {
                tabBtn.addEventListener('click', () => this.switchTab(tabBtn.dataset.tab));
            });

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

            // 打开移动端登录页
            el.btnOpenLogin.addEventListener('click', () => {
                window.open('https://home.m.jd.com/myJd/newhome.action', '_blank');
            });

            // 使用手动粘贴的 Cookie
            el.btnUseManual.addEventListener('click', () => this.useManualCookie());

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

        // 切换页签：cookie | config
        switchTab(tab) {
            const panel = this.elements.panel;
            panel.querySelectorAll('.tab-btn').forEach((btn) => {
                const active = btn.dataset.tab === tab;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            panel.querySelectorAll('.tab-panel').forEach((section) => {
                section.classList.toggle('active', section.dataset.panel === tab);
            });
        }

        // 自动提取Cookie
        autoExtractCookie() {
            if (CONFIG.AUTO_SEND) {
                setTimeout(() => {
                    this.extractCookie().then(() => {
                        if (this.cookieString) {
                            this.sendToQinglong();
                        }
                    });
                }, 2000);
            }
        }

        // 提取Cookie
        async extractCookie() {
            const el = this.elements;
            el.cookieStatus.textContent = '⏳ 检测中...';
            el.cookieStatus.style.color = '#ffc107';

            let result;
            try {
                result = await collectCookieMap();
            } catch (e) {
                this.showStatus('读取 Cookie 失败：' + (e && e.message ? e.message : e), 'error');
                el.cookieStatus.textContent = '❌ 读取失败';
                el.cookieStatus.style.color = '#dc3545';
                return;
            }

            const { cookieMap, storeSupported, storeReadable } = result;

            if (cookieMap.pt_key && cookieMap.pt_pin) {
                this.processCookie(cookieMap, 'GM_cookie');
                return;
            }

            // 失败诊断：区分「未登录」「HttpOnly 未授权」「管理器不支持」
            if (!cookieMap.pt_key) {
                const looksLoggedIn = ['pt_pin', 'pin', 'unick', 'thor', 'pt_token']
                    .some((name) => cookieMap[name]);

                if (!storeSupported) {
                    this.showStatus(
                        '无法读取 pt_key：当前脚本管理器没有可用的 GM_cookie。' +
                        '请升级到 Tampermonkey 5.3+ 并允许访问 HttpOnly Cookie，或改用 ScriptCat / Violentmonkey；' +
                        '也可以在下方手动粘贴 Cookie。',
                        'error'
                    );
                } else if (looksLoggedIn || storeReadable) {
                    this.showStatus(
                        '已读取到京东 Cookie，但缺少 HttpOnly 的 pt_key。' +
                        '请在脚本管理器设置中开启 HttpOnly Cookie 访问权限：' +
                        'Tampermonkey 需 5.3+，在设置中将配置模式切到「高级」后允许 GM_cookie 访问 HttpOnly Cookie（找不到时可直接安装 Tampermonkey Beta）；' +
                        'Violentmonkey 需开启 HTTP-only Cookie 权限。开启后刷新本页重试，或在下方手动粘贴 Cookie。',
                        'error'
                    );
                } else {
                    this.showStatus(
                        '未检测到京东登录态。请先点击下方「打开移动端京东登录页」并完成登录，' +
                        '登录成功后回到本页刷新重试。若已登录仍提示此项，请检查脚本管理器的 HttpOnly Cookie 权限。',
                        'warning'
                    );
                }
                el.cookieStatus.textContent = '❌ 未获取到 pt_key';
                el.cookieStatus.style.color = '#dc3545';
                el.cookieSource.textContent = '-';
                return;
            }

            // 有 pt_key 但没有 pt_pin
            this.showStatus('已获取 pt_key，但缺少 pt_pin，请重新登录京东后再试。', 'error');
            el.cookieStatus.textContent = '❌ Cookie 不完整';
            el.cookieStatus.style.color = '#dc3545';
            el.cookieSource.textContent = '-';
        }

        // 处理并保存 Cookie
        processCookie(cookieMap, source) {
            const el = this.elements;

            if (!cookieMap.pt_key || !cookieMap.pt_pin) {
                this.showStatus('Cookie 不完整，需要同时包含 pt_key 和 pt_pin。', 'error');
                el.cookieStatus.textContent = '❌ Cookie 不完整';
                el.cookieStatus.style.color = '#dc3545';
                return;
            }

            const rawPin = cookieMap.pt_pin;
            const decodedPin = safeDecode(rawPin);
            const cookieString = `pt_key=${cookieMap.pt_key}; pt_pin=${rawPin};`;

            this.cookieData = {
                pt_key: cookieMap.pt_key,
                pt_pin: rawPin,
                pt_pin_decoded: decodedPin
            };
            this.cookieString = cookieString;

            el.cookieStatus.textContent = '✅ 已获取';
            el.cookieStatus.style.color = '#28a745';
            el.jdPin.textContent = decodedPin;
            el.cookieSource.textContent = source;
            el.cookiePreview.textContent = cookieString;
            this.showStatus('Cookie 提取成功！可以复制或发送到青龙了。', 'success');

            if (CONFIG.LOG_DETAILS) {
                console.log('【京东Cookie助手】Cookie提取成功:', this.cookieData, '来源:', source);
            }
        }

        // 使用手动粘贴的 Cookie
        useManualCookie() {
            let text = (this.elements.manualCookie.value || '').trim();
            if (!text) {
                this.showStatus('请先粘贴 Cookie 内容。', 'warning');
                return;
            }

            // 兼容从开发者工具复制的格式："Cookie: pt_key=...; pt_pin=...;"
            text = text.replace(/^cookie\s*:\s*/i, '').replace(/^["']|["']$/g, '').trim();
            const cookieMap = parseCookieString(text);

            if (!cookieMap.pt_key || !cookieMap.pt_pin) {
                this.showStatus('粘贴的内容不完整，需要包含 pt_key 和 pt_pin。', 'error');
                return;
            }

            this.processCookie(cookieMap, '手动粘贴');
        }

        // 复制Cookie
        async copyCookie() {
            const el = this.elements;
            const cookieStr = this.cookieString;
            if (!cookieStr) {
                this.showStatus('请先提取 Cookie！', 'warning');
                return;
            }

            try {
                await navigator.clipboard.writeText(cookieStr);
                this.showStatus('Cookie 已复制到剪贴板！', 'success');
            } catch (error) {
                // 降级方案
                const textarea = document.createElement('textarea');
                textarea.value = cookieStr;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                try {
                    document.execCommand('copy');
                    this.showStatus('Cookie 已复制到剪贴板！', 'success');
                } catch (e) {
                    this.showStatus('复制失败，请手动选中下方预览内容复制。', 'error');
                }
                document.body.removeChild(textarea);
            }
        }

        // 青龙请求封装
        requestQinglong(method, url, token, body) {
            return new Promise((resolve, reject) => {
                const headers = {};
                if (body !== undefined) headers['Content-Type'] = 'application/json';
                if (token) headers['Authorization'] = `Bearer ${token}`;

                GM_xmlhttpRequest({
                    method,
                    url,
                    headers,
                    data: body !== undefined ? JSON.stringify(body) : undefined,
                    timeout: 15000,
                    onload: (response) => {
                        let data;
                        try {
                            data = JSON.parse(response.responseText);
                        } catch (e) {
                            reject(new Error(`青龙返回非 JSON 内容（HTTP ${response.status}）`));
                            return;
                        }
                        resolve({ status: response.status, data });
                    },
                    onerror: () => reject(new Error('无法连接青龙面板，请检查地址是否正确')),
                    ontimeout: () => reject(new Error('连接青龙面板超时'))
                });
            });
        }

        // 青龙登录，返回 token
        async loginQinglong(url, username, password) {
            const { data } = await this.requestQinglong(
                'POST',
                `${url}/api/user/login`,
                null,
                { username, password }
            );

            if (data.code !== 200) {
                throw new Error(data.message || '青龙登录失败，请检查用户名或密码');
            }
            const token = data.data && data.data.token;
            if (!token) {
                throw new Error('青龙登录成功但未返回 Token');
            }
            return token;
        }

        // 启用环境变量（失败不影响主流程）
        async enableEnvs(url, token, ids) {
            const validIds = (ids || []).filter((id) => id !== undefined && id !== null);
            if (!validIds.length) return;
            try {
                const { data } = await this.requestQinglong(
                    'PUT',
                    `${url}/api/envs/enable`,
                    token,
                    validIds
                );
                if (data.code !== 200) {
                    console.warn('【京东Cookie助手】启用环境变量失败:', data.message);
                }
            } catch (e) {
                console.warn('【京东Cookie助手】启用环境变量异常:', e);
            }
        }

        // 新增或更新 JD_COOKIE（按 pt_pin 去重，支持多账号）
        async upsertJDCOOKIE(url, token, cookieStr, rawPin, decodedPin) {
            const envName = 'JD_COOKIE';
            const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // pt_pin 可能是 URL 编码后的值，两种形式都要能识别；
            // 用 ; / 空白 / 行尾 作为边界，避免 jd_abc 误匹配 jd_abcd
            const pinValues = [rawPin, decodedPin].filter((pin, index, arr) => pin && arr.indexOf(pin) === index);
            const containsPin = (value) => {
                if (typeof value !== 'string') return false;
                return pinValues.some((pin) =>
                    new RegExp(`pt_pin=${escapeRegExp(pin)}(?:;|\\s|$)`).test(value)
                );
            };

            // 1. 查询已有 JD_COOKIE
            const { data: listData } = await this.requestQinglong(
                'GET',
                `${url}/api/envs?searchValue=${encodeURIComponent(envName)}`,
                token
            );
            if (listData.code !== 200) {
                throw new Error(listData.message || '查询青龙环境变量失败');
            }
            const envs = (Array.isArray(listData.data) ? listData.data : [])
                .filter((env) => env && env.name === envName);

            // 2. 不存在则创建
            if (envs.length === 0) {
                const { data: createData } = await this.requestQinglong(
                    'POST',
                    `${url}/api/envs`,
                    token,
                    [{ name: envName, value: cookieStr, remarks: decodedPin }]
                );
                if (createData.code !== 200) {
                    throw new Error(createData.message || '创建 JD_COOKIE 失败');
                }
                const newIds = (createData.data || []).map((env) => env.id);
                await this.enableEnvs(url, token, newIds);
                return '已创建 JD_COOKIE';
            }

            // 3. 已存在同一账号则替换该行
            const owner = envs.find((env) => containsPin(env.value));
            if (owner) {
                const lines = String(owner.value || '')
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean);
                const newValue = lines.length
                    ? lines.map((line) => (containsPin(line) ? cookieStr : line)).join('\n')
                    : cookieStr;

                const { data: updateData } = await this.requestQinglong(
                    'PUT',
                    `${url}/api/envs`,
                    token,
                    {
                        id: owner.id,
                        name: envName,
                        value: newValue,
                        remarks: owner.remarks || decodedPin
                    }
                );
                if (updateData.code !== 200) {
                    throw new Error(updateData.message || '更新 JD_COOKIE 失败');
                }
                await this.enableEnvs(url, token, [owner.id]);
                return '已更新 JD_COOKIE（同一账号替换）';
            }

            // 4. 新账号则追加到第一条 JD_COOKIE 末尾（每行一个账号）
            const target = envs[0];
            const baseValue = String(target.value || '').trim();
            const newValue = baseValue ? `${baseValue}\n${cookieStr}` : cookieStr;

            const { data: appendData } = await this.requestQinglong(
                'PUT',
                `${url}/api/envs`,
                token,
                {
                    id: target.id,
                    name: envName,
                    value: newValue,
                    remarks: target.remarks || decodedPin
                }
            );
            if (appendData.code !== 200) {
                throw new Error(appendData.message || '追加 JD_COOKIE 失败');
            }
            await this.enableEnvs(url, token, [target.id]);
            return '已追加新账号到 JD_COOKIE';
        }

        // 发送到青龙
        async sendToQinglong() {
            const el = this.elements;
            const url = normalizeQinglongUrl(el.qinglongUrl.value);
            const username = el.qinglongUsername.value.trim();
            const password = el.qinglongPassword.value.trim();

            if (!url || !username || !password) {
                this.switchTab('config');
                this.showStatus('请先在「青龙配置」中填写面板地址、用户名和密码。', 'warning');
                return;
            }

            if (!this.cookieString || !this.cookieData) {
                await this.extractCookie();
            }
            if (!this.cookieString || !this.cookieData) {
                this.showStatus('请先成功获取 Cookie（或手动粘贴）再发送！', 'warning');
                return;
            }

            // 发送前自动保存配置，避免每次重复填写
            this.saveConfig(true);

            el.btnSend.classList.add('sending');
            this.showStatus('正在登录青龙...', 'warning');

            try {
                const token = await this.loginQinglong(url, username, password);
                this.showStatus('登录成功，正在写入 JD_COOKIE...', 'warning');

                const resultMessage = await this.upsertJDCOOKIE(
                    url,
                    token,
                    this.cookieString,
                    this.cookieData.pt_pin,
                    this.cookieData.pt_pin_decoded
                );

                this.showStatus(`✅ ${resultMessage}，青龙环境变量已生效。`, 'success');
                this.notifySuccess();
            } catch (error) {
                console.error('【京东Cookie助手】发送失败:', error);
                this.showStatus('发送失败：' + (error && error.message ? error.message : error), 'error');
            } finally {
                el.btnSend.classList.remove('sending');
            }
        }

        // 保存配置
        saveConfig(silent) {
            const url = normalizeQinglongUrl(this.elements.qinglongUrl.value);
            const username = this.elements.qinglongUsername.value.trim();
            const password = this.elements.qinglongPassword.value.trim();

            GM_setValue('qinglong_url', url);
            GM_setValue('qinglong_username', username);
            GM_setValue('qinglong_password', password);

            if (!silent) {
                this.showStatus('配置已保存！', 'success');
            }
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
            el.innerHTML = '';

            const box = document.createElement('div');
            box.className = `status ${type}`;
            box.textContent = `${ICON[type] || ''} ${message}`;
            el.appendChild(box);

            // 3秒后清除成功/警告消息
            if (type !== 'error') {
                setTimeout(() => {
                    if (box.parentNode === el) {
                        el.innerHTML = '';
                    }
                }, 3000);
            }
        }

        // 通知成功
        notifySuccess() {
            if (!CONFIG.SHOW_NOTIFICATION) return;
            try {
                if (typeof Notification === 'undefined') return;
                if (Notification.permission === 'granted') {
                    new Notification('京东Cookie助手', {
                        body: 'Cookie 已成功配置到青龙面板！'
                    });
                } else if (Notification.permission === 'default') {
                    Notification.requestPermission().then((permission) => {
                        if (permission === 'granted') {
                            new Notification('京东Cookie助手', {
                                body: 'Cookie 已成功配置到青龙面板！'
                            });
                        }
                    });
                }
            } catch (e) {
                // 通知失败不影响主流程
            }
        }
    }

    // 初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new JDCookieHelper());
    } else {
        new JDCookieHelper();
    }

})();
