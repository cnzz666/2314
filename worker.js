/**
 * 2314 lqx 现代化起始页 - Google Gemini Pro 3.1 优化版
 * 功能：CF验证、动态天气、热搜、历史上的今天、中考倒计时、搜索建议
 */

const CF_SITE_KEY = '0x4AAAAAACH2EhsLlcPLE8QH';
const CF_SECRET_KEY = '0x4AAAAAACH2Ev3JYFva9CblnEt-iqKNGAk';
const WALLPAPER_URL = 'https://tc.ilqx.dpdns.org/file/AgACAgUAAyEGAASHMyZ1AAMSabZ5Y7HEwrA0vgKDxUX6lg3i_uQAAicPaxtXMblValDi_jjojFEBAAMCAAN3AAM6BA.jpg';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const clientIP = request.headers.get('CF-Connecting-IP') || '未知IP';

        // 1. 处理 API 动态代理 (严禁模拟数据)
        if (path.startsWith('/api/')) {
            return await handleProxyAPI(path, url.searchParams);
        }

        // 2. 处理 Turnstile 验证提交
        if (request.method === 'POST' && path === '/verify-security') {
            const body = await request.formData();
            const token = body.get('cf-turnstile-response');
            
            const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST',
                body: `secret=${CF_SECRET_KEY}&response=${token}`,
                headers: { 'content-type': 'application/x-www-form-urlencoded' }
            });
            const outcome = await result.json();
            
            if (outcome.success) {
                return new Response(JSON.stringify({ success: true }), {
                    headers: { 'Set-Cookie': 'auth_v2=true; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax' }
                });
            }
            return new Response(JSON.stringify({ success: false }), { status: 403 });
        }

        // 3. 访问拦截逻辑
        const cookies = request.headers.get('Cookie') || '';
        if (!cookies.includes('auth_v2=true')) {
            return new Response(renderCaptchaPage(clientIP), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
        }

        // 4. 返回主页面
        return new Response(renderMainPage(clientIP), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }
};

/**
 * 动态代理处理 - 参考 HAR 抓包逻辑
 */
async function handleProxyAPI(path, params) {
    const headers = { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://web.wetab.link/'
    };

    try {
        if (path === '/api/weather') {
            // 代理会泽天气 (依据HAR中的 wetab 接口逻辑)
            const res = await fetch(`https://api.wetab.link/api/weather/detail?cityCode=530326`, { headers });
            return res;
        }
        if (path === '/api/hot') {
            // 百度热搜代理
            const res = await fetch('https://api.wetab.link/api/hotsearch/baidu', { headers });
            return res;
        }
        if (path === '/api/history') {
            // 历史上的今天
            const res = await fetch('https://api.wetab.link/api/history/today', { headers });
            return res;
        }
        if (path === '/api/quote') {
            // 每日一言
            const res = await fetch('https://v1.hitokoto.cn/');
            return res;
        }
        if (path === '/api/suggest') {
            // Bing 搜索建议
            const q = params.get('q');
            const res = await fetch(`https://api.bing.com/qsonhs.aspx?q=${encodeURIComponent(q)}`);
            return res;
        }
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Proxy Error' }), { status: 500 });
    }
    return new Response('Not Found', { status: 404 });
}

/**
 * Cloudflare 风格人机验证页面
 */
function renderCaptchaPage(ip) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>安全验证 - Cloudflare</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; background: #f9f9f9; color: #313131; margin: 0; padding: 10vh 10vw; }
        .content { max-width: 600px; text-align: left; }
        h1 { font-size: 32px; font-weight: 500; margin-bottom: 20px; }
        p { line-height: 1.6; color: #555; font-size: 15px; }
        .verify-box { margin-top: 30px; min-height: 65px; }
        #success-ui { display: none; color: #1d8102; font-size: 20px; font-weight: 600; align-items: center; }
        .footer { position: fixed; bottom: 20px; left: 0; width: 100%; text-align: center; color: #999; font-size: 13px; }
        .ip-badge { background: #eee; padding: 2px 8px; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="content" id="main-ui">
        <h1>正在验证您的安全访问请求</h1>
        <p>进行人机验证前，系统已自动清空用户 Cookie 和本网站对其留下的缓存。本网站为防止恶意流量，需要进行人机验证。</p>
        <p><strong>科普：什么是 Cloudflare？</strong><br>如果把互联网比作一棵大树，那么 Cloudflare 就是它的根基。作为全球边缘计算的领航者，全球近一半的网站都在使用其提供的安全加速服务。它通过分布式网络节点（Edge）拦截异常请求，确保真实用户能够获得最丝滑的访问体验。</p>
        <div class="verify-box">
            <div class="cf-turnstile" data-sitekey="${CF_SITE_KEY}" data-callback="onSuccess"></div>
        </div>
    </div>
    <div id="success-ui" style="position: absolute; top: 10vh; left: 10vw;">
        <span style="font-size: 30px; margin-right: 10px;">✓</span> 验证成功！
    </div>
    <div class="footer">
        您的 IP: <span class="ip-badge">${ip}</span>
    </div>
    <script>
        // 验证前清理
        localStorage.clear();
        sessionStorage.clear();
        document.cookie.split(";").forEach(c => {
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
        });

        function onSuccess(token) {
            document.getElementById('main-ui').style.opacity = '0.3';
            document.getElementById('main-ui').style.pointerEvents = 'none';
            
            fetch('/verify-security', {
                method: 'POST',
                body: new URLSearchParams({'cf-turnstile-response': token})
            }).then(res => res.json()).then(data => {
                if(data.success) {
                    document.getElementById('main-ui').style.display = 'none';
                    document.getElementById('success-ui').style.display = 'flex';
                    setTimeout(() => { location.reload(); }, 2000);
                }
            });
        }
    </script>
</body>
</html>`;
}

/**
 * 现代化起始页 (仿图片样式)
 */
function renderMainPage(ip) {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>班级主页</title>
    <style>
        :root { --glass: rgba(255, 255, 255, 0.15); --blur: blur(12px); }
        body {
            margin: 0; height: 100vh;
            background: url('${WALLPAPER_URL}') no-repeat center/cover;
            color: white; font-family: 'PingFang SC', sans-serif;
            display: flex; flex-direction: column; align-items: center; overflow: hidden;
        }
        .container { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; background: rgba(0,0,0,0.2); animation: fadeIn 1s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        /* 时间与倒计时 */
        .top-info { margin-top: 8vh; text-align: center; }
        #clock { font-size: 80px; font-weight: 200; text-shadow: 0 4px 15px rgba(0,0,0,0.3); }
        .countdown-wrap { display: flex; gap: 10px; margin-top: 10px; justify-content: center; }
        .cd-box { background: var(--glass); backdrop-filter: var(--blur); padding: 10px 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); text-align: center; }
        .cd-num { font-size: 20px; font-weight: bold; display: block; }
        .cd-label { font-size: 12px; opacity: 0.8; }

        /* 搜索框 */
        .search-section { margin-top: 5vh; width: 100%; max-width: 600px; position: relative; }
        .search-bar {
            width: 100%; background: var(--glass); backdrop-filter: var(--blur);
            border-radius: 30px; border: 1px solid rgba(255,255,255,0.3);
            padding: 15px 25px; font-size: 18px; color: white; outline: none;
            transition: all 0.3s; box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        }
        .search-bar:focus { background: rgba(255, 255, 255, 0.25); border-color: #fff; }

        /* 组件网格 */
        .widgets-grid { 
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
            margin-top: 40px; width: 90%; max-width: 1000px;
        }
        .card { background: var(--glass); backdrop-filter: var(--blur); border-radius: 18px; padding: 15px; border: 1px solid rgba(255,255,255,0.1); height: 200px; overflow-y: auto; }
        .card-title { font-size: 14px; font-weight: bold; margin-bottom: 10px; display: flex; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px; }
        
        .hot-item { font-size: 13px; margin: 8px 0; display: flex; justify-content: space-between; }
        .weather-info { text-align: center; margin-top: 20px; }
        .weather-temp { font-size: 40px; }
        
        .footer-text { position: fixed; bottom: 15px; font-size: 12px; opacity: 0.6; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.3); border-radius: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="top-info">
            <div id="clock">00:00</div>
            <div class="countdown-wrap">
                <div class="cd-box"><span class="cd-num" id="cd-d">0</span><span class="cd-label">距离中考(天)</span></div>
                <div class="cd-box"><span class="cd-num" id="cd-h">0</span><span class="cd-label">小时</span></div>
            </div>
        </div>

        <div class="search-section">
            <input type="text" class="search-bar" placeholder="搜索内容..." id="search-input">
        </div>

        <div class="widgets-grid">
            <div class="card">
                <div class="card-title">会泽天气</div>
                <div id="weather-content" class="weather-info">加载中...</div>
            </div>
            <div class="card">
                <div class="card-title">百度热搜</div>
                <div id="hot-content"></div>
            </div>
            <div class="card">
                <div class="card-title">历史上的今天</div>
                <div id="history-content" style="font-size: 13px; line-height: 1.5;"></div>
            </div>
        </div>

        <div style="margin-top: 30px; font-style: italic; opacity: 0.9;" id="hitokoto"></div>

        <div class="footer-text">
            By 2314 lqx | 网页由 Google Gemini Pro 3.1 优化 | 您的 IP: ${ip}
        </div>
    </div>

    <script>
        // 1. 实时时钟
        setInterval(() => {
            const n = new Date();
            document.getElementById('clock').innerText = n.getHours().toString().padStart(2, '0') + ':' + n.getMinutes().toString().padStart(2, '0');
        }, 1000);

        // 2. 中考倒计时 (6月18日 8:00)
        function updateCD() {
            const target = new Date(new Date().getFullYear(), 5, 18, 8, 0, 0);
            const now = new Date();
            const diff = target - now;
            if (diff > 0) {
                document.getElementById('cd-d').innerText = Math.floor(diff / 86400000);
                document.getElementById('cd-h').innerText = Math.floor((diff % 86400000) / 3600000);
            }
        }
        updateCD();

        // 3. 搜索功能 (Bing)
        document.getElementById('search-input').onkeydown = (e) => {
            if(e.key === 'Enter') window.location.href = 'https://cn.bing.com/search?q=' + e.target.value;
        };

        // 4. 动态数据加载 (全部动态反代)
        async function loadData() {
            // 天气
            fetch('/api/weather').then(r => r.json()).then(d => {
                const w = d.data.weather;
                document.getElementById('weather-content').innerHTML = \`
                    <div class="weather-temp">\${w.temperature}°</div>
                    <div>\${w.weather} | \${w.windDirection}\${w.windPower}</div>
                    <div style="font-size: 12px; margin-top: 5px;">会泽县</div>
                \`;
            });

            // 热搜
            fetch('/api/hot').then(r => r.json()).then(d => {
                const list = d.data.slice(0, 6);
                document.getElementById('hot-content').innerHTML = list.map((item, i) => \`
                    <div class="hot-item">
                        <span>\${i+1}. \${item.title.substring(0,15)}...</span>
                        <span style="color: #ffca28">★</span>
                    </div>
                \`).join('');
            });

            // 历史上的今天
            fetch('/api/history').then(r => r.json()).then(d => {
                const item = d.data[0];
                document.getElementById('history-content').innerText = item.title + ": " + item.content.substring(0, 80) + "...";
            });

            // 每日一言
            fetch('/api/quote').then(r => r.json()).then(d => {
                document.getElementById('hitokoto').innerText = "「 " + d.hitokoto + " 」";
            });
        }
        loadData();
    </script>
</body>
</html>`;
}