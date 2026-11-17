// ==UserScript==
// @name         京东Cookie一键配置到青龙
// @namespace    http://tampermonkey.net/
// @version      1.2.1
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
// @updateURL    https://raw.githubusercontent.com/junyi5d/jd-cookie-helper/main/jd-cookie-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/junyi5d/jd-cookie-helper/main/jd-cookie-helper.user.js
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

    /**
     * 注入样式：优先用 GM_addStyle，同时再插入一个原生 <style> 兜底。
     * 部分国产浏览器（如 360 极速）内置脚本管理器对 GM_addStyle 兼容不佳，
     * 只调用 GM_addStyle 会导致整段样式丢失，界面变成未美化的原始 DOM。
     */
    function addStyle(css) {
        try {
            if (typeof GM_addStyle === 'function') {
                GM_addStyle(css);
            }
        } catch (e) {
            // ignore
        }
        try {
            const style = document.createElement('style');
            style.type = 'text/css';
            style.appendChild(document.createTextNode(css));
            (document.head || document.documentElement).appendChild(style);
        } catch (e) {
            // ignore
        }
    }

    // 存储读写：脚本管理器 API 不可用时退回 localStorage
    function getStored(key, fallback) {
        try {
            if (typeof GM_getValue === 'function') {
                const value = GM_getValue(key, fallback);
                if (value !== undefined) return value;
            }
        } catch (e) {
            // ignore
        }
        try {
            const raw = window.localStorage.getItem('jdch_' + key);
            if (raw !== null) return raw;
        } catch (e) {
            // ignore
        }
        return fallback;
    }

    function setStored(key, value) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(key, value);
                return;
            }
        } catch (e) {
            // ignore
        }
        try {
            window.localStorage.setItem('jdch_' + key, String(value));
        } catch (e) {
            // ignore
        }
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

            // 先应用消息通知开关状态，避免未打开面板时仍按默认值发送通知
            const notifyEnabled = getStored('notify_enabled', CONFIG.SHOW_NOTIFICATION);
            this.setNotifyEnabled(notifyEnabled === true || notifyEnabled === 'true');

            this.autoExtractCookie();
        }

        // 创建浮动按钮
        createUI() {
            // 添加样式
            addStyle(`
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
                    from { opacity: 0; }
                    to { opacity: 1; }
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
                    padding: 30px 26px;
                    width: 480px;
                    max-width: 92vw;
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
                    display: block;
                    width: 100%;
                    height: auto;
                    max-width: 100%;
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
            addStyle(`
                .jd-cookie-overlay {
                    background: rgba(17, 24, 39, 0.45);
                    backdrop-filter: blur(2px);
                    -webkit-backdrop-filter: blur(2px);
                    display: none;
                    align-items: center;
                    justify-content: center;
                    padding: 16px;
                    box-sizing: border-box;
                }
                .jd-cookie-overlay.show {
                    display: flex;
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
                    position: relative;
                    top: auto;
                    left: auto;
                    transform: none;
                    margin: 0;
                    padding: 0;
                    width: 480px;
                    max-width: 100%;
                    max-height: 86vh;
                    border-radius: 20px;
                    overflow: hidden;
                    display: none;
                    flex-direction: column;
                    background: #ffffff;
                    color: #1f2329;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
                    box-shadow: 0 24px 70px rgba(16, 24, 40, 0.28), 0 2px 8px rgba(16, 24, 40, 0.08);
                }
                .jd-cookie-panel.show {
                    display: flex;
                    animation: jdPanelIn 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
                }
                @keyframes jdPanelIn {
                    from { opacity: 0; transform: scale(0.94); }
                    to { opacity: 1; transform: scale(1); }
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
                .jd-cookie-panel .close-btn svg {
                    display: block;
                    pointer-events: none;
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
                    max-width: calc(100vw - 24px);
                    max-height: 90vh;
                    overflow-y: auto;
                    box-sizing: border-box;
                    transform: none;
                }
                .jd-cookie-panel .switch-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-top: 14px;
                    padding: 12px 14px;
                    background: #f7f8fa;
                    border: 1px solid #eceef2;
                    border-radius: 12px;
                }
                .jd-cookie-panel .switch-info {
                    padding-right: 12px;
                }
                .jd-cookie-panel .switch-text {
                    font-size: 13px;
                    font-weight: 600;
                    color: #1f2329;
                }
                .jd-cookie-panel .switch-desc {
                    margin-top: 3px;
                    font-size: 11.5px;
                    line-height: 1.5;
                    color: #8a919c;
                }
                .jd-cookie-panel .switch {
                    position: relative;
                    flex: none;
                    width: 42px;
                    height: 24px;
                    padding: 0;
                    border: none;
                    border-radius: 999px;
                    background: #d6d9de;
                    cursor: pointer;
                    transition: background 0.2s ease;
                }
                .jd-cookie-panel .switch .switch-dot {
                    position: absolute;
                    top: 3px;
                    left: 3px;
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: #ffffff;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
                    transition: left 0.2s ease;
                }
                .jd-cookie-panel .switch.on {
                    background: #e2231a;
                }
                .jd-cookie-panel .switch.on .switch-dot {
                    left: 21px;
                }
            `);

            // 创建按钮
            // 挂到 <html> 上，避免 body 上的 transform/filter 造成 fixed 定位漂移
            const root = document.documentElement || document.body;

            const btn = document.createElement('button');
            btn.className = 'jd-cookie-helper-btn';
            btn.innerHTML = '🍑';
            btn.title = '京东Cookie助手';
            btn.style.setProperty('position', 'fixed', 'important');
            btn.style.setProperty('top', '100px', 'important');
            btn.style.setProperty('right', '20px', 'important');
            btn.style.setProperty('left', 'auto', 'important');
            btn.style.setProperty('bottom', 'auto', 'important');
            root.appendChild(btn);

            // 创建遮罩层
            const overlay = document.createElement('div');
            overlay.className = 'jd-cookie-overlay';
            overlay.style.setProperty('position', 'fixed', 'important');
            overlay.style.setProperty('top', '0', 'important');
            overlay.style.setProperty('left', '0', 'important');
            overlay.style.setProperty('right', '0', 'important');
            overlay.style.setProperty('bottom', '0', 'important');
            root.appendChild(overlay);

            // 创建面板
            const panel = document.createElement('div');
            panel.className = 'jd-cookie-panel';
            panel.innerHTML = `
                <button class="close-btn" aria-label="关闭">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>
                </button>

                <div class="panel-header">
                    <div class="panel-logo">🍑</div>
                    <div class="panel-title">
                        <h3>京东 Cookie 助手</h3>
                        <p>一键同步登录态到青龙面板</p>
                    </div>
                    <span class="panel-badge">v1.2.1</span>
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

                        <div class="switch-row">
                            <div class="switch-info">
                                <div class="switch-text">消息通知</div>
                                <div class="switch-desc">发送成功后弹出系统通知，关闭后不再提醒</div>
                            </div>
                            <button class="switch on" id="switch-notify" type="button" role="switch" aria-checked="true" title="消息通知">
                                <span class="switch-dot"></span>
                            </button>
                        </div>

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
            overlay.appendChild(panel);

            // 创建赞助模态框
            const sponsorModal = document.createElement('div');
            sponsorModal.className = 'jd-sponsor-modal';
            sponsorModal.innerHTML = `
                <h4>🎁 赞赏支持</h4>
                <p>感谢您的支持！<br>您的赞助是我继续开发的动力~</p>
                <img src="data:image/png;base64,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" alt="微信 / 支付宝赞赏码" id="sponsor-qrcode">
                <button class="close-sponsor">关闭</button>
            `;
            root.appendChild(sponsorModal);

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
                switchNotify: panel.querySelector('#switch-notify'),
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

            // 关闭面板（仅点击遮罩本身时关闭，避免点面板内容误关）
            el.closeBtn.addEventListener('click', () => this.hidePanel());
            el.overlay.addEventListener('click', (e) => {
                if (e.target === el.overlay) this.hidePanel();
            });

            // ESC键关闭
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    if (el.sponsorModal.classList.contains('show')) {
                        this.closeSponsor();
                    } else {
                        this.hidePanel();
                    }
                }
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

            // 消息通知开关
            if (el.switchNotify) {
                el.switchNotify.addEventListener('click', () => {
                    const enabled = !el.switchNotify.classList.contains('on');
                    this.setNotifyEnabled(enabled);
                    if (enabled) this.requestNotifyPermission();
                });
            }

            // 赞助按钮
            el.btnSponsor.addEventListener('click', () => this.openSponsor());

            // 关闭赞助模态框
            el.closeSponsorBtn.addEventListener('click', () => this.closeSponsor());

            // 点击模态框外部关闭
            el.sponsorModal.addEventListener('click', (e) => {
                if (e.target === el.sponsorModal) {
                    this.closeSponsor();
                }
            });

            // 窗口尺寸变化时重新居中赞助弹窗
            window.addEventListener('resize', () => this.centerSponsorModal());
        }

        showPanel() {
            const overlay = this.elements.overlay;
            const panel = this.elements.panel;

            overlay.classList.add('show');
            panel.classList.add('show');

            // 关键定位写成内联样式，避免个别浏览器内核里样式表未生效时面板跑到左上角
            overlay.style.setProperty('display', 'flex', 'important');
            overlay.style.setProperty('align-items', 'center', 'important');
            overlay.style.setProperty('justify-content', 'center', 'important');
            overlay.style.setProperty('padding', '16px', 'important');
            overlay.style.setProperty('box-sizing', 'border-box', 'important');

            panel.style.setProperty('position', 'relative', 'important');
            panel.style.setProperty('top', 'auto', 'important');
            panel.style.setProperty('left', 'auto', 'important');
            panel.style.setProperty('right', 'auto', 'important');
            panel.style.setProperty('bottom', 'auto', 'important');
            panel.style.setProperty('margin', '0', 'important');
            panel.style.setProperty('transform', 'none', 'important');
            panel.style.setProperty('display', 'flex', 'important');
            panel.style.setProperty('flex-direction', 'column', 'important');
            panel.style.setProperty('width', '480px', 'important');
            panel.style.setProperty('max-width', '100%', 'important');
            panel.style.setProperty('max-height', '86vh', 'important');
            panel.style.setProperty('overflow', 'hidden', 'important');
            panel.style.setProperty('box-sizing', 'border-box', 'important');
            panel.style.setProperty('background', '#ffffff', 'important');
            panel.style.setProperty('border-radius', '20px', 'important');

            this.loadConfig();
            this.extractCookie();
        }

        hidePanel() {
            this.elements.overlay.classList.remove('show');
            this.elements.panel.classList.remove('show');
            this.elements.overlay.style.setProperty('display', 'none', 'important');
            this.elements.panel.style.setProperty('display', 'none', 'important');
            this.closeSponsor();
        }

        // 打开赞赏弹窗（用 JS 计算坐标居中，兼容不支持 translate 居中的内核）
        openSponsor() {
            const modal = this.elements.sponsorModal;
            modal.classList.add('show');
            modal.style.setProperty('display', 'block', 'important');
            modal.style.setProperty('position', 'fixed', 'important');
            modal.style.setProperty('transform', 'none', 'important');
            modal.style.setProperty('margin', '0', 'important');
            modal.style.setProperty('box-sizing', 'border-box', 'important');
            modal.style.setProperty('background', '#ffffff', 'important');
            modal.style.setProperty('border-radius', '20px', 'important');
            modal.style.setProperty('padding', '28px 26px', 'important');
            modal.style.setProperty('text-align', 'center', 'important');
            modal.style.setProperty('z-index', '1000001', 'important');
            modal.style.setProperty('overflow-y', 'auto', 'important');
            this.centerSponsorModal();
            // 图片解码后高度会变化，延迟再校正一次
            setTimeout(() => this.centerSponsorModal(), 120);
        }

        closeSponsor() {
            const modal = this.elements.sponsorModal;
            modal.classList.remove('show');
            modal.style.setProperty('display', 'none', 'important');
        }

        centerSponsorModal() {
            const modal = this.elements && this.elements.sponsorModal;
            if (!modal || !modal.classList.contains('show')) return;

            const vw = window.innerWidth || document.documentElement.clientWidth || 0;
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            const width = Math.min(480, Math.max(vw - 24, 240));

            modal.style.setProperty('width', width + 'px', 'important');
            modal.style.setProperty('max-width', 'calc(100vw - 24px)', 'important');
            modal.style.setProperty('max-height', 'calc(100vh - 24px)', 'important');

            const rect = modal.getBoundingClientRect();
            const height = Math.min(rect.height || 0, vh - 24);
            const left = Math.max((vw - width) / 2, 12);
            const top = Math.max((vh - height) / 2, 12);

            modal.style.setProperty('left', left + 'px', 'important');
            modal.style.setProperty('top', top + 'px', 'important');
            modal.style.setProperty('right', 'auto', 'important');
            modal.style.setProperty('bottom', 'auto', 'important');
        }

        // 消息通知开关
        setNotifyEnabled(enabled) {
            const btn = this.elements.switchNotify;
            CONFIG.SHOW_NOTIFICATION = !!enabled;
            setStored('notify_enabled', !!enabled);
            if (btn) {
                btn.classList.toggle('on', !!enabled);
                btn.setAttribute('aria-checked', enabled ? 'true' : 'false');
            }
        }

        requestNotifyPermission() {
            try {
                if (typeof Notification === 'undefined') return;
                if (Notification.permission === 'default') {
                    Notification.requestPermission();
                }
            } catch (e) {
                // ignore
            }
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

            setStored('qinglong_url', url);
            setStored('qinglong_username', username);
            setStored('qinglong_password', password);

            if (!silent) {
                this.showStatus('配置已保存！', 'success');
            }
        }

        // 加载配置
        loadConfig() {
            const url = getStored('qinglong_url', CONFIG.QINGLONG_URL);
            const username = getStored('qinglong_username', CONFIG.QINGLONG_USERNAME);
            const password = getStored('qinglong_password', CONFIG.QINGLONG_PASSWORD);
            const notifyEnabled = getStored('notify_enabled', CONFIG.SHOW_NOTIFICATION);

            this.elements.qinglongUrl.value = url;
            this.elements.qinglongUsername.value = username;
            this.elements.qinglongPassword.value = password;
            this.setNotifyEnabled(notifyEnabled === true || notifyEnabled === 'true');
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
