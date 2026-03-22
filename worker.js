/**
 * 2314 lqx 现代化全动态导航系统 - Google Gemini Pro 3.1 优化版
 * 声明：严禁静态模拟数据，所有组件均通过反代 HAR 接口实现
 */

const TURNSTILE_SITE_KEY = '0x4AAAAAACH2EhsLlcPLE8QH';
const TURNSTILE_SECRET_KEY = '0x4AAAAAACH2Ev3JYFva9CblnEt-iqKNGAk';
const BG_URL = 'https://tc.ilqx.dpdns.org/file/AgACAgUAAyEGAASHMyZ1AAMSabZ5Y7HEwrA0vgKDxUX6lg3i_uQAAicPaxtXMblValDi_jjojFEBAAMCAAN3AAM6BA.jpg';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const clientIP = request.headers.get('CF-Connecting-IP') || '127.0.0.1';

    // 1. 处理 API 动态代理 (严禁死数据)
    if (url.pathname.startsWith('/api/proxy')) {
      return await handleProxy(request, url);
    }

    // 2. 搜索建议代理
    if (url.pathname === '/api/suggest') {
      const q = url.searchParams.get('q');
      return await fetch(`https://api.bing.com/qsonhs.aspx?q=${encodeURIComponent(q)}`);
    }

    // 3. 处理人机验证逻辑
    if (request.method === 'POST' && url.pathname === '/verify-token') {
      const { token } = await request.json();
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${TURNSTILE_SECRET_KEY}&response=${token}&remoteip=${clientIP}`
      });
      const result = await verifyRes.json();
      if (result.success) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Set-Cookie': 'auth_token=valid; Path=/; Max-Age=3600; SameSite=Lax' }
        });
      }
      return new Response(JSON.stringify({ success: false }), { status: 403 });
    }

    // 4. 权限拦截 (每次访问强制验证，除非有刚过期的Cookie)
    const cookie = request.headers.get('Cookie') || '';
    if (!cookie.includes('auth_token=valid')) {
      return new Response(renderCaptchaPage(clientIP), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // 5. 返回主页面
    return new Response(renderMainPage(clientIP), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }
};

/**
 * 深度代理 HAR 接口
 */
async function handleProxy(request, url) {
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) return new Response('Missing URL', { status: 400 });

  const headers = new Headers({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'i-app': 'hitab',
    'i-version': '2.2.42',
    'Referer': 'https://web.wetab.link/'
  });

  try {
    const res = await fetch(targetUrl, { headers });
    return new Response(res.body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
}

/**
 * 验证页面 (全自动验证模式)
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
        .content { max-width: 600px; }
        h1 { font-size: 30px; font-weight: 500; }
        p { line-height: 1.6; color: #555; }
        .footer { position: fixed; bottom: 20px; width: 100%; left: 0; text-align: center; color: #999; font-size: 13px; }
        #success-box { display: none; color: #1d8102; font-size: 20px; font-weight: bold; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="content" id="captcha-ui">
        <h1>进行人机验证前清空用户cookie和本网站对其留下的缓存</h1>
        <p>本网站为防止恶意流量，需要进行人机验证。</p>
        <p><strong>互联网知识之 Cloudflare 是什么：</strong><br>
        如果把互联网必做一颗大树，那么 Cloudflare 就是它的根基。全球一半的网站都使用了其服务（包括本网站）。它通过分发式边缘计算节点拦截 DDoS 攻击、过滤恶意请求并加速内容传输。这种防御架构确保了即使在极高并发下，真实用户依然能获得稳定的访问权限。</p>
        <div id="turnstile-widget" class="cf-turnstile" 
             data-sitekey="${TURNSTILE_SITE_KEY}" 
             data-callback="onVerify" 
             data-appearance="execute"></div>
    </div>
    <div id="success-box">✓ 验证成功！正在进入系统...</div>
    <div class="footer">你的ip: ${ip}</div>
    <script>
        // 自动清理
        localStorage.clear(); sessionStorage.clear();
        document.cookie.split(";").forEach(c => document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"));

        async function onVerify(token) {
            const res = await fetch('/verify-token', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ token })
            });
            const data = await res.json();
            if(data.success) {
                document.getElementById('captcha-ui').style.display = 'none';
                document.getElementById('success-box').style.display = 'block';
                setTimeout(() => location.reload(), 2000);
            }
        }
    </script>
</body>
</html>`;
}

/**
 * 主页面 (全动态组件)
 */
function renderMainPage(ip) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title id="page-title">2314 中考必胜</title>
    <style>
        :root { --glass: rgba(255, 255, 255, 0.12); --blur: blur(15px); }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            background: url('${BG_URL}') center/cover no-repeat fixed;
            color: white; font-family: 'PingFang SC', sans-serif;
            min-height: 100vh; display: flex; flex-direction: column; align-items: center;
            animation: fadeIn 1.2s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        .header-box { margin-top: 5vh; text-align: center; }
        #clock { font-size: 80px; font-weight: 200; text-shadow: 0 4px 12px rgba(0,0,0,0.4); }

        /* 倒计时方框 */
        .countdown-container { display: flex; gap: 15px; margin-top: 15px; }
        .cd-item { 
            background: var(--glass); backdrop-filter: var(--blur); 
            padding: 12px 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2);
            text-align: center; min-width: 100px;
        }
        .cd-val { font-size: 24px; font-weight: bold; display: block; color: #ffeb3b; }
        .cd-lab { font-size: 12px; opacity: 0.8; }

        /* 搜索框 */
        .search-area { position: relative; width: 600px; margin-top: 40px; }
        .search-input-wrap {
            display: flex; align-items: center; background: var(--glass); 
            backdrop-filter: var(--blur); border-radius: 30px; padding: 5px 20px;
            border: 1px solid rgba(255,255,255,0.3); transition: 0.3s;
        }
        .search-input-wrap:focus-within { background: rgba(255,255,255,0.25); border-color: #fff; transform: scale(1.02); }
        .bing-icon { width: 24px; height: 24px; margin-right: 15px; }
        #search-input { 
            background: transparent; border: none; color: white; flex: 1; height: 45px;
            font-size: 18px; outline: none;
        }
        .suggest-box {
            position: absolute; top: 65px; width: 100%; background: rgba(30,30,30,0.9);
            backdrop-filter: blur(20px); border-radius: 15px; display: none; z-index: 100;
        }
        .suggest-item { padding: 12px 20px; cursor: pointer; transition: 0.2s; border-radius: 10px; }
        .suggest-item:hover { background: rgba(255,255,255,0.1); }

        /* 组件布局 */
        .widgets-grid {
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
            width: 90%; max-width: 1100px; margin-top: 40px;
        }
        .card { 
            background: var(--glass); backdrop-filter: var(--blur);
            border-radius: 20px; padding: 20px; border: 1px solid rgba(255,255,255,0.1);
            height: 280px; overflow-y: auto; scrollbar-width: none;
        }
        .card::-webkit-scrollbar { display: none; }
        .card-title { font-size: 15px; font-weight: bold; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; }

        .news-item, .hot-item { font-size: 13px; margin-bottom: 10px; display: flex; gap: 10px; text-decoration: none; color: white; opacity: 0.8; }
        .news-item:hover, .hot-item:hover { opacity: 1; color: #ffeb3b; }

        .footer { margin-top: auto; padding: 30px; text-align: center; font-size: 13px; opacity: 0.7; width: 100%; }
    </style>
</head>
<body>
    <div class="header-box">
        <div id="clock">00:00:00</div>
        <div class="countdown-container" id="exam-cd">
            <div class="cd-item"><span class="cd-val" id="d-val">0</span><span class="cd-lab">距离中考(天)</span></div>
            <div class="cd-item"><span class="cd-val" id="h-val">0</span><span class="cd-lab">小时</span></div>
        </div>
    </div>

    <div class="search-area">
        <div class="search-input-wrap">
            <img src="https://www.bing.com/favicon.ico" class="bing-icon">
            <input type="text" id="search-input" placeholder="输入搜索内容..." autocomplete="off">
        </div>
        <div class="suggest-box" id="suggest-box"></div>
    </div>

    <div class="widgets-grid">
        <div class="card">
            <div class="card-title">会泽天气 ☁️</div>
            <div id="weather-ui">正在反代实时天气...</div>
        </div>
        <div class="card">
            <div class="card-title">百度热搜 🔥</div>
            <div id="hot-ui">正在抓取热搜...</div>
        </div>
        <div class="card">
            <div class="card-title">新闻头条 📰</div>
            <div id="news-ui">正在同步新闻...</div>
        </div>
        <div class="card">
            <div class="card-title">历史上的今天 ⌛</div>
            <div id="history-ui">获取史料中...</div>
        </div>
        <div class="card">
            <div class="card-title">节日倒计时 🎈</div>
            <div id="holiday-ui">计算节日中...</div>
        </div>
        <div class="card">
            <div class="card-title">日历与黄历 📅</div>
            <div id="calendar-ui">获取日历卡片...</div>
        </div>
    </div>

    <div style="margin-top: 30px; text-align: center; max-width: 800px; padding: 0 20px;">
        <p id="quote-text" style="font-size: 18px; font-style: italic;"></p>
        <p id="quote-from" style="font-size: 13px; opacity: 0.6; margin-top: 10px;"></p>
    </div>

    <div class="footer">
        By 2314 lqx 网页由Google Gemini Pro 3.1优化<br>
        你的ip: ${ip}
    </div>

    <script>
        // 1. 动态时钟与标题
        function updateClock() {
            const now = new Date();
            const timeStr = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0') + ":" + now.getSeconds().toString().padStart(2, '0');
            document.getElementById('clock').innerText = timeStr;

            // 中考倒计时计算 (6月18日 8点)
            const target = new Date(now.getFullYear(), 5, 18, 8, 0, 0);
            const diff = target - now;
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            
            document.getElementById('d-val').innerText = days > 0 ? days : 0;
            document.getElementById('h-val').innerText = hours > 0 ? hours : 0;
            document.getElementById('page-title').innerText = "2314 中考必胜 距离中考只剩 " + (days > 0 ? days : 0) + " 天";
        }
        setInterval(updateClock, 1000);
        updateClock();

        // 2. 搜索建议逻辑
        const si = document.getElementById('search-input');
        const sb = document.getElementById('suggest-box');
        si.oninput = async () => {
            if(!si.value) { sb.style.display = 'none'; return; }
            const r = await fetch('/api/suggest?q=' + encodeURIComponent(si.value));
            const d = await r.json();
            if(d.AS && d.AS.Results) {
                const items = d.AS.Results[0].Suggests;
                sb.innerHTML = items.map(i => \`<div class="suggest-item">\${i.Txt}</div>\`).join('');
                sb.style.display = 'block';
            }
        };
        sb.onclick = (e) => {
            if(e.target.className === 'suggest-item') {
                window.location.href = "https://www.bing.com/search?q=" + encodeURIComponent(e.target.innerText);
            }
        };
        si.onkeydown = (e) => { if(e.key === 'Enter') window.location.href = "https://www.bing.com/search?q=" + encodeURIComponent(si.value); };

        // 3. 全动态数据获取 (反代接口)
        async function api(url) {
            const res = await fetch('/api/proxy?url=' + encodeURIComponent(url));
            return await res.json();
        }

        async function initData() {
            // 天气 (会泽 530326)
            api('https://api.wetab.link/api/weather/detail?cityCode=530326').then(d => {
                const w = d.data.weather;
                document.getElementById('weather-ui').innerHTML = \`
                    <div style="font-size: 30px;">\${w.temperature}°C</div>
                    <div>\${w.weather} | \${w.windDirection}\${w.windPower}级</div>
                    <div style="font-size: 12px; margin-top: 10px;">湿度: \${w.humidity}% | 空气: \${w.aqiText}</div>
                \`;
            });

            // 百度热搜
            api('https://api.wetab.link/api/hotsearch/all?type=baidu').then(d => {
                document.getElementById('hot-ui').innerHTML = d.data.slice(0, 10).map((i, idx) => \`
                    <a href="\${i.link}" target="_blank" class="hot-item"><span>\${idx+1}</span>\${i.title}</a>
                \`).join('');
            });

            // 新闻
            api('https://api.wetab.link/api/news/list?type=1').then(d => {
                document.getElementById('news-ui').innerHTML = d.data.slice(0, 10).map(i => \`
                    <a href="\${i.url}" target="_blank" class="news-item">● \${i.title}</a>
                \`).join('');
            });

            // 历史上的今天
            api('https://api.wetab.link/api/history/today').then(d => {
                const item = d.data[0];
                document.getElementById('history-ui').innerHTML = \`<div style="font-size:13px; line-height:1.6;"><strong>\${item.year}年</strong>: \${item.title}<br><br>\${item.content}</div>\`;
            });

            // 节日倒计时 (根据HAR接口逻辑)
            api('https://api.wetab.link/api/holiday/list').then(d => {
                document.getElementById('holiday-ui').innerHTML = d.data.slice(0, 6).map(i => \`
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">
                        <span>\${i.name}</span><span style="color:#ffeb3b">\${i.restDay}天后</span>
                    </div>
                \`).join('');
            });

            // 每日一言
            api('https://api.wetab.link/api/quote').then(d => {
                document.getElementById('quote-text').innerText = "「 " + d.data.content + " 」";
                document.getElementById('quote-from').innerText = "—— " + d.data.author + " · 《" + d.data.source + "》";
            });

            // 日历/黄历
            api('https://api.wetab.link/api/calendar/today').then(d => {
                const c = d.data;
                document.getElementById('calendar-ui').innerHTML = \`
                    <div style="text-align:center;">
                        <div style="font-size:18px; color:#ffeb3b">\${c.lunarMonth} \${c.lunarDay}</div>
                        <div style="margin:10px 0; font-size:12px;">\${c.gzYear}年 \${c.gzMonth}月 \${c.gzDay}日</div>
                        <div style="display:flex; gap:10px; font-size:12px; justify-content:center;">
                            <span style="color:#8bc34a">宜: \${c.yi.slice(0,3)}</span>
                            <span style="color:#f44336">忌: \${c.ji.slice(0,3)}</span>
                        </div>
                    </div>
                \`;
            });
        }
        initData();
    </script>
</body>
</html>`;
}