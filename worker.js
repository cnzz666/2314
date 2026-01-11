// cloudflare-worker.js - 重构版班级评分系统 V2.0
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '未知IP';
    const userAgent = request.headers.get('User-Agent') || '未知设备';

    try {
      // 检查数据库连接
      if (!env.DB) {
        return new Response(JSON.stringify({ 
          error: '数据库连接失败: DB变量未正确绑定',
          details: '请检查D1数据库绑定设置'
        }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // 初始化数据库
      const initResult = await initDatabase(env.DB);
      
      // 检查是否需要初始化设置
      if (!initResult.initialized && path !== '/setup' && path !== '/api/setup' && path !== '/health' && path !== '/api/wallpaper') {
        return Response.redirect(new URL('/setup', request.url));
      }

      // API路由
      if (path.startsWith('/api/')) {
        const startTime = Date.now();
        const response = await handleAPI(request, env, url, clientIP);
        const latency = Date.now() - startTime;
        response.headers.set('X-Latency', `${latency}ms`);
        response.headers.set('X-Client-IP', clientIP);
        return response;
      }

      // 页面路由
      return await handlePages(request, env, url, clientIP, userAgent);
    } catch (error) {
      console.error('Global Error:', error);
      return new Response(JSON.stringify({ 
        error: '服务器错误',
        details: error.message,
        ip: clientIP
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};

// 初始化数据库
async function initDatabase(db) {
  try {
    // 首先测试数据库连接
    const testResult = await db.prepare('SELECT 1').run();
    if (!testResult) {
      throw new Error('数据库连接测试失败');
    }
    
    // 检查设置表是否存在
    let settingsExist = true;
    try {
      await db.prepare('SELECT 1 FROM settings LIMIT 1').run();
    } catch (e) {
      settingsExist = false;
    }

    if (!settingsExist) {
      // 表不存在，需要初始化所有表
      await createAllTables(db);
      return { initialized: false, needsSetup: true };
    }

    // 检查是否已有设置数据
    const settingsResult = await db.prepare('SELECT COUNT(*) as count FROM settings').first();
    const settingsCount = settingsResult ? settingsResult.count : 0;
    
    if (settingsCount === 0) {
      return { initialized: false, needsSetup: true };
    }

    return { initialized: true, needsSetup: false };
  } catch (error) {
    console.error('Database initialization error:', error);
    throw new Error(`数据库初始化失败: ${error.message}`);
  }
}

// 创建所有表
async function createAllTables(db) {
  try {
    // 创建学生表
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_scored_at DATETIME,
        score_count INTEGER DEFAULT 0
      )
    `).run();

    // 创建评分项表
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS score_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        type TEXT,
        weight INTEGER DEFAULT 1,
        requires_note INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // 创建评分记录表
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS score_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        category_id INTEGER,
        score INTEGER,
        operator TEXT,
        operator_type TEXT,
        operator_detail TEXT,
        note TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students (id),
        FOREIGN KEY (category_id) REFERENCES score_categories (id)
      )
    `).run();

    // 创建任务表
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT,
        deadline DATETIME,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // 创建系统设置表
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // 创建月度快照表
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS monthly_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        month TEXT,
        student_name TEXT,
        add_score INTEGER,
        minus_score INTEGER,
        total_score INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // 创建操作日志表
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        student_name TEXT,
        action_type TEXT,
        score_change INTEGER,
        operator TEXT,
        operator_type TEXT,
        operator_detail TEXT,
        category_name TEXT,
        note TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // 创建IP会话表
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS ip_sessions (
        ip TEXT PRIMARY KEY,
        username TEXT,
        last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
        login_count INTEGER DEFAULT 1
      )
    `).run();

    // 创建更新记录表
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS update_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT,
        update_type TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // 初始化学生数据
    const students = [
      '曾钰景', '陈金语', '陈金卓', '陈明英', '陈兴旺', '陈钰琳', '代紫涵', '丁玉文',
      '高建航', '高奇', '高思凡', '高兴扬', '关戎', '胡菡', '胡人溪', '胡延鑫',
      '胡意佳', '胡语欣', '李国华', '李昊蓉', '李浩', '李灵芯', '李荣蝶', '李鑫蓉',
      '廖聪斌', '刘沁熙', '刘屹', '孟舒玲', '孟卫佳', '庞清清', '任雲川', '邵金平',
      '宋毓佳', '唐旺', '唐正高', '王恒', '王文琪', '吴良涛', '吴永贵', '夏碧涛',
      '徐程', '徐海俊', '徐小龙', '颜荣蕊', '晏灏', '杨青望', '余芳', '张灿',
      '张航', '张杰', '张毅', '赵丽瑞', '赵美婷', '赵威', '周安融', '周思棋', '朱蕊'
    ];

    for (const name of students) {
      try {
        await db.prepare(
          'INSERT OR IGNORE INTO students (name) VALUES (?)'
        ).bind(name).run();
      } catch (e) {
        console.warn(`Failed to insert student ${name}:`, e.message);
      }
    }

    // 初始化评分类别
    const scoreCategories = [
      // 加分项
      ['作业完成质量优秀', 'add', 1, 0],
      ['天天练达标', 'add', 1, 0],
      ['准时上课', 'add', 1, 0],
      ['卫生完成优秀', 'add', 1, 0],
      ['行为习惯良好', 'add', 1, 0],
      ['早操出勤', 'add', 1, 0],
      ['上课专注', 'add', 1, 0],
      ['任务完成优秀', 'add', 1, 0],
      ['课堂表现积极', 'add', 1, 0],
      ['帮助同学', 'add', 1, 0],
      ['其他加分项', 'add', 1, 1], // 必须填写备注
      
      // 减分项
      ['上课违纪', 'minus', 1, 0],
      ['作业完成质量差', 'minus', 1, 0],
      ['天天练未达标', 'minus', 1, 0],
      ['迟到', 'minus', 1, 0],
      ['卫生未完成', 'minus', 1, 0],
      ['行为习惯差', 'minus', 1, 0],
      ['早操缺勤', 'minus', 1, 0],
      ['上课不专注', 'minus', 1, 0],
      ['未交/拖延作业', 'minus', 1, 0],
      ['破坏课堂纪律', 'minus', 1, 0],
      ['其他扣分项', 'minus', 1, 1] // 必须填写备注
    ];

    for (const [name, type, weight, requiresNote] of scoreCategories) {
      try {
        await db.prepare(
          'INSERT OR IGNORE INTO score_categories (name, type, weight, requires_note) VALUES (?, ?, ?, ?)'
        ).bind(name, type, weight, requiresNote).run();
      } catch (e) {
        console.warn(`Failed to insert category ${name}:`, e.message);
      }
    }

    // 记录更新
    await db.prepare(
      'INSERT INTO update_records (version, update_type, details) VALUES (?, ?, ?)'
    ).bind('2.0', 'initial', '系统初始化完成').run();

    console.log('All tables created successfully');
  } catch (error) {
    console.error('Table creation error:', error);
    throw new Error(`创建数据库表失败: ${error.message}`);
  }
}

// API处理
async function handleAPI(request, env, url, clientIP) {
  const path = url.pathname;

  try {
    // 确保数据库连接可用
    if (!env.DB) {
      throw new Error('数据库连接不可用');
    }

    if (path === '/api/login') {
      return await handleLogin(request, env, clientIP);
    } else if (path === '/api/logout') {
      return handleLogout();
    } else if (path === '/api/students') {
      return await handleGetStudents(env.DB);
    } else if (path === '/api/score') {
      return await handleAddScore(request, env.DB, clientIP);
    } else if (path === '/api/revoke') {
      return await handleRevokeScore(request, env.DB);
    } else if (path === '/api/tasks') {
      if (request.method === 'GET') {
        return await handleGetTasks(env.DB);
      } else if (request.method === 'POST') {
        return await handleAddTask(request, env.DB);
      } else if (request.method === 'DELETE') {
        return await handleDeleteTask(request, env.DB);
      }
    } else if (path === '/api/snapshot') {
      return await handleSnapshot(request, env.DB);
    } else if (path === '/api/reset') {
      return await handleReset(request, env.DB, clientIP);
    } else if (path === '/api/settings') {
      if (request.method === 'GET') {
        return await handleGetSettings(env.DB);
      } else if (request.method === 'POST') {
        return await handleUpdateSettings(request, env.DB);
      }
    } else if (path === '/api/logs') {
      return await handleGetLogs(request, env.DB);
    } else if (path === '/api/monthly') {
      return await handleGetMonthlyData(request, env.DB);
    } else if (path === '/api/setup') {
      return await handleSetup(request, env.DB);
    } else if (path === '/api/health') {
      return await handleHealthCheck(env.DB);
    } else if (path === '/api/wallpaper') {
      return await handleWallpaper();
    } else if (path === '/api/geo') {
      return await handleGeoIP(clientIP, request.headers.get('User-Agent'));
    } else if (path === '/api/check-session') {
      return await handleCheckSession(request, env.DB, clientIP);
    } else if (path === '/api/batch-score') {
      return await handleBatchScore(request, env.DB, clientIP);
    } else if (path === '/api/student-history') {
      return await handleStudentHistory(request, env.DB);
    } else if (path === '/api/check-system') {
      return await handleSystemCheck(env.DB);
    } else if (path === '/api/update-database') {
      return await handleDatabaseUpdate(request, env.DB);
    } else if (path === '/api/search-suggest') {
      return await handleSearchSuggest(request);
    }

    return new Response(JSON.stringify({ error: 'API路径不存在' }), {
      status: 404,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ 
      error: 'API处理错误',
      details: error.message,
      ip: clientIP
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 获取必应壁纸
async function handleWallpaper() {
  try {
    const response = await fetch('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN');
    const data = await response.json();
    const imageUrl = 'https://cn.bing.com' + data.images[0].url;
    const copyright = data.images[0].copyright;
    
    return new Response(JSON.stringify({
      status: true,
      data: [{
        url: imageUrl,
        copyright: copyright
      }]
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      status: false,
      message: '获取壁纸失败',
      data: []
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 获取地理位置信息
async function handleGeoIP(clientIP, userAgent) {
  try {
    const response = await fetch(`https://api.ip.sb/geoip/${clientIP}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const data = await response.json();
    
    // 添加延迟信息
    const startTime = Date.now();
    await fetch('https://www.cloudflare.com');
    const latency = Date.now() - startTime;
    
    return new Response(JSON.stringify({
      ip: data.ip || clientIP,
      country: data.country || '中国',
      region: data.region || '未知',
      city: data.city || '未知',
      isp: data.isp || data.organization || '未知',
      latitude: data.latitude || '0',
      longitude: data.longitude || '0',
      latency: `${latency}ms`,
      user_agent: userAgent || '未知'
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ip: clientIP,
      country: "中国",
      region: "未知",
      city: "未知",
      isp: "未知",
      latitude: "0",
      longitude: "0",
      latency: "0ms",
      user_agent: userAgent || '未知'
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 搜索建议
async function handleSearchSuggest(request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    
    if (!query.trim()) {
      return new Response(JSON.stringify({ s: [] }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    const response = await fetch(`https://fd.ilqx.dpdns.org/https://cn.bing.com/AS/Suggestions?pt=page.home&qry=${encodeURIComponent(query)}&cp=1&csr=1&pths=1&cvid=1`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 EdgA/138.0.0.0',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'sec-ch-ua-full-version-list': '"Not)A;Brand";v="8.0.0.0", "Chromium";v="138.0.7204.184", "Microsoft Edge";v="138.0.3351.121"',
        'sec-ch-ua-platform': '"Android"',
        'ect': '4g',
        'x-autosuggest-contentwidth': '360',
        'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Microsoft Edge";v="138"',
        'sec-ch-ua-model': '"V1901A"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-bitness': '""',
        'sec-ch-ua-arch': '""',
        'sec-ch-ua-full-version': '"138.0.3351.121"',
        'sec-ch-ua-platform-version': '"9.0.0"',
        'sec-ms-gec': 'C182EAAC6FD3E77A3384F949F1E608E10F482698B7FBCFE25D3C6408B79CE90A',
        'sec-ms-gec-version': '1-138.0.3351.121',
        'x-client-data': 'eyIxIjoiMCIsIjIiOiIwIiwiMyI6IjAiLCI0IjoiLTIwNDE1NTcwNTIwOTcwOTMxMTMiLCI2Ijoic3RhYmxlIiwiOSI6InBob25lIn0=',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'referer': 'https://cn.bing.com/?PC=EMMX01',
        'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    
    const data = await response.json();
    
    // 处理特殊字符
    if (data.s && Array.isArray(data.s)) {
      data.s.forEach(item => {
        if (item.q) {
          // 移除特殊字符
          item.q = item.q.replace(//g, '').replace(//g, '');
        }
      });
    }
    
    return new Response(JSON.stringify(data), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ s: [] }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 系统检查
async function handleSystemCheck(db) {
  const checks = [];
  const startTime = Date.now();
  
  try {
    // 1. 数据库连接检查
    try {
      await db.prepare('SELECT 1').run();
      checks.push({
        name: '数据库连接',
        status: 'success',
        message: '数据库连接正常'
      });
    } catch (error) {
      checks.push({
        name: '数据库连接',
        status: 'error',
        message: `数据库连接失败: ${error.message}`
      });
    }
    
    // 2. 表结构检查
    const tables = ['students', 'score_categories', 'score_records', 'settings', 'operation_logs'];
    for (const table of tables) {
      try {
        await db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).run();
        checks.push({
          name: `表 ${table}`,
          status: 'success',
          message: `表 ${table} 存在且可访问`
        });
      } catch (error) {
        checks.push({
          name: `表 ${table}`,
          status: 'error',
          message: `表 ${table} 检查失败: ${error.message}`
        });
      }
    }
    
    // 3. 外部API检查
    const apis = [
      { name: '必应壁纸API', url: 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1' },
      { name: '搜索建议API', url: 'https://cn.bing.com/AS/Suggestions?qry=test' }
    ];
    
    for (const api of apis) {
      try {
        const response = await fetch(api.url);
        if (response.ok) {
          checks.push({
            name: api.name,
            status: 'success',
            message: `${api.name} 访问正常`
          });
        } else {
          checks.push({
            name: api.name,
            status: 'warning',
            message: `${api.name} 返回状态码: ${response.status}`
          });
        }
      } catch (error) {
        checks.push({
          name: api.name,
          status: 'error',
          message: `${api.name} 访问失败: ${error.message}`
        });
      }
    }
    
    // 4. 学生数据检查
    try {
      const students = await db.prepare('SELECT COUNT(*) as count FROM students').first();
      checks.push({
        name: '学生数据',
        status: 'success',
        message: `共有 ${students.count} 名学生`
      });
    } catch (error) {
      checks.push({
        name: '学生数据',
        status: 'error',
        message: `学生数据检查失败: ${error.message}`
      });
    }
    
    // 5. 评分记录检查
    try {
      const records = await db.prepare('SELECT COUNT(*) as count FROM score_records').first();
      checks.push({
        name: '评分记录',
        status: 'success',
        message: `共有 ${records.count} 条评分记录`
      });
    } catch (error) {
      checks.push({
        name: '评分记录',
        status: 'error',
        message: `评分记录检查失败: ${error.message}`
      });
    }
    
    const totalTime = Date.now() - startTime;
    
    return new Response(JSON.stringify({
      success: true,
      checks: checks,
      summary: {
        total: checks.length,
        success: checks.filter(c => c.status === 'success').length,
        warning: checks.filter(c => c.status === 'warning').length,
        error: checks.filter(c => c.status === 'error').length
      },
      time: `${totalTime}ms`
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 数据库更新
async function handleDatabaseUpdate(request, db) {
  try {
    const { updateType, confirm } = await request.json();
    
    if (!confirm) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '请确认更新操作' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    let message = '';
    
    if (updateType === 'structure') {
      // 更新表结构
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS update_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version TEXT,
          update_type TEXT,
          details TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      
      // 检查并添加新字段
      try {
        await db.prepare('ALTER TABLE score_records ADD COLUMN operator_type TEXT').run();
        await db.prepare('ALTER TABLE score_records ADD COLUMN operator_detail TEXT').run();
        await db.prepare('ALTER TABLE operation_logs ADD COLUMN operator_type TEXT').run();
        await db.prepare('ALTER TABLE operation_logs ADD COLUMN operator_detail TEXT').run();
        message = '表结构更新完成';
      } catch (e) {
        // 字段可能已存在
        message = '表结构已是最新';
      }
      
    } else if (updateType === 'data') {
      // 更新数据
      const students = [
        '曾钰景', '陈金语', '陈金卓', '陈明英', '陈兴旺', '陈钰琳', '代紫涵', '丁玉文',
        '高建航', '高奇', '高思凡', '高兴扬', '关戎', '胡菡', '胡人溪', '胡延鑫',
        '胡意佳', '胡语欣', '李国华', '李昊蓉', '李浩', '李灵芯', '李荣蝶', '李鑫蓉',
        '廖聪斌', '刘沁熙', '刘屹', '孟舒玲', '孟卫佳', '庞清清', '任雲川', '邵金平',
        '宋毓佳', '唐旺', '唐正高', '王恒', '王文琪', '吴良涛', '吴永贵', '夏碧涛',
        '徐程', '徐海俊', '徐小龙', '颜荣蕊', '晏灏', '杨青望', '余芳', '张灿',
        '张航', '张杰', '张毅', '赵丽瑞', '赵美婷', '赵威', '周安融', '周思棋', '朱蕊'
      ];
      
      for (const name of students) {
        try {
          await db.prepare(
            'INSERT OR IGNORE INTO students (name) VALUES (?)'
          ).bind(name).run();
        } catch (e) {
          console.warn(`Failed to insert student ${name}:`, e.message);
        }
      }
      message = `数据更新完成，共处理 ${students.length} 名学生`;
      
    } else if (updateType === 'merge') {
      // 合并更新
      const existingStudents = await db.prepare('SELECT name FROM students').all();
      const existingNames = existingStudents.results.map(s => s.name);
      
      const newStudents = [
        '曾钰景', '陈金语', '陈金卓', '陈明英', '陈兴旺', '陈钰琳', '代紫涵', '丁玉文',
        '高建航', '高奇', '高思凡', '高兴扬', '关戎', '胡菡', '胡人溪', '胡延鑫',
        '胡意佳', '胡语欣', '李国华', '李昊蓉', '李浩', '李灵芯', '李荣蝶', '李鑫蓉',
        '廖聪斌', '刘沁熙', '刘屹', '孟舒玲', '孟卫佳', '庞清清', '任雲川', '邵金平',
        '宋毓佳', '唐旺', '唐正高', '王恒', '王文琪', '吴良涛', '吴永贵', '夏碧涛',
        '徐程', '徐海俊', '徐小龙', '颜荣蕊', '晏灏', '杨青望', '余芳', '张灿',
        '张航', '张杰', '张毅', '赵丽瑞', '赵美婷', '赵威', '周安融', '周思棋', '朱蕊'
      ];
      
      let added = 0;
      for (const name of newStudents) {
        if (!existingNames.includes(name)) {
          try {
            await db.prepare(
              'INSERT INTO students (name) VALUES (?)'
            ).bind(name).run();
            added++;
          } catch (e) {
            console.warn(`Failed to insert student ${name}:`, e.message);
          }
        }
      }
      message = `合并更新完成，新增 ${added} 名学生，共有 ${existingNames.length + added} 名学生`;
    }
    
    // 记录更新
    await db.prepare(
      'INSERT INTO update_records (version, update_type, details) VALUES (?, ?, ?)'
    ).bind('2.0', updateType, message).run();
    
    return new Response(JSON.stringify({ 
      success: true,
      message: message
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Database update error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '数据库更新失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 检查IP会话
async function handleCheckSession(request, db, clientIP) {
  try {
    const session = await db.prepare(
      'SELECT * FROM ip_sessions WHERE ip = ?'
    ).bind(clientIP).first();
    
    return new Response(JSON.stringify({
      success: true,
      has_session: !!session,
      username: session?.username || null,
      last_login: session?.last_login || null
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 批量评分
async function handleBatchScore(request, db, clientIP) {
  try {
    const { studentIds, categoryId, score, operator, operatorType, operatorDetail, note } = await request.json();
    
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '请选择至少一名学生' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (!categoryId || !score || !operator) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少必需字段' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 获取类别信息
    const category = await db.prepare(
      'SELECT name, type, requires_note FROM score_categories WHERE id = ?'
    ).bind(categoryId).first();
    
    if (!category) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '评分项目不存在' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 检查是否需要备注
    if (category.requires_note && (!note || note.trim() === '')) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '此项必须填写备注说明' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const userAgent = request.headers.get('User-Agent') || '未知设备';

    // 批量插入评分记录
    for (const studentId of studentIds) {
      // 获取学生信息
      const student = await db.prepare('SELECT name FROM students WHERE id = ?').bind(studentId).first();
      
      // 插入评分记录
      await db.prepare(
        'INSERT INTO score_records (student_id, category_id, score, operator, operator_type, operator_detail, note, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(studentId, categoryId, score, operator, operatorType || 'teacher', operatorDetail || '', note || '', clientIP).run();

      // 更新学生最后评分时间
      await db.prepare(
        'UPDATE students SET last_scored_at = CURRENT_TIMESTAMP, score_count = score_count + 1 WHERE id = ?'
      ).bind(studentId).run();
    }

    // 记录一条合并的操作日志
    const studentCount = studentIds.length;
    const studentNames = [];
    for (const studentId of studentIds) {
      const student = await db.prepare('SELECT name FROM students WHERE id = ?').bind(studentId).first();
      if (student) {
        studentNames.push(student.name);
      }
    }
    
    await db.prepare(
      'INSERT INTO operation_logs (student_id, student_name, action_type, score_change, operator, operator_type, operator_detail, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(0, studentNames.join(', '), category.type, 
           category.type === 'add' ? score * studentCount : -score * studentCount, 
           operator, operatorType || 'teacher', operatorDetail || '', 
           category.name, `${note || ''} (批量${studentCount}人)`, clientIP, userAgent).run();

    return new Response(JSON.stringify({ 
      success: true,
      message: `成功为${studentIds.length}名学生评分`,
      count: studentIds.length
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Batch score error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '批量评分失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 获取学生历史记录
async function handleStudentHistory(request, db) {
  try {
    const { studentId, limit = 50 } = await request.json();
    
    if (!studentId) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少学生ID' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const logs = await db.prepare(`
      SELECT ol.*, s.name as student_name 
      FROM operation_logs ol
      JOIN students s ON ol.student_id = s.id
      WHERE ol.student_id = ?
      ORDER BY ol.created_at DESC
      LIMIT ?
    `).bind(studentId, limit).all();

    const student = await db.prepare('SELECT name FROM students WHERE id = ?').bind(studentId).first();

    return new Response(JSON.stringify({
      success: true,
      student: student,
      logs: logs.results || [],
      count: logs.results?.length || 0
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Get student history error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取学生历史失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 健康检查
async function handleHealthCheck(db) {
  try {
    await db.prepare('SELECT 1').run();
    return new Response(JSON.stringify({ 
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 初始化设置处理
async function handleSetup(request, db) {
  try {
    const { admin_username, admin_password, class_username, class_password, site_title, class_name } = await request.json();
    
    // 验证必需字段
    if (!admin_username || !admin_password || !class_username || !class_password) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '请填写所有必需字段' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 保存设置
    const settings = [
      ['class_username', class_username],
      ['class_password', class_password],
      ['admin_username', admin_username],
      ['admin_password', admin_password],
      ['site_title', site_title || '2314班综合评分系统'],
      ['class_name', class_name || '2314班'],
      ['current_month', new Date().toISOString().slice(0, 7)],
      ['enable_ip_auth', 'true']
    ];

    for (const [key, value] of settings) {
      await db.prepare(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
      ).bind(key, value).run();
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: '系统初始化成功'
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Setup error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '初始化失败: ' + error.message 
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 登录处理
async function handleLogin(request, env, clientIP) {
  try {
    const { username, password, remember_ip } = await request.json();
    
    const settings = await env.DB.prepare(
      'SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)'
    ).bind('class_username', 'class_password', 'admin_username', 'admin_password').all();

    const settingMap = {};
    settings.results.forEach(row => {
      settingMap[row.key] = row.value;
    });

    let role = '';
    if (username === settingMap.class_username && password === settingMap.class_password) {
      role = 'class';
    } else if (username === settingMap.admin_username && password === settingMap.admin_password) {
      role = 'admin';
    }

    if (role) {
      const sessionId = generateSessionId();
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const cookie = `session=${sessionId}; Path=/; HttpOnly; Expires=${expires.toUTCString()}; SameSite=Lax`;
      
      // 存储会话信息
      await env.DB.prepare(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
      ).bind(`session_${sessionId}`, JSON.stringify({ 
        username, 
        role, 
        expires: expires.getTime(),
        ip: clientIP
      })).run();

      // 如果选择记住IP，则保存IP会话
      if (remember_ip) {
        await env.DB.prepare(
          'INSERT OR REPLACE INTO ip_sessions (ip, username, last_login, login_count) VALUES (?, ?, CURRENT_TIMESTAMP, COALESCE((SELECT login_count FROM ip_sessions WHERE ip = ?), 0) + 1)'
        ).bind(clientIP, username, clientIP).run();
      }
      
      return new Response(JSON.stringify({ 
        success: true, 
        role,
        message: '登录成功',
        remember_ip: !!remember_ip
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': cookie,
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    return new Response(JSON.stringify({ 
      success: false, 
      error: '用户名或密码错误' 
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '登录失败: ' + error.message 
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 登出处理
async function handleLogout() {
  const cookie = 'session=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  return new Response(JSON.stringify({ 
    success: true,
    message: '登出成功'
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// 获取学生数据
async function handleGetStudents(db) {
  try {
    const students = await db.prepare(`
      SELECT s.id, s.name, 
             COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE 0 END), 0) as add_score,
             COALESCE(SUM(CASE WHEN sc.type = 'minus' THEN sr.score ELSE 0 END), 0) as minus_score,
             COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE -sr.score END), 0) as total_score,
             s.last_scored_at,
             s.score_count
      FROM students s
      LEFT JOIN score_records sr ON s.id = sr.student_id
      LEFT JOIN score_categories sc ON sr.category_id = sc.id
      GROUP BY s.id, s.name
      ORDER BY s.name COLLATE NOCASE ASC
    `).all();

    const studentsArray = students.results || [];

    return new Response(JSON.stringify({
      success: true,
      students: studentsArray,
      totalStudents: studentsArray.length
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Get students error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取学生数据失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 添加分数
async function handleAddScore(request, db, clientIP) {
  try {
    const { studentId, categoryId, score, operator, operatorType, operatorDetail, note } = await request.json();
    
    // 验证必需字段
    if (!studentId || !categoryId || !score || !operator) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少必需字段' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 获取类别信息
    const category = await db.prepare(
      'SELECT name, type, requires_note FROM score_categories WHERE id = ?'
    ).bind(categoryId).first();
    
    if (!category) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '评分项目不存在' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 检查是否需要备注
    if (category.requires_note && (!note || note.trim() === '')) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '此项必须填写备注说明' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const userAgent = request.headers.get('User-Agent') || '未知设备';

    // 获取学生信息
    const student = await db.prepare('SELECT name FROM students WHERE id = ?').bind(studentId).first();

    // 插入评分记录
    await db.prepare(
      'INSERT INTO score_records (student_id, category_id, score, operator, operator_type, operator_detail, note, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(studentId, categoryId, score, operator, operatorType || 'teacher', operatorDetail || '', note || '', clientIP).run();

    // 更新学生最后评分时间
    await db.prepare(
      'UPDATE students SET last_scored_at = CURRENT_TIMESTAMP, score_count = score_count + 1 WHERE id = ?'
    ).bind(studentId).run();

    // 记录操作日志
    await db.prepare(
      'INSERT INTO operation_logs (student_id, student_name, action_type, score_change, operator, operator_type, operator_detail, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(studentId, student?.name || '未知', category.type, category.type === 'add' ? score : -score, 
           operator, operatorType || 'teacher', operatorDetail || '', category.name, note || '', clientIP, userAgent).run();

    return new Response(JSON.stringify({ 
      success: true,
      message: '评分成功',
      student_name: student?.name
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Add score error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '评分失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 撤销操作
async function handleRevokeScore(request, db) {
  try {
    const { recordId, studentId } = await request.json();
    
    if (!recordId && !studentId) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少记录ID或学生ID' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    let lastRecord;
    if (recordId) {
      // 撤销指定记录
      lastRecord = await db.prepare(`
        SELECT sr.id, sr.score, sc.type, sc.name as category_name, sr.operator, sr.operator_type, sr.operator_detail, sr.note, s.name as student_name
        FROM score_records sr
        JOIN score_categories sc ON sr.category_id = sc.id
        JOIN students s ON sr.student_id = s.id
        WHERE sr.id = ?
      `).bind(recordId).first();
    } else {
      // 获取最近一条记录
      lastRecord = await db.prepare(`
        SELECT sr.id, sr.score, sc.type, sc.name as category_name, sr.operator, sr.operator_type, sr.operator_detail, sr.note, s.name as student_name
        FROM score_records sr
        JOIN score_categories sc ON sr.category_id = sc.id
        JOIN students s ON sr.student_id = s.id
        WHERE sr.student_id = ?
        ORDER BY sr.created_at DESC 
        LIMIT 1
      `).bind(studentId).first();
    }

    if (!lastRecord) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '没有可撤销的记录' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 删除记录
    await db.prepare('DELETE FROM score_records WHERE id = ?').bind(lastRecord.id).run();

    // 记录撤销日志
    await db.prepare(
      'INSERT INTO operation_logs (student_id, student_name, action_type, score_change, operator, operator_type, operator_detail, category_name, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(studentId || lastRecord.student_id, lastRecord.student_name, 'revoke', 
           lastRecord.type === 'add' ? -lastRecord.score : lastRecord.score, 
           lastRecord.operator, lastRecord.operator_type, lastRecord.operator_detail,
           `撤销: ${lastRecord.category_name}`, '撤销操作').run();

    return new Response(JSON.stringify({ 
      success: true,
      message: '撤销成功',
      record: lastRecord
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Revoke score error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '撤销失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 获取任务
async function handleGetTasks(db) {
  try {
    const tasks = await db.prepare(
      'SELECT * FROM tasks ORDER BY created_at DESC'
    ).all();

    return new Response(JSON.stringify({
      success: true,
      tasks: tasks.results || []
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Get tasks error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取任务失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 添加任务
async function handleAddTask(request, db) {
  try {
    const { title, content, deadline, created_by } = await request.json();
    
    if (!title || !content) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '请填写任务标题和内容' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    await db.prepare(
      'INSERT INTO tasks (title, content, deadline, created_by) VALUES (?, ?, ?, ?)'
    ).bind(title, content, deadline, created_by).run();

    return new Response(JSON.stringify({ 
      success: true,
      message: '任务发布成功'
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Add task error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '发布任务失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 删除任务
async function handleDeleteTask(request, db) {
  try {
    const { id } = await request.json();
    
    if (!id) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少任务ID' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    await db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();

    return new Response(JSON.stringify({ 
      success: true,
      message: '任务删除成功'
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Delete task error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '删除任务失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 创建快照
async function handleSnapshot(request, db) {
  try {
    const { title } = await request.json();
    
    if (!title) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '请输入快照标题' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const month = new Date().toISOString().slice(0, 7);
    const snapshotTitle = `${month}-${title}`;

    // 获取当前所有学生分数
    const students = await db.prepare(`
      SELECT s.name, 
             COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE 0 END), 0) as add_score,
             COALESCE(SUM(CASE WHEN sc.type = 'minus' THEN sr.score ELSE 0 END), 0) as minus_score,
             COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE -sr.score END), 0) as total_score
      FROM students s
      LEFT JOIN score_records sr ON s.id = sr.student_id
      LEFT JOIN score_categories sc ON sr.category_id = sc.id
      GROUP BY s.id, s.name
    `).all();

    // 保存快照
    for (const student of (students.results || [])) {
      await db.prepare(
        'INSERT INTO monthly_snapshots (title, month, student_name, add_score, minus_score, total_score) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(snapshotTitle, month, student.name, student.add_score, student.minus_score, student.total_score).run();
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: '月度数据保存成功',
      title: snapshotTitle,
      count: students.results?.length || 0
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Snapshot error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '保存快照失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 重置分数
async function handleReset(request, db, clientIP) {
  try {
    const { confirm_password, confirm_text } = await request.json();
    
    // 验证管理员密码和确认文本
    if (!confirm_password || !confirm_text) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '请输入管理员密码和确认文本' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (confirm_text !== '确认清空所有数据') {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '确认文本不正确，请输入"确认清空所有数据"' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const adminPassword = await db.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).bind('admin_password').first();

    if (!adminPassword || adminPassword.value !== confirm_password) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '管理员密码错误' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    await db.prepare('DELETE FROM score_records').run();
    await db.prepare('DELETE FROM operation_logs').run();

    // 记录重置操作
    await db.prepare(
      'INSERT INTO operation_logs (student_name, action_type, score_change, operator, category_name, note, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('系统', 'reset', 0, '管理员', '系统操作', '重置所有分数', clientIP).run();

    return new Response(JSON.stringify({ 
      success: true,
      message: '分数重置成功'
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Reset error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '重置失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 获取设置
async function handleGetSettings(db) {
  try {
    const settings = await db.prepare('SELECT key, value FROM settings').all();
    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });
    
    return new Response(JSON.stringify({
      success: true,
      settings: settingMap
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取设置失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 更新设置
async function handleUpdateSettings(request, db) {
  try {
    const settings = await request.json();
    
    for (const [key, value] of Object.entries(settings)) {
      await db.prepare(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
      ).bind(key, value).run();
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: '设置更新成功'
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Update settings error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '更新设置失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 获取操作日志
async function handleGetLogs(request, db) {
  try {
    const { studentId } = Object.fromEntries(new URL(request.url).searchParams);
    
    let query = `
      SELECT ol.*, s.name as student_name 
      FROM operation_logs ol
      JOIN students s ON ol.student_id = s.id
    `;
    let params = [];

    if (studentId) {
      query += ' WHERE ol.student_id = ?';
      params.push(studentId);
    }

    query += ' ORDER BY ol.created_at DESC LIMIT 100';

    const logs = await db.prepare(query).bind(...params).all();

    return new Response(JSON.stringify({
      success: true,
      logs: logs.results || []
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Get logs error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取日志失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 获取月度数据
async function handleGetMonthlyData(request, db) {
  try {
    const months = await db.prepare(
      'SELECT DISTINCT title, month, created_at FROM monthly_snapshots ORDER BY created_at DESC'
    ).all();

    return new Response(JSON.stringify({
      success: true,
      months: months.results || []
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Get monthly data error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取月度数据失败: ' + error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 页面处理
async function handlePages(request, env, url, clientIP, userAgent) {
  const path = url.pathname;
  
  try {
    if (!env.DB) {
      throw new Error('数据库连接不可用');
    }

    if (path === '/login') {
      return await renderLoginPage(env.DB, request, clientIP, userAgent);
    } else if (path === '/class') {
      return await renderClassPage(env.DB, request, clientIP, userAgent);
    } else if (path === '/admin') {
      return await renderAdminPage(env.DB, request, clientIP, userAgent);
    } else if (path === '/') {
      return Response.redirect(new URL('/login', request.url));
    } else if (path === '/logs') {
      return await renderLogsPage(env.DB, url);
    } else if (path === '/setup') {
      return renderSetupPage();
    } else if (path === '/health') {
      return await handleHealthCheck(env.DB);
    } else if (path === '/snapshots') {
      return await renderSnapshotsPage(env.DB);
    }

    return renderLoginPage(env.DB, request, clientIP, userAgent);
  } catch (error) {
    console.error('Page render error:', error);
    return renderErrorPage('页面渲染错误: ' + error.message);
  }
}

// 生成会话ID
function generateSessionId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('') + Date.now().toString(36);
}

// 验证会话
async function validateSession(request, db) {
  try {
    const cookieHeader = request.headers.get('Cookie');
    if (!cookieHeader) return null;

    const cookies = Object.fromEntries(
      cookieHeader.split(';').map(c => c.trim().split('='))
    );
    
    const sessionId = cookies.session;
    if (!sessionId) return null;

    const sessionData = await db.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).bind(`session_${sessionId}`).first();

    if (!sessionData) return null;

    const session = JSON.parse(sessionData.value);
    if (session.expires < Date.now()) {
      await db.prepare('DELETE FROM settings WHERE key = ?').bind(`session_${sessionId}`).run();
      return null;
    }
    return session;
  } catch (error) {
    console.error('Session validation error:', error);
    return null;
  }
}

// 获取必应壁纸数据
async function getBingWallpaper() {
  try {
    const response = await fetch('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN');
    const data = await response.json();
    if (data.images && data.images.length > 0) {
      return {
        url: 'https://cn.bing.com' + data.images[0].url,
        copyright: data.images[0].copyright
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

// 获取IP地理位置信息
async function getGeoInfo(clientIP, userAgent) {
  try {
    const response = await fetch(`https://api.ip.sb/geoip/${clientIP}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const data = await response.json();
    
    // 测试延迟
    const startTime = Date.now();
    await fetch('https://www.cloudflare.com');
    const latency = Date.now() - startTime;
    
    return {
      ip: data.ip || clientIP,
      country: data.country || '中国',
      region: data.region || '未知',
      city: data.city || '未知',
      isp: data.isp || data.organization || '未知',
      latency: `${latency}ms`,
      user_agent: userAgent
    };
  } catch (error) {
    return {
      ip: clientIP,
      country: "中国",
      region: "未知",
      city: "未知",
      isp: "未知",
      latency: "0ms",
      user_agent: userAgent
    };
  }
}

// 渲染初始化设置页面
function renderSetupPage() {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>系统初始化 - 班级评分系统</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        
        body { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            padding: 20px;
            color: #333;
        }
        
        .setup-container {
            background: rgba(255, 255, 255, 0.95); 
            padding: 40px; 
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); 
            width: 100%; 
            max-width: 500px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        h1 { 
            text-align: center; 
            margin-bottom: 30px; 
            color: #4a5568;
            font-size: 28px;
            font-weight: 700;
        }
        
        .form-group { 
            margin-bottom: 25px; 
            position: relative;
        }
        
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #4a5568;
            font-size: 14px;
        }
        
        input { 
            width: 100%; 
            padding: 15px 20px; 
            border: 2px solid #e2e8f0; 
            border-radius: 12px; 
            font-size: 16px; 
            transition: all 0.3s;
            background: #f8fafc;
            color: #2d3748;
            font-weight: 500;
        }
        
        input:focus { 
            outline: none; 
            border-color: #4299e1; 
            box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.2); 
            background: white;
        }
        
        button { 
            width: 100%; 
            padding: 18px; 
            background: linear-gradient(135deg, #4299e1, #3182ce); 
            color: white; 
            border: none; 
            border-radius: 12px; 
            font-size: 18px; 
            font-weight: 700;
            cursor: pointer; 
            transition: all 0.3s;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin-top: 10px;
        }
        
        button:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 10px 25px rgba(66, 153, 225, 0.4);
            background: linear-gradient(135deg, #3182ce, #2b6cb0);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        .section-title {
            font-size: 18px;
            font-weight: 700;
            margin: 30px 0 20px;
            color: #4a5568;
            padding-bottom: 10px;
            border-bottom: 2px solid #e2e8f0;
        }
        
        .form-section {
            background: #f8fafc;
            padding: 25px;
            border-radius: 15px;
            margin-bottom: 25px;
            border: 1px solid #e2e8f0;
        }
        
        .info-text {
            text-align: center;
            color: #718096;
            font-size: 14px;
            margin-top: 25px;
            line-height: 1.6;
        }
        
        .error-message {
            color: #e53e3e;
            font-size: 14px;
            margin-top: 10px;
            text-align: center;
            font-weight: 600;
        }
        
        .success-message {
            color: #38a169;
            font-size: 14px;
            margin-top: 10px;
            text-align: center;
            font-weight: 600;
        }
        
        @media (max-width: 640px) {
            .setup-container {
                padding: 30px 25px;
            }
            
            h1 {
                font-size: 24px;
            }
            
            input, button {
                padding: 14px 18px;
            }
        }
    </style>
</head>
<body>
    <div class="setup-container">
        <h1>系统初始化</h1>
        
        <div class="info-text">
            欢迎使用班级评分系统！请完成以下设置以开始使用。
        </div>
        
        <form id="setupForm">
            <div class="form-section">
                <div class="section-title">班级信息</div>
                
                <div class="form-group">
                    <label for="site_title">网站标题</label>
                    <input type="text" id="site_title" placeholder="输入网站标题" value="2314班综合评分系统" required>
                </div>
                
                <div class="form-group">
                    <label for="class_name">班级名称</label>
                    <input type="text" id="class_name" placeholder="输入班级名称" value="2314班" required>
                </div>
            </div>
            
            <div class="form-section">
                <div class="section-title">班级账号</div>
                
                <div class="form-group">
                    <label for="class_username">班级登录账号</label>
                    <input type="text" id="class_username" placeholder="设置班级登录账号" value="2314" required>
                </div>
                
                <div class="form-group">
                    <label for="class_password">班级登录密码</label>
                    <input type="password" id="class_password" placeholder="设置班级登录密码" value="hzwy2314" required>
                </div>
            </div>
            
            <div class="form-section">
                <div class="section-title">管理员账号</div>
                
                <div class="form-group">
                    <label for="admin_username">管理员账号</label>
                    <input type="text" id="admin_username" placeholder="设置管理员账号" value="2314admin" required>
                </div>
                
                <div class="form-group">
                    <label for="admin_password">管理员密码</label>
                    <input type="password" id="admin_password" placeholder="设置管理员密码" value="2314admin2314admin" required>
                </div>
            </div>
            
            <button type="submit">开始初始化</button>
            
            <div id="message" class="error-message"></div>
        </form>
        
        <div class="info-text">
            <strong>提示：</strong> 初始化后将创建数据库表并导入初始数据。
        </div>
    </div>

    <script>
        document.getElementById('setupForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = {
                site_title: document.getElementById('site_title').value.trim(),
                class_name: document.getElementById('class_name').value.trim(),
                class_username: document.getElementById('class_username').value.trim(),
                class_password: document.getElementById('class_password').value,
                admin_username: document.getElementById('admin_username').value.trim(),
                admin_password: document.getElementById('admin_password').value
            };

            // 验证必需字段
            for (const [key, value] of Object.entries(formData)) {
                if (!value) {
                    document.getElementById('message').textContent = '请填写所有字段';
                    document.getElementById('message').className = 'error-message';
                    return;
                }
            }

            const submitBtn = e.target.querySelector('button');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = '初始化中...';
            submitBtn.disabled = true;
            document.getElementById('message').textContent = '';

            try {
                const response = await fetch('/api/setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                const result = await response.json();
                
                if (result.success) {
                    document.getElementById('message').textContent = '系统初始化成功！正在跳转...';
                    document.getElementById('message').className = 'success-message';
                    submitBtn.textContent = '初始化成功';
                    
                    setTimeout(() => {
                        window.location.href = '/login';
                    }, 1500);
                } else {
                    document.getElementById('message').textContent = result.error || '初始化失败';
                    document.getElementById('message').className = 'error-message';
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            } catch (error) {
                document.getElementById('message').textContent = '网络错误，请检查网络连接';
                document.getElementById('message').className = 'error-message';
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        });

        // 自动聚焦到第一个输入框
        document.getElementById('site_title').focus();
    </script>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 渲染登录页面
async function renderLoginPage(db, request, clientIP, userAgent) {
  // 获取IP会话信息
  const ipSession = await db.prepare('SELECT * FROM ip_sessions WHERE ip = ?').bind(clientIP).first();
  const wallpaper = await getBingWallpaper();
  const geoInfo = await getGeoInfo(clientIP, userAgent);
  
  const bgImage = wallpaper ? wallpaper.url : 'https://cn.bing.com/th?id=OHR.BadlandsNP_ZH-CN1068836500_1920x1080.jpg';
  
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>班级评分系统 - 登录</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        
        body { 
            min-height: 100vh; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            padding: 20px;
            background: #0f172a;
            position: relative;
            overflow: hidden;
        }
        
        body::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('${bgImage}');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            z-index: -2;
        }
        
        body::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(15, 23, 42, 0.85);
            z-index: -1;
            backdrop-filter: blur(2px);
        }
        
        .login-container {
            background: rgba(30, 41, 59, 0.9); 
            padding: 40px; 
            border-radius: 24px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            width: 100%; 
            max-width: 480px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            transform: translateY(0);
            transition: transform 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        .login-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 4px;
            background: linear-gradient(90deg, #3b82f6, #8b5cf6);
        }
        
        .login-container:hover {
            transform: translateY(-5px);
        }
        
        h1 { 
            text-align: center; 
            margin-bottom: 30px; 
            color: #f1f5f9; 
            font-size: 32px;
            font-weight: 800;
            background: linear-gradient(135deg, #60a5fa, #a78bfa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .role-select { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 12px; 
            margin-bottom: 30px;
        }
        
        .role-btn { 
            padding: 16px; 
            border: 2px solid #475569; 
            background: #1e293b; 
            border-radius: 12px; 
            cursor: pointer; 
            transition: all 0.3s ease; 
            text-align: center;
            font-weight: 600;
            color: #cbd5e1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            font-size: 15px;
        }
        
        .role-btn.active { 
            background: linear-gradient(135deg, #3b82f6, #8b5cf6); 
            border-color: transparent;
            color: white;
            box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
            transform: scale(1.02);
        }
        
        .role-btn:hover:not(.active) {
            border-color: #60a5fa;
            background: #2d3748;
            color: #f1f5f9;
        }
        
        .input-group { 
            margin-bottom: 25px; 
            position: relative;
        }
        
        input { 
            width: 100%; 
            padding: 18px 20px 18px 50px; 
            border: 2px solid #475569; 
            border-radius: 12px; 
            font-size: 16px; 
            transition: all 0.3s ease;
            background: #1e293b;
            color: #f1f5f9;
            font-weight: 500;
        }
        
        input:focus { 
            outline: none; 
            border-color: #3b82f6; 
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2); 
            background: #0f172a;
        }
        
        .input-icon {
            position: absolute;
            left: 20px;
            top: 50%;
            transform: translateY(-50%);
            color: #94a3b8;
            font-size: 18px;
            transition: color 0.3s ease;
        }
        
        input:focus + .input-icon {
            color: #3b82f6;
        }
        
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 25px;
            color: #94a3b8;
            font-size: 14px;
            font-weight: 500;
        }
        
        .checkbox-group input {
            width: 18px;
            height: 18px;
            accent-color: #3b82f6;
        }
        
        button { 
            width: 100%; 
            padding: 18px; 
            background: linear-gradient(135deg, #3b82f6, #8b5cf6); 
            color: white; 
            border: none; 
            border-radius: 12px; 
            font-size: 17px; 
            font-weight: 700;
            cursor: pointer; 
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }
        
        button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
            transition: left 0.6s;
        }
        
        button:hover::before {
            left: 100%;
        }
        
        button:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 10px 30px rgba(59, 130, 246, 0.5);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        .ip-info {
            margin-top: 25px;
            padding: 20px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #94a3b8;
            font-size: 13px;
            line-height: 1.5;
        }
        
        .ip-info strong {
            color: #cbd5e1;
            display: block;
            margin-bottom: 5px;
            font-size: 14px;
        }
        
        .footer {
            margin-top: 30px;
            text-align: center;
            color: #64748b;
            font-size: 13px;
            line-height: 1.6;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 20px;
        }
        
        .error-message {
            color: #f87171;
            font-size: 14px;
            margin-top: 15px;
            text-align: center;
            font-weight: 600;
            background: rgba(239, 68, 68, 0.1);
            padding: 12px;
            border-radius: 8px;
            border: 1px solid rgba(239, 68, 68, 0.2);
        }
        
        .success-message {
            color: #34d399;
            font-size: 14px;
            margin-top: 15px;
            text-align: center;
            font-weight: 600;
            background: rgba(52, 211, 153, 0.1);
            padding: 12px;
            border-radius: 8px;
            border: 1px solid rgba(52, 211, 153, 0.2);
        }
        
        @media (max-width: 640px) {
            .login-container {
                padding: 30px 25px;
            }
            
            h1 {
                font-size: 26px;
            }
            
            .role-select {
                grid-template-columns: 1fr;
            }
            
            input, button {
                padding: 16px 16px 16px 48px;
            }
        }
        
        @media (max-width: 480px) {
            .login-container {
                padding: 25px 20px;
            }
            
            h1 {
                font-size: 24px;
            }
        }
        
        /* 动画效果 */
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .login-container {
            animation: fadeIn 0.6s ease-out;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <h1>班级评分系统</h1>
        
        <div class="role-select">
            <div class="role-btn active" data-role="class">
                班级登录
            </div>
            <div class="role-btn" data-role="admin">
                管理员登录
            </div>
        </div>
        
        <form id="loginForm">
            <div class="input-group">
                <div class="input-icon">用户</div>
                <input type="text" id="username" placeholder="请输入用户名" autocomplete="username" required>
            </div>
            
            <div class="input-group">
                <div class="input-icon">密码</div>
                <input type="password" id="password" placeholder="请输入密码" autocomplete="current-password" required>
            </div>
            
            ${ipSession ? `
            <div class="checkbox-group">
                <input type="checkbox" id="remember_ip" checked>
                <label for="remember_ip">记住IP地址 (${clientIP.substring(0, 15)}...)</label>
            </div>
            ` : ''}
            
            <button type="submit">登录系统</button>
        </form>
        
        <div class="ip-info">
            <strong>连接信息</strong>
            IP: ${geoInfo.ip || clientIP}<br>
            位置: ${geoInfo.region || '未知'} ${geoInfo.city || '未知'}<br>
            延迟: ${geoInfo.latency || '0ms'}<br>
            运营商: ${geoInfo.isp || '未知'}
        </div>
        
        <div id="message" class="error-message"></div>
        
        <div class="footer">
            By 2314 刘沁熙<br>
            基于 Cloudflare Worker 搭建<br>
            Cloudflare CDN 提供加速服务
        </div>
    </div>

    <script>
        let currentRole = 'class';
        const roleCredentials = {
            class: { username: '2314', password: 'hzwy2314' },
            admin: { username: '2314admin', password: '2314admin2314admin' }
        };

        document.querySelectorAll('.role-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentRole = btn.dataset.role;
                
                const creds = roleCredentials[currentRole];
                if (creds) {
                    document.getElementById('username').value = creds.username;
                    document.getElementById('password').value = creds.password;
                }
            });
        });

        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;
            const remember_ip = document.getElementById('remember_ip')?.checked || false;

            if (!username || !password) {
                showMessage('请输入用户名和密码', 'error');
                return;
            }

            const submitBtn = e.target.querySelector('button');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = '登录中...';
            submitBtn.disabled = true;
            document.getElementById('message').textContent = '';

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, remember_ip })
                });

                const result = await response.json();
                
                if (result.success) {
                    showMessage('登录成功！正在跳转...', 'success');
                    submitBtn.textContent = '登录成功';
                    
                    setTimeout(() => {
                        if (result.role === 'class') {
                            window.location.href = '/class';
                        } else if (result.role === 'admin') {
                            window.location.href = '/admin';
                        }
                    }, 800);
                } else {
                    showMessage(result.error, 'error');
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            } catch (error) {
                showMessage('网络错误，请重试', 'error');
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        });

        function showMessage(message, type) {
            const messageEl = document.getElementById('message');
            messageEl.textContent = message;
            messageEl.className = type + '-message';
        }

        // 自动填充默认凭据
        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('username').value = '2314';
            document.getElementById('password').value = 'hzwy2314';
            document.getElementById('username').focus();
        });

        // 监听键盘事件
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.target.matches('button')) {
                document.getElementById('loginForm').requestSubmit();
            }
        });
    </script>
</body>
</html>
  `;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 渲染班级页面
async function renderClassPage(db, request, clientIP, userAgent) {
  try {
    const session = await validateSession(request, db);
    if (!session || session.role !== 'class') {
      return Response.redirect(new URL('/login', request.url));
    }

    // 获取所有必要数据
    const [studentsData, scoreCategories, tasks, settings, wallpaper, geoInfo] = await Promise.all([
      handleGetStudents(db).then(r => r.json()),
      db.prepare('SELECT * FROM score_categories ORDER BY type, name').all(),
      db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 5').all(),
      db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?)').bind('site_title', 'class_name', 'current_month').all(),
      getBingWallpaper(),
      getGeoInfo(clientIP, userAgent)
    ]);

    if (!studentsData.success) {
      throw new Error(studentsData.error);
    }

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    const bgImage = wallpaper ? wallpaper.url : 'https://cn.bing.com/th?id=OHR.BadlandsNP_ZH-CN1068836500_1920x1080.jpg';

    // 完整的班级页面HTML
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settingMap.site_title || '2314班综合评分系统'}</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        
        :root {
            --primary: #3b82f6;
            --primary-dark: #2563eb;
            --secondary: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
            --background: #0f172a;
            --surface: #1e293b;
            --surface-light: #334155;
            --text: #f1f5f9;
            --text-light: #94a3b8;
            --text-lighter: #64748b;
            --border: #475569;
            --border-light: #64748b;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
            --shadow-lg: 0 25px 50px -12px rgba(0, 0, 0, 0.75);
            --radius: 16px;
            --radius-sm: 12px;
            --radius-lg: 20px;
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
            overflow-x: hidden;
            position: relative;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('${bgImage}');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            z-index: -2;
            opacity: 0.15;
        }
        
        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.98));
            z-index: -1;
            backdrop-filter: blur(1px);
        }
        
        /* 顶部信息栏 */
        .top-bar {
            background: rgba(30, 41, 59, 0.9);
            backdrop-filter: blur(10px);
            padding: 15px 25px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border);
            position: sticky;
            top: 0;
            z-index: 1000;
            box-shadow: var(--shadow);
        }
        
        .class-info {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .class-title {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .class-title h1 {
            font-size: 24px;
            font-weight: 800;
            color: var(--text);
            margin: 0;
        }
        
        .beta-badge {
            background: #3b82f6;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 700;
        }
        
        .class-stats {
            color: var(--text-light);
            font-size: 14px;
        }
        
        .cloudflare-badge {
            color: var(--text-light);
            font-size: 14px;
        }
        
        /* 搜索框 */
        .search-container {
            margin: 20px 25px;
            position: relative;
        }
        
        .search-box {
            display: flex;
            align-items: center;
            background: white;
            border-radius: 24px;
            padding: 8px 20px;
            box-shadow: var(--shadow);
        }
        
        .search-icon {
            width: 20px;
            height: 20px;
            margin-right: 10px;
        }
        
        .search-input {
            flex: 1;
            border: none;
            outline: none;
            font-size: 16px;
            padding: 10px 0;
            background: transparent;
            color: #333;
        }
        
        .search-input::placeholder {
            color: #999;
        }
        
        .search-button {
            background: #4CAF50;
            color: white;
            border: none;
            padding: 10px 24px;
            border-radius: 20px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .search-button:hover {
            background: #45a049;
            transform: translateY(-2px);
        }
        
        .suggestions-box {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: white;
            border-radius: 12px;
            box-shadow: var(--shadow);
            margin-top: 5px;
            max-height: 300px;
            overflow-y: auto;
            display: none;
            z-index: 1000;
        }
        
        .suggestion-item {
            padding: 12px 20px;
            cursor: pointer;
            color: #333;
            border-bottom: 1px solid #eee;
            transition: background 0.2s;
        }
        
        .suggestion-item:hover {
            background: #f5f5f5;
        }
        
        .suggestion-item:last-child {
            border-bottom: none;
        }
        
        /* 信息卡片 */
        .info-cards {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
            margin: 20px 25px;
        }
        
        .info-card {
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(10px);
            border-radius: var(--radius);
            padding: 20px;
            box-shadow: var(--shadow);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .info-card-title {
            color: var(--text-light);
            font-size: 14px;
            margin-bottom: 10px;
        }
        
        .info-card-content {
            font-size: 24px;
            font-weight: 700;
            color: var(--text);
        }
        
        .countdown {
            color: var(--danger);
        }
        
        .weather-container {
            height: 280px;
            overflow: hidden;
        }
        
        .schedule-container {
            max-height: 280px;
            overflow-y: auto;
        }
        
        .schedule-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }
        
        .schedule-table th, .schedule-table td {
            padding: 6px 8px;
            text-align: center;
            border: 1px solid var(--border);
        }
        
        .schedule-table th {
            background: rgba(59, 130, 246, 0.2);
            color: var(--text);
            font-weight: 600;
        }
        
        .schedule-table td {
            color: var(--text-light);
        }
        
        .current-class {
            background: rgba(16, 185, 129, 0.2);
            color: var(--text) !important;
            font-weight: 600;
        }
        
        /* 功能栏 */
        .function-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 20px 25px;
            padding: 15px;
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(10px);
            border-radius: var(--radius);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .sort-options {
            display: flex;
            gap: 10px;
            align-items: center;
        }
        
        .sort-btn {
            padding: 8px 16px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid var(--border);
            color: var(--text-light);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 14px;
        }
        
        .sort-btn:hover, .sort-btn.active {
            background: var(--primary);
            color: white;
            border-color: var(--primary);
        }
        
        .action-buttons {
            display: flex;
            gap: 10px;
        }
        
        .btn {
            padding: 10px 20px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            border: none;
        }
        
        .btn-primary {
            background: var(--primary);
            color: white;
        }
        
        .btn-primary:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
        }
        
        .btn-danger {
            background: var(--danger);
            color: white;
        }
        
        .btn-danger:hover {
            background: #dc2626;
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(239, 68, 68, 0.4);
        }
        
        /* 学生表格 */
        .student-table-container {
            margin: 20px 25px;
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(10px);
            border-radius: var(--radius);
            overflow: hidden;
            box-shadow: var(--shadow);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .student-table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .student-table th {
            background: rgba(30, 41, 59, 0.9);
            padding: 18px 20px;
            text-align: left;
            font-weight: 600;
            color: var(--text-light);
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 2px solid var(--border);
        }
        
        .student-table td {
            padding: 18px 20px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            transition: all 0.2s ease;
        }
        
        .student-table tr:hover td {
            background: rgba(59, 130, 246, 0.1);
        }
        
        .student-table tr:last-child td {
            border-bottom: none;
        }
        
        .student-name {
            font-weight: 600;
            color: var(--text);
        }
        
        .score-cell {
            font-weight: 700;
            font-size: 18px;
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
            padding: 8px 12px;
            border-radius: 8px;
            text-align: center;
        }
        
        .score-cell:hover {
            transform: scale(1.05);
            background: rgba(59, 130, 246, 0.2);
        }
        
        .add-score {
            color: var(--secondary);
        }
        
        .minus-score {
            color: var(--danger);
        }
        
        .total-score {
            color: var(--primary);
            font-weight: 800;
            font-size: 20px;
        }
        
        .action-buttons-cell {
            display: flex;
            gap: 8px;
        }
        
        .action-btn {
            padding: 6px 12px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            font-weight: 600;
            font-size: 12px;
            transition: all 0.3s ease;
        }
        
        .action-btn-detail {
            background: rgba(59, 130, 246, 0.2);
            color: #60a5fa;
            border: 1px solid rgba(59, 130, 246, 0.3);
        }
        
        .action-btn-detail:hover {
            background: rgba(59, 130, 246, 0.4);
            transform: translateY(-2px);
        }
        
        /* IP信息提示 */
        .ip-notification {
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(30, 41, 59, 0.95);
            backdrop-filter: blur(10px);
            padding: 15px 20px;
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            border: 1px solid rgba(255, 255, 255, 0.1);
            z-index: 2000;
            max-width: 300px;
            animation: slideInRight 0.5s ease;
        }
        
        .ip-notification h3 {
            color: var(--text);
            margin-bottom: 10px;
            font-size: 14px;
        }
        
        .ip-details {
            font-size: 12px;
            color: var(--text-light);
            line-height: 1.5;
        }
        
        /* 模态框 */
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(5px);
            z-index: 3000;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .modal-content {
            background: var(--surface);
            padding: 30px;
            border-radius: var(--radius-lg);
            width: 100%;
            max-width: 600px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: var(--shadow-lg);
            border: 1px solid rgba(255, 255, 255, 0.1);
            position: relative;
        }
        
        .modal-close {
            position: absolute;
            top: 20px;
            right: 20px;
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: var(--text-light);
            transition: color 0.3s ease;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.1);
        }
        
        .modal-close:hover {
            color: var(--danger);
            background: rgba(239, 68, 68, 0.1);
        }
        
        .modal-title {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 20px;
            color: var(--text);
        }
        
        /* 批量评分模态框 */
        .student-select-container {
            max-height: 300px;
            overflow-y: auto;
            margin: 20px 0;
            padding: 15px;
            background: rgba(15, 23, 42, 0.6);
            border-radius: var(--radius);
        }
        
        .student-checkbox {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .student-checkbox:hover {
            background: rgba(59, 130, 246, 0.1);
        }
        
        .student-checkbox.selected {
            background: rgba(59, 130, 246, 0.2);
            border: 1px solid rgba(59, 130, 246, 0.5);
        }
        
        /* 危险操作模态框 */
        .danger-actions {
            display: grid;
            gap: 15px;
            margin: 20px 0;
        }
        
        .danger-btn {
            padding: 15px;
            border-radius: var(--radius);
            border: none;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
            text-align: left;
        }
        
        .danger-btn-reset {
            background: rgba(239, 68, 68, 0.1);
            color: #f87171;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        
        .danger-btn-reset:hover {
            background: rgba(239, 68, 68, 0.2);
        }
        
        .danger-btn-snapshot {
            background: rgba(59, 130, 246, 0.1);
            color: #60a5fa;
            border: 1px solid rgba(59, 130, 246, 0.3);
        }
        
        .danger-btn-snapshot:hover {
            background: rgba(59, 130, 246, 0.2);
        }
        
        .danger-btn-password {
            background: rgba(245, 158, 11, 0.1);
            color: #f59e0b;
            border: 1px solid rgba(245, 158, 11, 0.3);
        }
        
        .danger-btn-password:hover {
            background: rgba(245, 158, 11, 0.2);
        }
        
        /* 动画 */
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }
        
        /* 响应式设计 */
        @media (max-width: 1200px) {
            .info-cards {
                grid-template-columns: repeat(2, 1fr);
            }
        }
        
        @media (max-width: 768px) {
            .top-bar {
                flex-direction: column;
                gap: 10px;
                text-align: center;
            }
            
            .class-info {
                flex-direction: column;
                gap: 5px;
            }
            
            .info-cards {
                grid-template-columns: 1fr;
            }
            
            .function-bar {
                flex-direction: column;
                gap: 15px;
            }
            
            .sort-options, .action-buttons {
                width: 100%;
                justify-content: center;
                flex-wrap: wrap;
            }
            
            .student-table {
                font-size: 14px;
            }
            
            .student-table th, .student-table td {
                padding: 12px 15px;
            }
        }
    </style>
</head>
<body>
    <!-- IP信息提示 -->
    <div class="ip-notification" id="ipNotification">
        <h3>连接信息</h3>
        <div class="ip-details">
            IP地址: ${geoInfo.ip || clientIP}<br>
            地区: ${geoInfo.region || '未知'} ${geoInfo.city || '未知'}<br>
            延迟: ${geoInfo.latency || '0ms'}<br>
            设备: ${userAgent?.substring(0, 30) || '未知'}...
        </div>
    </div>
    
    <!-- 顶部栏 -->
    <div class="top-bar">
        <div class="class-info">
            <div class="class-title">
                <h1>2314综合评分系统</h1>
                <div class="beta-badge">Beta2.0</div>
            </div>
            <div class="class-stats">
                人数: ${studentsData.totalStudents || 0}名学生 | 日期: <span id="currentDate"></span>
            </div>
        </div>
        <div class="cloudflare-badge">
            由Cloudflare Page强力驱动
        </div>
    </div>
    
    <!-- 搜索框 -->
    <div class="search-container">
        <div class="search-box">
            <img src="https://cn.bing.com/favicon.ico" alt="Bing" class="search-icon">
            <input type="text" class="search-input" placeholder="海纳百川，有求必应。" id="searchInput">
            <button class="search-button" id="searchButton">搜索</button>
        </div>
        <div class="suggestions-box" id="suggestionsBox"></div>
    </div>
    
    <!-- 信息卡片 -->
    <div class="info-cards">
        <div class="info-card">
            <div class="info-card-title">北京时间</div>
            <div class="info-card-content" id="beijingTime"></div>
        </div>
        <div class="info-card">
            <div class="info-card-title">距离中考</div>
            <div class="info-card-content countdown" id="examCountdown"></div>
        </div>
        <div class="info-card weather-container">
            <div class="info-card-title">天气</div>
            <iframe allowtransparency="true" frameborder="0" width="100%" height="240" scrolling="no" src="https://tianqi.2345.com/plugin/widget/index.htm?s=2&z=3&t=0&v=1&d=3&bd=1&k=000000&f=&ltf=009944&htf=cc0000&q=1&e=1&a=1&c=70866&w=100%&h=240&align=left"></iframe>
        </div>
        <div class="info-card schedule-container">
            <div class="info-card-title">课表</div>
            <table class="schedule-table" id="scheduleTable">
                <!-- 课表将通过JavaScript动态生成 -->
            </table>
        </div>
    </div>
    
    <!-- 功能栏 -->
    <div class="function-bar">
        <div class="sort-options">
            <span>排序方式:</span>
            <button class="sort-btn active" data-sort="name">姓名A-Z</button>
            <button class="sort-btn" data-sort="total-desc">总分由高到低</button>
            <button class="sort-btn" data-sort="total-asc">总分由低到高</button>
            <button class="sort-btn" data-sort="time">评分时间</button>
        </div>
        <div class="action-buttons">
            <button class="btn btn-primary" onclick="showBatchScoreModal()">批量评分</button>
            <button class="btn btn-danger" onclick="showDangerModal()">危险操作</button>
        </div>
    </div>
    
    <!-- 学生表格 -->
    <div class="student-table-container">
        <table class="student-table">
            <thead>
                <tr>
                    <th>学生姓名</th>
                    <th width="120">点击加分</th>
                    <th width="120">点击扣分</th>
                    <th width="120">总分</th>
                    <th width="150">操作</th>
                </tr>
            </thead>
            <tbody id="studentsBody">
                ${studentsData.students.map((student) => `
                    <tr data-id="${student.id}" data-name="${student.name}" data-total="${student.total_score}" data-time="${student.last_scored_at || ''}">
                        <td class="student-name">${student.name}</td>
                        <td class="score-cell add-score" onclick="startScoreProcess(${student.id}, 'add', '${student.name}')">
                            ${student.add_score}
                        </td>
                        <td class="score-cell minus-score" onclick="startScoreProcess(${student.id}, 'minus', '${student.name}')">
                            ${student.minus_score}
                        </td>
                        <td class="total-score">
                            ${student.total_score > 0 ? '+' : ''}${student.total_score}
                        </td>
                        <td>
                            <div class="action-buttons-cell">
                                <button class="action-btn action-btn-detail" onclick="showStudentHistory(${student.id}, '${student.name}')">详细</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    
    <!-- 评分模态框 -->
    <div class="modal-overlay" id="scoreModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeScoreModal()">×</button>
            <div class="modal-title">评分</div>
            
            <div style="margin-bottom: 20px;">
                学生: <strong id="scoreStudentName"></strong>
            </div>
            
            <div class="input-group" style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">选择分数:</label>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                    <button class="score-btn" data-score="1">1分</button>
                    <button class="score-btn" data-score="2">2分</button>
                    <button class="score-btn" data-score="3">3分</button>
                    <button class="score-btn" data-score="4">4分</button>
                    <button class="score-btn" data-score="5">5分</button>
                    <button class="score-btn" data-score="custom">自定义</button>
                </div>
                <input type="number" id="customScore" style="display: none; margin-top: 10px; width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);" placeholder="输入自定义分值" min="1" max="100">
            </div>
            
            <div class="input-group" style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">评分项目:</label>
                <select id="categorySelect" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);">
                    <!-- 动态填充 -->
                </select>
            </div>
            
            <div class="input-group" style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">操作者类型:</label>
                <select id="operatorType" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);">
                    <option value="teacher">老师</option>
                    <option value="student">学生(课代表)</option>
                </select>
            </div>
            
            <div class="input-group" id="operatorDetailContainer" style="margin-bottom: 20px; display: none;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">具体操作者:</label>
                <select id="operatorDetail" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);">
                    <option value="语文课代表">语文课代表</option>
                    <option value="数学课代表">数学课代表</option>
                    <option value="英语课代表">英语课代表</option>
                    <option value="物理课代表">物理课代表</option>
                    <option value="化学课代表">化学课代表</option>
                    <option value="政治课代表">政治课代表</option>
                    <option value="历史课代表">历史课代表</option>
                    <option value="体育课代表">体育课代表</option>
                    <option value="其他">其他</option>
                </select>
                <input type="text" id="otherOperatorDetail" style="display: none; margin-top: 10px; width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);" placeholder="请输入具体操作者">
            </div>
            
            <div class="input-group" style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">备注说明:</label>
                <input type="text" id="scoreNote" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);" placeholder="请输入备注信息（某些项目必填）">
                <div id="noteRequired" style="color: var(--danger); font-size: 13px; margin-top: 5px; display: none;">此项必须填写备注说明</div>
            </div>
            
            <div style="display: flex; gap: 15px; margin-top: 30px;">
                <button class="btn" onclick="closeScoreModal()" style="flex: 1; background: rgba(255, 255, 255, 0.1); color: var(--text-light);">取消</button>
                <button class="btn btn-primary" onclick="submitScore()" style="flex: 1;">提交评分</button>
            </div>
        </div>
    </div>
    
    <!-- 批量评分模态框 -->
    <div class="modal-overlay" id="batchScoreModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeBatchScoreModal()">×</button>
            <div class="modal-title">批量评分</div>
            
            <div class="student-select-container" id="studentSelectContainer">
                <!-- 动态填充 -->
            </div>
            
            <div style="margin: 15px 0; display: flex; gap: 10px;">
                <button class="btn" onclick="selectAllStudents()">全选</button>
                <button class="btn" onclick="deselectAllStudents()">全不选</button>
                <button class="btn" onclick="selectByFirstLetter()">按首字母选择</button>
            </div>
            
            <div class="input-group" style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">选择分数:</label>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                    <button class="score-btn" data-score="1">1分</button>
                    <button class="score-btn" data-score="2">2分</button>
                    <button class="score-btn" data-score="3">3分</button>
                    <button class="score-btn" data-score="4">4分</button>
                    <button class="score-btn" data-score="5">5分</button>
                    <button class="score-btn" data-score="custom">自定义</button>
                </div>
                <input type="number" id="batchCustomScore" style="display: none; margin-top: 10px; width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);" placeholder="输入自定义分值" min="1" max="100">
            </div>
            
            <div class="input-group" style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">评分项目:</label>
                <select id="batchCategorySelect" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);">
                    <!-- 动态填充 -->
                </select>
            </div>
            
            <div class="input-group" style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">操作者类型:</label>
                <select id="batchOperatorType" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);">
                    <option value="teacher">老师</option>
                    <option value="student">学生(课代表)</option>
                </select>
            </div>
            
            <div class="input-group" id="batchOperatorDetailContainer" style="margin-bottom: 20px; display: none;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">具体操作者:</label>
                <select id="batchOperatorDetail" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);">
                    <option value="语文课代表">语文课代表</option>
                    <option value="数学课代表">数学课代表</option>
                    <option value="英语课代表">英语课代表</option>
                    <option value="物理课代表">物理课代表</option>
                    <option value="化学课代表">化学课代表</option>
                    <option value="政治课代表">政治课代表</option>
                    <option value="历史课代表">历史课代表</option>
                    <option value="体育课代表">体育课代表</option>
                    <option value="其他">其他</option>
                </select>
                <input type="text" id="batchOtherOperatorDetail" style="display: none; margin-top: 10px; width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);" placeholder="请输入具体操作者">
            </div>
            
            <div class="input-group" style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">备注说明:</label>
                <input type="text" id="batchScoreNote" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);" placeholder="请输入备注信息（某些项目必填）">
                <div id="batchNoteRequired" style="color: var(--danger); font-size: 13px; margin-top: 5px; display: none;">此项必须填写备注说明</div>
            </div>
            
            <div style="display: flex; gap: 15px; margin-top: 30px;">
                <button class="btn" onclick="closeBatchScoreModal()" style="flex: 1; background: rgba(255, 255, 255, 0.1); color: var(--text-light);">取消</button>
                <button class="btn btn-primary" onclick="submitBatchScore()" style="flex: 1;">批量提交</button>
            </div>
        </div>
    </div>
    
    <!-- 危险操作模态框 -->
    <div class="modal-overlay" id="dangerModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeDangerModal()">×</button>
            <div class="modal-title">危险操作</div>
            
            <div class="danger-actions">
                <button class="danger-btn danger-btn-snapshot" onclick="showSnapshotModal()">保存月度快照</button>
                <button class="danger-btn danger-btn-reset" onclick="showResetModal()">重置所有分数</button>
                <button class="danger-btn danger-btn-password" onclick="showPasswordModal()">修改密码</button>
            </div>
            
            <div style="margin-top: 30px; padding: 20px; background: rgba(239, 68, 68, 0.1); border-radius: var(--radius); border: 1px solid rgba(239, 68, 68, 0.3); color: var(--text-light); font-size: 14px;">
                <strong style="color: var(--danger);">警告：</strong>
                这些操作可能会影响系统数据，请谨慎操作。部分操作不可恢复。
            </div>
        </div>
    </div>
    
    <!-- 保存快照模态框 -->
    <div class="modal-overlay" id="snapshotModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeSnapshotModal()">×</button>
            <div class="modal-title">保存月度快照</div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">快照标题:</label>
                <input type="text" id="snapshotTitle" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);" placeholder="例如：期中考核、月末总结等" value="${new Date().getMonth() + 1}月总结">
            </div>
            
            <div style="margin: 20px 0; padding: 20px; background: rgba(59, 130, 246, 0.1); border-radius: var(--radius); border: 1px solid rgba(59, 130, 246, 0.3); color: var(--text-light);">
                <strong style="color: var(--primary);">说明：</strong>
                快照将保存当前所有学生的分数状态，用于历史记录和对比分析。<br>
                保存后可在历史记录中查看。
            </div>
            
            <div style="display: flex; gap: 15px; margin-top: 30px;">
                <button class="btn" onclick="closeSnapshotModal()" style="flex: 1; background: rgba(255, 255, 255, 0.1); color: var(--text-light);">取消</button>
                <button class="btn btn-primary" onclick="createSnapshot()" style="flex: 1;">保存快照</button>
            </div>
        </div>
    </div>
    
    <!-- 重置分数模态框 -->
    <div class="modal-overlay" id="resetModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeResetModal()">×</button>
            <div class="modal-title">重置所有分数</div>
            
            <div style="margin: 20px 0; padding: 20px; background: rgba(239, 68, 68, 0.1); border-radius: var(--radius); border: 1px solid rgba(239, 68, 68, 0.3); color: var(--text-light);">
                <strong style="color: var(--danger);">警告：此操作不可撤销！</strong><br><br>
                这将清除所有学生的分数记录，包括所有加分和扣分记录。<br>
                学生分数将重置为0，但学生名单和评分项目设置将保留。
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">请输入管理员密码进行验证:</label>
                <input type="password" id="resetPassword" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);" placeholder="输入管理员密码">
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">请输入确认文本:</label>
                <input type="text" id="resetConfirmText" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);" placeholder="请输入'确认清空所有数据'">
            </div>
            
            <div style="display: flex; gap: 15px; margin-top: 30px;">
                <button class="btn" onclick="closeResetModal()" style="flex: 1; background: rgba(255, 255, 255, 0.1); color: var(--text-light);">取消</button>
                <button class="btn btn-danger" onclick="confirmReset()" style="flex: 1;">确认重置</button>
            </div>
        </div>
    </div>
    
    <!-- 修改密码模态框 -->
    <div class="modal-overlay" id="passwordModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closePasswordModal()">×</button>
            <div class="modal-title">修改密码</div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">当前密码:</label>
                <input type="password" id="currentPassword" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);" placeholder="输入当前密码">
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">新密码:</label>
                <input type="password" id="newPassword" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);" placeholder="输入新密码">
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; color: var(--text);">确认新密码:</label>
                <input type="password" id="confirmNewPassword" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(15, 23, 42, 0.6); color: var(--text);" placeholder="再次输入新密码">
            </div>
            
            <div style="display: flex; gap: 15px; margin-top: 30px;">
                <button class="btn" onclick="closePasswordModal()" style="flex: 1; background: rgba(255, 255, 255, 0.1); color: var(--text-light);">取消</button>
                <button class="btn btn-primary" onclick="updatePassword()" style="flex: 1;">修改密码</button>
            </div>
        </div>
    </div>
    
    <!-- 学生历史记录模态框 -->
    <div class="modal-overlay" id="historyModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeHistoryModal()">×</button>
            <div class="modal-title">学生详细记录 - <span id="historyStudentName"></span></div>
            
            <div id="historyLoading" style="text-align: center; padding: 40px; color: var(--text-light);">
                加载中...
            </div>
            
            <div id="historyContent" style="display: none;">
                <div style="margin-bottom: 20px; color: var(--text-light);">
                    共 <span id="historyCount">0</span> 条记录
                </div>
                
                <div id="historyList" style="max-height: 400px; overflow-y: auto;">
                    <!-- 动态填充 -->
                </div>
            </div>
        </div>
    </div>

    <script>
        // 全局变量
        let currentStudentId = null;
        let currentScoreType = 'add';
        let currentStudentName = '';
        let selectedScore = 1;
        let selectedStudents = new Set();
        let currentSort = 'name';
        let allStudents = ${JSON.stringify(studentsData.students || [])};
        
        // 初始化
        document.addEventListener('DOMContentLoaded', function() {
            // 初始化日期和时间
            updateDateTime();
            updateCountdown();
            updateSchedule();
            
            // 设置自动更新
            setInterval(updateDateTime, 1000);
            setInterval(updateSchedule, 60000); // 每分钟更新一次课表
            
            // 隐藏IP通知
            setTimeout(() => {
                const ipNotification = document.getElementById('ipNotification');
                if (ipNotification) {
                    ipNotification.style.animation = 'fadeOut 0.5s ease';
                    setTimeout(() => {
                        ipNotification.style.display = 'none';
                    }, 500);
                }
            }, 5000);
            
            // 初始化搜索功能
            initSearch();
            
            // 初始化排序按钮
            initSortButtons();
            
            // 初始化学生选择
            initStudentSelection();
            
            // 初始化评分按钮
            initScoreButtons();
        });
        
        // 更新日期和时间
        function updateDateTime() {
            const now = new Date();
            const dateStr = now.toLocaleDateString('zh-CN', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
            const timeStr = now.toLocaleTimeString('zh-CN', { 
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            document.getElementById('currentDate').textContent = dateStr;
            document.getElementById('beijingTime').textContent = \`\${dateStr} \${timeStr}\`;
        }
        
        // 更新中考倒计时
        function updateCountdown() {
            const examDate = new Date('2026-06-16');
            const today = new Date();
            const diffTime = examDate - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            document.getElementById('examCountdown').textContent = diffDays > 0 ? \`\${diffDays}天\` : '已开始';
        }
        
        // 更新课表
        function updateSchedule() {
            const scheduleTable = document.getElementById('scheduleTable');
            if (!scheduleTable) return;
            
            const now = new Date();
            const day = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
            const hour = now.getHours();
            const minute = now.getMinutes();
            const currentTime = hour * 60 + minute;
            
            // 课表数据
            const schedule = {
                '一': ['语文', '语文', '语文', '物理', '化学', '数学', '在宿舍', '午休', '化学', '政治', '英语', '体育', '晚饭', '历史', '英语', '数学', '数学', '化学'],
                '二': ['英语', '英语', '英语', '英语', '历史', '物理', '在宿舍', '午休', '数学', '数学', '数学', '物理', '晚饭', '语文', '语文', '语文', '化等', '英语'],
                '三': ['语文', '语文', '语文', '物理', '数学', '语文', '在宿舍', '午休', '物理', '物理', '英语', '体育', '晚饭', '英语', '政治', '物理', '化学', '数学'],
                '四': ['英语', '英语', '英语', '数学', '数学', '历史', '在宿舍', '午休', '数学', '政治', '化学', '语文', '晚饭', '语文', '英语', '英语', '政治', '语文'],
                '五': ['语文', '语文', '语文', '英语', '语文', '物理', '在宿舍', '午休', '物理', '物理', '数学', '数学', '晚饭', '英政治', '历史', '历史', '化学', '英语'],
                '六': ['英语', '英语', '语文', '语文化学', '语文', '历史', '在宿舍', '午休', '数学', '放假', '数学', '数学', '晚放', '班会', '化学', '英语', '物理', '数学'],
                '日': ['轮流', '政治', '数学', '', '物理', '数学', '放假', '↑', '', '', '', '', '返校', '', '英语', '数学', '阅读', '数学.']
            };
            
            const timeSlots = [
                '6:50-T:Lo', '1:20-8:00', '8:25-9:05', '9:15-9:55', '10:20-11:00', '11:10-11:50',
                '12:15-12:30', '12:30-13:20', '13:40-15:10', '15:20-16:00', '16:10-16:50', '17:00-17:40',
                '17:40-18:00', '18:16-18:50', '19:00-19:40', '19:50-20:30', '20:40-21:20', '21:30-22:50'
            ];
            
            const timeRanges = [
                { start: 6*60+50, end: 7*60+50 },   // 6:50-7:50
                { start: 13*60+20, end: 14*60+0 },  // 1:20-2:00
                { start: 8*60+25, end: 9*60+5 },    // 8:25-9:05
                { start: 9*60+15, end: 9*60+55 },   // 9:15-9:55
                { start: 10*60+20, end: 11*60+0 },  // 10:20-11:00
                { start: 11*60+10, end: 11*60+50 }, // 11:10-11:50
                { start: 12*60+15, end: 12*60+30 }, // 12:15-12:30
                { start: 12*60+30, end: 13*60+20 }, // 12:30-13:20
                { start: 13*60+40, end: 15*60+10 }, // 13:40-15:10
                { start: 15*60+20, end: 16*60+0 },  // 15:20-16:00
                { start: 16*60+10, end: 16*60+50 }, // 16:10-16:50
                { start: 17*60+0, end: 17*60+40 },  // 17:00-17:40
                { start: 17*60+40, end: 18*60+0 },  // 17:40-18:00
                { start: 18*60+16, end: 18*60+50 }, // 18:16-18:50
                { start: 19*60+0, end: 19*60+40 },  // 19:00-19:40
                { start: 19*60+50, end: 20*60+30 }, // 19:50-20:30
                { start: 20*60+40, end: 21*60+20 }, // 20:40-21:20
                { start: 21*60+30, end: 22*60+50 }  // 21:30-22:50
            ];
            
            const days = ['一', '二', '三', '四', '五', '六', '日'];
            const currentDayIndex = day === 0 ? 6 : day - 1;
            const currentDay = days[currentDayIndex];
            
            let html = '<thead><tr><th>时间</th>';
            days.forEach(day => {
                html += \`<th>\${day}</th>\`;
            });
            html += '</tr></thead><tbody>';
            
            for (let i = 0; i < timeSlots.length; i++) {
                html += '<tr>';
                html += \`<td>\${timeSlots[i]}</td>\`;
                
                let isCurrentClass = false;
                if (currentDayIndex >= 0 && currentDayIndex < days.length) {
                    const timeRange = timeRanges[i];
                    if (currentTime >= timeRange.start && currentTime <= timeRange.end) {
                        isCurrentClass = true;
                    }
                }
                
                days.forEach(day => {
                    const className = schedule[day][i] || '';
                    const cellClass = isCurrentClass && day === currentDay ? 'current-class' : '';
                    html += \`<td class="\${cellClass}">\${className}</td>\`;
                });
                
                html += '</tr>';
            }
            
            html += '</tbody>';
            scheduleTable.innerHTML = html;
        }
        
        // 初始化搜索功能
        function initSearch() {
            const searchInput = document.getElementById('searchInput');
            const searchButton = document.getElementById('searchButton');
            const suggestionsBox = document.getElementById('suggestionsBox');
            
            let debounceTimer;
            
            searchInput.addEventListener('input', function() {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    const query = this.value.trim();
                    if (query.length > 0) {
                        fetchSuggestions(query);
                    } else {
                        suggestionsBox.style.display = 'none';
                    }
                }, 300);
            });
            
            searchInput.addEventListener('focus', function() {
                const query = this.value.trim();
                if (query.length > 0) {
                    suggestionsBox.style.display = 'block';
                }
            });
            
            document.addEventListener('click', function(e) {
                if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
                    suggestionsBox.style.display = 'none';
                }
            });
            
            searchButton.addEventListener('click', function() {
                const query = searchInput.value.trim();
                if (query) {
                    window.open(\`https://cn.bing.com/search?q=\${encodeURIComponent(query)}\`, '_blank');
                }
            });
            
            searchInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    const query = this.value.trim();
                    if (query) {
                        window.open(\`https://cn.bing.com/search?q=\${encodeURIComponent(query)}\`, '_blank');
                    }
                }
            });
        }
        
        // 获取搜索建议
        async function fetchSuggestions(query) {
            try {
                const response = await fetch(\`/api/search-suggest?q=\${encodeURIComponent(query)}\`);
                const data = await response.json();
                
                const suggestionsBox = document.getElementById('suggestionsBox');
                suggestionsBox.innerHTML = '';
                
                if (data.s && data.s.length > 0) {
                    data.s.forEach(item => {
                        const div = document.createElement('div');
                        div.className = 'suggestion-item';
                        div.textContent = item.q;
                        div.addEventListener('click', function() {
                            document.getElementById('searchInput').value = item.q;
                            suggestionsBox.style.display = 'none';
                            window.open(\`https://cn.bing.com/search?q=\${encodeURIComponent(item.q)}\`, '_blank');
                        });
                        suggestionsBox.appendChild(div);
                    });
                    suggestionsBox.style.display = 'block';
                } else {
                    suggestionsBox.style.display = 'none';
                }
            } catch (error) {
                console.error('Failed to fetch suggestions:', error);
            }
        }
        
        // 初始化排序按钮
        function initSortButtons() {
            document.querySelectorAll('.sort-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
                    this.classList.add('active');
                    currentSort = this.dataset.sort;
                    sortStudents();
                });
            });
        }
        
        // 排序学生
        function sortStudents() {
            const tbody = document.getElementById('studentsBody');
            const rows = Array.from(tbody.querySelectorAll('tr'));
            
            rows.sort((a, b) => {
                const nameA = a.dataset.name;
                const nameB = b.dataset.name;
                const totalA = parseInt(a.dataset.total) || 0;
                const totalB = parseInt(b.dataset.total) || 0;
                const timeA = a.dataset.time ? new Date(a.dataset.time) : new Date(0);
                const timeB = b.dataset.time ? new Date(b.dataset.time) : new Date(0);
                
                switch (currentSort) {
                    case 'name':
                        return nameA.localeCompare(nameB, 'zh-CN');
                    case 'total-desc':
                        return totalB - totalA;
                    case 'total-asc':
                        return totalA - totalB;
                    case 'time':
                        return timeB - timeA;
                    default:
                        return 0;
                }
            });
            
            // 清空并重新添加排序后的行
            tbody.innerHTML = '';
            rows.forEach(row => tbody.appendChild(row));
        }
        
        // 初始化学生选择
        function initStudentSelection() {
            const container = document.getElementById('studentSelectContainer');
            container.innerHTML = '';
            
            // 按姓名排序
            const sortedStudents = [...allStudents].sort((a, b) => 
                a.name.localeCompare(b.name, 'zh-CN')
            );
            
            sortedStudents.forEach(student => {
                const checkbox = document.createElement('div');
                checkbox.className = 'student-checkbox';
                checkbox.innerHTML = \`
                    <input type="checkbox" value="\${student.id}" id="student_\${student.id}">
                    <label for="student_\${student.id}">\${student.name}</label>
                \`;
                
                const input = checkbox.querySelector('input');
                input.addEventListener('change', function() {
                    if (this.checked) {
                        selectedStudents.add(student.id);
                        checkbox.classList.add('selected');
                    } else {
                        selectedStudents.delete(student.id);
                        checkbox.classList.remove('selected');
                    }
                });
                
                container.appendChild(checkbox);
            });
        }
        
        // 全选学生
        function selectAllStudents() {
            document.querySelectorAll('#studentSelectContainer input[type="checkbox"]').forEach(cb => {
                cb.checked = true;
                const studentId = parseInt(cb.value);
                selectedStudents.add(studentId);
                cb.closest('.student-checkbox').classList.add('selected');
            });
        }
        
        // 全不选学生
        function deselectAllStudents() {
            document.querySelectorAll('#studentSelectContainer input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
                const studentId = parseInt(cb.value);
                selectedStudents.delete(studentId);
                cb.closest('.student-checkbox').classList.remove('selected');
            });
        }
        
        // 按首字母选择
        function selectByFirstLetter() {
            const letter = prompt('请输入首字母（中文拼音首字母，如"z"代表"张"）:');
            if (!letter) return;
            
            const letterLower = letter.toLowerCase();
            document.querySelectorAll('#studentSelectContainer input[type="checkbox"]').forEach(cb => {
                const label = cb.nextElementSibling;
                const name = label.textContent;
                // 简单的中文拼音首字母匹配
                const firstChar = name.charAt(0);
                let firstLetter = '';
                
                // 常见姓氏拼音首字母映射
                const pinyinMap = {
                    '曾': 'z', '陈': 'c', '代': 'd', '丁': 'd', '高': 'g', '关': 'g',
                    '胡': 'h', '李': 'l', '廖': 'l', '刘': 'l', '孟': 'm', '庞': 'p',
                    '任': 'r', '邵': 's', '宋': 's', '唐': 't', '王': 'w', '吴': 'w',
                    '夏': 'x', '徐': 'x', '颜': 'y', '晏': 'y', '杨': 'y', '余': 'y',
                    '张': 'z', '赵': 'z', '周': 'z', '朱': 'z'
                };
                
                firstLetter = pinyinMap[firstChar] || firstChar.toLowerCase();
                
                if (firstLetter === letterLower) {
                    cb.checked = true;
                    const studentId = parseInt(cb.value);
                    selectedStudents.add(studentId);
                    cb.closest('.student-checkbox').classList.add('selected');
                } else {
                    cb.checked = false;
                    const studentId = parseInt(cb.value);
                    selectedStudents.delete(studentId);
                    cb.closest('.student-checkbox').classList.remove('selected');
                }
            });
        }
        
        // 初始化评分按钮
        function initScoreButtons() {
            // 单个评分按钮
            document.querySelectorAll('#scoreModal .score-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    document.querySelectorAll('#scoreModal .score-btn').forEach(b => b.classList.remove('active'));
                    this.classList.add('active');
                    
                    if (this.dataset.score === 'custom') {
                        document.getElementById('customScore').style.display = 'block';
                        document.getElementById('customScore').focus();
                        selectedScore = parseInt(document.getElementById('customScore').value) || 1;
                    } else {
                        document.getElementById('customScore').style.display = 'none';
                        selectedScore = parseInt(this.dataset.score);
                    }
                });
            });
            
            // 批量评分按钮
            document.querySelectorAll('#batchScoreModal .score-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    document.querySelectorAll('#batchScoreModal .score-btn').forEach(b => b.classList.remove('active'));
                    this.classList.add('active');
                    
                    if (this.dataset.score === 'custom') {
                        document.getElementById('batchCustomScore').style.display = 'block';
                        document.getElementById('batchCustomScore').focus();
                        selectedScore = parseInt(document.getElementById('batchCustomScore').value) || 1;
                    } else {
                        document.getElementById('batchCustomScore').style.display = 'none';
                        selectedScore = parseInt(this.dataset.score);
                    }
                });
            });
            
            // 自定义分数输入
            document.getElementById('customScore')?.addEventListener('input', function() {
                selectedScore = parseInt(this.value) || 1;
            });
            
            document.getElementById('batchCustomScore')?.addEventListener('input', function() {
                selectedScore = parseInt(this.value) || 1;
            });
            
            // 操作者类型变化
            document.getElementById('operatorType')?.addEventListener('change', function() {
                const detailContainer = document.getElementById('operatorDetailContainer');
                if (this.value === 'student') {
                    detailContainer.style.display = 'block';
                } else {
                    detailContainer.style.display = 'none';
                }
            });
            
            document.getElementById('batchOperatorType')?.addEventListener('change', function() {
                const detailContainer = document.getElementById('batchOperatorDetailContainer');
                if (this.value === 'student') {
                    detailContainer.style.display = 'block';
                } else {
                    detailContainer.style.display = 'none';
                }
            });
            
            // 具体操作者变化
            document.getElementById('operatorDetail')?.addEventListener('change', function() {
                const otherInput = document.getElementById('otherOperatorDetail');
                if (this.value === '其他') {
                    otherInput.style.display = 'block';
                } else {
                    otherInput.style.display = 'none';
                }
            });
            
            document.getElementById('batchOperatorDetail')?.addEventListener('change', function() {
                const otherInput = document.getElementById('batchOtherOperatorDetail');
                if (this.value === '其他') {
                    otherInput.style.display = 'block';
                } else {
                    otherInput.style.display = 'none';
                }
            });
            
            // 点击弹窗外部关闭
            document.querySelectorAll('.modal-overlay').forEach(modal => {
                modal.addEventListener('click', function(e) {
                    if (e.target === this) {
                        this.style.display = 'none';
                    }
                });
            });
        }
        
        // 开始评分流程
        function startScoreProcess(studentId, type, studentName) {
            currentStudentId = studentId;
            currentScoreType = type;
            currentStudentName = studentName;
            
            // 重置表单
            document.getElementById('scoreStudentName').textContent = studentName;
            selectedScore = 1;
            document.querySelectorAll('#scoreModal .score-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.score === '1') {
                    btn.classList.add('active');
                }
            });
            document.getElementById('customScore').style.display = 'none';
            document.getElementById('customScore').value = '1';
            document.getElementById('scoreNote').value = '';
            document.getElementById('noteRequired').style.display = 'none';
            document.getElementById('operatorType').value = 'teacher';
            document.getElementById('operatorDetailContainer').style.display = 'none';
            document.getElementById('operatorDetail').value = '语文课代表';
            document.getElementById('otherOperatorDetail').style.display = 'none';
            document.getElementById('otherOperatorDetail').value = '';
            
            // 加载评分项目
            loadCategories();
            
            // 显示模态框
            document.getElementById('scoreModal').style.display = 'flex';
        }
        
        // 加载评分项目
        function loadCategories() {
            const categorySelect = document.getElementById('categorySelect');
            categorySelect.innerHTML = '';
            
            const categories = ${JSON.stringify((scoreCategories.results || []))};
            const filteredCategories = categories.filter(cat => cat.type === currentScoreType);
            
            filteredCategories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name + (cat.requires_note ? ' (需备注)' : '');
                option.dataset.requiresNote = cat.requires_note;
                categorySelect.appendChild(option);
            });
            
            // 监听选择变化
            categorySelect.addEventListener('change', function() {
                const selectedOption = this.options[this.selectedIndex];
                const requiresNote = selectedOption.dataset.requiresNote === '1';
                document.getElementById('noteRequired').style.display = requiresNote ? 'block' : 'none';
                if (requiresNote) {
                    document.getElementById('scoreNote').focus();
                }
            });
            
            // 触发一次change事件
            categorySelect.dispatchEvent(new Event('change'));
        }
        
        // 提交分数
        async function submitScore() {
            const categoryId = document.getElementById('categorySelect').value;
            const operatorType = document.getElementById('operatorType').value;
            let operatorDetail = '';
            let operator = '';
            
            if (operatorType === 'teacher') {
                operator = '老师';
            } else {
                operator = '学生';
                const detailSelect = document.getElementById('operatorDetail');
                if (detailSelect.value === '其他') {
                    operatorDetail = document.getElementById('otherOperatorDetail').value.trim();
                    if (!operatorDetail) {
                        alert('请输入具体操作者');
                        return;
                    }
                } else {
                    operatorDetail = detailSelect.value;
                }
            }
            
            const note = document.getElementById('scoreNote').value.trim();
            
            let score = selectedScore;
            if (document.getElementById('customScore').style.display === 'block') {
                score = parseInt(document.getElementById('customScore').value) || 1;
            }

            if (score <= 0 || score > 100) {
                alert('分值必须在1-100之间');
                return;
            }
            
            // 检查是否需要备注
            const selectedOption = document.getElementById('categorySelect').options[document.getElementById('categorySelect').selectedIndex];
            const requiresNote = selectedOption.dataset.requiresNote === '1';
            
            if (requiresNote && !note) {
                alert('此项必须填写备注说明');
                document.getElementById('scoreNote').focus();
                return;
            }

            // 立即关闭弹窗防止重复点击
            closeScoreModal();
            
            try {
                const response = await fetch('/api/score', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        studentId: currentStudentId,
                        categoryId: categoryId,
                        score: score,
                        operator: operator,
                        operatorType: operatorType,
                        operatorDetail: operatorDetail,
                        note: note
                    })
                });

                const result = await response.json();

                if (result.success) {
                    alert(\`为\${currentStudentName}评分成功！\`);
                    setTimeout(() => location.reload(), 1000);
                } else {
                    alert('评分失败: ' + result.error);
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }
        
        // 关闭评分弹窗
        function closeScoreModal() {
            document.getElementById('scoreModal').style.display = 'none';
        }
        
        // 显示批量评分模态框
        function showBatchScoreModal() {
            // 重置表单
            selectedScore = 1;
            document.querySelectorAll('#batchScoreModal .score-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.score === '1') {
                    btn.classList.add('active');
                }
            });
            document.getElementById('batchCustomScore').style.display = 'none';
            document.getElementById('batchCustomScore').value = '1';
            document.getElementById('batchScoreNote').value = '';
            document.getElementById('batchNoteRequired').style.display = 'none';
            document.getElementById('batchOperatorType').value = 'teacher';
            document.getElementById('batchOperatorDetailContainer').style.display = 'none';
            document.getElementById('batchOperatorDetail').value = '语文课代表';
            document.getElementById('batchOtherOperatorDetail').style.display = 'none';
            document.getElementById('batchOtherOperatorDetail').value = '';
            
            // 加载评分项目
            loadBatchCategories();
            
            // 显示模态框
            document.getElementById('batchScoreModal').style.display = 'flex';
        }
        
        // 加载批量评分项目
        function loadBatchCategories() {
            const categorySelect = document.getElementById('batchCategorySelect');
            categorySelect.innerHTML = '';
            
            const categories = ${JSON.stringify((scoreCategories.results || []))};
            
            // 添加加分项
            const addCategories = categories.filter(cat => cat.type === 'add');
            const minusCategories = categories.filter(cat => cat.type === 'minus');
            
            const addGroup = document.createElement('optgroup');
            addGroup.label = '加分项';
            addCategories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name + (cat.requires_note ? ' (需备注)' : '');
                option.dataset.requiresNote = cat.requires_note;
                option.dataset.type = 'add';
                addGroup.appendChild(option);
            });
            categorySelect.appendChild(addGroup);
            
            const minusGroup = document.createElement('optgroup');
            minusGroup.label = '扣分项';
            minusCategories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name + (cat.requires_note ? ' (需备注)' : '');
                option.dataset.requiresNote = cat.requires_note;
                option.dataset.type = 'minus';
                minusGroup.appendChild(option);
            });
            categorySelect.appendChild(minusGroup);
            
            // 监听选择变化
            categorySelect.addEventListener('change', function() {
                const selectedOption = this.options[this.selectedIndex];
                const requiresNote = selectedOption.dataset.requiresNote === '1';
                document.getElementById('batchNoteRequired').style.display = requiresNote ? 'block' : 'none';
                if (requiresNote) {
                    document.getElementById('batchScoreNote').focus();
                }
            });
            
            // 触发一次change事件
            categorySelect.dispatchEvent(new Event('change'));
        }
        
        // 关闭批量评分弹窗
        function closeBatchScoreModal() {
            document.getElementById('batchScoreModal').style.display = 'none';
        }
        
        // 批量提交分数
        async function submitBatchScore() {
            if (selectedStudents.size === 0) {
                alert('请至少选择一名学生');
                return;
            }
            
            const categoryId = document.getElementById('batchCategorySelect').value;
            const operatorType = document.getElementById('batchOperatorType').value;
            let operatorDetail = '';
            let operator = '';
            
            if (operatorType === 'teacher') {
                operator = '老师';
            } else {
                operator = '学生';
                const detailSelect = document.getElementById('batchOperatorDetail');
                if (detailSelect.value === '其他') {
                    operatorDetail = document.getElementById('batchOtherOperatorDetail').value.trim();
                    if (!operatorDetail) {
                        alert('请输入具体操作者');
                        return;
                    }
                } else {
                    operatorDetail = detailSelect.value;
                }
            }
            
            const note = document.getElementById('batchScoreNote').value.trim();
            
            let score = selectedScore;
            if (document.getElementById('batchCustomScore').style.display === 'block') {
                score = parseInt(document.getElementById('batchCustomScore').value) || 1;
            }

            if (score <= 0 || score > 100) {
                alert('分值必须在1-100之间');
                return;
            }
            
            // 检查是否需要备注
            const selectedOption = document.getElementById('batchCategorySelect').options[document.getElementById('batchCategorySelect').selectedIndex];
            const requiresNote = selectedOption.dataset.requiresNote === '1';
            
            if (requiresNote && !note) {
                alert('此项必须填写备注说明');
                document.getElementById('batchScoreNote').focus();
                return;
            }

            // 立即关闭弹窗防止重复点击
            closeBatchScoreModal();
            
            try {
                const response = await fetch('/api/batch-score', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        studentIds: Array.from(selectedStudents),
                        categoryId: categoryId,
                        score: score,
                        operator: operator,
                        operatorType: operatorType,
                        operatorDetail: operatorDetail,
                        note: note
                    })
                });

                const result = await response.json();

                if (result.success) {
                    alert(\`成功为\${result.count}名学生评分！\`);
                    setTimeout(() => location.reload(), 1000);
                } else {
                    alert('批量评分失败: ' + result.error);
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }
        
        // 显示危险操作模态框
        function showDangerModal() {
            document.getElementById('dangerModal').style.display = 'flex';
        }
        
        function closeDangerModal() {
            document.getElementById('dangerModal').style.display = 'none';
        }
        
        // 显示保存快照模态框
        function showSnapshotModal() {
            document.getElementById('snapshotModal').style.display = 'flex';
            closeDangerModal();
        }
        
        function closeSnapshotModal() {
            document.getElementById('snapshotModal').style.display = 'none';
        }
        
        // 创建快照
        async function createSnapshot() {
            const title = document.getElementById('snapshotTitle').value.trim();
            
            if (!title) {
                alert('请输入快照标题');
                return;
            }

            try {
                const response = await fetch('/api/snapshot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title })
                });

                const result = await response.json();

                if (result.success) {
                    alert(\`快照"\${title}"保存成功！\`);
                    closeSnapshotModal();
                } else {
                    alert('保存失败: ' + result.error);
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }
        
        // 显示重置分数模态框
        function showResetModal() {
            document.getElementById('resetModal').style.display = 'flex';
            document.getElementById('resetPassword').value = '';
            document.getElementById('resetConfirmText').value = '';
            closeDangerModal();
        }
        
        function closeResetModal() {
            document.getElementById('resetModal').style.display = 'none';
        }
        
        // 确认重置分数
        async function confirmReset() {
            const password = document.getElementById('resetPassword').value;
            const confirmText = document.getElementById('resetConfirmText').value.trim();
            
            if (!password) {
                alert('请输入管理员密码');
                return;
            }
            
            if (confirmText !== '确认清空所有数据') {
                alert('确认文本不正确，请输入"确认清空所有数据"');
                return;
            }
            
            try {
                const response = await fetch('/api/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        confirm_password: password,
                        confirm_text: confirmText
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('分数重置成功！');
                    closeResetModal();
                    setTimeout(() => location.reload(), 1000);
                } else {
                    alert('重置失败: ' + result.error);
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }
        
        // 显示修改密码模态框
        function showPasswordModal() {
            document.getElementById('passwordModal').style.display = 'flex';
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmNewPassword').value = '';
            closeDangerModal();
        }
        
        function closePasswordModal() {
            document.getElementById('passwordModal').style.display = 'none';
        }
        
        // 修改密码
        async function updatePassword() {
            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmNewPassword = document.getElementById('confirmNewPassword').value;
            
            if (!currentPassword || !newPassword || !confirmNewPassword) {
                alert('请填写所有字段');
                return;
            }
            
            if (newPassword !== confirmNewPassword) {
                alert('新密码和确认密码不一致');
                return;
            }
            
            if (newPassword.length < 6) {
                alert('新密码长度至少6位');
                return;
            }
            
            // 这里需要调用API来修改密码
            // 由于API未实现，这里先模拟
            alert('密码修改功能正在开发中...');
            closePasswordModal();
        }
        
        // 显示学生历史记录
        async function showStudentHistory(studentId, studentName) {
            document.getElementById('historyModal').style.display = 'flex';
            document.getElementById('historyStudentName').textContent = studentName;
            document.getElementById('historyLoading').style.display = 'block';
            document.getElementById('historyContent').style.display = 'none';
            
            try {
                const response = await fetch('/api/student-history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ studentId })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    const historyList = document.getElementById('historyList');
                    historyList.innerHTML = '';
                    
                    if (result.logs.length === 0) {
                        historyList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-light);">暂无操作记录</div>';
                    } else {
                        result.logs.forEach(log => {
                            const item = document.createElement('div');
                            item.className = 'log-item';
                            item.style.cssText = 'background: rgba(255, 255, 255, 0.05); padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid ' + 
                                (log.action_type === 'add' ? 'var(--secondary)' : log.action_type === 'minus' ? 'var(--danger)' : 'var(--warning)') + ';';
                            
                            const time = new Date(log.created_at).toLocaleString('zh-CN', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                            });
                            const scoreChange = log.score_change > 0 ? '+' + log.score_change : log.score_change;
                            const scoreColor = log.score_change > 0 ? 'var(--secondary)' : 'var(--danger)';
                            
                            let operatorText = log.operator;
                            if (log.operator_type === 'student' && log.operator_detail) {
                                operatorText += ' (' + log.operator_detail + ')';
                            }
                            
                            item.innerHTML = \`
                                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-weight: 600; color: var(--text);">\${log.category_name}</span>
                                    <span style="font-weight: 800; color: \${scoreColor};">\${scoreChange}</span>
                                </div>
                                <div style="color: var(--text-light); font-size: 13px; margin-bottom: 5px;">
                                    \${time} • \${operatorText}
                                </div>
                                \${log.note ? '<div style="color: var(--text-light); font-size: 13px; font-style: italic;">备注: ' + log.note + '</div>' : ''}
                            \`;
                            
                            historyList.appendChild(item);
                        });
                    }
                    
                    document.getElementById('historyCount').textContent = result.logs.length;
                    document.getElementById('historyLoading').style.display = 'none';
                    document.getElementById('historyContent').style.display = 'block';
                } else {
                    alert('获取历史记录失败: ' + result.error);
                    closeHistoryModal();
                }
            } catch (error) {
                alert('网络错误，请重试');
                closeHistoryModal();
            }
        }
        
        function closeHistoryModal() {
            document.getElementById('historyModal').style.display = 'none';
        }
    </script>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    return renderErrorPage('班级页面加载失败: ' + error.message);
  }
}

// 渲染管理员页面
async function renderAdminPage(db, request, clientIP, userAgent) {
  try {
    const session = await validateSession(request, db);
    if (!session || session.role !== 'admin') {
      return Response.redirect(new URL('/login', request.url));
    }

    const [studentsData, logs, settings, wallpaper, geoInfo] = await Promise.all([
      handleGetStudents(db).then(r => r.json()),
      db.prepare('SELECT ol.*, s.name as student_name FROM operation_logs ol JOIN students s ON ol.student_id = s.id ORDER BY ol.created_at DESC LIMIT 100').all(),
      db.prepare('SELECT key, value FROM settings').all(),
      getBingWallpaper(),
      getGeoInfo(clientIP, userAgent)
    ]);

    if (!studentsData.success) {
      throw new Error(studentsData.error);
    }

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    const bgImage = wallpaper ? wallpaper.url : 'https://cn.bing.com/th?id=OHR.BadlandsNP_ZH-CN1068836500_1920x1080.jpg';

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settingMap.site_title || '班级评分系统'} - 管理员</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        
        :root {
            --primary: #3b82f6;
            --secondary: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
            --background: #0f172a;
            --surface: #1e293b;
            --text: #f1f5f9;
            --text-light: #94a3b8;
            --border: #475569;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
            position: relative;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('${bgImage}');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            z-index: -2;
            opacity: 0.15;
        }
        
        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.98));
            z-index: -1;
            backdrop-filter: blur(1px);
        }
        
        .header { 
            background: rgba(30, 41, 59, 0.9);
            backdrop-filter: blur(10px);
            color: white; 
            padding: 25px; 
            box-shadow: var(--shadow);
            border-bottom: 1px solid var(--border);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        
        .header-content { 
            display: flex; 
            justify-content: space-between; 
            align-items: center;
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .class-info h1 { 
            font-weight: 800; 
            margin-bottom: 10px; 
            font-size: 28px;
            background: linear-gradient(135deg, #60a5fa, #a78bfa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .admin-badge {
            background: linear-gradient(135deg, var(--danger), #dc2626);
            padding: 6px 15px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 700;
            margin-left: 15px;
        }
        
        .header-actions {
            display: flex;
            gap: 15px;
            align-items: center;
        }
        
        .btn {
            padding: 12px 25px;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
            color: white;
        }
        
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
        }
        
        .btn-danger {
            background: linear-gradient(135deg, var(--danger), #dc2626);
            color: white;
        }
        
        .btn-danger:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(239, 68, 68, 0.4);
        }
        
        .btn-success {
            background: linear-gradient(135deg, var(--secondary), #0da271);
            color: white;
        }
        
        .btn-success:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(16, 185, 129, 0.4);
        }
        
        .main-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: 30px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 30px;
        }
        
        .card {
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 30px;
            box-shadow: var(--shadow);
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
        }
        
        .card:hover {
            transform: translateY(-8px);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);
            border-color: rgba(59, 130, 246, 0.3);
        }
        
        .card-full {
            grid-column: 1 / -1;
        }
        
        .card-title {
            font-size: 22px;
            font-weight: 700;
            margin-bottom: 25px;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: rgba(255, 255, 255, 0.05);
            padding: 25px;
            border-radius: 16px;
            text-align: center;
            border-left: 4px solid var(--primary);
            transition: all 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow);
            background: rgba(255, 255, 255, 0.08);
        }
        
        .stat-number {
            font-size: 32px;
            font-weight: 800;
            margin-bottom: 10px;
        }
        
        .stat-label {
            color: var(--text-light);
            font-size: 14px;
            font-weight: 600;
        }
        
        .settings-form {
            display: grid;
            gap: 20px;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        
        .form-group label {
            font-weight: 600;
            color: var(--text);
            font-size: 15px;
        }
        
        .form-group input {
            padding: 16px 20px;
            border: 2px solid var(--border);
            border-radius: 12px;
            font-size: 16px;
            transition: all 0.3s ease;
            background: rgba(15, 23, 42, 0.6);
            color: var(--text);
            font-weight: 500;
        }
        
        .form-group input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
            background: rgba(15, 23, 42, 0.8);
        }
        
        .danger-zone {
            background: rgba(239, 68, 68, 0.1);
            border: 2px solid rgba(239, 68, 68, 0.3);
            border-radius: 16px;
            padding: 25px;
            margin-top: 30px;
        }
        
        .danger-zone h3 {
            color: var(--danger);
            margin-bottom: 20px;
            font-size: 18px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .data-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        
        .data-table th, .data-table td {
            padding: 18px 20px;
            text-align: left;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .data-table th {
            background: rgba(30, 41, 59, 0.9);
            font-weight: 600;
            color: var(--text-light);
            position: sticky;
            top: 0;
        }
        
        .data-table tr:hover td {
            background: rgba(59, 130, 246, 0.1);
        }
        
        .positive { color: var(--secondary); font-weight: 700; }
        .negative { color: var(--danger); font-weight: 700; }
        
        .action-type {
            padding: 6px 15px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 700;
        }
        
        .action-type.add {
            background: rgba(16, 185, 129, 0.2);
            color: var(--secondary);
        }
        
        .action-type.minus {
            background: rgba(239, 68, 68, 0.2);
            color: var(--danger);
        }
        
        .action-type.revoke {
            background: rgba(245, 158, 11, 0.2);
            color: var(--warning);
        }
        
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(5px);
            z-index: 2000;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .modal-content {
            background: var(--surface);
            padding: 40px;
            border-radius: 20px;
            width: 100%;
            max-width: 600px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);
            border: 1px solid rgba(255, 255, 255, 0.1);
            position: relative;
        }
        
        .modal-close {
            position: absolute;
            top: 20px;
            right: 20px;
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: var(--text-light);
            transition: color 0.3s ease;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.1);
        }
        
        .modal-close:hover {
            color: var(--danger);
            background: rgba(239, 68, 68, 0.1);
        }
        
        .modal-title {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 25px;
            color: var(--text);
            text-align: center;
        }
        
        .check-list {
            margin: 20px 0;
        }
        
        .check-item {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 15px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            margin-bottom: 10px;
        }
        
        .check-status {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 700;
        }
        
        .status-success {
            background: var(--secondary);
            color: white;
        }
        
        .status-error {
            background: var(--danger);
            color: white;
        }
        
        .status-warning {
            background: var(--warning);
            color: white;
        }
        
        .check-name {
            flex: 1;
            font-weight: 600;
            color: var(--text);
        }
        
        .check-message {
            color: var(--text-light);
            font-size: 14px;
        }
        
        .update-options {
            display: grid;
            gap: 15px;
            margin: 20px 0;
        }
        
        .update-option {
            padding: 20px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.3s ease;
            border: 2px solid transparent;
        }
        
        .update-option:hover {
            background: rgba(59, 130, 246, 0.1);
            border-color: rgba(59, 130, 246, 0.3);
        }
        
        .update-option.selected {
            background: rgba(59, 130, 246, 0.2);
            border-color: var(--primary);
        }
        
        .update-title {
            font-weight: 700;
            color: var(--text);
            margin-bottom: 10px;
        }
        
        .update-description {
            color: var(--text-light);
            font-size: 14px;
            line-height: 1.5;
        }
        
        @media (max-width: 768px) {
            .main-content {
                grid-template-columns: 1fr;
                padding: 20px;
                gap: 20px;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .header {
                padding: 20px;
            }
            
            .header-content {
                flex-direction: column;
                gap: 20px;
                text-align: center;
            }
            
            .header-actions {
                width: 100%;
                justify-content: center;
                flex-wrap: wrap;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div class="class-info">
                <h1>${settingMap.site_title || '2314班综合评分系统'}
                    <span class="admin-badge">管理员模式</span>
                </h1>
                <div>系统管理面板 • IP: ${clientIP}</div>
            </div>
            <div class="header-actions">
                <button class="btn btn-primary" onclick="window.location.href='/class'">
                    班级视图
                </button>
                <button class="btn btn-success" onclick="startSystemCheck()">
                    工程检查
                </button>
                <button class="btn btn-danger" onclick="logout()">
                    退出登录
                </button>
            </div>
        </div>
    </div>

    <div class="main-content">
        <!-- 系统统计 -->
        <div class="card card-full">
            <div class="card-title">系统统计</div>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-number" style="color: #60a5fa;">${studentsData.students?.length || 0}</div>
                    <div class="stat-label">学生总数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" style="color: #10b981;">${studentsData.students?.reduce((acc, s) => acc + s.add_score, 0) || 0}</div>
                    <div class="stat-label">总加分</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" style="color: #ef4444;">${studentsData.students?.reduce((acc, s) => acc + s.minus_score, 0) || 0}</div>
                    <div class="stat-label">总扣分</div>
                </div>
            </div>
        </div>

        <!-- 系统设置 -->
        <div class="card">
            <div class="card-title">系统设置</div>
            <form class="settings-form" id="settingsForm">
                <div class="form-group">
                    <label>网站标题</label>
                    <input type="text" name="site_title" value="${settingMap.site_title || ''}" required>
                </div>
                <div class="form-group">
                    <label>班级名称</label>
                    <input type="text" name="class_name" value="${settingMap.class_name || ''}" required>
                </div>
                <div class="form-group">
                    <label>班级账号</label>
                    <input type="text" name="class_username" value="${settingMap.class_username || ''}" required>
                </div>
                <div class="form-group">
                    <label>班级密码</label>
                    <input type="password" name="class_password" value="${settingMap.class_password || ''}" required>
                </div>
                <div class="form-group">
                    <label>管理员账号</label>
                    <input type="text" name="admin_username" value="${settingMap.admin_username || ''}" required readonly>
                </div>
                <div class="form-group">
                    <label>管理员密码</label>
                    <input type="password" name="admin_password" value="${settingMap.admin_password || ''}" required>
                </div>
                <button type="submit" class="btn btn-success" style="margin-top: 20px;">
                    保存设置
                </button>
            </form>
            
            <div class="danger-zone">
                <h3>危险操作区</h3>
                <button class="btn btn-danger" onclick="showUpdateModal()" style="width: 100%; margin-bottom: 15px;">
                    数据库更新
                </button>
                <button class="btn btn-danger" onclick="showResetModal()" style="width: 100%;">
                    重置所有分数
                </button>
            </div>
        </div>

        <!-- 操作日志 -->
        <div class="card card-full">
            <div class="card-title">最近操作日志</div>
            <div style="overflow-x: auto;">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>时间</th>
                            <th>学生</th>
                            <th>操作类型</th>
                            <th>分数变化</th>
                            <th>操作教师</th>
                            <th>备注</th>
                            <th>IP地址</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(logs.results || []).map(log => `
                            <tr>
                                <td>${new Date(log.created_at).toLocaleString('zh-CN')}</td>
                                <td>${log.student_name}</td>
                                <td>
                                    <span class="action-type ${log.action_type}">
                                        ${log.action_type === 'add' ? '加分' : log.action_type === 'minus' ? '扣分' : '撤销'}
                                    </span>
                                </td>
                                <td class="${log.score_change > 0 ? 'positive' : 'negative'}">
                                    ${log.score_change > 0 ? '+' : ''}${log.score_change}
                                </td>
                                <td>${log.operator}${log.operator_detail ? ' (' + log.operator_detail + ')' : ''}</td>
                                <td>${log.note || '-'}</td>
                                <td style="font-size: 13px; color: var(--text-light);">${log.ip_address?.substring(0, 15) || '未知'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    
    <!-- 系统检查模态框 -->
    <div class="modal-overlay" id="systemCheckModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeSystemCheckModal()">×</button>
            <div class="modal-title">系统工程检查</div>
            
            <div id="checkStep1">
                <div style="margin-bottom: 25px; color: var(--text-light);">
                    请选择检查模式：
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px;">
                    <button class="btn btn-success" onclick="startAutoCheck()" style="padding: 20px;">
                        自动检查
                    </button>
                    <button class="btn btn-primary" onclick="showManualCheck()" style="padding: 20px;">
                        手动检查
                    </button>
                </div>
                
                <div style="color: var(--text-light); font-size: 14px; text-align: center;">
                    自动检查将一次性检查所有系统组件<br>
                    手动检查将逐步检查每个组件
                </div>
            </div>
            
            <div id="checkStep2" style="display: none;">
                <div class="check-list" id="checkList">
                    <!-- 检查结果将在这里显示 -->
                </div>
                
                <div id="checkSummary" style="display: none; margin-top: 25px; padding: 20px; background: rgba(255, 255, 255, 0.05); border-radius: 12px;">
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; text-align: center;">
                        <div>
                            <div style="font-size: 24px; font-weight: 800; color: var(--secondary);" id="successCount">0</div>
                            <div style="font-size: 13px; color: var(--text-light);">成功</div>
                        </div>
                        <div>
                            <div style="font-size: 24px; font-weight: 800; color: var(--warning);" id="warningCount">0</div>
                            <div style="font-size: 13px; color: var(--text-light);">警告</div>
                        </div>
                        <div>
                            <div style="font-size: 24px; font-weight: 800; color: var(--danger);" id="errorCount">0</div>
                            <div style="font-size: 13px; color: var(--text-light);">错误</div>
                        </div>
                    </div>
                    <div style="text-align: center; margin-top: 15px; color: var(--text-light); font-size: 14px;">
                        总耗时: <span id="checkTime">0ms</span>
                    </div>
                </div>
                
                <div style="display: flex; gap: 15px; margin-top: 30px;">
                    <button class="btn" onclick="backToStep1()" style="flex: 1; background: rgba(255, 255, 255, 0.1); color: var(--text-light);">
                        返回
                    </button>
                    <button class="btn btn-success" onclick="recheckSystem()" style="flex: 1;" id="recheckBtn" disabled>
                        重新检查
                    </button>
                </div>
            </div>
            
            <div id="manualCheck" style="display: none;">
                <div style="margin-bottom: 25px; color: var(--text-light);">
                    手动检查 - 步骤 <span id="manualStep">1</span>/6
                </div>
                
                <div id="manualCheckContent">
                    <!-- 手动检查内容将动态加载 -->
                </div>
                
                <div style="display: flex; gap: 15px; margin-top: 30px;">
                    <button class="btn" onclick="backToStep1()" id="manualBackBtn" style="flex: 1; background: rgba(255, 255, 255, 0.1); color: var(--text-light);">
                        返回
                    </button>
                    <button class="btn btn-primary" onclick="nextManualStep()" style="flex: 1;" id="manualNextBtn">
                        下一步
                    </button>
                </div>
            </div>
        </div>
    </div>
    
    <!-- 数据库更新模态框 -->
    <div class="modal-overlay" id="updateModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeUpdateModal()">×</button>
            <div class="modal-title">数据库更新</div>
            
            <div style="margin: 20px 0; color: var(--text-light);">
                检测到数据库有新版本可用。请选择更新方式：
            </div>
            
            <div class="update-options">
                <div class="update-option" data-type="structure" onclick="selectUpdateOption('structure')">
                    <div class="update-title">仅更新表结构</div>
                    <div class="update-description">
                        只更新数据库表结构，不修改现有数据。<br>
                        适用于升级系统功能但保留所有评分记录。
                    </div>
                </div>
                
                <div class="update-option" data-type="data" onclick="selectUpdateOption('data')">
                    <div class="update-title">更新数据（覆盖）</div>
                    <div class="update-description">
                        用新数据覆盖现有数据。<br>
                        注意：这会清除所有现有学生数据，导入新数据。
                    </div>
                </div>
                
                <div class="update-option" data-type="merge" onclick="selectUpdateOption('merge')">
                    <div class="update-title">合并更新</div>
                    <div class="update-description">
                        将新数据合并到现有数据库中。<br>
                        保留现有数据，只添加新的学生记录。
                    </div>
                </div>
            </div>
            
            <div id="updateWarning" style="margin: 25px 0; padding: 20px; background: rgba(239, 68, 68, 0.1); border-radius: 16px; border: 2px solid rgba(239, 68, 68, 0.3); color: var(--text-light); display: none;">
                <strong style="color: var(--danger); font-size: 16px;">警告：</strong>
                <span id="warningText"></span>
            </div>
            
            <div style="display: flex; gap: 15px; margin-top: 30px;">
                <button class="btn" onclick="closeUpdateModal()" style="flex: 1; background: rgba(255, 255, 255, 0.1); color: var(--text-light);">
                    取消
                </button>
                <button class="btn btn-danger" onclick="confirmUpdate()" style="flex: 1;" id="updateBtn" disabled>
                    开始更新
                </button>
            </div>
        </div>
    </div>
    
    <!-- 重置分数确认模态框 -->
    <div class="modal-overlay" id="resetModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeResetModal()">×</button>
            <div class="modal-title">重置所有分数</div>
            
            <div style="margin: 25px 0; padding: 25px; background: rgba(239, 68, 68, 0.1); border-radius: 16px; border: 2px solid rgba(239, 68, 68, 0.3); color: var(--text-light);">
                <strong style="color: var(--danger); font-size: 18px;">警告：此操作不可撤销！</strong><br><br>
                这将清除所有学生的分数记录，包括：
                <ul style="margin: 15px 0 15px 20px;">
                    <li>所有加分和扣分记录</li>
                    <li>所有操作日志</li>
                    <li>学生分数将重置为0</li>
                </ul>
                但会保留：
                <ul style="margin: 15px 0 15px 20px;">
                    <li>学生名单</li>
                    <li>评分项目设置</li>
                    <li>月度快照数据</li>
                </ul>
            </div>
            
            <div class="form-group">
                <label>请输入管理员密码进行二次验证：</label>
                <input type="password" id="resetPassword" placeholder="输入管理员密码" required>
            </div>
            
            <div style="display: flex; gap: 15px; margin-top: 30px;">
                <button class="btn" onclick="closeResetModal()" style="flex: 1; background: rgba(255, 255, 255, 0.1); color: var(--text-light);">
                    取消
                </button>
                <button class="btn btn-danger" onclick="confirmReset()" style="flex: 1;">
                    确认重置
                </button>
            </div>
        </div>
    </div>

    <script>
        let selectedUpdateType = null;
        let manualCheckStep = 1;
        let checkResults = null;
        
        // 保存设置
        document.getElementById('settingsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const settings = Object.fromEntries(formData);
            
            try {
                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('设置保存成功！');
                    location.reload();
                } else {
                    alert('保存失败: ' + result.error);
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        });
        
        // 系统检查
        function startSystemCheck() {
            document.getElementById('systemCheckModal').style.display = 'flex';
            document.getElementById('checkStep1').style.display = 'block';
            document.getElementById('checkStep2').style.display = 'none';
            document.getElementById('manualCheck').style.display = 'none';
        }
        
        function closeSystemCheckModal() {
            document.getElementById('systemCheckModal').style.display = 'none';
        }
        
        function backToStep1() {
            document.getElementById('checkStep1').style.display = 'block';
            document.getElementById('checkStep2').style.display = 'none';
            document.getElementById('manualCheck').style.display = 'none';
            manualCheckStep = 1;
        }
        
        // 自动检查
        async function startAutoCheck() {
            document.getElementById('checkStep1').style.display = 'none';
            document.getElementById('checkStep2').style.display = 'block';
            
            const checkList = document.getElementById('checkList');
            checkList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-light);">正在检查系统...</div>';
            
            try {
                const response = await fetch('/api/check-system');
                const result = await response.json();
                
                checkResults = result;
                
                if (result.success) {
                    checkList.innerHTML = '';
                    
                    result.checks.forEach(check => {
                        const item = document.createElement('div');
                        item.className = 'check-item';
                        
                        const status = document.createElement('div');
                        status.className = 'check-status';
                        
                        if (check.status === 'success') {
                            status.className += ' status-success';
                            status.textContent = '✓';
                        } else if (check.status === 'warning') {
                            status.className += ' status-warning';
                            status.textContent = '!';
                        } else {
                            status.className += ' status-error';
                            status.textContent = '✗';
                        }
                        
                        const name = document.createElement('div');
                        name.className = 'check-name';
                        name.textContent = check.name;
                        
                        const message = document.createElement('div');
                        message.className = 'check-message';
                        message.textContent = check.message;
                        
                        item.appendChild(status);
                        item.appendChild(name);
                        item.appendChild(message);
                        checkList.appendChild(item);
                    });
                    
                    // 显示统计
                    document.getElementById('checkSummary').style.display = 'block';
                    document.getElementById('successCount').textContent = result.summary.success;
                    document.getElementById('warningCount').textContent = result.summary.warning;
                    document.getElementById('errorCount').textContent = result.summary.error;
                    document.getElementById('checkTime').textContent = result.time;
                    
                    // 启用重新检查按钮
                    document.getElementById('recheckBtn').disabled = false;
                } else {
                    checkList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--danger);">检查失败: ' + result.error + '</div>';
                }
            } catch (error) {
                checkList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--danger);">网络错误: ' + error.message + '</div>';
            }
        }
        
        function recheckSystem() {
            startAutoCheck();
        }
        
        // 手动检查
        function showManualCheck() {
            document.getElementById('checkStep1').style.display = 'none';
            document.getElementById('manualCheck').style.display = 'block';
            manualCheckStep = 1;
            loadManualStep();
        }
        
        function loadManualStep() {
            const content = document.getElementById('manualCheckContent');
            const stepText = document.getElementById('manualStep');
            const backBtn = document.getElementById('manualBackBtn');
            const nextBtn = document.getElementById('manualNextBtn');
            
            stepText.textContent = manualCheckStep;
            
            switch (manualCheckStep) {
                case 1:
                    content.innerHTML = \`
                        <div style="margin-bottom: 20px;">
                            <div style="font-weight: 700; color: var(--text); margin-bottom: 10px;">步骤1: 数据库连接检查</div>
                            <div style="color: var(--text-light); font-size: 14px; margin-bottom: 20px;">
                                检查数据库是否能够正常连接和访问。
                            </div>
                            <button class="btn" onclick="testDatabase()" style="width: 100%;">
                                测试数据库连接
                            </button>
                            <div id="step1Result" style="margin-top: 15px;"></div>
                        </div>
                    \`;
                    backBtn.textContent = '返回';
                    nextBtn.textContent = '下一步';
                    nextBtn.disabled = true;
                    break;
                    
                case 2:
                    content.innerHTML = \`
                        <div style="margin-bottom: 20px;">
                            <div style="font-weight: 700; color: var(--text); margin-bottom: 10px;">步骤2: 表结构检查</div>
                            <div style="color: var(--text-light); font-size: 14px; margin-bottom: 20px;">
                                检查所有数据库表是否存在且结构完整。
                            </div>
                            <button class="btn" onclick="testTables()" style="width: 100%;">
                                检查表结构
                            </button>
                            <div id="step2Result" style="margin-top: 15px;"></div>
                        </div>
                    \`;
                    nextBtn.disabled = true;
                    break;
                    
                case 3:
                    content.innerHTML = \`
                        <div style="margin-bottom: 20px;">
                            <div style="font-weight: 700; color: var(--text); margin-bottom: 10px;">步骤3: 外部API检查</div>
                            <div style="color: var(--text-light); font-size: 14px; margin-bottom: 20px;">
                                检查必应壁纸和搜索建议API是否可用。
                            </div>
                            <button class="btn" onclick="testAPIs()" style="width: 100%;">
                                测试外部API
                            </button>
                            <div id="step3Result" style="margin-top: 15px;"></div>
                        </div>
                    \`;
                    nextBtn.disabled = true;
                    break;
                    
                case 4:
                    content.innerHTML = \`
                        <div style="margin-bottom: 20px;">
                            <div style="font-weight: 700; color: var(--text); margin-bottom: 10px;">步骤4: 学生数据检查</div>
                            <div style="color: var(--text-light); font-size: 14px; margin-bottom: 20px;">
                                检查学生数据是否完整。
                            </div>
                            <button class="btn" onclick="testStudents()" style="width: 100%;">
                                检查学生数据
                            </button>
                            <div id="step4Result" style="margin-top: 15px;"></div>
                        </div>
                    \`;
                    nextBtn.disabled = true;
                    break;
                    
                case 5:
                    content.innerHTML = \`
                        <div style="margin-bottom: 20px;">
                            <div style="font-weight: 700; color: var(--text); margin-bottom: 10px;">步骤5: 评分记录检查</div>
                            <div style="color: var(--text-light); font-size: 14px; margin-bottom: 20px;">
                                检查评分记录是否正常。
                            </div>
                            <button class="btn" onclick="testRecords()" style="width: 100%;">
                                检查评分记录
                            </button>
                            <div id="step5Result" style="margin-top: 15px;"></div>
                        </div>
                    \`;
                    nextBtn.disabled = true;
                    break;
                    
                case 6:
                    content.innerHTML = \`
                        <div style="margin-bottom: 20px;">
                            <div style="font-weight: 700; color: var(--text); margin-bottom: 10px;">步骤6: 完成检查</div>
                            <div style="color: var(--text-light); font-size: 14px; margin-bottom: 20px;">
                                所有检查已完成。点击完成查看总结。
                            </div>
                            <div id="step6Result" style="padding: 20px; background: rgba(16, 185, 129, 0.1); border-radius: 12px; border: 1px solid rgba(16, 185, 129, 0.3); color: var(--text-light);">
                                手动检查流程已完成。
                            </div>
                        </div>
                    \`;
                    nextBtn.textContent = '完成';
                    nextBtn.disabled = false;
                    break;
            }
        }
        
        async function testDatabase() {
            const resultDiv = document.getElementById('step1Result');
            resultDiv.innerHTML = '<div style="color: var(--text-light);">测试中...</div>';
            
            try {
                const response = await fetch('/api/health');
                const result = await response.json();
                
                if (result.status === 'healthy') {
                    resultDiv.innerHTML = '<div style="color: var(--secondary);">✓ 数据库连接正常</div>';
                    document.getElementById('manualNextBtn').disabled = false;
                } else {
                    resultDiv.innerHTML = '<div style="color: var(--danger);">✗ 数据库连接失败: ' + result.error + '</div>';
                }
            } catch (error) {
                resultDiv.innerHTML = '<div style="color: var(--danger);">✗ 测试失败: ' + error.message + '</div>';
            }
        }
        
        async function testTables() {
            const resultDiv = document.getElementById('step2Result');
            resultDiv.innerHTML = '<div style="color: var(--text-light);">测试中...</div>';
            
            try {
                const response = await fetch('/api/check-system');
                const result = await response.json();
                
                if (result.success) {
                    const tableChecks = result.checks.filter(c => c.name.includes('表'));
                    const allSuccess = tableChecks.every(c => c.status === 'success');
                    
                    if (allSuccess) {
                        resultDiv.innerHTML = '<div style="color: var(--secondary);">✓ 所有表结构正常</div>';
                        document.getElementById('manualNextBtn').disabled = false;
                    } else {
                        const errors = tableChecks.filter(c => c.status !== 'success').map(c => c.name + ': ' + c.message).join('<br>');
                        resultDiv.innerHTML = '<div style="color: var(--danger);">✗ 表结构检查失败:<br>' + errors + '</div>';
                    }
                } else {
                    resultDiv.innerHTML = '<div style="color: var(--danger);">✗ 检查失败: ' + result.error + '</div>';
                }
            } catch (error) {
                resultDiv.innerHTML = '<div style="color: var(--danger);">✗ 测试失败: ' + error.message + '</div>';
            }
        }
        
        async function testAPIs() {
            const resultDiv = document.getElementById('step3Result');
            resultDiv.innerHTML = '<div style="color: var(--text-light);">测试中...</div>';
            
            try {
                // 测试壁纸API
                const wallpaperResponse = await fetch('/api/wallpaper');
                const wallpaperResult = await wallpaperResponse.json();
                
                // 测试搜索建议API
                const suggestResponse = await fetch('/api/search-suggest?q=测试');
                const suggestResult = await suggestResponse.json();
                
                if (wallpaperResult.status && suggestResult.s !== undefined) {
                    resultDiv.innerHTML = '<div style="color: var(--secondary);">✓ 外部API连接正常</div>';
                    document.getElementById('manualNextBtn').disabled = false;
                } else {
                    resultDiv.innerHTML = '<div style="color: var(--danger);">✗ 外部API测试失败</div>';
                }
            } catch (error) {
                resultDiv.innerHTML = '<div style="color: var(--danger);">✗ 测试失败: ' + error.message + '</div>';
            }
        }
        
        async function testStudents() {
            const resultDiv = document.getElementById('step4Result');
            resultDiv.innerHTML = '<div style="color: var(--text-light);">测试中...</div>';
            
            try {
                const response = await fetch('/api/students');
                const result = await response.json();
                
                if (result.success && result.students && result.students.length > 0) {
                    resultDiv.innerHTML = '<div style="color: var(--secondary);">✓ 学生数据正常，共' + result.students.length + '名学生</div>';
                    document.getElementById('manualNextBtn').disabled = false;
                } else {
                    resultDiv.innerHTML = '<div style="color: var(--danger);">✗ 学生数据检查失败: ' + (result.error || '无学生数据') + '</div>';
                }
            } catch (error) {
                resultDiv.innerHTML = '<div style="color: var(--danger);">✗ 测试失败: ' + error.message + '</div>';
            }
        }
        
        async function testRecords() {
            const resultDiv = document.getElementById('step5Result');
            resultDiv.innerHTML = '<div style="color: var(--text-light);">测试中...</div>';
            
            try {
                const response = await fetch('/api/logs');
                const result = await response.json();
                
                if (result.success) {
                    resultDiv.innerHTML = '<div style="color: var(--secondary);">✓ 评分记录访问正常</div>';
                    document.getElementById('manualNextBtn').disabled = false;
                } else {
                    resultDiv.innerHTML = '<div style="color: var(--danger);">✗ 评分记录检查失败: ' + result.error + '</div>';
                }
            } catch (error) {
                resultDiv.innerHTML = '<div style="color: var(--danger);">✗ 测试失败: ' + error.message + '</div>';
            }
        }
        
        function nextManualStep() {
            if (manualCheckStep < 6) {
                manualCheckStep++;
                loadManualStep();
            } else {
                closeSystemCheckModal();
                startAutoCheck(); // 显示总结
                document.getElementById('systemCheckModal').style.display = 'flex';
                document.getElementById('checkStep1').style.display = 'none';
                document.getElementById('checkStep2').style.display = 'block';
                document.getElementById('manualCheck').style.display = 'none';
            }
        }
        
        // 数据库更新
        function showUpdateModal() {
            selectedUpdateType = null;
            document.querySelectorAll('.update-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            document.getElementById('updateWarning').style.display = 'none';
            document.getElementById('updateBtn').disabled = true;
            document.getElementById('updateModal').style.display = 'flex';
        }
        
        function closeUpdateModal() {
            document.getElementById('updateModal').style.display = 'none';
        }
        
        function selectUpdateOption(type) {
            selectedUpdateType = type;
            
            document.querySelectorAll('.update-option').forEach(opt => {
                opt.classList.remove('selected');
                if (opt.dataset.type === type) {
                    opt.classList.add('selected');
                }
            });
            
            const warningDiv = document.getElementById('updateWarning');
            const warningText = document.getElementById('warningText');
            const updateBtn = document.getElementById('updateBtn');
            
            if (type === 'data') {
                warningDiv.style.display = 'block';
                warningText.textContent = '此操作将清除所有现有学生数据并导入新数据，所有评分记录将被保留但学生关联可能会丢失。';
                updateBtn.disabled = false;
            } else if (type === 'merge') {
                warningDiv.style.display = 'block';
                warningText.textContent = '此操作将新数据合并到现有数据库中，现有数据将保留，只添加新的学生记录。';
                updateBtn.disabled = false;
            } else {
                warningDiv.style.display = 'none';
                updateBtn.disabled = false;
            }
        }
        
        async function confirmUpdate() {
            if (!selectedUpdateType) {
                alert('请选择更新方式');
                return;
            }
            
            if (!confirm('确定要执行数据库更新操作吗？')) {
                return;
            }
            
            try {
                const response = await fetch('/api/update-database', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        updateType: selectedUpdateType,
                        confirm: true
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert(result.message);
                    closeUpdateModal();
                    location.reload();
                } else {
                    alert('更新失败: ' + result.error);
                }
            } catch (error) {
                alert('网络错误，请重试: ' + error.message);
            }
        }
        
        // 重置分数
        function showResetModal() {
            document.getElementById('resetModal').style.display = 'flex';
            document.getElementById('resetPassword').value = '';
        }
        
        function closeResetModal() {
            document.getElementById('resetModal').style.display = 'none';
        }
        
        async function confirmReset() {
            const password = document.getElementById('resetPassword').value;
            
            if (!password) {
                alert('请输入管理员密码');
                return;
            }
            
            if (!confirm('确定要重置所有分数吗？此操作不可撤销！')) {
                return;
            }
            
            try {
                const response = await fetch('/api/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirm_password: password, confirm_text: '确认清空所有数据' })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('分数重置成功！');
                    closeResetModal();
                    location.reload();
                } else {
                    alert('重置失败: ' + result.error);
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }
        
        // 退出登录
        async function logout() {
            try {
                await fetch('/api/logout');
                window.location.href = '/login';
            } catch (error) {
                window.location.href = '/login';
            }
        }
        
        // 点击模态框外部关闭
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.style.display = 'none';
                }
            });
        });
    </script>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    return renderErrorPage('管理员页面加载失败: ' + error.message);
  }
}

// 渲染快照页面
async function renderSnapshotsPage(db) {
  try {
    const snapshots = await db.prepare(
      'SELECT DISTINCT title, month, created_at FROM monthly_snapshots ORDER BY created_at DESC'
    ).all();

    const wallpaper = await getBingWallpaper();
    const bgImage = wallpaper ? wallpaper.url : 'https://cn.bing.com/th?id=OHR.BadlandsNP_ZH-CN1068836500_1920x1080.jpg';

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>历史数据 - 班级评分系统</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        
        :root {
            --primary: #3b82f6;
            --background: #0f172a;
            --surface: #1e293b;
            --text: #f1f5f9;
            --text-light: #94a3b8;
            --border: #475569;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
            position: relative;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('${bgImage}');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            z-index: -2;
            opacity: 0.15;
        }
        
        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.98));
            z-index: -1;
            backdrop-filter: blur(1px);
        }
        
        .header {
            background: rgba(30, 41, 59, 0.9);
            backdrop-filter: blur(10px);
            padding: 30px;
            text-align: center;
            border-bottom: 1px solid var(--border);
            box-shadow: var(--shadow);
        }
        
        .header h1 {
            font-size: 32px;
            font-weight: 800;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #60a5fa, #a78bfa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .header p {
            color: var(--text-light);
            font-size: 16px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 30px 20px;
        }
        
        .back-btn {
            position: fixed;
            top: 30px;
            left: 30px;
            background: rgba(59, 130, 246, 0.2);
            border: 1px solid rgba(59, 130, 246, 0.3);
            color: #60a5fa;
            padding: 12px 20px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s ease;
            z-index: 100;
        }
        
        .back-btn:hover {
            background: rgba(59, 130, 246, 0.4);
            transform: translateY(-2px);
        }
        
        .snapshots-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 25px;
            margin-top: 40px;
        }
        
        .snapshot-card {
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 30px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: all 0.3s ease;
            cursor: pointer;
            position: relative;
            overflow: hidden;
        }
        
        .snapshot-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #3b82f6, #10b981);
        }
        
        .snapshot-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);
            border-color: rgba(59, 130, 246, 0.3);
        }
        
        .snapshot-title {
            font-size: 22px;
            font-weight: 700;
            margin-bottom: 15px;
            color: var(--text);
        }
        
        .snapshot-meta {
            color: var(--text-light);
            font-size: 14px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .snapshot-meta span {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        .snapshot-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            text-align: center;
            margin-top: 20px;
        }
        
        .stat-item {
            background: rgba(255, 255, 255, 0.05);
            padding: 15px;
            border-radius: 12px;
        }
        
        .stat-value {
            font-size: 24px;
            font-weight: 800;
            margin-bottom: 5px;
        }
        
        .stat-label {
            font-size: 13px;
            color: var(--text-light);
        }
        
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--text-light);
        }
        
        .empty-state h2 {
            font-size: 28px;
            margin-bottom: 15px;
            color: var(--text);
        }
        
        .empty-state p {
            font-size: 16px;
            margin-bottom: 30px;
            max-width: 500px;
            margin-left: auto;
            margin-right: auto;
        }
        
        .empty-btn {
            background: linear-gradient(135deg, #3b82f6, #8b5cf6);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            gap: 10px;
            text-decoration: none;
        }
        
        .empty-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(59, 130, 246, 0.5);
        }
        
        @media (max-width: 768px) {
            .snapshots-grid {
                grid-template-columns: 1fr;
            }
            
            .header h1 {
                font-size: 26px;
            }
            
            .container {
                padding: 20px 15px;
            }
            
            .back-btn {
                top: 20px;
                left: 20px;
                padding: 10px 15px;
            }
        }
    </style>
</head>
<body>
    <a href="/class" class="back-btn">
        返回评分系统
    </a>
    
    <div class="header">
        <h1>历史数据</h1>
        <p>查看保存的月度快照和历史记录</p>
    </div>
    
    <div class="container">
        ${snapshots.results && snapshots.results.length > 0 ? `
            <div class="snapshots-grid">
                ${snapshots.results.map(snapshot => {
                    const date = new Date(snapshot.created_at);
                    const timeStr = date.toLocaleString('zh-CN');
                    
                    return `
                        <div class="snapshot-card" onclick="viewSnapshot('${snapshot.title}')">
                            <div class="snapshot-title">${snapshot.title}</div>
                            <div class="snapshot-meta">
                                <span>${timeStr}</span>
                                <span>${snapshot.month}</span>
                            </div>
                            <div class="snapshot-stats">
                                <div class="stat-item">
                                    <div class="stat-value" style="color: #60a5fa;">--</div>
                                    <div class="stat-label">学生总数</div>
                                </div>
                                <div class="stat-item">
                                    <div class="stat-value" style="color: #10b981;">--</div>
                                    <div class="stat-label">总加分</div>
                                </div>
                                <div class="stat-item">
                                    <div class="stat-value" style="color: #ef4444;">--</div>
                                    <div class="stat-label">总扣分</div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        ` : `
            <div class="empty-state">
                <h2>暂无历史数据</h2>
                <p>您还没有保存任何月度快照。快照功能可以帮助您记录特定时间点的学生评分状态，便于对比和分析。</p>
                <button class="empty-btn" onclick="goBackAndCreate()">
                    返回并创建快照
                </button>
            </div>
        `}
    </div>
    
    <script>
        function viewSnapshot(title) {
            alert('快照详细功能开发中...\\n标题: ' + title + '\\n\\n该功能将在后续版本中提供详细数据查看和导出功能。');
        }
        
        function goBackAndCreate() {
            window.location.href = '/class';
        }
    </script>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    return renderErrorPage('快照页面加载失败: ' + error.message);
  }
}

// 渲染日志页面
async function renderLogsPage(db, url) {
  try {
    const studentId = url.searchParams.get('studentId');
    
    let logs;
    if (studentId) {
      logs = await db.prepare(`
        SELECT ol.*, s.name as student_name 
        FROM operation_logs ol
        JOIN students s ON ol.student_id = s.id
        WHERE ol.student_id = ?
        ORDER BY ol.created_at DESC
        LIMIT 100
      `).bind(studentId).all();
    } else {
      logs = await db.prepare(`
        SELECT ol.*, s.name as student_name 
        FROM operation_logs ol
        JOIN students s ON ol.student_id = s.id
        ORDER BY ol.created_at DESC
        LIMIT 100
      `).all();
    }

    const students = await db.prepare('SELECT id, name FROM students ORDER BY name').all();

    const wallpaper = await getBingWallpaper();
    const bgImage = wallpaper ? wallpaper.url : 'https://cn.bing.com/th?id=OHR.BadlandsNP_ZH-CN1068836500_1920x1080.jpg';

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>操作日志 - 班级评分系统</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        
        :root {
            --primary: #3b82f6;
            --background: #0f172a;
            --surface: #1e293b;
            --text: #f1f5f9;
            --text-light: #94a3b8;
            --border: #475569;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            padding: 30px;
            min-height: 100vh;
            position: relative;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('${bgImage}');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            z-index: -2;
            opacity: 0.1;
        }
        
        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.98));
            z-index: -1;
            backdrop-filter: blur(1px);
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
            background: rgba(30, 41, 59, 0.9);
            backdrop-filter: blur(10px);
            padding: 30px;
            border-radius: 20px;
            box-shadow: var(--shadow);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .header h1 {
            font-size: 32px;
            font-weight: 800;
            margin-bottom: 15px;
            background: linear-gradient(135deg, #60a5fa, #a78bfa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .filters {
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(10px);
            padding: 25px;
            border-radius: 16px;
            box-shadow: var(--shadow);
            margin-bottom: 30px;
            display: flex;
            gap: 15px;
            align-items: center;
            border: 1px solid rgba(255, 255, 255, 0.1);
            flex-wrap: wrap;
        }
        
        select, button {
            padding: 15px 20px;
            border: 2px solid var(--border);
            border-radius: 12px;
            background: rgba(15, 23, 42, 0.6);
            color: var(--text);
            font-size: 15px;
            font-weight: 500;
            transition: all 0.3s ease;
        }
        
        select:focus, button:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }
        
        button {
            background: linear-gradient(135deg, var(--primary), #2563eb);
            color: white;
            border: none;
            cursor: pointer;
            font-weight: 600;
            min-width: 120px;
        }
        
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
        }
        
        .log-table {
            width: 100%;
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            overflow: hidden;
            box-shadow: var(--shadow);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .log-table th, .log-table td {
            padding: 20px 25px;
            text-align: left;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .log-table th {
            background: rgba(30, 41, 59, 0.9);
            font-weight: 700;
            color: var(--text-light);
            font-size: 15px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .log-table tr:hover td {
            background: rgba(59, 130, 246, 0.1);
        }
        
        .positive { color: #10b981; font-weight: 700; }
        .negative { color: #ef4444; font-weight: 700; }
        
        .back-btn {
            display: inline-block;
            margin-bottom: 25px;
            color: #60a5fa;
            text-decoration: none;
            font-weight: 700;
            font-size: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(59, 130, 246, 0.2);
            padding: 12px 20px;
            border-radius: 12px;
            border: 1px solid rgba(59, 130, 246, 0.3);
            transition: all 0.3s ease;
        }
        
        .back-btn:hover {
            background: rgba(59, 130, 246, 0.4);
            transform: translateY(-2px);
        }
        
        @media (max-width: 768px) {
            body {
                padding: 20px;
            }
            
            .filters {
                flex-direction: column;
                align-items: stretch;
            }
            
            select, button {
                width: 100%;
            }
            
            .log-table {
                font-size: 14px;
            }
            
            .log-table th, .log-table td {
                padding: 15px 20px;
            }
        }
        
        @media (max-width: 480px) {
            .header h1 {
                font-size: 26px;
            }
            
            .log-table th, .log-table td {
                padding: 12px 15px;
            }
        }
    </style>
</head>
<body>
    <a href="/class" class="back-btn">
        返回班级视图
    </a>
    
    <div class="header">
        <h1>操作日志</h1>
        <p>查看系统操作记录和评分历史</p>
    </div>
    
    <div class="filters">
        <select id="studentFilter" style="flex: 1;">
            <option value="">所有学生</option>
            ${(students.results || []).map(s => `
                <option value="${s.id}" ${studentId == s.id ? 'selected' : ''}>${s.name}</option>
            `).join('')}
        </select>
        <button onclick="filterLogs()">筛选</button>
        <button onclick="clearFilter()" style="background: linear-gradient(135deg, #64748b, #475569);">清除筛选</button>
    </div>
    
    <table class="log-table">
        <thead>
            <tr>
                <th>时间</th>
                <th>学生</th>
                <th>操作类型</th>
                <th>分数变化</th>
                <th>操作者</th>
                <th>项目</th>
                <th>备注</th>
            </tr>
        </thead>
        <tbody>
            ${(logs.results || []).map(log => `
                <tr>
                    <td>${new Date(log.created_at).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    })}</td>
                    <td>${log.student_name}</td>
                    <td>
                        <span style="padding: 8px 15px; border-radius: 20px; font-size: 13px; font-weight: 700; background: ${log.action_type === 'add' ? 'rgba(16, 185, 129, 0.2)' : log.action_type === 'minus' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)'}; color: ${log.action_type === 'add' ? '#10b981' : log.action_type === 'minus' ? '#ef4444' : '#f59e0b'};">
                            ${log.action_type === 'add' ? '加分' : log.action_type === 'minus' ? '扣分' : '撤销'}
                        </span>
                    </td>
                    <td class="${log.score_change > 0 ? 'positive' : 'negative'}">
                        ${log.score_change > 0 ? '+' : ''}${log.score_change}
                    </td>
                    <td>${log.operator}${log.operator_detail ? ' (' + log.operator_detail + ')' : ''}</td>
                    <td>${log.category_name}</td>
                    <td>${log.note || '-'}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    
    <script>
        function filterLogs() {
            const studentId = document.getElementById('studentFilter').value;
            let url = '/logs';
            if (studentId) {
                url += \`?studentId=\${studentId}\`;
            }
            window.location.href = url;
        }
        
        function clearFilter() {
            window.location.href = '/logs';
        }
    </script>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    return renderErrorPage('日志页面加载失败: ' + error.message);
  }
}

// 渲染错误页面
function renderErrorPage(message) {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>系统错误</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        body { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem; }
        .error-container { background: rgba(30, 41, 59, 0.9); backdrop-filter: blur(10px); padding: 3rem; border-radius: 20px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); text-align: center; max-width: 500px; border: 1px solid rgba(255,255,255,0.1); }
        h1 { color: #ef4444; margin-bottom: 1.5rem; font-size: 28px; font-weight: 800; }
        p { color: #94a3b8; margin-bottom: 2rem; line-height: 1.6; font-size: 16px; }
        .btn { background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; padding: 1rem 2rem; border: none; border-radius: 12px; text-decoration: none; display: inline-block; font-weight: 700; font-size: 16px; transition: all 0.3s ease; }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(59, 130, 246, 0.4); }
    </style>
</head>
<body>
    <div class="error-container">
        <h1>系统错误</h1>
        <p>${message}</p>
        <a href="/" class="btn">返回首页</a>
    </div>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}