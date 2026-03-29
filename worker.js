/**
 * 2314 lqx 核心导航系统 - 安全加固版
 * 1. 使用加密 Cookie 验证，拒绝 URL 参数绕过。
 * 2. 添加 CSP 防止外部脚本注入。
 * 3. 保留原有 CSS 样式和功能，无多余修改。
 */

const CF_SITE_KEY = '0x4AAAAAACH2EhsLlcPLE8QH';
const CF_SECRET_KEY = '0x4AAAAAACH2Ev3JYFva9CblnEt-iqKNGAk';
const BG_URL = 'https://tc.ilqx.dpdns.org/file/AgACAgUAAyEGAASHMyZ1AAMSabZ5Y7HEwrA0vgKDxUX6lg3i_uQAAicPaxtXMblValDi_jjojFEBAAMCAAN3AAM6BA.jpg';

// 从环境变量获取密钥（需在 Cloudflare Workers Dashboard 中设置）
const SECRET_KEY = env.SECRET_KEY || 'default-change-me-32-chars-long';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const clientIP = request.headers.get('CF-Connecting-IP') || 'Unknown';
    const cookieHeader = request.headers.get('Cookie') || '';

    // 1. 搜索建议代理（不变）
    if (url.pathname === '/api/suggest') {
      const q = url.searchParams.get('q');
      return fetch(`https://api.bing.com/qsonhs.aspx?q=${encodeURIComponent(q)}`);
    }

    // 2. 验证接口：验证 Turnstile token，设置加密 Cookie
    if (request.method === 'POST' && url.pathname === '/verify-security') {
      const { token } = await request.json();
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${CF_SECRET_KEY}&response=${token}`
      });
      const result = await verifyRes.json();
      if (result.success) {
        // 生成加密 Cookie（有效期 1 小时）
        const expires = Date.now() + 3600 * 1000;
        const random = Math.random().toString(36).substring(2);
        const data = `${expires}:${random}`;
        const hmac = await hmacSha256(data, SECRET_KEY);
        const cookieValue = `${data}:${hmac}`;
        // 设置 HttpOnly, Secure, SameSite=Lax
        const setCookie = `verified=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Max-Age=3600; Path=/`;
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': setCookie
          }
        });
      } else {
        return new Response(JSON.stringify({ success: false }), { status: 400 });
      }
    }

    // 3. 验证 Cookie 是否有效
    const isValid = await verifyCookie(cookieHeader, SECRET_KEY);
    if (!isValid) {
      // 未验证或验证过期，显示验证页面（添加 CSP 防止注入）
      return new Response(renderCaptchaPage(clientIP), {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
          'Content-Security-Policy': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src data:; frame-src https://challenges.cloudflare.com;",
          'X-Frame-Options': 'DENY',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }

    // 4. 已通过验证，返回主页面（同样添加安全头）
    return new Response(renderMainPage(clientIP), {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data: https:; font-src data:;",
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
};

// ---------- 辅助函数 ----------

/** 生成 HMAC-SHA256 签名（异步） */
async function hmacSha256(message, key) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const messageData = encoder.encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 验证 Cookie 值 */
async function verifyCookie(cookieHeader, secretKey) {
  const match = cookieHeader.match(/verified=([^;]+)/);
  if (!match) return false;
  const cookieValue = decodeURIComponent(match[1]);
  const parts = cookieValue.split(':');
  if (parts.length !== 3) return false;
  const [expiresStr, random, signature] = parts;
  const expires = parseInt(expiresStr, 10);
  if (isNaN(expires) || Date.now() > expires) return false;
  const data = `${expiresStr}:${random}`;
  const expectedSig = await hmacSha256(data, secretKey);
  return signature === expectedSig;
}

// ---------- 验证页面（安全加固，增加 CSP） ----------
function renderCaptchaPage(ip) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>人机验证</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    <style>
        body { font-family: -apple-system, sans-serif; background: #fff; padding: 10% 15%; margin: 0; color: #333; }
        .container { max-width: 600px; }
        h1 { font-size: 26px; font-weight: 500; margin-bottom: 20px; }
        p { line-height: 1.8; color: #555; font-size: 15px; }
        .footer { margin-top: 50px; font-size: 12px; color: #999; }
        #success-hint { display: none; color: #1d8102; font-weight: bold; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>2314.ilqx.dpdna.org网站需要进行人机验证</h1>
        <p>本网站为防止恶意流量，需要进行人机验证。</p>
        <p><strong>互联网知识之 Cloudflare 是什么：</strong><br>
        Cloudflare 是一套全球分布式网络体系，它能够通过分发式边缘计算拦截 DDoS 攻击、过滤恶意机器人请求并加速网页加载。作为网站的防御屏障，它确保了数据传输的完整性与访问的稳定性。验证通过后，您将获得受保护的访问权限。</p>
        <div class="cf-turnstile" data-sitekey="${CF_SITE_KEY}" data-callback="onVerify"></div>
        <div id="success-hint">✓ 验证成功！</div>
    </div>
    <div class="footer">你的ip: ${ip}</div>
    <script>
        async function onVerify(token) {
            const r = await fetch('/verify-security', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ token })
            });
            const d = await r.json();
            if(d.success) {
                document.getElementById('success-hint').style.display = 'block';
                setTimeout(() => { location.href = location.pathname; }, 1000);
            }
        }
    </script>
</body>
</html>`;
}

// ---------- 主页面（添加备用防遮挡样式） ----------
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
            color: #fff; font-family: "Inter", -apple-system, sans-serif;
            height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
            overflow: hidden;
        }

        /* 强制所有元素不被外部注入元素覆盖（备用防护） */
        body > * { position: relative; z-index: 1; }
        body::before { content: ''; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: inherit; z-index: -1; }

        /* 顶部大时钟 */
        #big-time { font-size: 100px; font-weight: 200; text-shadow: 0 4px 20px rgba(0,0,0,0.3); letter-spacing: -2px; }

        /* 中考倒计时方框 */
        .cd-row { display: flex; gap: 15px; margin-top: 20px; }
        .cd-box { 
            background: var(--glass); backdrop-filter: blur(20px);
            padding: 15px 25px; border-radius: 12px; border: 1px solid var(--border);
            text-align: center; min-width: 110px;
        }
        .cd-val { font-size: 30px; font-weight: bold; display: block; }
        .cd-lab { font-size: 12px; opacity: 0.7; margin-top: 5px; }

        /* 搜索框 */
        .search-area { position: relative; width: 550px; margin-top: 50px; z-index: 100; }
        .search-bar {
            display: flex; align-items: center; background: rgba(255,255,255,0.18);
            backdrop-filter: blur(25px); border-radius: 30px; padding: 10px 25px;
            border: 1px solid rgba(255,255,255,0.3); transition: 0.3s;
        }
        .search-bar:focus-within { background: rgba(255,255,255,0.25); border-color: #fff; transform: translateY(-2px); }
        .bing-icon { width: 22px; height: 22px; margin-right: 15px; }
        #s-input { background: none; border: none; color: #fff; flex: 1; height: 40px; font-size: 18px; outline: none; }
        
        .suggest-box {
            position: absolute; top: 70px; left: 0; right: 0; background: rgba(20,20,20,0.9);
            backdrop-filter: blur(20px); border-radius: 18px; display: none; overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .suggest-item { padding: 12px 25px; cursor: pointer; font-size: 15px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .suggest-item:hover { background: rgba(255,255,255,0.1); }

        /* 底部信息 */
        footer { 
            position: absolute; bottom: 40px; text-align: center; 
            font-size: 13px; color: rgba(255,255,255,0.5); line-height: 2;
        }
    </style>
</head>
<body>

    <div id="big-time">00:00:00</div>

    <div class="cd-row">
        <div class="cd-box"><span class="cd-val" id="d-val">0</span><span class="cd-lab">距离中考(天)</span></div>
        <div class="cd-box"><span class="cd-val" id="h-val">0</span><span class="cd-lab">小时</span></div>
        <div class="cd-box"><span class="cd-val" id="m-val">0</span><span class="cd-lab">分钟</span></div>
    </div>

    <div class="search-area">
        <div class="search-bar">
            <img src="https://www.bing.com/favicon.ico" class="bing-icon">
            <input type="text" id="s-input" placeholder="输入搜索内容..." autocomplete="off">
        </div>
        <div class="suggest-box" id="s-suggest"></div>
    </div>

    <footer>
        By 2314 lqx 网页由Google Gemini Pro 3.1优化<br>
        你的ip: ${ip}
    </footer>

    <script>
        // 1. 时间与动态标题逻辑
        function refresh() {
            const now = new Date();
            const h = now.getHours().toString().padStart(2, '0');
            const m = now.getMinutes().toString().padStart(2, '0');
            const s = now.getSeconds().toString().padStart(2, '0');
            document.getElementById('big-time').innerText = h + ":" + m + ":" + s;

            // 倒计时计算：目标 6月16日 08:00
            const target = new Date(now.getFullYear(), 5, 16, 8, 0, 0);
            const diff = target - now;
            const days = Math.max(0, Math.floor(diff / 86400000));
            const hours = Math.max(0, Math.floor((diff % 86400000) / 3600000));
            const mins = Math.max(0, Math.floor((diff % 3600000) / 60000));

            document.getElementById('d-val').innerText = days;
            document.getElementById('h-val').innerText = hours;
            document.getElementById('m-val').innerText = mins;

            // 动态标题
            document.getElementById('p-title').innerText = "2314 中考必胜 距离中考只剩 " + days + " 天";
        }
        setInterval(refresh, 1000); refresh();

        // 2. 搜索建议与跳转
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
        ss.onclick = (e) => { if(e.target.className === 'suggest-item') go(e.target.innerText); };
        si.onkeydown = (e) => { if(e.key === 'Enter') go(si.value); };
        function go(q) { window.location.href = "https://cn.bing.com/search?q=" + encodeURIComponent(q); }
    </script>
</body>
</html>`;
}