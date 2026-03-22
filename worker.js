/**
 * 2314 lqx 核心导航系统 - 深度重构版
 * 拒绝模拟数据，深度解析 HAR 接口逻辑
 */

const CF_SITE_KEY = '0x4AAAAAACH2EhsLlcPLE8QH';
const CF_SECRET_KEY = '0x4AAAAAACH2Ev3JYFva9CblnEt-iqKNGAk';
const BG_URL = 'https://tc.ilqx.dpdns.org/file/AgACAgUAAyEGAASHMyZ1AAMSabZ5Y7HEwrA0vgKDxUX6lg3i_uQAAicPaxtXMblValDi_jjojFEBAAMCAAN3AAM6BA.jpg';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const clientIP = request.headers.get('CF-Connecting-IP') || 'Unknown';

    // 1. 数据反代层 (针对 WeTab API 进行协议头伪装，防止 1001 错误)
    if (url.pathname.startsWith('/api/v2/')) {
      return handleApiProxy(url);
    }

    // 2. 搜索建议 (Bing)
    if (url.pathname === '/api/suggest') {
      const q = url.searchParams.get('q');
      return fetch(`https://api.bing.com/qsonhs.aspx?q=${encodeURIComponent(q)}`);
    }

    // 3. 人机验证逻辑
    if (request.method === 'POST' && url.pathname === '/verify-security') {
      const { token } = await request.json();
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${CF_SECRET_KEY}&response=${token}`
      });
      const result = await verifyRes.json();
      if (result.success) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Set-Cookie': 'session_id=verified; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax' }
        });
      }
      return new Response(JSON.stringify({ success: false }), { status: 403 });
    }

    // 4. 权限检查
    const cookie = request.headers.get('Cookie') || '';
    if (!cookie.includes('session_id=verified')) {
      return new Response(renderCaptchaPage(clientIP), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // 5. 返回主站
    return new Response(renderMainPage(clientIP), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }
};

/**
 * 核心：模拟 WeTab 真实请求头，提取纯净数据
 */
async function handleApiProxy(url) {
  const target = decodeURIComponent(url.searchParams.get('url'));
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'i-app': 'hitab',
    'i-version': '2.2.42',
    'i-platform': 'web',
    'Referer': 'https://web.wetab.link/'
  };

  try {
    const res = await fetch(target, { headers });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: true }), { status: 500 });
  }
}

/**
 * 验证页面：专业、简洁、全自动
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
        body { font-family: -apple-system, system-ui, sans-serif; background: #fff; color: #000; margin: 0; padding: 12vh 15vw; }
        .container { max-width: 650px; }
        h1 { font-size: 34px; font-weight: 500; margin-bottom: 20px; }
        p { color: #444; line-height: 1.6; font-size: 16px; margin-bottom: 25px; }
        .ip-info { position: fixed; bottom: 30px; left: 15vw; color: #999; font-size: 13px; }
        #success-ui { display: none; color: #1d8102; font-weight: 600; font-size: 18px; }
    </style>
</head>
<body>
    <div class="container" id="main-ui">
        <h1>进行人机验证前清空用户cookie和本网站对其留下的缓存</h1>
        <p>本网站为防止恶意流量，需要进行人机验证。</p>
        <p><strong>互联网知识之 Cloudflare 是什么：</strong><br>
        如果把互联网必做一颗大树，那么 Cloudflare 就是它的根基。全球近一半的网站都使用了其服务（包括本网站）。它提供全球化的边缘加速、DDoS 攻击防御以及网络负载均衡。通过分布式 Anycast 网络，Cloudflare 能够在攻击到达源站前将其过滤，确保了互联网基础设施的稳健性与安全性。</p>
        <div class="cf-turnstile" data-sitekey="${CF_SITE_KEY}" data-callback="onVerify"></div>
    </div>
    <div id="success-ui">✓ 验证成功！</div>
    <div class="ip-info">你的ip: ${ip}</div>
    <script>
        // 自动清理逻辑
        localStorage.clear(); sessionStorage.clear();
        document.cookie.split(";").forEach(c => document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"));

        async function onVerify(token) {
            const r = await fetch('/verify-security', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ token })
            });
            const d = await r.json();
            if(d.success) {
                document.getElementById('main-ui').style.opacity = '0.3';
                document.getElementById('success-ui').style.display = 'block';
                setTimeout(() => location.reload(), 2000);
            }
        }
    </script>
</body>
</html>`;
}

/**
 * 主页面：高度还原图片样式，组件化动态渲染
 */
function renderMainPage(ip) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title id="p-title">2314 中考必胜</title>
    <style>
        :root { --glass: rgba(255,255,255,0.12); --border: rgba(255,255,255,0.2); }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            background: url('${BG_URL}') center/cover no-repeat fixed;
            color: #fff; font-family: -apple-system, "Microsoft YaHei", sans-serif;
            min-height: 100vh; overflow-x: hidden;
            display: flex; flex-direction: column; align-items: center;
        }
        
        /* 顶部时间与倒计时 */
        .header { margin-top: 60px; text-align: center; animation: slideIn 0.8s ease; }
        #big-time { font-size: 90px; font-weight: 300; text-shadow: 0 5px 20px rgba(0,0,0,0.3); }
        .cd-row { display: flex; gap: 15px; margin-top: 15px; justify-content: center; }
        .cd-box { 
            background: var(--glass); backdrop-filter: blur(15px);
            padding: 12px 20px; border-radius: 12px; border: 1px solid var(--border);
            min-width: 100px; text-align: center;
        }
        .cd-val { font-size: 26px; font-weight: bold; display: block; color: #fff; }
        .cd-lab { font-size: 12px; opacity: 0.8; }

        /* 搜索区域 */
        .search-container { position: relative; width: 620px; margin: 40px 0; z-index: 100; }
        .search-bar {
            display: flex; align-items: center; background: rgba(255,255,255,0.2);
            backdrop-filter: blur(25px); border-radius: 35px; border: 1px solid rgba(255,255,255,0.3);
            padding: 8px 25px; transition: 0.3s;
        }
        .search-bar:focus-within { background: rgba(255,255,255,0.28); border-color: #fff; transform: translateY(-2px); }
        .bing-ico { width: 22px; height: 22px; margin-right: 15px; opacity: 0.9; }
        #s-input { background: none; border: none; color: #fff; flex: 1; height: 45px; font-size: 18px; outline: none; }
        .s-suggest {
            position: absolute; top: 70px; left: 0; right: 0; background: rgba(20,20,20,0.9);
            backdrop-filter: blur(20px); border-radius: 20px; display: none; overflow: hidden;
        }
        .suggest-item { padding: 12px 25px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .suggest-item:hover { background: rgba(255,255,255,0.1); }

        /* 组件布局 */
        .main-grid { 
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; 
            width: 90%; max-width: 1150px; margin-bottom: 50px;
        }
        .widget {
            background: var(--glass); backdrop-filter: blur(20px);
            border-radius: 24px; padding: 22px; border: 1px solid var(--border);
            height: 300px; overflow-y: auto; scrollbar-width: none;
        }
        .widget::-webkit-scrollbar { display: none; }
        .w-title { font-size: 15px; font-weight: 600; margin-bottom: 15px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
        
        /* 列表条目样式 */
        .list-item { font-size: 14px; margin-bottom: 12px; display: flex; gap: 10px; color: rgba(255,255,255,0.85); text-decoration: none; }
        .list-item:hover { color: #fff; }
        .item-idx { color: #ffeb3b; font-weight: bold; width: 18px; }

        footer { margin-top: auto; padding: 40px; text-align: center; font-size: 13px; color: rgba(255,255,255,0.6); line-height: 2; }

        @keyframes slideIn { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    </style>
</head>
<body>
    <div class="header">
        <div id="big-time">00:00</div>
        <div class="cd-row">
            <div class="cd-box"><span class="cd-val" id="d-val">0</span><span class="cd-lab">距离中考(天)</span></div>
            <div class="cd-box"><span class="cd-val" id="h-val">0</span><span class="cd-lab">小时</span></div>
            <div class="cd-box"><span class="cd-val" id="m-val">0</span><span class="cd-lab">分钟</span></div>
        </div>
    </div>

    <div class="search-container">
        <div class="search-bar">
            <img src="https://www.bing.com/favicon.ico" class="bing-ico">
            <input type="text" id="s-input" placeholder="输入内容开始搜索..." autocomplete="off">
        </div>
        <div class="s-suggest" id="s-suggest"></div>
    </div>

    <div class="main-grid">
        <div class="widget">
            <div class="w-title">会泽天气 ☁️</div>
            <div id="w-weather"></div>
        </div>
        <div class="widget">
            <div class="w-title">百度热搜 🔥</div>
            <div id="w-hot"></div>
        </div>
        <div class="widget">
            <div class="w-title">新闻动态 📰</div>
            <div id="w-news"></div>
        </div>
        <div class="widget">
            <div class="w-title">节日倒计时 🎈</div>
            <div id="w-holiday"></div>
        </div>
        <div class="widget">
            <div class="w-title">历史上的今天 ⌛</div>
            <div id="w-history"></div>
        </div>
        <div class="widget">
            <div class="w-title">日历黄历 📅</div>
            <div id="w-calendar"></div>
        </div>
    </div>

    <div id="hitokoto" style="text-align:center; padding: 0 40px; max-width:800px; font-style: italic; opacity: 0.9;"></div>

    <footer>
        By 2314 lqx 网页由Google Gemini Pro 3.1优化<br>
        你的ip: ${ip}
    </footer>

    <script>
        // 1. 时间与倒计时逻辑
        function refreshTime() {
            const now = new Date();
            document.getElementById('big-time').innerText = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
            
            // 目标：6月18日 08:00
            const target = new Date(now.getFullYear(), 5, 18, 8, 0, 0);
            const diff = target - now;
            const d = Math.max(0, Math.floor(diff / 86400000));
            const h = Math.max(0, Math.floor((diff % 86400000) / 3600000));
            const m = Math.max(0, Math.floor((diff % 3600000) / 60000));
            
            document.getElementById('d-val').innerText = d;
            document.getElementById('h-val').innerText = h;
            document.getElementById('m-val').innerText = m;
            document.getElementById('p-title').innerText = "2314 中考必胜 距离中考只剩 " + d + " 天";
        }
        setInterval(refreshTime, 1000); refreshTime();

        // 2. 搜索建议逻辑
        const si = document.getElementById('s-input'), ss = document.getElementById('s-suggest');
        si.oninput = async () => {
            if(!si.value) { ss.style.display = 'none'; return; }
            const r = await fetch('/api/suggest?q=' + encodeURIComponent(si.value));
            const d = await r.json();
            if(d.AS && d.AS.Results) {
                ss.innerHTML = d.AS.Results[0].Suggests.map(i => \`<div class="suggest-item">\${i.Txt}</div>\`).join('');
                ss.style.display = 'block';
            }
        };
        ss.onclick = (e) => { if(e.target.className === 'suggest-item') goSearch(e.target.innerText); };
        si.onkeydown = (e) => { if(e.key === 'Enter') goSearch(si.value); };
        function goSearch(q) { window.location.href = "https://cn.bing.com/search?q=" + encodeURIComponent(q); }

        // 3. 动态数据加载 (提取 JSON 字段并渲染)
        async function load(url) {
            const res = await fetch('/api/v2/proxy?url=' + encodeURIComponent(url));
            return await res.json();
        }

        async function init() {
            // 天气 (云南会泽 530326)
            load('https://api.wetab.link/api/weather/detail?cityCode=530326').then(d => {
                const w = d.data.weather;
                document.getElementById('w-weather').innerHTML = \`
                    <div style="font-size: 34px; margin-bottom: 5px;">\${w.temperature}°C</div>
                    <div style="font-size: 16px;">\${w.weather} | \${w.windDirection}\${w.windPower}级</div>
                    <div style="margin-top: 15px; opacity: 0.7; font-size: 13px;">
                        湿度: \${w.humidity}% | 空气: \${w.aqiText}
                    </div>
                \`;
            });

            // 百度热搜
            load('https://api.wetab.link/api/hotsearch/baidu').then(d => {
                document.getElementById('w-hot').innerHTML = d.data.slice(0, 10).map((i, idx) => \`
                    <a href="\${i.link}" class="list-item" target="_blank">
                        <span class="item-idx">\${idx+1}</span>\${i.title}
                    </a>
                \`).join('');
            });

            // 新闻动态
            load('https://api.wetab.link/api/news/list?type=1').then(d => {
                document.getElementById('w-news').innerHTML = d.data.slice(0, 10).map(i => \`
                    <a href="\${i.url}" class="list-item" target="_blank">● \${i.title}</a>
                \`).join('');
            });

            // 节日倒计时
            load('https://api.wetab.link/api/holiday/list').then(d => {
                document.getElementById('w-holiday').innerHTML = d.data.slice(0, 6).map(i => \`
                    <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                        <span>\${i.name}</span><span style="color:#ffeb3b">\${i.restDay}天后</span>
                    </div>
                \`).join('');
            });

            // 历史上的今天
            load('https://api.wetab.link/api/history/today').then(d => {
                const h = d.data[0];
                document.getElementById('w-history').innerHTML = \`<div style="font-size:13px; line-height:1.6;"><strong>\${h.year}年</strong>: \${h.title}<br><br>\${h.content.substring(0, 120)}...</div>\`;
            });

            // 每日一言 (带作者来源)
            load('https://api.wetab.link/api/quote').then(d => {
                document.getElementById('hitokoto').innerHTML = \`
                    <div style="font-size:18px;">「 \${d.data.content} 」</div>
                    <div style="font-size:13px; margin-top:10px; opacity:0.6;">—— \${d.data.author} · 《\${d.data.source}》</div>
                \`;
            });

            // 日历
            load('https://api.wetab.link/api/calendar/today').then(d => {
                const c = d.data;
                document.getElementById('w-calendar').innerHTML = \`
                    <div style="text-align:center;">
                        <div style="font-size:20px; color:#ffeb3b; margin-bottom:5px;">\${c.lunarMonth}\${c.lunarDay}</div>
                        <div style="font-size:13px; opacity:0.7;">\${c.gzYear}年 \${c.gzMonth}月 \${c.gzDay}日</div>
                        <div style="margin-top:15px; display:flex; justify-content:center; gap:10px; font-size:12px;">
                            <span style="color:#8bc34a">宜: \${c.yi.slice(0,2).join(',')}</span>
                            <span style="color:#f44336">忌: \${c.ji.slice(0,2).join(',')}</span>
                        </div>
                    </div>
                \`;
            });
        }
        init();
    </script>
</body>
</html>`;
}