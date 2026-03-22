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
      return fetch('https://api.bing.com/qsonhs.aspx?q=' + encodeURIComponent(q));
    }

    // 3. 人机验证逻辑
    if (request.method === 'POST' && url.pathname === '/verify-security') {
      const { token } = await request.json();
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'secret=' + CF_SECRET_KEY + '&response=' + token
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
        localStorage.clear(); sessionStorage.clear();
        document.cookie.split(";").forEach(c => document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + "path=/"));

        async function onVerify(token) {
            const r = await fetch('/verify-security', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ token: token })
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
 * 主页面：移除 emoji，保留四个卡片（天气、热搜、新闻、历史上的今天）
 * 天气使用基于IP的iframe（自动定位城市），IP直接显示服务端传递值，无模拟数据
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
            z-index: 200;
        }
        .suggest-item { padding: 12px 25px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); color: #fff; }
        .suggest-item:hover { background: rgba(255,255,255,0.1); }

        /* 组件布局 - 两行两列四个卡片 */
        .main-grid { 
            display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; 
            width: 90%; max-width: 1000px; margin-bottom: 50px;
        }
        .widget {
            background: var(--glass); backdrop-filter: blur(20px);
            border-radius: 28px; padding: 22px; border: 1px solid var(--border);
            height: auto; min-height: 280px;
            transition: transform 0.2s;
        }
        .widget:hover { transform: translateY(-3px); background: rgba(255,255,255,0.16); }
        .w-title { font-size: 18px; font-weight: 600; margin-bottom: 18px; border-left: 4px solid #ffeb3b; padding-left: 12px; letter-spacing: 1px; }
        
        /* 列表条目样式 */
        .list-item { font-size: 14px; margin-bottom: 14px; display: flex; gap: 12px; align-items: baseline; color: rgba(255,255,255,0.9); text-decoration: none; line-height: 1.4; }
        .list-item:hover { color: #ffeb3b; }
        .item-idx { color: #ffeb3b; font-weight: bold; min-width: 24px; font-size: 15px; }
        
        /* 历史图片区域 */
        .history-img {
            width: 100%; max-height: 150px; object-fit: cover; border-radius: 16px; margin: 12px 0 10px;
            border: 1px solid rgba(255,255,255,0.2);
        }
        .history-text { font-size: 13px; line-height: 1.5; color: rgba(255,255,255,0.85); }
        .error-msg { background: rgba(220,53,69,0.7); padding: 8px 12px; border-radius: 12px; font-size: 13px; text-align: center; }
        
        /* 天气iframe容器 */
        .weather-iframe-wrap { width: 100%; overflow-x: auto; display: flex; justify-content: center; }
        iframe { border-radius: 20px; background: rgba(0,0,0,0.2); }
        
        /* 一言区域 */
        .hitokoto-area {
            margin: 20px auto 30px;
            text-align: center;
            max-width: 780px;
            background: rgba(0,0,0,0.3);
            backdrop-filter: blur(8px);
            border-radius: 60px;
            padding: 14px 28px;
            border: 1px solid rgba(255,255,255,0.2);
        }
        .hitokoto-text { font-size: 18px; font-style: italic; letter-spacing: 0.5px; }
        .hitokoto-from { font-size: 13px; margin-top: 8px; opacity: 0.7; }
        
        footer { margin-top: 20px; padding: 30px 20px 40px; text-align: center; font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.8; width: 100%; }
        @keyframes slideIn { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @media (max-width: 750px) {
            .main-grid { grid-template-columns: 1fr; gap: 20px; width: 92%; }
            .search-container { width: 90%; }
            #big-time { font-size: 60px; }
            .cd-box { min-width: 70px; padding: 8px 12px; }
        }
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
            <img src="https://www.bing.com/favicon.ico" class="bing-ico" alt="bing">
            <input type="text" id="s-input" placeholder="输入内容开始搜索..." autocomplete="off">
        </div>
        <div class="s-suggest" id="s-suggest"></div>
    </div>

    <div class="main-grid">
        <!-- 卡片1: 天气 (基于IP自动定位，使用iframe) -->
        <div class="widget">
            <div class="w-title">实时天气 · 我的城市</div>
            <div id="weather-widget" style="min-height: 150px;">
                <div style="text-align:center;">定位中...</div>
            </div>
        </div>
        
        <!-- 卡片2: 百度热搜榜 -->
        <div class="widget">
            <div class="w-title">百度热搜榜</div>
            <div id="hot-list"></div>
        </div>
        
        <!-- 卡片3: 热点新闻 -->
        <div class="widget">
            <div class="w-title">热点新闻</div>
            <div id="news-list"></div>
        </div>
        
        <!-- 卡片4: 历史上的今天 (含配图) -->
        <div class="widget">
            <div class="w-title">历史上的今天</div>
            <div id="history-today"></div>
        </div>
    </div>

    <!-- 每日一言 正中下方 -->
    <div class="hitokoto-area" id="hitokoto-area">
        <div class="hitokoto-text" id="hitokoto-text">一言加载中...</div>
        <div class="hitokoto-from" id="hitokoto-from"></div>
    </div>

    <footer>
        By 2314 lqx | 数据实时取自网络 · 无模拟数据<br>
        你的IP: ${ip}
    </footer>

    <script>
        // ---------- 辅助函数：通过代理获取WeTab API ----------
        var API_PROXY = '/api/v2/proxy?url=';
        async function fetchAPI(apiUrl) {
            try {
                var resp = await fetch(API_PROXY + encodeURIComponent(apiUrl));
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                var json = await resp.json();
                return json;
            } catch (err) {
                console.error('[API Error] ' + apiUrl, err);
                return { error: true, message: err.message };
            }
        }

        // ---------- 时间与中考倒计时 ----------
        function refreshTime() {
            var now = new Date();
            document.getElementById('big-time').innerText = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
            var target = new Date(now.getFullYear(), 5, 18, 8, 0, 0);
            var diff = target - now;
            var d = Math.max(0, Math.floor(diff / 86400000));
            var h = Math.max(0, Math.floor((diff % 86400000) / 3600000));
            var m = Math.max(0, Math.floor((diff % 3600000) / 60000));
            document.getElementById('d-val').innerText = d;
            document.getElementById('h-val').innerText = h;
            document.getElementById('m-val').innerText = m;
            document.getElementById('p-title').innerText = '2314 中考必胜 距离中考只剩 ' + d + ' 天';
        }
        setInterval(refreshTime, 1000); refreshTime();

        // ---------- 搜索建议 & 搜索跳转 ----------
        var si = document.getElementById('s-input');
        var ss = document.getElementById('s-suggest');
        si.oninput = async function() {
            var val = si.value.trim();
            if (!val) { ss.style.display = 'none'; return; }
            try {
                var res = await fetch('/api/suggest?q=' + encodeURIComponent(val));
                var data = await res.json();
                if (data && data.AS && data.AS.Results && data.AS.Results[0] && data.AS.Results[0].Suggests) {
                    var suggests = data.AS.Results[0].Suggests.map(function(item) {
                        return '<div class="suggest-item">' + escapeHtml(item.Txt) + '</div>';
                    }).join('');
                    ss.innerHTML = suggests;
                    ss.style.display = 'block';
                } else {
                    ss.style.display = 'none';
                }
            } catch(e) { ss.style.display = 'none'; }
        };
        ss.onclick = function(e) {
            if(e.target.classList && e.target.classList.contains('suggest-item')) {
                goSearch(e.target.innerText);
            }
        };
        si.onkeydown = function(e) { if(e.key === 'Enter') goSearch(si.value); };
        function goSearch(q) { if(q.trim()) window.location.href = 'https://cn.bing.com/search?q=' + encodeURIComponent(q); }
        function escapeHtml(str) { return str.replace(/[&<>]/g, function(m){if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; return m;}); }

        // ---------- 1. 天气：基于IP定位城市并嵌入iframe ----------
        async function loadWeatherByIP() {
            var container = document.getElementById('weather-widget');
            container.innerHTML = '<div style="text-align:center;">获取位置中...</div>';
            try {
                var ipResp = await fetch('https://api.ipify.org?format=json');
                var ipData = await ipResp.json();
                var clientIP = ipData.ip;
                var geoResp = await fetch('http://ip-api.com/json/' + clientIP + '?fields=status,city,countryCode');
                var geo = await geoResp.json();
                var cityCode = '54511';
                if (geo.status === 'success' && geo.countryCode === 'CN') {
                    var cityMap = {
                        '北京': '54511', '上海': '58367', '广州': '59287', '深圳': '59493',
                        '杭州': '58457', '南京': '58238', '武汉': '57494', '成都': '56294',
                        '重庆': '57516', '西安': '57036', '会泽': '56778'
                    };
                    cityCode = cityMap[geo.city] || '54511';
                }
                var iframeSrc = '//tianqi.2345.com/plugin/widget/index.htm?s=1&z=1&t=0&v=0&d=3&bd=0&k=&f=&ltf=009944&htf=cc0000&q=1&e=1&a=1&c=' + cityCode + '&w=385&h=96&align=center';
                container.innerHTML = '<div class="weather-iframe-wrap"><iframe allowtransparency="true" frameborder="0" width="385" height="96" scrolling="no" src="' + iframeSrc + '"></iframe></div><div style="font-size:12px; text-align:center; margin-top:8px;">定位城市: ' + (geo.city || '中国') + '</div>';
            } catch (err) {
                console.warn('天气定位失败，使用默认iframe', err);
                container.innerHTML = '<div class="weather-iframe-wrap"><iframe allowtransparency="true" frameborder="0" width="385" height="96" scrolling="no" src="//tianqi.2345.com/plugin/widget/index.htm?s=1&z=1&t=0&v=0&d=3&bd=0&k=&f=&ltf=009944&htf=cc0000&q=1&e=1&a=1&c=54511&w=385&h=96&align=center"></iframe></div><div style="font-size:12px; text-align:center; margin-top:8px;">默认城市: 北京</div>';
            }
        }
        
        // ---------- 2. 百度热搜榜 ----------
        async function loadHotSearch() {
            var hotContainer = document.getElementById('hot-list');
            hotContainer.innerHTML = '<div class="list-item">加载热搜中...</div>';
            var data = await fetchAPI('https://api.wetab.link/api/hotsearch/baidu');
            if (data && data.code === 0 && data.data && data.data.list) {
                var list = data.data.list.slice(0, 10);
                if (list.length) {
                    var html = '';
                    for (var i = 0; i < list.length; i++) {
                        var item = list[i];
                        html += '<a href="' + escapeHtml(item.url) + '" class="list-item" target="_blank" rel="noopener">' +
                                '<span class="item-idx">' + (i+1) + '</span>' +
                                '<span>' + escapeHtml(item.title) + '</span>' +
                                '</a>';
                    }
                    hotContainer.innerHTML = html;
                } else {
                    hotContainer.innerHTML = '<div class="error-msg">暂无热搜数据</div>';
                }
            } else {
                hotContainer.innerHTML = '<div class="error-msg">热搜加载失败 (接口错误)</div>';
            }
        }
        
        // ---------- 3. 热点新闻 (top新闻) ----------
        async function loadNews() {
            var newsDiv = document.getElementById('news-list');
            newsDiv.innerHTML = '<div class="list-item">新闻加载中...</div>';
            var data = await fetchAPI('https://api.wetab.link/api/news/list?type=top&pageNum=1&pageSize=10');
            if (data && data.code === 0 && data.data && data.data.list) {
                var articles = data.data.list.slice(0, 8);
                if (articles.length) {
                    var html = '';
                    for (var i = 0; i < articles.length; i++) {
                        var item = articles[i];
                        html += '<a href="' + escapeHtml(item.url) + '" class="list-item" target="_blank" rel="noopener">' +
                                '<span style="margin-right:6px;">·</span> ' + escapeHtml(item.title) +
                                '</a>';
                    }
                    newsDiv.innerHTML = html;
                } else {
                    newsDiv.innerHTML = '<div class="error-msg">暂无新闻数据</div>';
                }
            } else {
                newsDiv.innerHTML = '<div class="error-msg">新闻接口异常，请稍后重试</div>';
            }
        }
        
        // ---------- 4. 历史上的今天 (含图片) ----------
        async function loadHistoryToday() {
            var historyDiv = document.getElementById('history-today');
            historyDiv.innerHTML = '<div class="history-text">翻阅史册中...</div>';
            try {
                var now = new Date();
                var month = now.getMonth() + 1;
                var day = now.getDate();
                var dateStr = month + '/' + day;
                var listRes = await fetchAPI('https://api.wetab.link/api/history/list?date=' + encodeURIComponent(dateStr));
                if (listRes && listRes.code === 0 && listRes.data && listRes.data.length) {
                    var firstEvent = listRes.data[0];
                    var eventId = firstEvent.e_id;
                    var detailRes = await fetchAPI('https://api.wetab.link/api/history/detail?id=' + eventId);
                    if (detailRes && detailRes.code === 0 && detailRes.data && detailRes.data[0]) {
                        var detail = detailRes.data[0];
                        var title = detail.title || '历史事件';
                        var content = detail.content ? detail.content.replace(/\\n/g, ' ').substring(0, 220) : '无详细描述';
                        var imageHtml = '';
                        if (detail.picUrl && detail.picUrl.length > 0 && detail.picUrl[0].url) {
                            imageHtml = '<img class="history-img" src="' + detail.picUrl[0].url + '" alt="历史配图" onerror="this.style.display=\'none\'">';
                        }
                        historyDiv.innerHTML = '<div class="history-text">' +
                            '<strong style="font-size:16px; display:block; margin-bottom:8px;">' + escapeHtml(title) + '</strong>' +
                            imageHtml +
                            '<div style="font-size:13px; line-height:1.5; margin-top:6px;">' + escapeHtml(content) + (content.length>=200 ? '...' : '') + '</div>' +
                            '<div style="margin-top:12px; font-size:11px; color:#ffeb3b; text-align:right;">' + (firstEvent.date || '') + '</div>' +
                            '</div>';
                    } else {
                        historyDiv.innerHTML = '<div class="error-msg">历史详情获取失败，请刷新</div>';
                    }
                } else {
                    var fallbackRes = await fetchAPI('https://api.wetab.link/api/history/detail?id=3898');
                    if (fallbackRes && fallbackRes.code === 0 && fallbackRes.data && fallbackRes.data[0]) {
                        var detail = fallbackRes.data[0];
                        var title = detail.title;
                        var content = detail.content ? detail.content.replace(/\\n/g, ' ').substring(0, 220) : '';
                        var imgHtml = '';
                        if (detail.picUrl && detail.picUrl[0] && detail.picUrl[0].url) {
                            imgHtml = '<img class="history-img" src="' + detail.picUrl[0].url + '" alt="历史配图" onerror="this.style.display=\'none\'">';
                        }
                        historyDiv.innerHTML = '<div class="history-text">' +
                            '<strong style="font-size:16px;">' + escapeHtml(title) + '</strong>' +
                            imgHtml +
                            '<div style="margin-top:8px;">' + escapeHtml(content) + '</div>' +
                            '<div style="margin-top:8px; font-size:11px; opacity:0.7;">康熙年间 · 史料</div>' +
                            '</div>';
                    } else {
                        historyDiv.innerHTML = '<div class="error-msg">历史上的今天暂无数据，稍后重试</div>';
                    }
                }
            } catch (err) {
                console.error(err);
                historyDiv.innerHTML = '<div class="error-msg">加载历史失败，请检查网络</div>';
            }
        }
        
        // ---------- 5. 每日一言 ----------
        async function loadHitokoto() {
            var textEl = document.getElementById('hitokoto-text');
            var fromEl = document.getElementById('hitokoto-from');
            try {
                var resp = await fetch('https://v1.hitokoto.cn/?c=d&c=e&c=h&c=i&c=k');
                var data = await resp.json();
                if (data && data.hitokoto) {
                    textEl.innerHTML = '「 ' + data.hitokoto + ' 」';
                    var author = data.from_who ? data.from_who : '佚名';
                    var source = data.from ? data.from : '未知出处';
                    fromEl.innerHTML = '—— ' + author + ' · 《' + source + '》';
                } else {
                    throw new Error('一言格式错误');
                }
            } catch (e) {
                textEl.innerHTML = '心之所向，素履以往。';
                fromEl.innerHTML = '—— 名言·自勉';
            }
        }
        
        // 执行所有模块
        loadWeatherByIP().catch(function(e) { console.warn(e); });
        loadHotSearch().catch(function() {});
        loadNews().catch(function() {});
        loadHistoryToday().catch(function() {});
        loadHitokoto().catch(function() {});
    </script>
</body>
</html>`;
}