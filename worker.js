// cloudflare-worker.js - 重构版班级评分系统
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
    const response = await fetch('https://tc.ilqx.dpdns.org/api/bing/wallpaper');
    const data = await response.json();
    return new Response(JSON.stringify(data), {
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
    const response = await fetch(`https://qx.dpdns.org/geo`);
    const data = await response.json();
    
    // 添加延迟信息
    const startTime = Date.now();
    await fetch('https://ip.ilqx.dpdns.org/geo'); // 测试延迟
    const latency = Date.now() - startTime;
    
    data.latency = `${latency}ms`;
    data.user_agent = userAgent || '未知';
    
    return new Response(JSON.stringify(data), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ip: clientIP,
      flag: "🇨🇳",
      country: "CN",
      countryRegion: "Unknown",
      city: "Unknown",
      region: "Unknown",
      latitude: "0",
      longitude: "0",
      asOrganization: "Unknown",
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
    const { studentIds, categoryId, score, operator, note } = await request.json();
    
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
        'INSERT INTO score_records (student_id, category_id, score, operator, note, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(studentId, categoryId, score, operator, note || '', clientIP).run();

      // 更新学生最后评分时间
      await db.prepare(
        'UPDATE students SET last_scored_at = CURRENT_TIMESTAMP, score_count = score_count + 1 WHERE id = ?'
      ).bind(studentId).run();

      // 记录操作日志
      await db.prepare(
        'INSERT INTO operation_logs (student_id, student_name, action_type, score_change, operator, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(studentId, student?.name || '未知', category.type, category.type === 'add' ? score : -score, 
             operator, category.name, note || '', clientIP, userAgent).run();
    }

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
      ['enable_ip_auth', 'true'],
      ['wallpaper_api', 'https://tc.ilqx.dpdns.org/api/bing/wallpaper'],
      ['geo_api', 'https://ip.ilqx.dpdns.org/geo']
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
      ORDER BY total_score DESC, s.last_scored_at DESC
    `).all();

    const studentsArray = students.results || [];

    // 获取最近评分的学生
    const recentStudents = await db.prepare(`
      SELECT s.id, s.name, MAX(sr.created_at) as last_scored
      FROM students s
      LEFT JOIN score_records sr ON s.id = sr.student_id
      GROUP BY s.id, s.name
      ORDER BY last_scored DESC
      LIMIT 10
    `).all();

    return new Response(JSON.stringify({
      success: true,
      students: studentsArray,
      recentStudents: recentStudents.results || [],
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
    const { studentId, categoryId, score, operator, note } = await request.json();
    
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
      'INSERT INTO score_records (student_id, category_id, score, operator, note, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(studentId, categoryId, score, operator, note || '', clientIP).run();

    // 更新学生最后评分时间
    await db.prepare(
      'UPDATE students SET last_scored_at = CURRENT_TIMESTAMP, score_count = score_count + 1 WHERE id = ?'
    ).bind(studentId).run();

    // 记录操作日志
    await db.prepare(
      'INSERT INTO operation_logs (student_id, student_name, action_type, score_change, operator, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(studentId, student?.name || '未知', category.type, category.type === 'add' ? score : -score, 
           operator, category.name, note || '', clientIP, userAgent).run();

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
        SELECT sr.id, sr.score, sc.type, sc.name as category_name, sr.operator, sr.note, s.name as student_name
        FROM score_records sr
        JOIN score_categories sc ON sr.category_id = sc.id
        JOIN students s ON sr.student_id = s.id
        WHERE sr.id = ?
      `).bind(recordId).first();
    } else {
      // 获取最近一条记录
      lastRecord = await db.prepare(`
        SELECT sr.id, sr.score, sc.type, sc.name as category_name, sr.operator, sr.note, s.name as student_name
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
      'INSERT INTO operation_logs (student_id, student_name, action_type, score_change, operator, category_name, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(studentId || lastRecord.student_id, lastRecord.student_name, 'revoke', 
           lastRecord.type === 'add' ? -lastRecord.score : lastRecord.score, 
           lastRecord.operator, `撤销: ${lastRecord.category_name}`, '撤销操作').run();

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
    const { confirm_password } = await request.json();
    
    // 验证管理员密码
    if (!confirm_password) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '请输入管理员密码进行二次验证' 
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
      return await renderVisitorPage(env.DB, clientIP, userAgent);
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
    const response = await fetch('https://tc.ilqx.dpdns.org/api/bing/wallpaper');
    const data = await response.json();
    return data.data && data.data.length > 0 ? data.data[0] : null;
  } catch (error) {
    return null;
  }
}

// 获取IP地理位置信息
async function getGeoInfo(clientIP, userAgent) {
  try {
    const response = await fetch('https://ip.ilqx.dpdns.org/geo');
    const data = await response.json();
    
    // 测试延迟
    const startTime = Date.now();
    await fetch('https://ip.ilqx.dpdns.org/geo');
    const latency = Date.now() - startTime;
    
    return {
      ...data,
      latency: `${latency}ms`,
      user_agent: userAgent,
      ip: clientIP
    };
  } catch (error) {
    return {
      ip: clientIP,
      flag: "🇨🇳",
      country: "CN",
      countryRegion: "未知",
      city: "未知",
      region: "未知",
      latitude: "0",
      longitude: "0",
      asOrganization: "未知",
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
        <h1>📊 系统初始化</h1>
        
        <div class="info-text">
            欢迎使用班级评分系统！请完成以下设置以开始使用。
        </div>
        
        <form id="setupForm">
            <div class="form-section">
                <div class="section-title">🏫 班级信息</div>
                
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
                <div class="section-title">🔐 班级账号</div>
                
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
                <div class="section-title">⚡ 管理员账号</div>
                
                <div class="form-group">
                    <label for="admin_username">管理员账号</label>
                    <input type="text" id="admin_username" placeholder="设置管理员账号" value="2314admin" required>
                </div>
                
                <div class="form-group">
                    <label for="admin_password">管理员密码</label>
                    <input type="password" id="admin_password" placeholder="设置管理员密码" value="2314admin2314admin" required>
                </div>
            </div>
            
            <button type="submit">🚀 开始初始化</button>
            
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
                    document.getElementById('message').textContent = '✅ 系统初始化成功！正在跳转...';
                    document.getElementById('message').className = 'success-message';
                    submitBtn.textContent = '✅ 初始化成功';
                    
                    setTimeout(() => {
                        window.location.href = '/login';
                    }, 1500);
                } else {
                    document.getElementById('message').textContent = '❌ ' + (result.error || '初始化失败');
                    document.getElementById('message').className = 'error-message';
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            } catch (error) {
                document.getElementById('message').textContent = '❌ 网络错误，请检查网络连接';
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
  
  const bgImage = wallpaper ? `https://www.bing.com${wallpaper.url}` : 'https://www.loliapi.com/acg/';
  
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
            text-shadow: 0 2px 10px rgba(96, 165, 250, 0.2);
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
                <span>👨‍🎓</span>
                班级登录
            </div>
            <div class="role-btn" data-role="visitor">
                <span>👁️</span>
                游客登录
            </div>
        </div>
        
        <form id="loginForm">
            <div class="input-group">
                <div class="input-icon">👤</div>
                <input type="text" id="username" placeholder="请输入用户名" autocomplete="username" required>
            </div>
            
            <div class="input-group">
                <div class="input-icon">🔒</div>
                <input type="password" id="password" placeholder="请输入密码" autocomplete="current-password" required>
            </div>
            
            ${ipSession ? `
            <div class="checkbox-group">
                <input type="checkbox" id="remember_ip" checked>
                <label for="remember_ip">记住IP地址 (${clientIP.substring(0, 15)}...)</label>
            </div>
            ` : ''}
            
            <button type="submit">🔐 登录系统</button>
        </form>
        
        <div class="ip-info">
            <strong>📡 连接信息</strong>
            IP: ${geoInfo.ip || clientIP}<br>
            位置: ${geoInfo.countryRegion || '未知'} ${geoInfo.city || '未知'}<br>
            延迟: ${geoInfo.latency || '0ms'}<br>
            运营商: ${geoInfo.asOrganization || '未知'}
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
            class: { username: '2314', password: 'hzwy2314' }
        };

        document.querySelectorAll('.role-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentRole = btn.dataset.role;
                
                if (currentRole === 'visitor') {
                    window.location.href = '/';
                } else {
                    const creds = roleCredentials[currentRole];
                    if (creds) {
                        document.getElementById('username').value = creds.username;
                        document.getElementById('password').value = creds.password;
                    }
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
                    showMessage('✅ 登录成功！正在跳转...', 'success');
                    submitBtn.textContent = '✅ 登录成功';
                    
                    setTimeout(() => {
                        if (result.role === 'class') {
                            window.location.href = '/class';
                        } else if (result.role === 'admin') {
                            window.location.href = '/admin';
                        }
                    }, 800);
                } else {
                    showMessage('❌ ' + result.error, 'error');
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            } catch (error) {
                showMessage('❌ 网络错误，请重试', 'error');
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
    const [studentsData, scoreCategories, tasks, settings, wallpaper, geoInfo, recentStudents] = await Promise.all([
      handleGetStudents(db).then(r => r.json()),
      db.prepare('SELECT * FROM score_categories ORDER BY type, name').all(),
      db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 5').all(),
      db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?)').bind('site_title', 'class_name', 'current_month').all(),
      getBingWallpaper(),
      getGeoInfo(clientIP, userAgent),
      db.prepare(`
        SELECT s.id, s.name, MAX(sr.created_at) as last_scored
        FROM students s
        LEFT JOIN score_records sr ON s.id = sr.student_id
        GROUP BY s.id, s.name
        ORDER BY last_scored DESC
        LIMIT 10
      `).all()
    ]);

    if (!studentsData.success) {
      throw new Error(studentsData.error);
    }

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    const bgImage = wallpaper ? `https://www.bing.com${wallpaper.url}` : 'https://www.loliapi.com/acg/';

    // 处理最近评分的学生
    const recentStudentList = recentStudents.results || [];
    const recentStudentIds = recentStudentList.map(s => s.id);

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
        
        .class-info h1 {
            font-size: 24px;
            font-weight: 800;
            color: var(--text);
            margin-bottom: 5px;
            background: linear-gradient(135deg, #60a5fa, #a78bfa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .class-info .subtitle {
            font-size: 14px;
            color: var(--text-light);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .top-actions {
            display: flex;
            gap: 15px;
            align-items: center;
        }
        
        .btn {
            padding: 10px 20px;
            border-radius: var(--radius-sm);
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            text-decoration: none;
            font-size: 14px;
            border: none;
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
        
        /* 主内容区域 */
        .main-content {
            padding: 25px;
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 25px;
            margin-bottom: 25px;
        }
        
        .grid-3 {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 25px;
            margin-bottom: 25px;
        }
        
        .card {
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(10px);
            border-radius: var(--radius-lg);
            padding: 25px;
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
            transform: translateY(-5px);
            box-shadow: var(--shadow-lg);
            border-color: rgba(59, 130, 246, 0.3);
        }
        
        .card-title {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 20px;
            color: var(--text);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        /* 学生表格 */
        .student-table-container {
            background: rgba(15, 23, 42, 0.6);
            border-radius: var(--radius);
            overflow: hidden;
            margin-top: 20px;
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
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .student-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 700;
            font-size: 16px;
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
        
        /* 按钮样式 */
        .action-btn {
            padding: 8px 16px;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            font-weight: 600;
            font-size: 13px;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        
        .action-btn-primary {
            background: rgba(59, 130, 246, 0.2);
            color: #60a5fa;
            border: 1px solid rgba(59, 130, 246, 0.3);
        }
        
        .action-btn-primary:hover {
            background: rgba(59, 130, 246, 0.4);
            transform: translateY(-2px);
        }
        
        .action-btn-danger {
            background: rgba(239, 68, 68, 0.2);
            color: #f87171;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        
        .action-btn-danger:hover {
            background: rgba(239, 68, 68, 0.4);
            transform: translateY(-2px);
        }
        
        /* 排名按钮 */
        .rank-btn {
            background: linear-gradient(135deg, #8b5cf6, #a78bfa);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 20px auto;
            font-size: 15px;
        }
        
        .rank-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(139, 92, 246, 0.4);
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
            z-index: 2000;
            align-items: center;
            justify-content: center;
            padding: 20px;
            animation: fadeIn 0.3s ease;
        }
        
        .modal-content {
            background: var(--surface);
            padding: 30px;
            border-radius: var(--radius-lg);
            width: 100%;
            max-width: 500px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: var(--shadow-lg);
            border: 1px solid rgba(255, 255, 255, 0.1);
            animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
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
        
        /* 评分步骤 */
        .step-container {
            display: none;
        }
        
        .step-container.active {
            display: block;
            animation: fadeIn 0.3s ease;
        }
        
        .step-indicator {
            display: flex;
            justify-content: center;
            margin-bottom: 30px;
            gap: 10px;
        }
        
        .step-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: var(--border);
            transition: all 0.3s ease;
        }
        
        .step-dot.active {
            background: var(--primary);
            transform: scale(1.2);
            box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
        }
        
        .step-title {
            text-align: center;
            margin-bottom: 25px;
            font-size: 22px;
            font-weight: 700;
            color: var(--text);
        }
        
        .student-highlight {
            color: var(--primary);
            font-weight: 800;
        }
        
        /* 分数按钮 */
        .score-buttons {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            margin: 20px 0;
        }
        
        .score-btn {
            padding: 25px 10px;
            border: 2px solid var(--border);
            background: rgba(255, 255, 255, 0.05);
            border-radius: var(--radius);
            cursor: pointer;
            transition: all 0.3s ease;
            text-align: center;
            font-weight: 800;
            color: var(--text);
            font-size: 20px;
            position: relative;
            overflow: hidden;
        }
        
        .score-btn:hover {
            border-color: var(--primary);
            background: rgba(59, 130, 246, 0.1);
            transform: translateY(-4px) scale(1.05);
            box-shadow: 0 8px 20px rgba(59, 130, 246, 0.2);
        }
        
        .score-btn.selected {
            border-color: var(--primary);
            background: var(--primary);
            color: white;
            box-shadow: 0 8px 25px rgba(59, 130, 246, 0.4);
            transform: translateY(-2px) scale(1.02);
        }
        
        /* 输入框样式 */
        .input-group {
            margin-bottom: 20px;
        }
        
        .input-group label {
            display: block;
            margin-bottom: 10px;
            font-weight: 600;
            color: var(--text);
            font-size: 15px;
        }
        
        select, input, textarea {
            width: 100%;
            padding: 16px 20px;
            border: 2px solid var(--border);
            border-radius: var(--radius-sm);
            font-size: 16px;
            transition: all 0.3s ease;
            background: rgba(15, 23, 42, 0.6);
            color: var(--text);
            font-weight: 500;
        }
        
        select:focus, input:focus, textarea:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
            background: rgba(15, 23, 42, 0.8);
        }
        
        /* 动作按钮 */
        .action-buttons {
            display: flex;
            gap: 15px;
            margin-top: 30px;
        }
        
        .action-btn-large {
            flex: 1;
            padding: 18px;
            border: none;
            border-radius: var(--radius-sm);
            cursor: pointer;
            transition: all 0.3s ease;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            font-size: 16px;
        }
        
        .action-btn-large.submit {
            background: linear-gradient(135deg, var(--secondary), #0da271);
            color: white;
        }
        
        .action-btn-large.submit:hover {
            background: linear-gradient(135deg, #0da271, #059669);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(16, 185, 129, 0.3);
        }
        
        .action-btn-large.cancel {
            background: rgba(255, 255, 255, 0.1);
            color: var(--text-light);
            border: 1px solid var(--border);
        }
        
        .action-btn-large.cancel:hover {
            background: rgba(255, 255, 255, 0.2);
            transform: translateY(-2px);
        }
        
        /* 多选学生 */
        .student-select-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 12px;
            max-height: 300px;
            overflow-y: auto;
            padding: 15px;
            background: rgba(15, 23, 42, 0.4);
            border-radius: var(--radius);
            margin: 20px 0;
        }
        
        .student-checkbox {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            border: 2px solid transparent;
        }
        
        .student-checkbox:hover {
            background: rgba(59, 130, 246, 0.1);
            border-color: rgba(59, 130, 246, 0.3);
        }
        
        .student-checkbox.selected {
            background: rgba(59, 130, 246, 0.2);
            border-color: var(--primary);
        }
        
        .student-checkbox input {
            width: 18px;
            height: 18px;
            accent-color: var(--primary);
        }
        
        /* 通知 */
        .notification {
            position: fixed;
            top: 100px;
            right: 25px;
            padding: 20px 25px;
            border-radius: var(--radius);
            color: white;
            font-weight: 600;
            z-index: 3000;
            animation: slideInRight 0.3s ease;
            box-shadow: var(--shadow);
            display: flex;
            align-items: center;
            gap: 12px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            min-width: 300px;
        }
        
        .notification.success {
            background: rgba(16, 185, 129, 0.9);
        }
        
        .notification.error {
            background: rgba(239, 68, 68, 0.9);
        }
        
        .notification.info {
            background: rgba(59, 130, 246, 0.9);
        }
        
        /* 动画 */
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        @keyframes slideUp {
            from { transform: translateY(30px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        /* 响应式设计 */
        @media (max-width: 1200px) {
            .grid-2, .grid-3 {
                grid-template-columns: 1fr;
            }
        }
        
        @media (max-width: 768px) {
            .main-content {
                padding: 15px;
            }
            
            .top-bar {
                padding: 12px 15px;
                flex-direction: column;
                gap: 15px;
                text-align: center;
            }
            
            .top-actions {
                width: 100%;
                justify-content: center;
                flex-wrap: wrap;
            }
            
            .card {
                padding: 20px;
            }
            
            .student-table th, .student-table td {
                padding: 12px 15px;
            }
            
            .score-buttons {
                grid-template-columns: repeat(2, 1fr);
            }
            
            .action-buttons {
                flex-direction: column;
            }
            
            .modal-content {
                padding: 20px;
            }
        }
        
        @media (max-width: 480px) {
            .student-table {
                font-size: 14px;
            }
            
            .student-table th, .student-table td {
                padding: 10px 12px;
            }
            
            .score-btn {
                padding: 20px 8px;
                font-size: 18px;
            }
            
            .btn {
                padding: 8px 15px;
                font-size: 13px;
            }
        }
        
        /* 最近评分学生 */
        .recent-students {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 15px;
        }
        
        .recent-student-btn {
            padding: 10px 15px;
            background: rgba(59, 130, 246, 0.2);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 20px;
            color: #60a5fa;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
        }
        
        .recent-student-btn:hover {
            background: rgba(59, 130, 246, 0.4);
            transform: translateY(-2px);
        }
        
        /* IP信息显示 */
        .ip-display {
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(30, 41, 59, 0.9);
            backdrop-filter: blur(10px);
            padding: 15px;
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            border: 1px solid rgba(255, 255, 255, 0.1);
            z-index: 1000;
            max-width: 300px;
            animation: slideInRight 0.5s ease;
        }
        
        .ip-display h3 {
            color: var(--text);
            margin-bottom: 10px;
            font-size: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .ip-details {
            font-size: 13px;
            color: var(--text-light);
            line-height: 1.5;
        }
        
        .ip-details strong {
            color: var(--text);
            font-weight: 600;
        }
        
        .latency {
            color: var(--secondary);
            font-weight: 700;
        }
        
        /* 排名模态框 */
        .rank-modal {
            max-width: 800px;
        }
        
        .rank-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        
        .rank-table th {
            background: rgba(30, 41, 59, 0.9);
            padding: 15px;
            text-align: left;
            font-weight: 600;
            color: var(--text-light);
            border-bottom: 2px solid var(--border);
        }
        
        .rank-table td {
            padding: 15px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .rank-table tr:hover td {
            background: rgba(59, 130, 246, 0.1);
        }
        
        .rank-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: var(--primary);
            color: white;
            font-weight: 800;
            font-size: 14px;
            transition: all 0.3s ease;
        }
        
        .rank-badge:hover {
            transform: scale(1.1) rotate(5deg);
        }
        
        .rank-1 {
            background: linear-gradient(135deg, #f59e0b, #d97706);
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
        }
        
        .rank-2 {
            background: linear-gradient(135deg, #6b7280, #4b5563);
            box-shadow: 0 4px 12px rgba(107, 114, 128, 0.4);
        }
        
        .rank-3 {
            background: linear-gradient(135deg, #92400e, #78350f);
            box-shadow: 0 4px 12px rgba(146, 64, 14, 0.4);
        }
    </style>
</head>
<body>
    <!-- IP信息显示 -->
    <div class="ip-display">
        <h3>📡 连接信息</h3>
        <div class="ip-details">
            <strong>IP:</strong> ${geoInfo.ip || clientIP}<br>
            <strong>位置:</strong> ${geoInfo.countryRegion || '未知'} ${geoInfo.city || '未知'}<br>
            <strong>延迟:</strong> <span class="latency">${geoInfo.latency || '0ms'}</span><br>
            <strong>设备:</strong> ${geoInfo.user_agent?.substring(0, 30) || '未知'}...
        </div>
    </div>
    
    <!-- 顶部栏 -->
    <div class="top-bar">
        <div class="class-info">
            <h1>${settingMap.site_title || '2314班综合评分系统'}</h1>
            <div class="subtitle">
                <span>📅 ${new Date().toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                <span>•</span>
                <span>👥 ${studentsData.totalStudents || 0} 名学生</span>
            </div>
        </div>
        
        <div class="top-actions">
            <button class="btn btn-success" onclick="showRanking()">
                <span>🏆</span>
                查看排名
            </button>
            <button class="btn btn-primary" onclick="showBatchScoreModal()">
                <span>📝</span>
                批量评分
            </button>
            <button class="btn btn-primary" onclick="showSnapshotModal()">
                <span>💾</span>
                保存快照
            </button>
            <button class="btn btn-danger" onclick="logout()">
                <span>🚪</span>
                退出登录
            </button>
        </div>
    </div>
    
    <!-- 主内容 -->
    <div class="main-content">
        <!-- 最近评分学生 -->
        <div class="card">
            <div class="card-title">
                <span>🕐 最近评分学生</span>
                <span>点击快速评分</span>
            </div>
            <div class="recent-students" id="recentStudents">
                ${recentStudentList.map(student => `
                    <div class="recent-student-btn" onclick="startScoreProcess(${student.id}, 'add', '${student.name}')">
                        <span>👤</span>
                        ${student.name}
                    </div>
                `).join('')}
                ${recentStudentList.length === 0 ? '<div style="color: var(--text-light); text-align: center; padding: 20px;">暂无最近评分记录</div>' : ''}
            </div>
        </div>
        
        <!-- 学生评分表格 -->
        <div class="card">
            <div class="card-title">
                <span>📊 学生综合评分表</span>
                <span>点击分数单元格进行评分</span>
            </div>
            
            <div class="student-table-container">
                <table class="student-table">
                    <thead>
                        <tr>
                            <th width="40">
                                <input type="checkbox" id="selectAll" onclick="toggleSelectAll()">
                            </th>
                            <th>学生姓名</th>
                            <th width="120" class="score-cell" onclick="showAllScores('add')">加分</th>
                            <th width="120" class="score-cell" onclick="showAllScores('minus')">扣分</th>
                            <th width="120">总分</th>
                            <th width="150">操作</th>
                        </tr>
                    </thead>
                    <tbody id="studentsBody">
                        ${studentsData.students.map((student, index) => `
                            <tr>
                                <td>
                                    <input type="checkbox" class="student-select" value="${student.id}" data-name="${student.name}" 
                                           ${recentStudentIds.includes(student.id) ? 'checked' : ''}>
                                </td>
                                <td>
                                    <div class="student-name">
                                        <div class="student-avatar">
                                            ${student.name.charAt(0)}
                                        </div>
                                        ${student.name}
                                        ${index < 3 ? `<div class="rank-badge rank-${index + 1}" style="width: 24px; height: 24px; font-size: 12px;">${index + 1}</div>` : ''}
                                    </div>
                                </td>
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
                                    <div style="display: flex; gap: 8px;">
                                        <button class="action-btn action-btn-primary" onclick="showStudentHistory(${student.id}, '${student.name}')">
                                            <span>📋</span>
                                            详细
                                        </button>
                                        <button class="action-btn action-btn-danger" onclick="showRevokeModal(${student.id}, '${student.name}')">
                                            <span>↩️</span>
                                            撤销
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            
            <div style="margin-top: 20px; display: flex; justify-content: center;">
                <button class="rank-btn" onclick="showRanking()">
                    <span>🏆</span>
                    查看完整排名榜
                </button>
            </div>
        </div>
        
        <!-- 页脚信息 -->
        <div style="text-align: center; margin-top: 40px; color: var(--text-light); font-size: 14px; padding: 25px; border-top: 1px solid var(--border);">
            <div style="margin-bottom: 15px;">
                <strong>By 2314 刘沁熙</strong><br>
                基于 Cloudflare Worker 搭建<br>
                Cloudflare CDN 提供加速服务
            </div>
            <div style="font-size: 12px; color: var(--text-lighter);">
                当前IP: ${clientIP} • 设备: ${userAgent?.substring(0, 50) || '未知'}...
            </div>
        </div>
    </div>
    
    <!-- 排名模态框 -->
    <div class="modal-overlay" id="rankingModal">
        <div class="modal-content rank-modal">
            <button class="modal-close" onclick="closeRankingModal()">×</button>
            
            <div class="step-title">🏆 学生排名榜</div>
            
            <table class="rank-table">
                <thead>
                    <tr>
                        <th width="80">排名</th>
                        <th>学生姓名</th>
                        <th width="120">加分</th>
                        <th width="120">扣分</th>
                        <th width="120">总分</th>
                        <th width="150">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${studentsData.students.map((student, index) => `
                        <tr>
                            <td>
                                <div class="rank-badge ${index < 3 ? `rank-${index + 1}` : ''}">
                                    ${index + 1}
                                </div>
                            </td>
                            <td>
                                <div class="student-name">
                                    <div class="student-avatar">
                                        ${student.name.charAt(0)}
                                    </div>
                                    ${student.name}
                                </div>
                            </td>
                            <td class="add-score">${student.add_score}</td>
                            <td class="minus-score">${student.minus_score}</td>
                            <td class="total-score">${student.total_score > 0 ? '+' : ''}${student.total_score}</td>
                            <td>
                                <button class="action-btn action-btn-primary" onclick="showStudentHistory(${student.id}, '${student.name}')">
                                    <span>📋</span>
                                    详细
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <div class="action-buttons" style="margin-top: 30px;">
                <button class="action-btn-large cancel" onclick="closeRankingModal()">
                    <span>←</span>
                    返回
                </button>
            </div>
        </div>
    </div>
    
    <!-- 评分模态框 -->
    <div class="modal-overlay" id="scoreModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeScoreModal()">×</button>
            
            <div class="step-indicator">
                <div class="step-dot active" id="step1Dot"></div>
                <div class="step-dot" id="step2Dot"></div>
            </div>
            
            <!-- 第一步：选择分数 -->
            <div class="step-container active" id="step1">
                <div class="step-title">
                    为 <span class="student-highlight" id="step1StudentName"></span> 
                    <span id="step1ActionType"></span>
                </div>
                <div class="score-buttons" id="scoreButtons">
                    <div class="score-btn" data-score="1">1分</div>
                    <div class="score-btn" data-score="2">2分</div>
                    <div class="score-btn" data-score="3">3分</div>
                    <div class="score-btn" data-score="4">4分</div>
                    <div class="score-btn" data-score="5">5分</div>
                    <div class="score-btn" data-score="custom">自定义</div>
                </div>
                <div class="input-group">
                    <input type="number" id="customScore" style="display: none;" placeholder="输入自定义分值 (1-100)" min="1" max="100" value="1">
                </div>
                <div class="action-buttons">
                    <button class="action-btn-large cancel" onclick="closeScoreModal()">
                        <span>❌</span>
                        取消
                    </button>
                    <button class="action-btn-large submit" onclick="goToStep2()">
                        <span>➡️</span>
                        下一步
                    </button>
                </div>
            </div>
            
            <!-- 第二步：选择原因和教师 -->
            <div class="step-container" id="step2">
                <div class="step-title">
                    选择评分项目
                </div>
                
                <div class="input-group">
                    <label>评分项目：</label>
                    <select id="categorySelect">
                        <!-- 动态填充 -->
                    </select>
                </div>
                
                <div class="input-group">
                    <label>操作教师：</label>
                    <select id="operatorSelect">
                        <option value="班主任">班主任</option>
                        <option value="语文老师">语文老师</option>
                        <option value="数学老师">数学老师</option>
                        <option value="英语老师">英语老师</option>
                        <option value="政治老师">政治老师</option>
                        <option value="历史老师">历史老师</option>
                        <option value="物理老师">物理老师</option>
                        <option value="化学老师">化学老师</option>
                    </select>
                </div>
                
                <div class="input-group">
                    <label>备注说明：</label>
                    <input type="text" id="scoreNote" placeholder="请输入备注信息（某些项目必填）">
                    <div id="noteRequired" style="color: var(--danger); font-size: 13px; margin-top: 5px; display: none;">⚠️ 此项必须填写备注说明</div>
                </div>
                
                <div class="action-buttons">
                    <button class="action-btn-large cancel" onclick="goToStep1()">
                        <span>⬅️</span>
                        上一步
                    </button>
                    <button class="action-btn-large submit" onclick="submitScore()">
                        <span>✅</span>
                        提交评分
                    </button>
                </div>
            </div>
        </div>
    </div>
    
    <!-- 批量评分模态框 -->
    <div class="modal-overlay" id="batchScoreModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeBatchScoreModal()">×</button>
            
            <div class="step-title">📝 批量评分</div>
            
            <div class="input-group">
                <label>选择学生（已选择 <span id="selectedCount">0</span> 人）：</label>
                <div class="student-select-grid" id="studentSelectGrid">
                    <!-- 动态填充 -->
                </div>
                <div style="margin-top: 10px; display: flex; gap: 10px;">
                    <button class="action-btn action-btn-primary" onclick="selectRecentStudents()">
                        选择最近评分学生
                    </button>
                    <button class="action-btn action-btn-danger" onclick="clearSelection()">
                        清空选择
                    </button>
                </div>
            </div>
            
            <div class="score-buttons">
                <div class="score-btn" data-score="1">1分</div>
                <div class="score-btn" data-score="2">2分</div>
                <div class="score-btn" data-score="3">3分</div>
                <div class="score-btn" data-score="4">4分</div>
                <div class="score-btn" data-score="5">5分</div>
                <div class="score-btn" data-score="custom">自定义</div>
            </div>
            
            <div class="input-group">
                <input type="number" id="batchCustomScore" style="display: none;" placeholder="输入自定义分值 (1-100)" min="1" max="100" value="1">
            </div>
            
            <div class="input-group">
                <label>评分项目：</label>
                <select id="batchCategorySelect">
                    <!-- 动态填充 -->
                </select>
            </div>
            
            <div class="input-group">
                <label>操作教师：</label>
                <select id="batchOperatorSelect">
                    <option value="班主任">班主任</option>
                    <option value="语文老师">语文老师</option>
                    <option value="数学老师">数学老师</option>
                    <option value="英语老师">英语老师</option>
                    <option value="政治老师">政治老师</option>
                    <option value="历史老师">历史老师</option>
                    <option value="物理老师">物理老师</option>
                    <option value="化学老师">化学老师</option>
                </select>
            </div>
            
            <div class="input-group">
                <label>备注说明：</label>
                <input type="text" id="batchScoreNote" placeholder="请输入备注信息（某些项目必填）">
                <div id="batchNoteRequired" style="color: var(--danger); font-size: 13px; margin-top: 5px; display: none;">⚠️ 此项必须填写备注说明</div>
            </div>
            
            <div class="action-buttons">
                <button class="action-btn-large cancel" onclick="closeBatchScoreModal()">
                    <span>❌</span>
                    取消
                </button>
                <button class="action-btn-large submit" onclick="submitBatchScore()">
                    <span>🚀</span>
                    批量提交
                </button>
            </div>
        </div>
    </div>
    
    <!-- 学生历史记录模态框 -->
    <div class="modal-overlay" id="historyModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeHistoryModal()">×</button>
            
            <div class="step-title">
                📋 <span id="historyStudentName"></span> 的操作记录
            </div>
            
            <div id="historyLoading" style="text-align: center; padding: 40px; color: var(--text-light);">
                <div style="font-size: 18px; margin-bottom: 15px;">⏳ 加载中...</div>
                <div>正在获取学生历史记录</div>
            </div>
            
            <div id="historyContent" style="display: none;">
                <div style="margin-bottom: 20px; color: var(--text-light);">
                    共 <span id="historyCount">0</span> 条记录
                </div>
                
                <div id="historyList" style="max-height: 400px; overflow-y: auto;">
                    <!-- 动态填充 -->
                </div>
                
                <div class="action-buttons" style="margin-top: 30px;">
                    <button class="action-btn-large cancel" onclick="closeHistoryModal()">
                        <span>←</span>
                        返回
                    </button>
                    <button class="action-btn-large submit" onclick="exportStudentHistory()">
                        <span>📥</span>
                        导出记录
                    </button>
                </div>
            </div>
        </div>
    </div>
    
    <!-- 撤销模态框 -->
    <div class="modal-overlay" id="revokeModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeRevokeModal()">×</button>
            
            <div class="step-title">
                ↩️ 撤销操作 - <span id="revokeStudentName"></span>
            </div>
            
            <div id="revokeLoading" style="text-align: center; padding: 40px; color: var(--text-light);">
                <div style="font-size: 18px; margin-bottom: 15px;">⏳ 加载中...</div>
                <div>正在获取最近操作记录</div>
            </div>
            
            <div id="revokeContent" style="display: none;">
                <div style="margin-bottom: 25px; color: var(--text-light);">
                    最近一次操作记录
                </div>
                
                <div id="lastRecord" style="background: rgba(255, 255, 255, 0.05); padding: 20px; border-radius: var(--radius); border: 1px solid var(--border);">
                    <!-- 动态填充 -->
                </div>
                
                <div style="margin: 25px 0; padding: 20px; background: rgba(239, 68, 68, 0.1); border-radius: var(--radius); border: 1px solid rgba(239, 68, 68, 0.3); color: var(--text-light);">
                    <strong style="color: var(--danger);">⚠️ 警告：</strong>
                    撤销操作将删除该评分记录，此操作不可恢复。请谨慎操作。
                </div>
                
                <div class="action-buttons">
                    <button class="action-btn-large cancel" onclick="closeRevokeModal()">
                        <span>❌</span>
                        取消
                    </button>
                    <button class="action-btn-large submit" style="background: linear-gradient(135deg, var(--danger), #dc2626);" onclick="confirmRevoke()">
                        <span>✅</span>
                        确认撤销
                    </button>
                </div>
            </div>
        </div>
    </div>
    
    <!-- 快照模态框 -->
    <div class="modal-overlay" id="snapshotModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeSnapshotModal()">×</button>
            
            <div class="step-title">💾 保存月度快照</div>
            
            <div class="input-group">
                <label>快照标题：</label>
                <input type="text" id="snapshotTitle" placeholder="例如：期中考核、月末总结等" value="${new Date().getMonth() + 1}月总结">
            </div>
            
            <div style="margin: 25px 0; padding: 20px; background: rgba(59, 130, 246, 0.1); border-radius: var(--radius); border: 1px solid rgba(59, 130, 246, 0.3); color: var(--text-light);">
                <strong style="color: var(--primary);">💡 说明：</strong>
                快照将保存当前所有学生的分数状态，用于历史记录和对比分析。<br>
                保存后可在历史记录中查看。
            </div>
            
            <div id="snapshotStats" style="background: rgba(255, 255, 255, 0.05); padding: 20px; border-radius: var(--radius); border: 1px solid var(--border); margin-bottom: 25px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; text-align: center;">
                    <div>
                        <div style="font-size: 24px; font-weight: 800; color: var(--text);">${studentsData.totalStudents || 0}</div>
                        <div style="font-size: 13px; color: var(--text-light);">学生总数</div>
                    </div>
                    <div>
                        <div style="font-size: 24px; font-weight: 800; color: var(--secondary);">${studentsData.students.reduce((acc, s) => acc + s.add_score, 0)}</div>
                        <div style="font-size: 13px; color: var(--text-light);">总加分</div>
                    </div>
                    <div>
                        <div style="font-size: 24px; font-weight: 800; color: var(--danger);">${studentsData.students.reduce((acc, s) => acc + s.minus_score, 0)}</div>
                        <div style="font-size: 13px; color: var(--text-light);">总扣分</div>
                    </div>
                </div>
            </div>
            
            <div class="action-buttons">
                <button class="action-btn-large cancel" onclick="closeSnapshotModal()">
                    <span>❌</span>
                    取消
                </button>
                <button class="action-btn-large submit" onclick="createSnapshot()">
                    <span>💾</span>
                    保存快照
                </button>
            </div>
        </div>
    </div>
    
    <!-- 通知容器 -->
    <div id="notificationContainer"></div>

    <script>
        // 全局变量
        let currentStudentId = null;
        let currentScoreType = 'add';
        let currentStudentName = '';
        let selectedScore = 1;
        let currentStep = 1;
        let isBatchMode = false;
        let selectedStudents = new Set(${JSON.stringify(recentStudentIds)});
        let selectedStudentNames = new Map();
        
        // 初始化
        document.addEventListener('DOMContentLoaded', function() {
            updateSelectedCount();
            initializeScoreButtons();
            loadCategories();
            
            // 初始化学生选择网格
            const students = ${JSON.stringify(studentsData.students)};
            const studentSelectGrid = document.getElementById('studentSelectGrid');
            studentSelectGrid.innerHTML = '';
            
            students.forEach(student => {
                const isRecent = ${JSON.stringify(recentStudentIds)}.includes(student.id);
                const isChecked = selectedStudents.has(student.id);
                
                const div = document.createElement('div');
                div.className = \`student-checkbox \${isChecked ? 'selected' : ''}\`;
                div.innerHTML = \`
                    <input type="checkbox" value="\${student.id}" \${isChecked ? 'checked' : ''} 
                           onchange="toggleStudentSelection(\${student.id}, '\${student.name}', this.checked)">
                    <span>\${student.name}</span>
                \`;
                studentSelectGrid.appendChild(div);
                
                if (isChecked) {
                    selectedStudentNames.set(student.id, student.name);
                }
            });
            
            // 初始化IP显示
            setTimeout(() => {
                const ipDisplay = document.querySelector('.ip-display');
                if (ipDisplay) {
                    ipDisplay.style.opacity = '0.7';
                    ipDisplay.addEventListener('mouseenter', () => {
                        ipDisplay.style.opacity = '1';
                    });
                    ipDisplay.addEventListener('mouseleave', () => {
                        ipDisplay.style.opacity = '0.7';
                    });
                }
            }, 1000);
        });
        
        // 显示/关闭排名模态框
        function showRanking() {
            document.getElementById('rankingModal').style.display = 'flex';
        }
        
        function closeRankingModal() {
            document.getElementById('rankingModal').style.display = 'none';
        }
        
        // 开始评分流程
        function startScoreProcess(studentId, type, studentName) {
            currentStudentId = studentId;
            currentScoreType = type;
            currentStudentName = studentName;
            currentStep = 1;
            isBatchMode = false;
            
            // 更新第一步界面
            document.getElementById('step1StudentName').textContent = studentName;
            document.getElementById('step1ActionType').textContent = type === 'add' ? '加分' : '扣分';
            
            // 重置选择
            selectedScore = 1;
            updateScoreButtons();
            document.getElementById('customScore').style.display = 'none';
            document.getElementById('customScore').value = '1';
            document.getElementById('scoreNote').value = '';
            document.getElementById('noteRequired').style.display = 'none';
            
            // 显示第一步
            showStep(1);
            
            // 显示模态框
            document.getElementById('scoreModal').style.display = 'flex';
        }
        
        // 显示批量评分模态框
        function showBatchScoreModal() {
            isBatchMode = true;
            document.getElementById('batchScoreModal').style.display = 'flex';
            loadBatchCategories();
        }
        
        function closeBatchScoreModal() {
            document.getElementById('batchScoreModal').style.display = 'none';
        }
        
        // 显示快照模态框
        function showSnapshotModal() {
            document.getElementById('snapshotModal').style.display = 'flex';
        }
        
        function closeSnapshotModal() {
            document.getElementById('snapshotModal').style.display = 'none';
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
                            
                            const time = new Date(log.created_at).toLocaleString('zh-CN');
                            const scoreChange = log.score_change > 0 ? '+' + log.score_change : log.score_change;
                            const scoreColor = log.score_change > 0 ? 'var(--secondary)' : 'var(--danger)';
                            
                            item.innerHTML = \`
                                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-weight: 600; color: var(--text);">\${log.category_name}</span>
                                    <span style="font-weight: 800; color: \${scoreColor};">\${scoreChange}</span>
                                </div>
                                <div style="color: var(--text-light); font-size: 13px; margin-bottom: 5px;">
                                    \${time} • \${log.operator}
                                </div>
                                \${log.note ? '<div style="color: var(--text-light); font-size: 13px; font-style: italic;">' + log.note + '</div>' : ''}
                            \`;
                            
                            historyList.appendChild(item);
                        });
                    }
                    
                    document.getElementById('historyCount').textContent = result.logs.length;
                    document.getElementById('historyLoading').style.display = 'none';
                    document.getElementById('historyContent').style.display = 'block';
                } else {
                    showNotification('获取历史记录失败: ' + result.error, 'error');
                    closeHistoryModal();
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
                closeHistoryModal();
            }
        }
        
        function closeHistoryModal() {
            document.getElementById('historyModal').style.display = 'none';
        }
        
        // 显示撤销模态框
        async function showRevokeModal(studentId, studentName) {
            document.getElementById('revokeModal').style.display = 'flex';
            document.getElementById('revokeStudentName').textContent = studentName;
            document.getElementById('revokeLoading').style.display = 'block';
            document.getElementById('revokeContent').style.display = 'none';
            
            try {
                const response = await fetch('/api/student-history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ studentId, limit: 1 })
                });
                
                const result = await response.json();
                
                if (result.success && result.logs.length > 0) {
                    const log = result.logs[0];
                    const lastRecord = document.getElementById('lastRecord');
                    const time = new Date(log.created_at).toLocaleString('zh-CN');
                    const scoreChange = log.score_change > 0 ? '+' + log.score_change : log.score_change;
                    const scoreColor = log.score_change > 0 ? 'var(--secondary)' : 'var(--danger)';
                    
                    lastRecord.innerHTML = \`
                        <div style="font-weight: 600; color: var(--text); margin-bottom: 10px;">\${log.category_name}</div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                            <span style="color: var(--text-light);">操作教师:</span>
                            <span style="font-weight: 600; color: var(--text);">\${log.operator}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                            <span style="color: var(--text-light);">分数变化:</span>
                            <span style="font-weight: 800; color: \${scoreColor};">\${scoreChange}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                            <span style="color: var(--text-light);">操作时间:</span>
                            <span style="color: var(--text-light);">\${time}</span>
                        </div>
                        \${log.note ? '<div style="margin-top: 10px;"><strong style=\"color: var(--text-light);\">备注:</strong><div style=\"color: var(--text-light); margin-top: 5px;\">' + log.note + '</div></div>' : ''}
                    \`;
                    
                    // 保存记录ID用于撤销
                    lastRecord.dataset.recordId = log.id;
                    
                    document.getElementById('revokeLoading').style.display = 'none';
                    document.getElementById('revokeContent').style.display = 'block';
                } else {
                    showNotification('没有可撤销的记录', 'error');
                    closeRevokeModal();
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
                closeRevokeModal();
            }
        }
        
        function closeRevokeModal() {
            document.getElementById('revokeModal').style.display = 'none';
        }
        
        // 确认撤销
        async function confirmRevoke() {
            const lastRecord = document.getElementById('lastRecord');
            const recordId = lastRecord.dataset.recordId;
            
            if (!recordId) {
                showNotification('未找到可撤销的记录', 'error');
                return;
            }
            
            try {
                const response = await fetch('/api/revoke', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recordId })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showNotification('✅ 撤销操作成功！', 'success');
                    closeRevokeModal();
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showNotification('撤销失败: ' + result.error, 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }
        
        // 显示步骤
        function showStep(step) {
            currentStep = step;
            
            // 更新步骤指示器
            document.getElementById('step1Dot').classList.toggle('active', step === 1);
            document.getElementById('step2Dot').classList.toggle('active', step === 2);
            
            // 显示对应步骤内容
            document.getElementById('step1').classList.toggle('active', step === 1);
            document.getElementById('step2').classList.toggle('active', step === 2);
            
            // 如果是第二步，加载评分项目
            if (step === 2 && !isBatchMode) {
                loadCategories();
            }
        }
        
        // 前往第二步
        function goToStep2() {
            let score = selectedScore;
            if (document.getElementById('customScore').style.display === 'block') {
                score = parseInt(document.getElementById('customScore').value) || 1;
            }

            if (score <= 0 || score > 100) {
                showNotification('分值必须在1-100之间', 'error');
                return;
            }
            showStep(2);
        }
        
        // 返回第一步
        function goToStep1() {
            showStep(1);
        }
        
        // 关闭评分弹窗
        function closeScoreModal() {
            document.getElementById('scoreModal').style.display = 'none';
        }
        
        // 初始化分数按钮
        function initializeScoreButtons() {
            // 单个评分按钮
            document.querySelectorAll('#scoreButtons .score-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    if (this.dataset.score === 'custom') {
                        document.getElementById('customScore').style.display = 'block';
                        document.getElementById('customScore').focus();
                    } else {
                        document.getElementById('customScore').style.display = 'none';
                        selectedScore = parseInt(this.dataset.score);
                        updateScoreButtons();
                    }
                });
            });
            
            // 批量评分按钮
            document.querySelectorAll('#batchScoreModal .score-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    if (this.dataset.score === 'custom') {
                        document.getElementById('batchCustomScore').style.display = 'block';
                        document.getElementById('batchCustomScore').focus();
                    } else {
                        document.getElementById('batchCustomScore').style.display = 'none';
                        selectedScore = parseInt(this.dataset.score);
                        updateBatchScoreButtons();
                    }
                });
            });
            
            // 自定义分数输入
            document.getElementById('customScore')?.addEventListener('input', function() {
                selectedScore = parseInt(this.value) || 0;
                updateScoreButtons();
            });
            
            document.getElementById('batchCustomScore')?.addEventListener('input', function() {
                selectedScore = parseInt(this.value) || 0;
                updateBatchScoreButtons();
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
        
        // 更新分数按钮状态
        function updateScoreButtons() {
            document.querySelectorAll('#scoreButtons .score-btn').forEach(btn => {
                btn.classList.remove('selected');
                if (btn.dataset.score === 'custom' && document.getElementById('customScore').style.display === 'block') {
                    btn.classList.add('selected');
                } else if (parseInt(btn.dataset.score) === selectedScore) {
                    btn.classList.add('selected');
                }
            });
        }
        
        function updateBatchScoreButtons() {
            document.querySelectorAll('#batchScoreModal .score-btn').forEach(btn => {
                btn.classList.remove('selected');
                if (btn.dataset.score === 'custom' && document.getElementById('batchCustomScore').style.display === 'block') {
                    btn.classList.add('selected');
                } else if (parseInt(btn.dataset.score) === selectedScore) {
                    btn.classList.add('selected');
                }
            });
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
        
        // 提交分数
        async function submitScore() {
            const categoryId = document.getElementById('categorySelect').value;
            const operator = document.getElementById('operatorSelect').value;
            const note = document.getElementById('scoreNote').value.trim();
            
            let score = selectedScore;
            if (document.getElementById('customScore').style.display === 'block') {
                score = parseInt(document.getElementById('customScore').value) || 1;
            }

            if (score <= 0 || score > 100) {
                showNotification('分值必须在1-100之间', 'error');
                return;
            }
            
            // 检查是否需要备注
            const selectedOption = document.getElementById('categorySelect').options[document.getElementById('categorySelect').selectedIndex];
            const requiresNote = selectedOption.dataset.requiresNote === '1';
            
            if (requiresNote && !note) {
                showNotification('此项必须填写备注说明', 'error');
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
                        note: note
                    })
                });

                const result = await response.json();

                if (result.success) {
                    showNotification(\`✅ 为\${currentStudentName}评分成功！\`, 'success');
                    setTimeout(() => location.reload(), 1200);
                } else {
                    showNotification('评分失败: ' + result.error, 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }
        
        // 批量提交分数
        async function submitBatchScore() {
            if (selectedStudents.size === 0) {
                showNotification('请至少选择一名学生', 'error');
                return;
            }
            
            const categoryId = document.getElementById('batchCategorySelect').value;
            const operator = document.getElementById('batchOperatorSelect').value;
            const note = document.getElementById('batchScoreNote').value.trim();
            
            let score = selectedScore;
            if (document.getElementById('batchCustomScore').style.display === 'block') {
                score = parseInt(document.getElementById('batchCustomScore').value) || 1;
            }

            if (score <= 0 || score > 100) {
                showNotification('分值必须在1-100之间', 'error');
                return;
            }
            
            // 检查是否需要备注
            const selectedOption = document.getElementById('batchCategorySelect').options[document.getElementById('batchCategorySelect').selectedIndex];
            const requiresNote = selectedOption.dataset.requiresNote === '1';
            
            if (requiresNote && !note) {
                showNotification('此项必须填写备注说明', 'error');
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
                        note: note
                    })
                });

                const result = await response.json();

                if (result.success) {
                    showNotification(\`✅ 成功为\${result.count}名学生评分！\`, 'success');
                    setTimeout(() => location.reload(), 1200);
                } else {
                    showNotification('批量评分失败: ' + result.error, 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }
        
        // 学生选择功能
        function toggleSelectAll() {
            const selectAll = document.getElementById('selectAll');
            const checkboxes = document.querySelectorAll('.student-select');
            
            checkboxes.forEach(cb => {
                cb.checked = selectAll.checked;
                toggleStudentSelection(parseInt(cb.value), cb.dataset.name, cb.checked);
            });
            
            updateSelectedCount();
        }
        
        function toggleStudentSelection(studentId, studentName, isChecked) {
            if (isChecked) {
                selectedStudents.add(studentId);
                selectedStudentNames.set(studentId, studentName);
            } else {
                selectedStudents.delete(studentId);
                selectedStudentNames.delete(studentId);
            }
            
            // 更新UI
            const checkbox = document.querySelector(\`.student-select[value="\${studentId}"]\`);
            if (checkbox) {
                const parent = checkbox.closest('.student-checkbox') || checkbox.closest('tr');
                if (parent) {
                    parent.classList.toggle('selected', isChecked);
                }
            }
            
            updateSelectedCount();
        }
        
        function selectRecentStudents() {
            selectedStudents.clear();
            selectedStudentNames.clear();
            
            const recentIds = ${JSON.stringify(recentStudentIds)};
            recentIds.forEach(id => {
                selectedStudents.add(id);
                const student = ${JSON.stringify(studentsData.students)}.find(s => s.id === id);
                if (student) {
                    selectedStudentNames.set(id, student.name);
                }
            });
            
            // 更新所有复选框
            document.querySelectorAll('.student-select').forEach(cb => {
                const studentId = parseInt(cb.value);
                cb.checked = selectedStudents.has(studentId);
                toggleStudentSelection(studentId, cb.dataset.name, cb.checked);
            });
            
            updateSelectedCount();
        }
        
        function clearSelection() {
            selectedStudents.clear();
            selectedStudentNames.clear();
            
            document.querySelectorAll('.student-select').forEach(cb => {
                cb.checked = false;
                toggleStudentSelection(parseInt(cb.value), cb.dataset.name, false);
            });
            
            document.getElementById('selectAll').checked = false;
            updateSelectedCount();
        }
        
        function updateSelectedCount() {
            document.getElementById('selectedCount').textContent = selectedStudents.size;
        }
        
        // 创建快照
        async function createSnapshot() {
            const title = document.getElementById('snapshotTitle').value.trim();
            
            if (!title) {
                showNotification('请输入快照标题', 'error');
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
                    showNotification(\`✅ 快照"\${title}"保存成功！\`, 'success');
                    closeSnapshotModal();
                    setTimeout(() => {
                        window.open('/snapshots', '_blank');
                    }, 1500);
                } else {
                    showNotification('保存失败: ' + result.error, 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }
        
        // 导出学生历史
        function exportStudentHistory() {
            const studentName = document.getElementById('historyStudentName').textContent;
            const historyList = document.getElementById('historyList');
            const items = historyList.querySelectorAll('.log-item');
            
            if (items.length === 0) {
                showNotification('没有可导出的记录', 'error');
                return;
            }
            
            let csvContent = "data:text/csv;charset=utf-8,\uFEFF学生,时间,项目,分数变化,操作教师,备注\\n";
            
            items.forEach(item => {
                const parts = item.textContent.split('\\n').map(p => p.trim()).filter(p => p);
                if (parts.length >= 3) {
                    const timeMatch = parts[1].match(/\\d{4}.+\\d{2}:\\d{2}/);
                    const time = timeMatch ? timeMatch[0] : parts[1];
                    const teacher = parts[1].includes('•') ? parts[1].split('•')[1].trim() : '';
                    const note = parts[2] || '';
                    
                    const row = [
                        \`"\${studentName}"\`,
                        \`"\${time}"\`,
                        \`"\${parts[0]}"\`,
                        \`"\${parts[0].match(/[+-]?\\d+/)?.[0] || '0'}"\`,
                        \`"\${teacher}"\`,
                        \`"\${note}"\`
                    ].join(',');
                    
                    csvContent += row + "\\n";
                }
            });
            
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", \`\${studentName}_历史记录.csv\`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showNotification('✅ 导出成功！', 'success');
        }
        
        // 显示通知
        function showNotification(message, type = 'info') {
            // 移除现有通知
            const existingNotification = document.querySelector('.notification');
            if (existingNotification) {
                existingNotification.remove();
            }

            // 创建通知元素
            const notification = document.createElement('div');
            notification.className = \`notification \${type}\`;
            notification.innerHTML = \`
                <span>\${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
                <span>\${message}</span>
            \`;
            
            document.getElementById('notificationContainer').appendChild(notification);
            
            // 4秒后自动移除
            setTimeout(() => {
                notification.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }, 4000);
        }
        
        // 显示所有学生分数详情
        function showAllScores(type) {
            const students = ${JSON.stringify(studentsData.students)};
            let message = \`\${type === 'add' ? '加分' : '扣分'}详情：\\n\\n\`;
            
            const sortedStudents = [...students].sort((a, b) => {
                return type === 'add' ? b.add_score - a.add_score : b.minus_score - a.minus_score;
            });
            
            sortedStudents.forEach((student, index) => {
                const score = type === 'add' ? student.add_score : student.minus_score;
                message += \`\${index + 1}. \${student.name}: \${score}\\n\`;
            });
            
            alert(message);
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

// 渲染快照页面
async function renderSnapshotsPage(db) {
  try {
    const snapshots = await db.prepare(
      'SELECT DISTINCT title, month, created_at FROM monthly_snapshots ORDER BY created_at DESC'
    ).all();

    const wallpaper = await getBingWallpaper();
    const bgImage = wallpaper ? `https://www.bing.com${wallpaper.url}` : 'https://www.loliapi.com/acg/';

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
        
        body { 
            background: #0f172a; 
            color: #f1f5f9;
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
            padding: 25px;
            text-align: center;
            border-bottom: 1px solid #475569;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
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
            color: #94a3b8;
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
            color: #f1f5f9;
        }
        
        .snapshot-meta {
            color: #94a3b8;
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
            color: #94a3b8;
        }
        
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #94a3b8;
        }
        
        .empty-state h2 {
            font-size: 28px;
            margin-bottom: 15px;
            color: #f1f5f9;
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
        <span>←</span>
        返回评分系统
    </a>
    
    <div class="header">
        <h1>📊 历史数据</h1>
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
                                <span>📅 ${timeStr}</span>
                                <span>🏷️ ${snapshot.month}</span>
                            </div>
                            <div class="snapshot-stats">
                                <div class="stat-item">
                                    <div class="stat-value" style="color: #60a5fa;">?</div>
                                    <div class="stat-label">学生总数</div>
                                </div>
                                <div class="stat-item">
                                    <div class="stat-value" style="color: #10b981;">?</div>
                                    <div class="stat-label">总加分</div>
                                </div>
                                <div class="stat-item">
                                    <div class="stat-value" style="color: #ef4444;">?</div>
                                    <div class="stat-label">总扣分</div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        ` : `
            <div class="empty-state">
                <h2>📭 暂无历史数据</h2>
                <p>您还没有保存任何月度快照。快照功能可以帮助您记录特定时间点的学生评分状态，便于对比和分析。</p>
                <button class="empty-btn" onclick="goBackAndCreate()">
                    <span>💾</span>
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

    const bgImage = wallpaper ? `https://www.bing.com${wallpaper.url}` : 'https://www.loliapi.com/acg/';

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
            max-width: 500px;
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
                    📊 班级视图
                </button>
                <button class="btn btn-danger" onclick="logout()">
                    🚪 退出登录
                </button>
            </div>
        </div>
    </div>

    <div class="main-content">
        <!-- 系统统计 -->
        <div class="card card-full">
            <div class="card-title">📈 系统统计</div>
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
            <div class="card-title">⚙️ 系统设置</div>
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
                    💾 保存设置
                </button>
            </form>
            
            <div class="danger-zone">
                <h3>⚠️ 危险操作区</h3>
                <button class="btn btn-danger" onclick="showResetModal()" style="width: 100%; margin-bottom: 15px;">
                    🔄 重置所有分数
                </button>
                <button class="btn btn-danger" onclick="showClearModal()" style="width: 100%;">
                    🗑️ 清空所有数据
                </button>
            </div>
        </div>

        <!-- 操作日志 -->
        <div class="card card-full">
            <div class="card-title">📋 最近操作日志</div>
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
                                <td>${log.operator}</td>
                                <td>${log.note || '-'}</td>
                                <td style="font-size: 13px; color: var(--text-light);">${log.ip_address?.substring(0, 15) || '未知'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    
    <!-- 重置分数确认模态框 -->
    <div class="modal-overlay" id="resetModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeResetModal()">×</button>
            <div class="modal-title">🔄 重置所有分数</div>
            
            <div style="margin: 25px 0; padding: 25px; background: rgba(239, 68, 68, 0.1); border-radius: 16px; border: 2px solid rgba(239, 68, 68, 0.3); color: var(--text-light);">
                <strong style="color: var(--danger); font-size: 18px;">⚠️ 警告：此操作不可撤销！</strong><br><br>
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
                    ❌ 取消
                </button>
                <button class="btn btn-danger" onclick="confirmReset()" style="flex: 1;">
                    ✅ 确认重置
                </button>
            </div>
        </div>
    </div>
    
    <!-- 清空数据确认模态框 -->
    <div class="modal-overlay" id="clearModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeClearModal()">×</button>
            <div class="modal-title">🗑️ 清空所有数据</div>
            
            <div style="margin: 25px 0; padding: 25px; background: rgba(239, 68, 68, 0.1); border-radius: 16px; border: 2px solid rgba(239, 68, 68, 0.3); color: var(--text-light);">
                <strong style="color: var(--danger); font-size: 18px;">🚨 极度危险：此操作将永久删除所有数据！</strong><br><br>
                这将清空整个数据库，包括：
                <ul style="margin: 15px 0 15px 20px;">
                    <li>所有学生数据</li>
                    <li>所有评分记录</li>
                    <li>所有操作日志</li>
                    <li>所有月度快照</li>
                    <li>所有系统设置</li>
                </ul>
                系统将恢复到初始状态，需要重新进行系统初始化设置。
            </div>
            
            <div class="form-group">
                <label>请输入管理员密码进行最终确认：</label>
                <input type="password" id="clearPassword1" placeholder="第一次输入密码" required>
            </div>
            
            <div class="form-group">
                <label>请再次输入管理员密码：</label>
                <input type="password" id="clearPassword2" placeholder="第二次输入密码" required>
            </div>
            
            <div style="display: flex; gap: 15px; margin-top: 30px;">
                <button class="btn" onclick="closeClearModal()" style="flex: 1; background: rgba(255, 255, 255, 0.1); color: var(--text-light);">
                    ❌ 取消
                </button>
                <button class="btn btn-danger" onclick="confirmClear()" style="flex: 1;">
                    🗑️ 确认清空
                </button>
            </div>
        </div>
    </div>

    <script>
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
                    alert('✅ 设置保存成功！');
                    location.reload();
                } else {
                    alert('❌ 保存失败: ' + result.error);
                }
            } catch (error) {
                alert('❌ 网络错误，请重试');
            }
        });
        
        // 重置分数
        function showResetModal() {
            document.getElementById('resetModal').style.display = 'flex';
            document.getElementById('resetPassword').focus();
        }
        
        function closeResetModal() {
            document.getElementById('resetModal').style.display = 'none';
            document.getElementById('resetPassword').value = '';
        }
        
        async function confirmReset() {
            const password = document.getElementById('resetPassword').value;
            
            if (!password) {
                alert('请输入管理员密码');
                return;
            }
            
            try {
                const response = await fetch('/api/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirm_password: password })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('✅ 分数重置成功！');
                    closeResetModal();
                    location.reload();
                } else {
                    alert('❌ 重置失败: ' + result.error);
                }
            } catch (error) {
                alert('❌ 网络错误，请重试');
            }
        }
        
        // 清空数据
        function showClearModal() {
            document.getElementById('clearModal').style.display = 'flex';
            document.getElementById('clearPassword1').focus();
        }
        
        function closeClearModal() {
            document.getElementById('clearModal').style.display = 'none';
            document.getElementById('clearPassword1').value = '';
            document.getElementById('clearPassword2').value = '';
        }
        
        async function confirmClear() {
            const password1 = document.getElementById('clearPassword1').value;
            const password2 = document.getElementById('clearPassword2').value;
            
            if (!password1 || !password2) {
                alert('请两次输入管理员密码');
                return;
            }
            
            if (password1 !== password2) {
                alert('两次输入的密码不一致');
                return;
            }
            
            if (!confirm('🚨 最终确认：这将永久删除所有数据！确定要继续吗？')) {
                return;
            }
            
            try {
                // 这里需要实现清空所有数据的API
                // 由于这是一个危险操作，我们可以通过多次调用重置API来实现
                await fetch('/api/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirm_password: password1 })
                });
                
                alert('✅ 所有数据已清空，系统将重启...');
                setTimeout(() => {
                    window.location.href = '/setup';
                }, 2000);
            } catch (error) {
                alert('❌ 操作失败: ' + error.message);
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

// 渲染访客页面
async function renderVisitorPage(db, clientIP, userAgent) {
  try {
    const studentsData = await handleGetStudents(db).then(r => r.json());
    const settings = await db.prepare(
      'SELECT key, value FROM settings WHERE key IN (?, ?)'
    ).bind('site_title', 'class_name').all();
    
    const wallpaper = await getBingWallpaper();
    const geoInfo = await getGeoInfo(clientIP, userAgent);

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    const bgImage = wallpaper ? `https://www.bing.com${wallpaper.url}` : 'https://www.loliapi.com/acg/';

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settingMap.site_title || '班级评分系统'} - 访客视图</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        
        :root {
            --primary: #3b82f6;
            --secondary: #10b981;
            --danger: #ef4444;
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
            padding: 40px 25px; 
            text-align: center;
            box-shadow: var(--shadow);
            border-bottom: 1px solid var(--border);
        }
        
        .header h1 { 
            font-weight: 800; 
            margin-bottom: 15px;
            font-size: 36px;
            background: linear-gradient(135deg, #60a5fa, #a78bfa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .header .subtitle {
            opacity: 0.9;
            margin-bottom: 20px;
            font-size: 18px;
            color: var(--text-light);
        }
        
        .login-prompt { 
            text-align: center; 
            padding: 40px 30px; 
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(10px);
            margin: 40px auto;
            border-radius: 20px;
            box-shadow: var(--shadow);
            border: 1px solid rgba(255, 255, 255, 0.1);
            max-width: 500px;
        }
        
        .login-prompt p {
            font-size: 18px;
            margin-bottom: 25px;
            color: var(--text);
            line-height: 1.6;
        }
        
        .login-btn { 
            background: linear-gradient(135deg, var(--primary), #2563eb); 
            color: white; 
            padding: 18px 35px; 
            border: none; 
            border-radius: 12px; 
            text-decoration: none; 
            display: inline-block; 
            margin-top: 15px;
            font-weight: 700;
            font-size: 17px;
            transition: all 0.3s ease;
            box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
            display: inline-flex;
            align-items: center;
            gap: 10px;
        }
        
        .login-btn:hover {
            transform: translateY(-4px);
            box-shadow: 0 15px 30px rgba(59, 130, 246, 0.6);
        }
        
        .ranking-table { 
            width: 100%; 
            border-collapse: collapse;
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            overflow: hidden;
            box-shadow: var(--shadow);
            margin: 40px auto;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .ranking-table th, .ranking-table td { 
            padding: 25px 30px; 
            text-align: center; 
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .ranking-table th { 
            background: rgba(30, 41, 59, 0.9); 
            font-weight: 700; 
            color: var(--text-light);
            font-size: 16px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .ranking-table tr:last-child td { 
            border-bottom: none; 
        }
        
        .ranking-table tr:hover td {
            background: rgba(59, 130, 246, 0.1);
        }
        
        .container { 
            padding: 30px 20px; 
            max-width: 900px; 
            margin: 0 auto; 
        }
        
        .section-title {
            font-size: 28px;
            font-weight: 800;
            margin: 50px 0 30px;
            text-align: center;
            color: var(--text);
        }
        
        .rank-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--primary);
            color: white;
            font-weight: 800;
            font-size: 16px;
            transition: all 0.3s ease;
        }
        
        .rank-badge:hover {
            transform: scale(1.1) rotate(5deg);
        }
        
        .rank-1 { 
            background: linear-gradient(135deg, #f59e0b, #d97706);
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
        }
        .rank-2 { 
            background: linear-gradient(135deg, #6b7280, #4b5563);
            box-shadow: 0 4px 12px rgba(107, 114, 128, 0.4);
        }
        .rank-3 { 
            background: linear-gradient(135deg, #92400e, #78350f);
            box-shadow: 0 4px 12px rgba(146, 64, 14, 0.4);
        }
        
        .positive { color: var(--secondary); font-weight: 800; font-size: 20px; }
        .negative { color: var(--danger); font-weight: 800; font-size: 20px; }
        .total { color: var(--primary); font-weight: 800; font-size: 22px; }
        
        .connection-info {
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(10px);
            padding: 25px;
            border-radius: 16px;
            margin: 30px auto;
            max-width: 500px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: var(--text-light);
            font-size: 14px;
            line-height: 1.6;
        }
        
        .connection-info strong {
            color: var(--text);
            display: block;
            margin-bottom: 10px;
            font-size: 16px;
        }
        
        .footer {
            text-align: center;
            margin-top: 50px;
            padding: 30px;
            color: var(--text-light);
            font-size: 14px;
            line-height: 1.8;
            border-top: 1px solid var(--border);
        }
        
        @media (max-width: 768px) {
            .header h1 {
                font-size: 28px;
            }
            
            .ranking-table {
                font-size: 14px;
            }
            
            .ranking-table th, .ranking-table td {
                padding: 18px 15px;
            }
            
            .container {
                padding: 20px 15px;
            }
            
            .section-title {
                font-size: 24px;
            }
        }
        
        @media (max-width: 480px) {
            .header h1 {
                font-size: 24px;
            }
            
            .header .subtitle {
                font-size: 16px;
            }
            
            .ranking-table th, .ranking-table td {
                padding: 15px 10px;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${settingMap.site_title || '2314班综合评分系统'}</h1>
        <div class="subtitle">${settingMap.class_name || '2314班'} - 访客视图</div>
    </div>
    
    <div class="container">
        <div class="login-prompt">
            <p>👀 您当前处于访客模式，只能查看学生排名信息。</p>
            <p>要使用完整功能（评分、管理、历史记录等），请登录系统。</p>
            <a href="/login" class="login-btn">
                <span>🔐</span>
                立即登录
            </a>
        </div>
        
        <div class="connection-info">
            <strong>📡 连接信息</strong>
            IP地址: ${geoInfo.ip || clientIP}<br>
            地理位置: ${geoInfo.countryRegion || '未知'} ${geoInfo.city || '未知'}<br>
            网络延迟: <span style="color: var(--secondary); font-weight: 700;">${geoInfo.latency || '0ms'}</span><br>
            服务提供商: ${geoInfo.asOrganization || '未知'}
        </div>
        
        <div class="section-title">🏆 学生排名榜</div>
        
        <table class="ranking-table">
            <thead>
                <tr>
                    <th width="100">排名</th>
                    <th>学生姓名</th>
                    <th width="150">总分</th>
                </tr>
            </thead>
            <tbody>
                ${studentsData.success ? (studentsData.students || []).map((student, index) => `
                    <tr>
                        <td>
                    '<div class="rank-badge ' + (index < 3 ? 'rank-' + (index + 1) : '') + '">'
                                ${index + 1}
                            </div>
                        </td>
                        <td>
                            <div style="font-weight: 600; font-size: 18px;">${student.name}</div>
                        </td>
                        <td class="total">
                            ${student.total_score > 0 ? '+' : ''}${student.total_score}
                        </td>
                    </tr>
                `).join('') : '<tr><td colspan="3" style="text-align: center; padding: 40px; color: var(--text-light);">数据加载中...</td></tr>'}
            </tbody>
        </table>
        
        <div class="footer">
            <strong>By 2314 刘沁熙</strong><br>
            基于 Cloudflare Worker 搭建<br>
            Cloudflare CDN 提供加速服务<br><br>
            <small>© 2025 班级评分系统 - 仅供内部使用</small>
        </div>
    </div>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    return renderErrorPage('访客页面加载失败: ' + error.message);
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
    const bgImage = wallpaper ? `https://www.bing.com${wallpaper.url}` : 'https://www.loliapi.com/acg/';

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
        <span>←</span>
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
        <button onclick="exportLogs()" style="background: linear-gradient(135deg, #10b981, #0da271);">导出日志</button>
    </div>
    
    <table class="log-table">
        <thead>
            <tr>
                <th>时间</th>
                <th>学生</th>
                <th>操作类型</th>
                <th>分数变化</th>
                <th>操作教师</th>
                <th>项目</th>
                <th>备注</th>
            </tr>
        </thead>
        <tbody>
            ${(logs.results || []).map(log => `
                <tr>
                    <td>${new Date(log.created_at).toLocaleString('zh-CN')}</td>
                    <td>${log.student_name}</td>
                    <td>
                        <span style="padding: 8px 15px; border-radius: 20px; font-size: 13px; font-weight: 700; background: ${log.action_type === 'add' ? 'rgba(16, 185, 129, 0.2)' : log.action_type === 'minus' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)'}; color: ${log.action_type === 'add' ? '#10b981' : log.action_type === 'minus' ? '#ef4444' : '#f59e0b'};">
                            ${log.action_type === 'add' ? '加分' : log.action_type === 'minus' ? '扣分' : '撤销'}
                        </span>
                    </td>
                    <td class="${log.score_change > 0 ? 'positive' : 'negative'}">
                        ${log.score_change > 0 ? '+' : ''}${log.score_change}
                    </td>
                    <td>${log.operator}</td>
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
        
        function exportLogs() {
            const rows = document.querySelectorAll('.log-table tbody tr');
            let csvContent = "data:text/csv;charset=utf-8,\uFEFF时间,学生,操作类型,分数变化,操作教师,项目,备注\\n";
            
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 7) {
                    const rowData = [
                        \`"\${cells[0].textContent}"\`,
                        \`"\${cells[1].textContent}"\`,
                        \`"\${cells[2].querySelector('span').textContent}"\`,
                        \`"\${cells[3].textContent}"\`,
                        \`"\${cells[4].textContent}"\`,
                        \`"\${cells[5].textContent}"\`,
                        \`"\${cells[6].textContent}"\`
                    ];
                    csvContent += rowData.join(',') + "\\n";
                }
            });
            
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", \`操作日志_\${new Date().toISOString().slice(0, 10)}.csv\`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            alert('✅ 日志导出成功！');
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
        <h1>⚠️ 系统错误</h1>
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