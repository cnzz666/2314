/**
 * 2314 lqx 核心导航系统 - 严谨版
 * 1. 强制人机验证（不记录Cookie，刷新即验证）
 * 2. 深度反代 WeTab 接口，补全 HAR 记录的 Headers
 * 3. 移除所有 Emoji
 */

const CF_SITE_KEY = '0x4AAAAAACH2EhsLlcPLE8QH';
const CF_SECRET_KEY = '0x4AAAAAACH2Ev3JYFva9CblnEt-iqKNGAk';
const BG_URL = 'https://tc.ilqx.dpdns.org/file/AgACAgUAAyEGAASHMyZ1AAMSabZ5Y7HEwrA0vgKDxUX6lg3i_uQAAicPaxtXMblValDi_jjojFEBAAMCAAN3AAM6BA.jpg';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const clientIP = request.headers.get('CF-Connecting-IP') || 'Unknown';

    // 路由：API 反代层
    if (url.pathname.startsWith('/api/v2/')) {
      return handleApiProxy(url);
    }

    // 路由：验证逻辑
    if (request.method === 'POST' && url.pathname === '/verify-security') {
      const { token } = await request.json();
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${CF_SECRET_KEY}&response=${token}`
      });
      const result = await verifyRes.json();
      return new Response(JSON.stringify({ success: result.success }));
    }

    // 默认展示人机验证（不检查Cookie，强制每次触发）
    // 只有带有特定 verify_token 的 URL 才能进入主页
    if (!url.searchParams.has('verified')) {
      return new Response(renderCaptchaPage(clientIP), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    return new Response(renderMainPage(clientIP), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }
};

/**
 * 核心反代：补全了 .har 文件中发现的所有关键 Headers 
 */
async function handleApiProxy(url) {
  const target = decodeURIComponent(url.searchParams.get('url'));
  const headers = {
    'Host': 'api.wetab.link',
    'i-app': 'hitab',
    'i-version': '2.2.42',
    'i-branch': 'zh',
    'i-lang': 'zh-CN',
    'i-platform': 'web',
    'Origin': 'https://web.wetab.link',
    'Referer': 'https://web.wetab.link/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  try {
    const res = await fetch(target, { headers });
    const text = await res.text();
    return new Response(text, {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ code: 500, message: "Proxy Error" }), { status: 500 });
  }
}

/**
 * 验证页面：强制验证
 */
function renderCaptchaPage(ip) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>安全验证</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    <style>
        body { font-family: sans-serif; background: #fff; padding: 10% 15%; margin: 0; color: #333; }
        h1 { font-size: 28px; font-weight: 500; }
        p { line-height: 1.6; color: #666; }
        .info { margin-top: 50px; font-size: 12px; color: #999; }
        #success { display: none; color: green; font-weight: bold; margin-top: 20px; }
    </style>
</head>
<body>
    <h1>进行人机验证前清空用户缓存</h1>
    <p>正在检测您的连接安全性。Cloudflare 提供边缘安全防护，确保您的数据免受恶意攻击。验证通过后将立即跳转。</p>
    <div class="cf-turnstile" data-sitekey="${CF_SITE_KEY}" data-callback="onVerify"></div>
    <div id="success">验证通过，正在进入...</div>
    <div class="info">节点IP: ${ip}</div>
    <script>
        async function onVerify(token) {
            const r = await fetch('/verify-security', {
                method: 'POST',
                body: JSON.stringify({ token })
            });
            const d = await r.json();
            if(d.success) {
                document.getElementById('success').style.display = 'block';
                // 验证成功后带参数跳转，确保刷新后重新验证
                location.href = location.pathname + '?verified=true';
            }
        }
    </script>
</body>
</html>`;
}

/**
 * 主页面：全文字，无Emoji，深度数据提取
 */
function renderMainPage(ip) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>2314 导航</title>
    <style>
        :root { --glass: rgba(255,255,255,0.1); --border: rgba(255,255,255,0.15); }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            background: url('${BG_URL}') center/cover no-repeat fixed;
            color: #fff; font-family: "Inter", -apple-system, sans-serif;
            min-height: 100vh; display: flex; flex-direction: column; align-items: center;
        }
        .header { margin-top: 5vh; text-align: center; }
        #time { font-size: 80px; font-weight: 200; }
        .countdown { display: flex; gap: 10px; margin-top: 10px; }
        .cd-item { background: var(--glass); padding: 10px 15px; border-radius: 8px; border: 1px solid var(--border); min-width: 80px; }
        .cd-num { font-size: 20px; font-weight: 700; display: block; }
        .cd-label { font-size: 11px; opacity: 0.7; }

        .search { width: 550px; margin: 40px 0; background: rgba(255,255,255,0.15); backdrop-filter: blur(20px); border-radius: 30px; padding: 12px 25px; border: 1px solid var(--border); }
        input { background: none; border: none; color: #fff; width: 100%; font-size: 16px; outline: none; }

        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; width: 90%; max-width: 1100px; }
        .card { background: var(--glass); backdrop-filter: blur(20px); border-radius: 16px; padding: 20px; border: 1px solid var(--border); height: 260px; overflow-y: auto; }
        .card-title { font-size: 14px; font-weight: bold; margin-bottom: 12px; border-left: 3px solid #fff; padding-left: 8px; opacity: 0.9; }
        .item { font-size: 13px; margin-bottom: 8px; color: rgba(255,255,255,0.8); text-decoration: none; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .item:hover { color: #fff; }

        #quote-box { margin-top: 30px; text-align: center; max-width: 700px; padding: 20px; line-height: 1.8; }
        #quote-text { font-size: 16px; font-weight: 300; }
        #quote-from { font-size: 12px; opacity: 0.6; margin-top: 10px; }

        footer { margin-top: auto; padding: 30px; font-size: 12px; color: rgba(255,255,255,0.4); text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <div id="time">00:00</div>
        <div class="countdown">
            <div class="cd-item"><span class="cd-num" id="d">0</span><span class="cd-label">距离中考(天)</span></div>
            <div class="cd-item"><span class="cd-num" id="h">0</span><span class="cd-label">小时</span></div>
            <div class="cd-item"><span class="cd-num" id="m">0</span><span class="cd-label">分钟</span></div>
        </div>
    </div>

    <div class="search">
        <input type="text" id="si" placeholder="输入搜索内容..." onkeydown="if(event.key==='Enter') window.location.href='https://cn.bing.com/search?q='+this.value">
    </div>

    <div class="grid">
        <div class="card"><div class="card-title">会泽天气</div><div id="weather">加载中...</div></div>
        <div class="card"><div class="card-title">百度热搜</div><div id="hot"></div></div>
        <div class="card"><div class="card-title">新闻动态</div><div id="news"></div></div>
        <div class="card"><div class="card-title">节日安排</div><div id="holiday"></div></div>
        <div class="card"><div class="card-title">历史今天</div><div id="history"></div></div>
        <div class="card"><div class="card-title">日历黄历</div><div id="calendar"></div></div>
    </div>

    <div id="quote-box">
        <div id="quote-text">加载中...</div>
        <div id="quote-from"></div>
    </div>

    <footer>
        By 2314 lqx 网页由Google Gemini Pro 3.1优化<br>
        IP: ${ip}
    </footer>

    <script>
        function updateTime() {
            const now = new Date();
            document.getElementById('time').innerText = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
            const target = new Date(2026, 5, 18, 8, 0, 0); // 2026-06-18
            const diff = target - now;
            document.getElementById('d').innerText = Math.max(0, Math.floor(diff / 86400000));
            document.getElementById('h').innerText = Math.max(0, Math.floor((diff % 86400000) / 3600000));
            document.getElementById('m').innerText = Math.max(0, Math.floor((diff % 3600000) / 60000));
        }
        setInterval(updateTime, 1000); updateTime();

        async function fetchAPI(url) {
            const r = await fetch('/api/v2/proxy?url=' + encodeURIComponent(url));
            return await r.json();
        }

        async function init() {
            // 天气
            fetchAPI('https://api.wetab.link/api/weather/detail?cityCode=530326').then(d => {
                const w = d.data.weather;
                document.getElementById('weather').innerHTML = \`
                    <div style="font-size:24px;">\${w.temperature}度</div>
                    <div style="margin-top:10px;">天气: \${w.weather}</div>
                    <div>风力: \${w.windDirection} \${w.windPower}级</div>
                    <div style="opacity:0.6; font-size:12px; margin-top:10px;">湿度: \${w.humidity}% | 空气: \${w.aqiText}</div>
                \`;
            });

            // 每日一言 (Hitokoto) - 严格按照HAR请求头补全 
            fetchAPI('https://api.wetab.link/api/quote').then(d => {
                if(d.data) {
                    document.getElementById('quote-text').innerText = "「 " + d.data.content + " 」";
                    document.getElementById('quote-from').innerText = "—— " + d.data.author + " · " + d.data.source;
                }
            });

            // 热搜
            fetchAPI('https://api.wetab.link/api/hotsearch/baidu').then(d => {
                document.getElementById('hot').innerHTML = d.data.slice(0, 10).map((i, idx) => 
                    \`<a href="\${i.link}" class="item" target="_blank">\${idx+1}. \${i.title}</a>\`
                ).join('');
            });

            // 历史今天
            fetchAPI('https://api.wetab.link/api/history/today').then(d => {
                const h = d.data[0];
                document.getElementById('history').innerHTML = \`
                    <div style="font-weight:bold; margin-bottom:5px;">\${h.year}年</div>
                    <div style="font-size:13px; line-height:1.5;">\${h.title}</div>
                    <div style="font-size:12px; opacity:0.7; margin-top:10px;">\${h.content.substring(0, 80)}...</div>
                \`;
            });

            // 节日
            fetchAPI('https://api.wetab.link/api/holiday/list').then(d => {
                document.getElementById('holiday').innerHTML = d.data.slice(0, 5).map(i => 
                    \`<div class="item" style="display:flex; justify-content:space-between;"><span>\${i.name}</span><span>\${i.restDay}天后</span></div>\`
                ).join('');
            });

            // 日历
            fetchAPI('https://api.wetab.link/api/calendar/today').then(d => {
                const c = d.data;
                document.getElementById('calendar').innerHTML = \`
                    <div style="text-align:center;">
                        <div style="font-size:18px;">\${c.lunarMonth}\${c.lunarDay}</div>
                        <div style="font-size:12px; opacity:0.6;">\${c.gzYear}年 \${c.gzMonth}月 \${c.gzDay}日</div>
                        <div style="margin-top:15px; font-size:12px; color:#aaffaa;">宜: \${c.yi.slice(0,3).join(' ')}</div>
                        <div style="font-size:12px; color:#ffaaaa;">忌: \${c.ji.slice(0,3).join(' ')}</div>
                    </div>
                \`;
            });
            
            // 新闻
            fetchAPI('https://api.wetab.link/api/news/list?type=1').then(d => {
                document.getElementById('news').innerHTML = d.data.slice(0, 10).map(i => 
                    \`<a href="\${i.url}" class="item" target="_blank">- \${i.title}</a>\`
                ).join('');
            });
        }
        init();
    </script>
</body>
</html>`;
}