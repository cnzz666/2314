// worker.js - 重构版班级主页系统 (无登录/评分, 纸质风格, 带Turnstile验证)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 处理 Turnstile 验证回调
    if (path === '/verify-turnstile' && request.method === 'POST') {
      return handleVerifyTurnstile(request);
    }

    // 代理外部 API (避免跨域)
    if (path.startsWith('/api/')) {
      return handleApiProxy(request, url);
    }

    // 主页面 (所有其他路径返回 HTML)
    return renderMainPage(request);
  }
};

// 处理 Turnstile 服务端验证
async function handleVerifyTurnstile(request) {
  try {
    const { token } = await request.json();
    const secret = '0x4AAAAAACrLfPKMbc_zplxpLDU5OwaCdfI'; // 用户提供的密钥
    const ip = request.headers.get('CF-Connecting-IP') || '';

    const formData = new FormData();
    formData.append('secret', secret);
    formData.append('response', token);
    if (ip) formData.append('remoteip', ip);

    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });

    const outcome = await result.json();
    return new Response(JSON.stringify(outcome), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// 代理后端API (直接转发，保留原格式)
async function handleApiProxy(request, url) {
  const targetUrl = url.searchParams.get('url') || 'https://api.wetab.link' + url.pathname + url.search;
  // 简单白名单：只允许 wetab.link 和 hitokoto 等安全域名
  const allowedHosts = ['api.wetab.link', 'v1.hitokoto.cn', 'weatheroffer.com', 'tc.ilqx.dpdns.org'];
  try {
    const target = new URL(targetUrl);
    if (!allowedHosts.includes(target.hostname)) {
      return new Response('Forbidden', { status: 403 });
    }

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0',
        'Accept': 'application/json',
      }
    });
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// 渲染主页面 (HTML完全内联，无外部CSS)
function renderMainPage(request) {
  const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '未知IP';
  const userAgent = request.headers.get('User-Agent') || '未知设备';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>2314班 · 中考加油</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; }
        body {
            min-height: 100vh;
            background: #f4f2eb;  /* 纸质底色 */
            background-image: url('https://tc.ilqx.dpdns.org/file/AgACAgUAAyEGAASHMyZ1AAMSabZ5Y7HEwrA0vgKDxUX6lg3i_uQAAicPaxtXMblValDi_jjojFEBAAMCAAN3AAM6BA.jpg');
            background-size: cover;
            background-attachment: fixed;
            background-position: center;
            color: #2c3e4f;
            display: flex;
            flex-direction: column;
            position: relative;
        }
        /* 半透明遮罩让文字更清晰 */
        body::before {
            content: '';
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(244, 242, 235, 0.7);
            backdrop-filter: blur(2px);
            z-index: -1;
        }
        /* 验证遮罩层 */
        #verification-overlay {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(44, 62, 79, 0.98);
            backdrop-filter: blur(6px);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.5s;
            color: #e9e3d5;
        }
        .verification-card {
            max-width: 500px;
            background: #2c3e4f;
            border-radius: 28px;
            padding: 32px;
            box-shadow: 0 20px 40px -12px rgba(0,0,0,0.6);
            border: 1px solid #5f7a8c;
            text-align: center;
        }
        .verification-card h2 {
            font-weight: 500;
            margin-bottom: 16px;
            color: #f5e7d9;
            font-size: 28px;
        }
        .verification-card p {
            line-height: 1.7;
            color: #bfcfda;
            margin-bottom: 24px;
            font-size: 15px;
        }
        .cf-quote {
            background: #1e2b36;
            padding: 16px;
            border-radius: 16px;
            margin: 20px 0;
            border-left: 4px solid #f6ae2d;
            text-align: left;
        }
        .ip-info {
            font-family: monospace;
            background: #1e2b36;
            padding: 12px;
            border-radius: 30px;
            margin: 16px 0 24px;
            font-size: 14px;
            color: #b8d0d9;
        }
        #cf-turnstile-container {
            display: inline-block;
            margin: 10px 0;
        }
        .verification-footer {
            margin-top: 24px;
            font-size: 13px;
            color: #8faaaf;
        }

        /* 主内容 (初始隐藏) */
        #main-content {
            display: none;
            opacity: 0;
            transition: opacity 1s;
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px 24px;
            width: 100%;
        }

        /* 顶部横幅 */
        .top-banner {
            background: rgba(255, 250, 240, 0.8);
            backdrop-filter: blur(4px);
            border-radius: 60px;
            padding: 14px 30px;
            margin-bottom: 25px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
            border: 1px solid #ddceb5;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 450;
            color: #1f3a4b;
        }
        .banner-left {
            display: flex;
            gap: 16px;
            align-items: baseline;
            flex-wrap: wrap;
        }
        #current-datetime {
            font-size: 1.1rem;
            letter-spacing: 0.3px;
        }
        #countdown {
            background: #e7d9c5;
            padding: 4px 14px;
            border-radius: 40px;
            font-size: 1rem;
            font-weight: 500;
            color: #1e3c4f;
        }
        .banner-right {
            font-size: 1.5rem;
            font-weight: 500;
            color: #b43b3b;
            text-shadow: 0 2px 4px rgba(180, 59, 59, 0.2);
            min-width: 200px;
            text-align: right;
        }
        /* 粒子画布 */
        #particle-canvas {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            z-index: 5;
            opacity: 0;
            transition: opacity 0.5s;
        }
        .banner-right.particle-active ~ #particle-canvas {
            opacity: 0.6;
        }

        /* 搜索区域 + 窗口 */
        .search-section {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 20px;
            position: relative;
            z-index: 500;
        }
        #search-input {
            background: #fefcf7;
            border: 1px solid #c9b693;
            border-radius: 40px 0 0 40px;
            padding: 12px 20px;
            width: 280px;
            font-size: 15px;
            outline: none;
            color: #2c3e4f;
        }
        #search-btn {
            background: #d5c3a5;
            border: 1px solid #c9b693;
            border-left: none;
            border-radius: 0 40px 40px 0;
            padding: 12px 24px;
            cursor: pointer;
            font-weight: 500;
            color: #1f3a4b;
            transition: 0.2s;
        }
        #search-btn:hover { background: #c7b28f; }

        /* 仿Windows浏览器窗口 */
        .browser-window {
            position: fixed;
            top: 100px; left: 100px;
            width: 800px;
            height: 500px;
            background: #f1ebe2;
            border-radius: 12px 12px 8px 8px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.4);
            display: none;
            flex-direction: column;
            z-index: 2000;
            border: 1px solid #b7a27b;
            resize: both;
            overflow: hidden;
        }
        .window-bar {
            background: #d9cdbc;
            padding: 8px 12px;
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: move;
            user-select: none;
            border-bottom: 1px solid #b7a27b;
        }
        .window-controls {
            display: flex;
            gap: 8px;
        }
        .win-btn {
            width: 16px; height: 16px;
            border-radius: 50%;
            background: #f0a5a5;
            border: none;
            cursor: pointer;
        }
        .win-btn.min { background: #f5d36c; }
        .win-btn.max { background: #9bc69b; }
        .win-close { background: #e67373; }
        .address-bar {
            flex: 1;
            background: white;
            border: 1px solid #b7a27b;
            border-radius: 20px;
            padding: 6px 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .address-bar input {
            flex: 1;
            border: none;
            outline: none;
            background: transparent;
            font-size: 14px;
        }
        .nav-btns {
            display: flex;
            gap: 6px;
        }
        .nav-btns button {
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            color: #4d5f6b;
        }
        .browser-iframe {
            width: 100%;
            flex: 1;
            background: white;
            border: none;
        }

        /* 卡片网格 */
        .dashboard-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 22px;
            margin-top: 20px;
        }
        .card {
            background: rgba(255, 250, 240, 0.7);
            backdrop-filter: blur(3px);
            border-radius: 32px;
            padding: 22px;
            border: 1px solid #e0d2bd;
            box-shadow: 0 6px 14px rgba(0,0,0,0.03);
            transition: 0.2s;
        }
        .card:hover { background: rgba(255, 250, 240, 0.9); }
        .card-title {
            font-size: 20px;
            font-weight: 500;
            margin-bottom: 18px;
            border-left: 5px solid #ba9f7b;
            padding-left: 16px;
            color: #1e3c4f;
        }
        .weather-frame {
            width: 100%;
            border-radius: 24px;
            overflow: hidden;
            background: #e3d7c4;
            iframe { display: block; }
        }
        .list-item {
            padding: 10px 0;
            border-bottom: 1px dashed #cfbba3;
            font-size: 14px;
        }
        .list-item a {
            color: #2c4a5c;
            text-decoration: none;
        }
        .list-item a:hover { text-decoration: underline; }
        .hotsearch-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .hot-label {
            background: #f1d9bf;
            border-radius: 20px;
            padding: 2px 8px;
            font-size: 12px;
        }
        .footer-note {
            position: fixed;
            bottom: 12px;
            right: 20px;
            background: rgba(230, 215, 190, 0.6);
            backdrop-filter: blur(4px);
            padding: 6px 14px;
            border-radius: 40px;
            font-size: 13px;
            color: #1d3a45;
            border: 1px solid #bba88b;
            z-index: 500;
        }

        /* 加载提示 */
        .loading-tip {
            color: #8b7a62;
            font-size: 13px;
            padding: 20px;
            text-align: center;
        }
    </style>
    <!-- Turnstile 脚本 (官方) -->
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body>

<!-- 验证遮罩层 -->
<div id="verification-overlay">
    <div class="verification-card">
        <h2>🛡️ 人机验证</h2>
        <p>本网站为防止恶意流量访问，需要进行人机验证。</p>
        <div class="cf-quote">
            🌐 如果把互联网比作一棵大树，<strong>Cloudflare</strong> 就是它的根基。<br>
            全球超过70%的网站使用 Cloudflare 来抵御攻击、加速访问。<br>
            本页面也受到 Cloudflare 保护，请完成下方验证。
        </div>
        <div class="ip-info" id="pre-ip-info">
            🔍 连接信息：IP ${clientIP} · 正在获取位置...
        </div>
        <div id="cf-turnstile-container"></div>
        <div class="verification-footer">验证成功后自动进入 · by 2314 liuqinxi</div>
    </div>
</div>

<!-- 主内容 (初始隐藏) -->
<div id="main-content">
    <!-- 顶部动态横幅 -->
    <div class="top-banner">
        <div class="banner-left">
            <span id="current-datetime"></span>
            <span id="countdown"></span>
        </div>
        <div class="banner-right" id="banner-slogan">2314班中考加油！</div>
    </div>
    <canvas id="particle-canvas"></canvas>

    <!-- 右上搜索 -->
    <div class="search-section">
        <input type="text" id="search-input" placeholder="必应搜索...">
        <button id="search-btn">搜索</button>
    </div>

    <!-- 仿Windows浏览器窗口 (可拖动) -->
    <div class="browser-window" id="browserWindow">
        <div class="window-bar" id="windowBar">
            <div class="window-controls">
                <div class="win-btn min" id="minBtn"></div>
                <div class="win-btn max" id="maxBtn"></div>
                <div class="win-btn win-close" id="closeBtn"></div>
            </div>
            <div class="address-bar">
                <button id="backBtn">←</button>
                <button id="forwardBtn">→</button>
                <input type="text" id="urlInput" value="https://cn.bing.com/">
                <button id="goBtn">↵</button>
            </div>
        </div>
        <iframe class="browser-iframe" id="browserIframe" src="about:blank" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"></iframe>
    </div>

    <!-- 卡片区域 -->
    <div class="dashboard-grid">
        <!-- 天气卡片 (使用 iframe) -->
        <div class="card">
            <div class="card-title">天气</div>
            <div class="weather-frame">
                <iframe allowtransparency="true" frameborder="0" width="100%" height="96" scrolling="no" src="//tianqi.2345.com/plugin/widget/index.htm?s=1&z=1&t=0&v=0&d=3&bd=0&k=&f=&ltf=009944&htf=cc0000&q=1&e=1&a=1&c=54511&w=385&h=96&align=center"></iframe>
            </div>
        </div>

        <!-- 每日一言 (从hitokoto获取) -->
        <div class="card">
            <div class="card-title">📜 一言</div>
            <div id="hitokoto-text" class="loading-tip">载入一言...</div>
        </div>

        <!-- 热搜榜 (微博) -->
        <div class="card">
            <div class="card-title">🔥 微博热搜</div>
            <div id="hotsearch-list" class="loading-tip">加载热搜中...</div>
        </div>
    </div>

    <!-- 底部署名 (固定) -->
    <div class="footer-note">by 2314 liuqinxi</div>
</div>

<script>
    (function() {
        // ---------- 全局变量 ----------
        const clientIP = '${clientIP}';
        let turnstileWidgetId = null;
        let particleInterval, bannerInterval;
        let particleCanvas, ctx, particles = [];
        let bannerPhase = 0; // 0: datetime, 1: particle, 2: slogan
        const bannerEl = document.getElementById('banner-slogan');
        const datetimeEl = document.getElementById('current-datetime');
        const countdownEl = document.getElementById('countdown');

        // ---------- 中考日期计算 (2026-06-16) ----------
        const examDate = new Date(2026, 5, 16); // 月份从0开始, 5=6月

        function updateTime() {
            const now = new Date();
            // 日期时间
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2,'0');
            const day = String(now.getDate()).padStart(2,'0');
            const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            const wd = weekdays[now.getDay()];
            const hour = String(now.getHours()).padStart(2,'0');
            const minute = String(now.getMinutes()).padStart(2,'0');
            const second = String(now.getSeconds()).padStart(2,'0');
            datetimeEl.innerText = \`\${year}年\${month}月\${day}日 \${wd} \${hour}:\${minute}:\${second}\`;

            // 中考倒计时 (天+小时)
            const diff = examDate - now;
            if (diff > 0) {
                const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                const hours = Math.floor((diff % (86400000)) / (1000 * 60 * 60));
                countdownEl.innerText = \`中考仅剩 \${days}天\${hours}小时\`;
            } else {
                countdownEl.innerText = '中考已至，金榜题名！';
            }
        }
        updateTime();
        setInterval(updateTime, 1000);

        // ---------- 粒子效果 ----------
        function initParticles() {
            particleCanvas = document.getElementById('particle-canvas');
            if (!particleCanvas) return;
            ctx = particleCanvas.getContext('2d');
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);
            particles = [];
            for (let i = 0; i < 60; i++) {
                particles.push({
                    x: Math.random() * particleCanvas.width,
                    y: Math.random() * particleCanvas.height,
                    vx: (Math.random() - 0.5) * 0.6,
                    vy: (Math.random() - 0.5) * 0.6,
                    size: Math.random() * 3 + 1,
                    color: \`rgba(180, 120, 70, \${Math.random() * 0.4 + 0.2})\`
                });
            }
        }
        function resizeCanvas() {
            if (!particleCanvas) return;
            particleCanvas.width = window.innerWidth;
            particleCanvas.height = window.innerHeight;
        }
        function drawParticles() {
            if (!ctx || !particleCanvas) return;
            ctx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
            for (let p of particles) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0 || p.x > particleCanvas.width) p.vx *= -1;
                if (p.y < 0 || p.y > particleCanvas.height) p.vy *= -1;
            }
            requestAnimationFrame(drawParticles);
        }

        // ---------- 横幅循环 ----------
        function startBannerLoop() {
            bannerPhase = 0;
            bannerEl.style.opacity = '1';
            particleCanvas.style.opacity = '0';
            bannerInterval = setInterval(() => {
                bannerPhase = (bannerPhase + 1) % 3;
                if (bannerPhase === 0) {
                    bannerEl.innerText = '2314班中考加油！';
                    particleCanvas.style.opacity = '0';
                } else if (bannerPhase === 1) {
                    bannerEl.innerText = '';
                    particleCanvas.style.opacity = '0.6';
                } else if (bannerPhase === 2) {
                    bannerEl.innerText = '2314班中考加油！';
                    particleCanvas.style.opacity = '0';
                }
            }, 2000);
        }

        // ---------- 获取IP地理位置 (预验证时显示) ----------
        async function fetchGeoInfo() {
            try {
                const res = await fetch('/api/geo?ip=' + clientIP);
                const geo = await res.json();
                document.getElementById('pre-ip-info').innerHTML = \`🔍 连接信息：IP \${clientIP} · \${geo.countryRegion || '未知'}\${geo.city || ''} · \${geo.asOrganization || '未知运营商'}\`;
            } catch (e) {
                document.getElementById('pre-ip-info').innerHTML = \`🔍 连接信息：IP \${clientIP} · 位置获取失败\`;
            }
        }
        fetchGeoInfo();

        // ---------- Turnstile 验证 ----------
        window.onloadTurnstileCallback = function () {
            turnstileWidgetId = turnstile.render('#cf-turnstile-container', {
                sitekey: '0x4AAAAAACrLfLWUyYwrDR_e',
                callback: async function(token) {
                    // 验证token
                    const resp = await fetch('/verify-turnstile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token })
                    });
                    const result = await resp.json();
                    if (result.success) {
                        // 验证通过，隐藏遮罩，显示主内容
                        document.getElementById('verification-overlay').style.opacity = '0';
                        setTimeout(() => {
                            document.getElementById('verification-overlay').style.display = 'none';
                            document.getElementById('main-content').style.display = 'block';
                            setTimeout(() => document.getElementById('main-content').style.opacity = '1', 50);
                            // 启动粒子背景
                            initParticles();
                            drawParticles();
                            startBannerLoop();
                            // 加载卡片数据
                            loadHitokoto();
                            loadHotSearch();
                        }, 500);
                    } else {
                        alert('人机验证失败，请重试');
                        turnstile.reset(turnstileWidgetId);
                    }
                }
            });
        };

        // ---------- 卡片数据 ----------
        async function loadHitokoto() {
            try {
                const resp = await fetch('https://v1.hitokoto.cn/?c=d&c=e&c=h&c=i&c=k');
                const data = await resp.json();
                document.getElementById('hitokoto-text').innerHTML = \`“\${data.hitokoto}” —— \${data.from}\`;
            } catch (e) {
                document.getElementById('hitokoto-text').innerHTML = '一言暂时缺席';
            }
        }

        async function loadHotSearch() {
            try {
                const resp = await fetch('/api/hotsearch?type=weibo');
                const data = await resp.json();
                if (data.data && data.data.list) {
                    const list = data.data.list.slice(0, 8);
                    let html = '';
                    list.forEach(item => {
                        html += \`<div class="list-item hotsearch-item"><a href="\${item.url}" target="_blank">\${item.title}</a><span class="hot-label">\${item.hotLabel || '热'}</span></div>\`;
                    });
                    document.getElementById('hotsearch-list').innerHTML = html;
                } else {
                    document.getElementById('hotsearch-list').innerHTML = '暂无热搜';
                }
            } catch (e) {
                document.getElementById('hotsearch-list').innerHTML = '热搜加载失败';
            }
        }

        // ---------- 浏览器窗口实现 (可拖动, 地址栏) ----------
        const win = document.getElementById('browserWindow');
        const bar = document.getElementById('windowBar');
        const iframe = document.getElementById('browserIframe');
        const urlInput = document.getElementById('urlInput');
        const goBtn = document.getElementById('goBtn');
        const backBtn = document.getElementById('backBtn');
        const forwardBtn = document.getElementById('forwardBtn');
        const closeBtn = document.getElementById('closeBtn');
        const minBtn = document.getElementById('minBtn');
        const maxBtn = document.getElementById('maxBtn');

        let offsetX, offsetY, mouseX, mouseY, isDragging = false;

        bar.addEventListener('mousedown', (e) => {
            if (e.target.closest('button, input')) return;
            isDragging = true;
            offsetX = e.clientX - win.offsetLeft;
            offsetY = e.clientY - win.offsetTop;
            bar.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            win.style.left = (e.clientX - offsetX) + 'px';
            win.style.top = (e.clientY - offsetY) + 'px';
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
            bar.style.cursor = 'grab';
        });

        // 地址栏导航
        function navigateTo(url) {
            let fullUrl = url;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                fullUrl = 'https://' + url;
            }
            iframe.src = fullUrl;
            urlInput.value = fullUrl;
        }

        goBtn.addEventListener('click', () => navigateTo(urlInput.value));
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') navigateTo(urlInput.value);
        });

        backBtn.addEventListener('click', () => iframe.contentWindow?.history.back());
        forwardBtn.addEventListener('click', () => iframe.contentWindow?.history.forward());

        closeBtn.addEventListener('click', () => win.style.display = 'none');
        minBtn.addEventListener('click', () => win.style.display = 'none'); // 简单隐藏
        maxBtn.addEventListener('click', () => {
            if (win.style.width === '100%') {
                win.style.width = '800px';
                win.style.height = '500px';
                win.style.top = '100px';
                win.style.left = '100px';
            } else {
                win.style.width = '100%';
                win.style.height = 'calc(100% - 60px)';
                win.style.top = '30px';
                win.style.left = '0';
            }
        });

        // 搜索按钮
        document.getElementById('search-btn').addEventListener('click', () => {
            const query = document.getElementById('search-input').value.trim();
            if (!query) return;
            const searchUrl = 'https://cn.bing.com/search?q=' + encodeURIComponent(query);
            win.style.display = 'flex';
            navigateTo(searchUrl);
        });

        // 允许嵌入任意网页 (sandbox 已设置, 必要时可放宽)
    })();
</script>
<!-- 后备: 如果Turnstile未加载 -->
<script>
    if (typeof turnstile === 'undefined') {
        const checkTurnstile = setInterval(() => {
            if (window.turnstile) {
                clearInterval(checkTurnstile);
                window.onloadTurnstileCallback();
            }
        }, 200);
    } else {
        window.onloadTurnstileCallback();
    }
</script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}