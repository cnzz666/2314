// cloudflare-worker.js - 现代化班级评分系统
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '未知IP';
    const userAgent = request.headers.get('User-Agent') || '未知浏览器';
    
    try {
      // 检查数据库连接
      if (!env.DB) {
        return new Response(JSON.stringify({ 
          error: '数据库连接失败: DB变量未正确绑定',
          details: '请检查D1数据库绑定设置'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 初始化数据库
      const initResult = await initDatabase(env.DB);
      
      // 检查是否需要初始化设置
      if (!initResult.initialized && path !== '/setup' && path !== '/api/setup' && path !== '/health') {
        return Response.redirect(new URL('/setup', request.url));
      }

      // API路由
      if (path.startsWith('/api/')) {
        return await handleAPI(request, env, url, clientIP);
      }

      // 页面路由
      return await handlePages(request, env, url, clientIP, userAgent);
    } catch (error) {
      console.error('Global Error:', error);
      return new Response(JSON.stringify({ 
        error: '服务器错误',
        details: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // 创建评分项表
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS score_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        type TEXT,
        weight INTEGER DEFAULT 1,
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
        month TEXT,
        title TEXT,
        snapshot_data TEXT,
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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT UNIQUE,
        username TEXT,
        role TEXT,
        last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
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
      ['作业完成质量优秀', 'add', 1],
      ['天天练达标', 'add', 1],
      ['准时上课', 'add', 1],
      ['卫生完成优秀', 'add', 1],
      ['行为习惯良好', 'add', 1],
      ['早操出勤', 'add', 1],
      ['上课专注', 'add', 1],
      ['任务完成优秀', 'add', 1],
      ['课堂表现积极', 'add', 1],
      ['帮助同学', 'add', 1],
      
      // 减分项
      ['上课违纪', 'minus', 1],
      ['作业完成质量差', 'minus', 1],
      ['天天练未达标', 'minus', 1],
      ['迟到', 'minus', 1],
      ['卫生未完成', 'minus', 1],
      ['行为习惯差', 'minus', 1],
      ['早操缺勤', 'minus', 1],
      ['上课不专注', 'minus', 1],
      ['未交/拖延作业', 'minus', 1],
      ['破坏课堂纪律', 'minus', 1],
      
      // 其他项
      ['其他（加分）', 'add', 1],
      ['其他（扣分）', 'minus', 1]
    ];

    for (const [name, type, weight] of scoreCategories) {
      try {
        await db.prepare(
          'INSERT OR IGNORE INTO score_categories (name, type, weight) VALUES (?, ?, ?)'
        ).bind(name, type, weight).run();
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
      return await handleLogout(request, env.DB, clientIP);
    } else if (path === '/api/students') {
      return await handleGetStudents(env.DB);
    } else if (path === '/api/score') {
      return await handleAddScore(request, env.DB, clientIP);
    } else if (path === '/api/batch-score') {
      return await handleBatchScore(request, env.DB, clientIP);
    } else if (path === '/api/revoke') {
      return await handleRevokeScore(request, env.DB, clientIP);
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
    } else if (path === '/api/snapshots') {
      return await handleGetSnapshots(env.DB);
    } else if (path === '/api/snapshot-detail') {
      return await handleGetSnapshotDetail(request, env.DB);
    } else if (path === '/api/reset') {
      return await handleReset(request, env.DB, clientIP);
    } else if (path === '/api/settings') {
      if (request.method === 'GET') {
        return await handleGetSettings(env.DB);
      } else if (request.method === 'POST') {
        return await handleUpdateSettings(request, env.DB);
      }
    } else if (path === '/api/student-logs') {
      return await handleGetStudentLogs(request, env.DB);
    } else if (path === '/api/monthly') {
      return await handleGetMonthlyData(request, env.DB);
    } else if (path === '/api/setup') {
      return await handleSetup(request, env.DB);
    } else if (path === '/api/health') {
      return await handleHealthCheck(env.DB);
    } else if (path === '/api/ip-info') {
      return await handleIPInfo();
    } else if (path === '/api/wallpaper') {
      return await handleWallpaper();
    } else if (path === '/api/check-session') {
      return await handleCheckSession(request, env.DB, clientIP);
    } else if (path === '/api/recent-students') {
      return await handleGetRecentStudents(env.DB);
    } else if (path === '/api/verify-admin') {
      return await handleVerifyAdmin(request, env.DB);
    }

    return new Response(JSON.stringify({ error: 'API路径不存在' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ 
      error: 'API处理错误',
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 健康检查
async function handleHealthCheck(db) {
  try {
    await db.prepare('SELECT 1').run();
    return new Response(JSON.stringify({ 
      status: 'healthy',
      database: 'connected'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 获取IP信息
async function handleIPInfo() {
  try {
    const response = await fetch('https://ip.ilqx.dpdns.org/geo');
    if (!response.ok) {
      throw new Error('IP信息获取失败');
    }
    const data = await response.json();
    
    // 转换为中文显示
    const chineseData = {
      ip: data.ip || '未知',
      flag: data.flag || '🌐',
      country: data.country === 'CN' ? '中国' : data.country,
      countryRegion: data.countryRegion || '未知地区',
      city: data.city || '未知城市',
      region: data.region === 'SEA' ? '东南亚' : data.region,
      latitude: data.latitude || '未知',
      longitude: data.longitude || '未知',
      asOrganization: data.asOrganization || '未知组织'
    };
    
    return new Response(JSON.stringify({
      success: true,
      data: chineseData
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 获取壁纸
async function handleWallpaper() {
  try {
    const response = await fetch('https://tc.ilqx.dpdns.org/api/bing/wallpaper');
    if (!response.ok) {
      throw new Error('壁纸获取失败');
    }
    const data = await response.json();
    
    return new Response(JSON.stringify({
      success: true,
      data: data.data
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 检查会话
async function handleCheckSession(request, db, clientIP) {
  try {
    const session = await validateSession(request, db);
    if (session) {
      return new Response(JSON.stringify({
        success: true,
        session
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 检查IP会话
    const ipSession = await db.prepare(
      'SELECT * FROM ip_sessions WHERE ip_address = ?'
    ).bind(clientIP).first();
    
    if (ipSession) {
      return new Response(JSON.stringify({
        success: true,
        session: {
          username: ipSession.username,
          role: ipSession.role
        },
        fromIP: true
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({
      success: false,
      error: '未登录'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { 'Content-Type': 'application/json' }
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
        headers: { 'Content-Type': 'application/json' }
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
      ['current_month', new Date().toISOString().slice(0, 7)]
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
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Setup error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '初始化失败: ' + error.message 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 登录处理
async function handleLogin(request, env, clientIP) {
  try {
    const { username, password } = await request.json();
    
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
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30天
      const cookie = `session=${sessionId}; Path=/; HttpOnly; Expires=${expires.toUTCString()}; SameSite=Lax; Secure`;
      
      // 存储会话信息
      await env.DB.prepare(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
      ).bind(`session_${sessionId}`, JSON.stringify({ 
        username, 
        role, 
        expires: expires.getTime() 
      })).run();
      
      // 存储IP会话
      await env.DB.prepare(
        'INSERT OR REPLACE INTO ip_sessions (ip_address, username, role) VALUES (?, ?, ?)'
      ).bind(clientIP, username, role).run();
      
      return new Response(JSON.stringify({ 
        success: true, 
        role,
        message: '登录成功'
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': cookie
        }
      });
    }

    return new Response(JSON.stringify({ 
      success: false, 
      error: '用户名或密码错误' 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Login error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '登录失败: ' + error.message 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 登出处理
async function handleLogout(request, db, clientIP) {
  try {
    const cookie = 'session=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure';
    
    // 清除IP会话
    await db.prepare('DELETE FROM ip_sessions WHERE ip_address = ?').bind(clientIP).run();
    
    return new Response(JSON.stringify({ 
      success: true,
      message: '登出成功'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookie
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: true,
      message: '登出成功'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'session=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure'
      }
    });
  }
}

// 获取学生数据
async function handleGetStudents(db) {
  try {
    const students = await db.prepare(`
      SELECT s.id, s.name, 
             COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE 0 END), 0) as add_score,
             COALESCE(SUM(CASE WHEN sc.type = 'minus' THEN sr.score ELSE 0 END), 0) as minus_score,
             COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE -sr.score END), 0) as total_score
      FROM students s
      LEFT JOIN score_records sr ON s.id = sr.student_id
      LEFT JOIN score_categories sc ON sr.category_id = sc.id
      GROUP BY s.id, s.name
      ORDER BY total_score DESC
    `).all();

    const studentsArray = students.results || [];

    return new Response(JSON.stringify({
      success: true,
      students: studentsArray
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    console.error('Get students error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取学生数据失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 获取最近评分的学生
async function handleGetRecentStudents(db) {
  try {
    const recentStudents = await db.prepare(`
      SELECT DISTINCT s.id, s.name
      FROM score_records sr
      JOIN students s ON sr.student_id = s.id
      ORDER BY sr.created_at DESC
      LIMIT 10
    `).all();

    return new Response(JSON.stringify({
      success: true,
      students: recentStudents.results || []
    }), {
      headers: { 
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Get recent students error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取最近学生失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 添加分数
async function handleAddScore(request, db, clientIP) {
  try {
    const { studentId, categoryId, score, operator, note, userAgent } = await request.json();
    
    // 验证必需字段
    if (!studentId || !categoryId || !score || !operator) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少必需字段' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 检查是否为"其他"类别，如果是则需要备注
    const category = await db.prepare(
      'SELECT name, type FROM score_categories WHERE id = ?'
    ).bind(categoryId).first();
    
    if (!category) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '评分项目不存在' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if ((category.name.includes('其他') || category.name.includes('自定义')) && (!note || note.trim() === '')) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '自定义评分必须填写备注' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 获取学生姓名
    const student = await db.prepare(
      'SELECT name FROM students WHERE id = ?'
    ).bind(studentId).first();

    if (!student) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '学生不存在' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 插入评分记录
    await db.prepare(
      'INSERT INTO score_records (student_id, category_id, score, operator, note) VALUES (?, ?, ?, ?, ?)'
    ).bind(studentId, categoryId, score, operator, note).run();

    // 记录操作日志
    await db.prepare(
      'INSERT INTO operation_logs (student_id, student_name, action_type, score_change, operator, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(studentId, student.name, category.type, category.type === 'add' ? score : -score, operator, category.name, note, clientIP, userAgent || '未知').run();

    return new Response(JSON.stringify({ 
      success: true,
      message: '评分成功'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Add score error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '评分失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 批量添加分数
async function handleBatchScore(request, db, clientIP) {
  try {
    const { studentIds, categoryId, score, operator, note, userAgent } = await request.json();
    
    // 验证必需字段
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0 || !categoryId || !score || !operator) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少必需字段' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const category = await db.prepare(
      'SELECT name, type FROM score_categories WHERE id = ?'
    ).bind(categoryId).first();
    
    if (!category) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '评分项目不存在' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if ((category.name.includes('其他') || category.name.includes('自定义')) && (!note || note.trim() === '')) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '自定义评分必须填写备注' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 批量插入记录
    for (const studentId of studentIds) {
      const student = await db.prepare(
        'SELECT name FROM students WHERE id = ?'
      ).bind(studentId).first();

      if (student) {
        await db.prepare(
          'INSERT INTO score_records (student_id, category_id, score, operator, note) VALUES (?, ?, ?, ?, ?)'
        ).bind(studentId, categoryId, score, operator, note).run();

        await db.prepare(
          'INSERT INTO operation_logs (student_id, student_name, action_type, score_change, operator, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(studentId, student.name, category.type, category.type === 'add' ? score : -score, operator, category.name, note, clientIP, userAgent || '未知').run();
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: `批量评分成功，共${studentIds.length}名学生`
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Batch score error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '批量评分失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 撤销操作
async function handleRevokeScore(request, db, clientIP) {
  try {
    const { recordId, userAgent } = await request.json();
    
    if (!recordId) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少记录ID' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 获取要撤销的记录
    const record = await db.prepare(`
      SELECT sr.id, sr.student_id, sr.score, sc.type, sc.name as category_name, sr.operator, sr.note, s.name as student_name
      FROM score_records sr
      JOIN score_categories sc ON sr.category_id = sc.id
      JOIN students s ON sr.student_id = s.id
      WHERE sr.id = ?
    `).bind(recordId).first();

    if (!record) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '记录不存在' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 删除记录
    await db.prepare('DELETE FROM score_records WHERE id = ?').bind(recordId).run();

    // 记录撤销日志
    await db.prepare(
      'INSERT INTO operation_logs (student_id, student_name, action_type, score_change, operator, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(record.student_id, record.student_name, 'revoke', record.type === 'add' ? -record.score : record.score, 
           record.operator, `撤销: ${record.category_name}`, '撤销操作', clientIP, userAgent || '未知').run();

    return new Response(JSON.stringify({ 
      success: true,
      message: '撤销成功'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Revoke score error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '撤销失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
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
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get tasks error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取任务失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
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
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.prepare(
      'INSERT INTO tasks (title, content, deadline, created_by) VALUES (?, ?, ?, ?)'
    ).bind(title, content, deadline, created_by).run();

    return new Response(JSON.stringify({ 
      success: true,
      message: '任务发布成功'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Add task error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '发布任务失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
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
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();

    return new Response(JSON.stringify({ 
      success: true,
      message: '任务删除成功'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Delete task error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '删除任务失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
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
        headers: { 'Content-Type': 'application/json' }
      });
    }

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

    const snapshotData = {
      title,
      timestamp: new Date().toISOString(),
      students: students.results || []
    };

    // 保存快照
    await db.prepare(
      'INSERT INTO monthly_snapshots (month, title, snapshot_data) VALUES (?, ?, ?)'
    ).bind(new Date().toISOString().slice(0, 7), title, JSON.stringify(snapshotData)).run();

    return new Response(JSON.stringify({ 
      success: true,
      message: '快照保存成功'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Snapshot error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '保存快照失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 获取快照列表
async function handleGetSnapshots(db) {
  try {
    const snapshots = await db.prepare(
      'SELECT id, month, title, created_at FROM monthly_snapshots ORDER BY created_at DESC'
    ).all();

    return new Response(JSON.stringify({
      success: true,
      snapshots: snapshots.results || []
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get snapshots error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取快照列表失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 获取快照详情
async function handleGetSnapshotDetail(request, db) {
  try {
    const { id } = Object.fromEntries(new URL(request.url).searchParams);
    
    if (!id) {
      return new Response(JSON.stringify({ 
        success: false,
        error: '缺少快照ID' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const snapshot = await db.prepare(
      'SELECT * FROM monthly_snapshots WHERE id = ?'
    ).bind(id).first();

    if (!snapshot) {
      return new Response(JSON.stringify({ 
        success: false,
        error: '快照不存在' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      snapshot
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get snapshot detail error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取快照详情失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 重置分数
async function handleReset(request, db, clientIP) {
  try {
    const { adminUsername, adminPassword, confirm } = await request.json();
    
    // 验证管理员身份
    const settings = await db.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).bind('admin_password').first();
    
    if (adminUsername !== '2314admin' || adminPassword !== (settings ? settings.value : '')) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '管理员验证失败' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (confirm !== '确认清除所有数据') {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '确认文本不正确' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.prepare('DELETE FROM score_records').run();
    await db.prepare('DELETE FROM operation_logs').run();

    // 记录重置操作
    await db.prepare(
      'INSERT INTO operation_logs (student_id, student_name, action_type, score_change, operator, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(0, '系统', 'reset', 0, '管理员', '系统重置', '清除所有评分数据', clientIP, '系统操作').run();

    return new Response(JSON.stringify({ 
      success: true,
      message: '分数重置成功'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Reset error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '重置失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
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
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取设置失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
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
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Update settings error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '更新设置失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 获取学生操作日志
async function handleGetStudentLogs(request, db) {
  try {
    const { studentId } = Object.fromEntries(new URL(request.url).searchParams);
    
    if (!studentId) {
      return new Response(JSON.stringify({ 
        success: false,
        error: '缺少学生ID' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const logs = await db.prepare(`
      SELECT * FROM operation_logs 
      WHERE student_id = ? 
      ORDER BY created_at DESC 
      LIMIT 100
    `).bind(studentId).all();

    return new Response(JSON.stringify({
      success: true,
      logs: logs.results || []
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get logs error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取日志失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 获取月度数据
async function handleGetMonthlyData(request, db) {
  try {
    const months = await db.prepare(
      'SELECT DISTINCT month FROM monthly_snapshots ORDER BY month DESC'
    ).all();

    return new Response(JSON.stringify({
      success: true,
      months: (months.results || []).map(m => m.month)
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get monthly data error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取月度数据失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 验证管理员
async function handleVerifyAdmin(request, db) {
  try {
    const { username, password } = await request.json();
    
    const settings = await db.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).bind('admin_password').first();
    
    if (username === '2314admin' && password === (settings ? settings.value : '')) {
      return new Response(JSON.stringify({ 
        success: true,
        message: '验证成功'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: '管理员验证失败' 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Verify admin error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '验证失败: ' + error.message 
    }), {
      headers: { 'Content-Type': 'application/json' }
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
      return await renderLoginPage(env.DB, request);
    } else if (path === '/class') {
      return await renderClassPage(env.DB, request, clientIP, userAgent);
    } else if (path === '/admin') {
      return await renderAdminPage(env.DB, request, clientIP, userAgent);
    } else if (path === '/') {
      return await renderVisitorPage(env.DB);
    } else if (path === '/setup') {
      return renderSetupPage();
    } else if (path === '/health') {
      return await handleHealthCheck(env.DB);
    } else if (path === '/snapshots') {
      return await renderSnapshotsPage(env.DB, request);
    } else if (path === '/snapshot-detail') {
      return await renderSnapshotDetailPage(env.DB, url);
    }

    return await renderLoginPage(env.DB, request);
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
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', sans-serif; }
        body { background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem; }
        .error-container { background: white; padding: 3rem; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
        h1 { color: #ef4444; margin-bottom: 1rem; }
        p { color: #64748b; margin-bottom: 2rem; line-height: 1.6; }
        .btn { background: #6366f1; color: white; padding: 1rem 2rem; border: none; border-radius: 12px; text-decoration: none; display: inline-block; }
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
        html, body { 
            height: 100%; 
            margin: 0; 
            overflow: auto; 
            background-color: #e0f7fa;
            font-family: 'Roboto', Arial, sans-serif;
        }
        
        body { 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center; 
            min-height: 100vh; 
            color: #333333;
            background-image: url('https://www.loliapi.com/acg/');
            background-size: cover; 
            background-position: center; 
            background-repeat: no-repeat;
            position: relative;
        }
        
        .setup-container {
            text-align: center; 
            max-width: 90%;
            padding: 30px; 
            background-color: rgba(255, 255, 255, 0.3);
            border-radius: 15px; 
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            transform: scale(0.5);
            opacity: 0.5;
            filter: blur(10px);
            transition: transform 1s ease-out, opacity 1s ease-out, filter 1s ease-out;
        }
        
        .setup-container.loaded {
            transform: scale(1);
            opacity: 1;
            filter: blur(0);
        }
        
        h1 { 
            font-size: 2.5rem; 
            margin-bottom: 20px; 
            color: #0277bd;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
        }
        
        .form-group {
            margin: 15px auto;
            text-align: left;
            width: 80%;
            max-width: 300px;
        }
        
        label {
            display: block;
            margin-bottom: 5px;
            color: #333;
            font-weight: bold;
        }
        
        input { 
            margin: 5px auto;
            padding: 12px 20px; 
            font-size: 16px; 
            border-radius: 25px; 
            outline: none; 
            display: block; 
            width: 100%;
            transition: all 0.3s ease;
            background-color: rgba(255, 255, 255, 0.5);
            border: 1px solid rgba(79, 195, 247, 0.5);
            color: #333333;
            text-align: center;
        }
        
        input:focus { 
            background-color: rgba(255, 255, 255, 0.7); 
            border-color: #0277bd; 
            box-shadow: 0 0 10px rgba(79, 195, 247, 0.3);
        }
        
        button { 
            margin: 15px auto; 
            padding: 12px 20px; 
            font-size: 16px; 
            border-radius: 25px; 
            outline: none; 
            display: block; 
            width: 80%;
            max-width: 300px;
            transition: all 0.3s ease;
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            border: none; 
            color: #333333; 
            cursor: pointer; 
            font-weight: bold; 
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        button:hover { 
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
        
        #message {
            margin-top: 20px;
            color: #d32f2f;
            font-weight: bold;
        }
        
        @media (max-width: 768px) {
            .setup-container {
                max-width: 95%;
                padding: 20px;
            }
            
            h1 {
                font-size: 1.8rem;
            }
            
            input, button {
                width: 90%;
                font-size: 14px;
                padding: 10px;
            }
        }
    </style>
</head>
<body>
    <div class="setup-container" id="setupContainer">
        <h1>系统初始化</h1>
        <p>欢迎使用班级评分系统！请先完成系统初始化设置。</p>
        
        <div class="form-group">
            <label>网站标题：</label>
            <input type="text" id="site_title" placeholder="网站标题" value="2314班综合评分系统" required>
        </div>
        
        <div class="form-group">
            <label>班级名称：</label>
            <input type="text" id="class_name" placeholder="班级名称" value="2314班" required>
        </div>
        
        <div class="form-group">
            <label>班级登录用户名：</label>
            <input type="text" id="class_username" placeholder="班级登录用户名" value="2314" required>
        </div>
        
        <div class="form-group">
            <label>班级登录密码：</label>
            <input type="password" id="class_password" placeholder="班级登录密码" value="hzwy2314" required>
        </div>
        
        <div class="form-group">
            <label>管理员用户名：</label>
            <input type="text" id="admin_username" placeholder="管理员用户名" value="2314admin" required>
        </div>
        
        <div class="form-group">
            <label>管理员密码：</label>
            <input type="password" id="admin_password" placeholder="管理员密码" value="2314admin2314admin" required>
        </div>
        
        <button onclick="submitSetup()">初始化系统</button>
        
        <div id="message"></div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            var container = document.getElementById('setupContainer');
            setTimeout(function() {
                container.classList.add('loaded');
            }, 100);
        });

        async function submitSetup() {
            const formData = {
                site_title: document.getElementById('site_title').value,
                class_name: document.getElementById('class_name').value,
                class_username: document.getElementById('class_username').value,
                class_password: document.getElementById('class_password').value,
                admin_username: document.getElementById('admin_username').value,
                admin_password: document.getElementById('admin_password').value
            };

            const submitBtn = document.querySelector('button');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = '初始化中...';
            submitBtn.disabled = true;

            try {
                const response = await fetch('/api/setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                const result = await response.json();
                
                if (result.success) {
                    submitBtn.textContent = '初始化成功!';
                    setTimeout(() => {
                        window.location.href = '/login';
                    }, 1000);
                } else {
                    document.getElementById('message').textContent = result.error || '初始化失败';
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            } catch (error) {
                document.getElementById('message').textContent = '网络错误，请重试';
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        }
    </script>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 渲染登录页面
async function renderLoginPage(db, request) {
  try {
    // 检查是否有现有会话
    const session = await validateSession(request, db);
    if (session) {
      if (session.role === 'class') {
        return Response.redirect(new URL('/class', request.url));
      } else if (session.role === 'admin') {
        return Response.redirect(new URL('/admin', request.url));
      }
    }

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>班级评分系统 - 登录</title>
    <style>
        html, body { 
            height: 100%; 
            margin: 0; 
            overflow: auto; 
            background-color: #e0f7fa;
            font-family: 'Roboto', Arial, sans-serif;
        }
        
        body { 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center; 
            min-height: 100vh; 
            color: #333333;
            background-image: url('https://www.loliapi.com/acg/');
            background-size: cover; 
            background-position: center; 
            background-repeat: no-repeat;
            position: relative;
        }
        
        .login-container {
            text-align: center; 
            max-width: 90%;
            padding: 30px; 
            background-color: rgba(255, 255, 255, 0.3);
            border-radius: 15px; 
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            transform: scale(0.5);
            opacity: 0.5;
            filter: blur(10px);
            transition: transform 1s ease-out, opacity 1s ease-out, filter 1s ease-out;
        }
        
        .login-container.loaded {
            transform: scale(1);
            opacity: 1;
            filter: blur(0);
        }
        
        h1 { 
            font-size: 2.5rem; 
            margin-bottom: 20px; 
            color: #0277bd;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
        }
        
        .role-select {
            display: flex;
            gap: 10px;
            justify-content: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        
        .role-btn {
            padding: 10px 20px;
            border: 2px solid rgba(79, 195, 247, 0.5);
            background: rgba(255, 255, 255, 0.3);
            border-radius: 25px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-weight: bold;
        }
        
        .role-btn.active {
            background: rgba(79, 195, 247, 0.5);
            color: white;
        }
        
        .role-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
        
        input { 
            margin: 15px auto; 
            padding: 12px 20px; 
            font-size: 16px; 
            border-radius: 25px; 
            outline: none; 
            display: block; 
            width: 80%;
            max-width: 300px;
            transition: all 0.3s ease;
            background-color: rgba(255, 255, 255, 0.5);
            border: 1px solid rgba(79, 195, 247, 0.5);
            color: #333333;
            text-align: center;
        }
        
        input:focus { 
            background-color: rgba(255, 255, 255, 0.7); 
            border-color: #0277bd; 
            box-shadow: 0 0 10px rgba(79, 195, 247, 0.3);
        }
        
        button { 
            margin: 15px auto; 
            padding: 12px 20px; 
            font-size: 16px; 
            border-radius: 25px; 
            outline: none; 
            display: block; 
            width: 80%;
            max-width: 300px;
            transition: all 0.3s ease;
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            border: none; 
            color: #333333; 
            cursor: pointer; 
            font-weight: bold; 
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        button:hover { 
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
        
        .login-info {
            margin-top: 20px;
            padding: 15px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 10px;
            font-size: 0.9rem;
        }
        
        #message {
            margin-top: 20px;
            color: #d32f2f;
            font-weight: bold;
        }
        
        @media (max-width: 768px) {
            .login-container {
                max-width: 95%;
                padding: 20px;
            }
            
            h1 {
                font-size: 1.8rem;
            }
            
            .role-select {
                flex-direction: column;
                align-items: center;
            }
            
            input, button {
                width: 90%;
                font-size: 14px;
                padding: 10px;
            }
        }
    </style>
</head>
<body>
    <div class="login-container" id="loginContainer">
        <h1>班级评分系统</h1>
        
        <div class="role-select">
            <div class="role-btn active" data-role="class">班级登录</div>
            <div class="role-btn" data-role="visitor">游客登录</div>
        </div>
        
        <form id="loginForm" style="display: block;">
            <input type="text" id="username" placeholder="用户名" value="2314" required>
            <input type="password" id="password" placeholder="密码" required>
            <button type="submit">登录系统</button>
        </form>
        
        <div class="login-info">
            <p>By 2314 刘沁熙</p>
            <p>基于Cloudflare Worker搭建</p>
            <p>Cloudflare CDN提供加速服务</p>
        </div>
        
        <div id="message"></div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            var container = document.getElementById('loginContainer');
            setTimeout(function() {
                container.classList.add('loaded');
            }, 100);
            
            // 设置默认密码
            document.getElementById('password').value = 'hzwy2314';
            
            // 角色选择
            document.querySelectorAll('.role-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    if (btn.dataset.role === 'visitor') {
                        window.location.href = '/';
                    } else if (btn.dataset.role === 'class') {
                        document.getElementById('username').value = '2314';
                        document.getElementById('password').value = 'hzwy2314';
                    }
                });
            });
            
            // 表单提交
            document.getElementById('loginForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = document.getElementById('username').value;
                const password = document.getElementById('password').value;

                const submitBtn = e.target.querySelector('button');
                const originalText = submitBtn.textContent;
                submitBtn.textContent = '登录中...';
                submitBtn.disabled = true;

                try {
                    const response = await fetch('/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username, password })
                    });

                    const result = await response.json();
                    
                    if (result.success) {
                        submitBtn.textContent = '登录成功!';
                        setTimeout(() => {
                            if (result.role === 'class') {
                                window.location.href = '/class';
                            } else if (result.role === 'admin') {
                                window.location.href = '/admin';
                            }
                        }, 500);
                    } else {
                        document.getElementById('message').textContent = result.error;
                        submitBtn.textContent = originalText;
                        submitBtn.disabled = false;
                    }
                } catch (error) {
                    document.getElementById('message').textContent = '网络错误，请重试';
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
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
    return renderErrorPage('登录页面加载失败: ' + error.message);
  }
}

// 渲染班级页面
async function renderClassPage(db, request, clientIP, userAgent) {
  try {
    const session = await validateSession(request, db);
    if (!session || session.role !== 'class') {
      return Response.redirect(new URL('/login', request.url));
    }

    const [studentsData, scoreCategories, tasks, settings, recentStudents] = await Promise.all([
      handleGetStudents(db).then(r => r.json()),
      db.prepare('SELECT * FROM score_categories ORDER BY type, id').all(),
      db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 10').all(),
      db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?)').bind('site_title', 'class_name', 'current_month').all(),
      handleGetRecentStudents(db).then(r => r.json())
    ]);

    if (!studentsData.success) {
      throw new Error(studentsData.error);
    }

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    // 修正score_categories，将"英语老师"改为"班主任"
    const modifiedCategories = (scoreCategories.results || []).map(cat => {
      if (cat.operator === '英语老师') {
        return { ...cat, operator: '班主任' };
      }
      return cat;
    });

    // 完整的班级页面HTML
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settingMap.site_title || '2314班综合评分系统'}</title>
    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
            --background: #f8fafc;
            --surface: #ffffff;
            --text: #1e293b;
            --text-light: #64748b;
            --border: #e2e8f0;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
            --shadow-lg: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }
        
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
        }
        
        .notification-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            max-width: 350px;
        }
        
        .notification {
            background: var(--surface);
            border-radius: 12px;
            padding: 1rem 1.5rem;
            margin-bottom: 1rem;
            box-shadow: var(--shadow-lg);
            border-left: 4px solid var(--primary);
            animation: slideInRight 0.3s ease;
            display: flex;
            align-items: center;
            gap: 1rem;
            backdrop-filter: blur(10px);
            border: 1px solid var(--border);
        }
        
        .notification.success { border-left-color: var(--secondary); }
        .notification.error { border-left-color: var(--danger); }
        .notification.warning { border-left-color: var(--warning); }
        
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        .header { 
            background: rgba(255, 255, 255, 0.9); 
            color: var(--text); 
            padding: 1rem 2rem; 
            box-shadow: var(--shadow);
            position: sticky;
            top: 0;
            z-index: 1000;
            backdrop-filter: blur(10px);
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border);
        }
        
        .class-info h1 { 
            font-weight: 700; 
            margin-bottom: 0.25rem; 
            font-size: 1.5rem;
            color: var(--primary);
        }
        
        .header-actions {
            display: flex;
            gap: 0.75rem;
            align-items: center;
        }
        
        .btn {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            text-decoration: none;
            font-size: 0.875rem;
        }
        
        .btn-primary {
            background: var(--primary);
            color: white;
        }
        
        .btn-primary:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
        }
        
        .btn-secondary {
            background: var(--background);
            color: var(--text);
            border: 1px solid var(--border);
        }
        
        .btn-secondary:hover {
            background: var(--surface);
            transform: translateY(-2px);
        }
        
        .main-content { 
            padding: 2rem; 
            max-width: 1400px; 
            margin: 0 auto;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .stat-card {
            background: var(--surface);
            border-radius: 16px;
            padding: 1.5rem;
            box-shadow: var(--shadow);
            transition: all 0.3s ease;
            border: 1px solid var(--border);
        }
        
        .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-lg);
        }
        
        .stat-title {
            color: var(--text-light);
            font-size: 0.875rem;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .stat-value {
            font-size: 2rem;
            font-weight: 700;
            color: var(--text);
        }
        
        .rank-btn {
            margin-top: 1rem;
            width: 100%;
        }
        
        .students-section {
            background: var(--surface);
            border-radius: 16px;
            padding: 2rem;
            box-shadow: var(--shadow);
            margin-bottom: 2rem;
            border: 1px solid var(--border);
        }
        
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            flex-wrap: wrap;
            gap: 1rem;
        }
        
        .section-title {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        .batch-controls {
            display: flex;
            gap: 1rem;
            align-items: center;
            flex-wrap: wrap;
        }
        
        .batch-btn {
            padding: 0.5rem 1rem;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            border: 2px solid var(--border);
            background: var(--surface);
            color: var(--text);
        }
        
        .batch-btn.active {
            background: var(--primary);
            color: white;
            border-color: var(--primary);
        }
        
        .students-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }
        
        .student-card {
            background: var(--background);
            border-radius: 12px;
            padding: 1.5rem;
            transition: all 0.3s ease;
            border: 1px solid var(--border);
            position: relative;
            overflow: hidden;
        }
        
        .student-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow);
            border-color: var(--primary);
        }
        
        .student-card.selected {
            border-color: var(--primary);
            background: rgba(99, 102, 241, 0.05);
        }
        
        .student-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 1rem;
        }
        
        .student-name {
            font-weight: 700;
            font-size: 1.1rem;
            color: var(--text);
        }
        
        .student-rank {
            background: var(--primary);
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 0.75rem;
        }
        
        .student-scores {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 0.5rem;
            margin-bottom: 1rem;
        }
        
        .score-item {
            text-align: center;
        }
        
        .score-label {
            font-size: 0.75rem;
            color: var(--text-light);
            margin-bottom: 0.25rem;
        }
        
        .score-value {
            font-weight: 700;
            font-size: 1.25rem;
        }
        
        .add-score { color: var(--secondary); }
        .minus-score { color: var(--danger); }
        .total-score { color: var(--primary); }
        
        .student-actions {
            display: flex;
            gap: 0.5rem;
        }
        
        .action-btn {
            flex: 1;
            padding: 0.5rem;
            border-radius: 8px;
            border: none;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.75rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.25rem;
        }
        
        .add-btn { 
            background: rgba(16, 185, 129, 0.1);
            color: var(--secondary);
            border: 1px solid rgba(16, 185, 129, 0.2);
        }
        
        .add-btn:hover {
            background: rgba(16, 185, 129, 0.2);
            transform: translateY(-2px);
        }
        
        .minus-btn { 
            background: rgba(239, 68, 68, 0.1);
            color: var(--danger);
            border: 1px solid rgba(239, 68, 68, 0.2);
        }
        
        .minus-btn:hover {
            background: rgba(239, 68, 68, 0.2);
            transform: translateY(-2px);
        }
        
        .detail-btn { 
            background: rgba(99, 102, 241, 0.1);
            color: var(--primary);
            border: 1px solid rgba(99, 102, 241, 0.2);
        }
        
        .detail-btn:hover {
            background: rgba(99, 102, 241, 0.2);
            transform: translateY(-2px);
        }
        
        /* 模态框样式 */
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.3s ease;
            backdrop-filter: blur(5px);
            padding: 1rem;
        }
        
        .modal-content {
            background: var(--surface);
            padding: 2rem;
            border-radius: 20px;
            width: 100%;
            max-width: 500px;
            animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: var(--shadow-lg);
            border: 1px solid var(--border);
            position: relative;
            max-height: 90vh;
            overflow-y: auto;
        }
        
        .modal-close {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: var(--text-light);
            transition: color 0.3s ease;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .modal-close:hover {
            color: var(--danger);
            background: rgba(239, 68, 68, 0.1);
        }
        
        @keyframes fadeIn { 
            from { opacity: 0; } 
            to { opacity: 1; } 
        }
        
        @keyframes slideUp { 
            from { transform: translateY(30px); opacity: 0; } 
            to { transform: translateY(0); opacity: 1; } 
        }
        
        .modal-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 1.5rem;
            color: var(--text);
            text-align: center;
        }
        
        .input-group { 
            margin-bottom: 1.5rem; 
        }
        
        .input-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: var(--text);
        }
        
        select, input[type="text"], input[type="number"], textarea {
            width: 100%;
            padding: 0.75rem 1rem;
            border: 2px solid var(--border);
            border-radius: 8px;
            font-size: 1rem;
            transition: all 0.3s ease;
            background: var(--surface);
            color: var(--text);
        }
        
        select:focus, input:focus, textarea:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        
        .score-buttons { 
            display: grid; 
            grid-template-columns: repeat(3, 1fr); 
            gap: 0.5rem; 
            margin: 1rem 0; 
        }
        
        .score-btn { 
            padding: 1rem; 
            border: 2px solid var(--border); 
            background: var(--surface); 
            border-radius: 8px;
            cursor: pointer; 
            transition: all 0.3s ease; 
            text-align: center;
            font-weight: 600;
            color: var(--text);
        }
        
        .score-btn:hover { 
            border-color: var(--primary); 
            background: rgba(99, 102, 241, 0.05);
            transform: translateY(-2px);
        }
        
        .score-btn.selected { 
            border-color: var(--primary); 
            background: var(--primary); 
            color: white;
        }
        
        .modal-actions { 
            display: flex; 
            gap: 1rem; 
            margin-top: 2rem; 
        }
        
        .modal-btn { 
            flex: 1; 
            padding: 0.75rem; 
            border: none; 
            border-radius: 8px; 
            cursor: pointer; 
            transition: all 0.3s ease; 
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }
        
        .submit-btn { 
            background: var(--secondary); 
            color: white; 
        }
        
        .submit-btn:hover { 
            background: #0da271;
            transform: translateY(-2px);
        }
        
        .cancel-btn { 
            background: var(--text-light); 
            color: white; 
        }
        
        .cancel-btn:hover { 
            background: #475569;
            transform: translateY(-2px);
        }
        
        .logs-container {
            max-height: 300px;
            overflow-y: auto;
            margin-top: 1rem;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 1rem;
        }
        
        .log-item {
            padding: 0.75rem;
            border-bottom: 1px solid var(--border);
            font-size: 0.875rem;
        }
        
        .log-item:last-child {
            border-bottom: none;
        }
        
        .log-time {
            color: var(--text-light);
            font-size: 0.75rem;
            margin-bottom: 0.25rem;
        }
        
        .log-content {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .log-action {
            padding: 0.25rem 0.5rem;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        
        .log-action.add {
            background: rgba(16, 185, 129, 0.1);
            color: var(--secondary);
        }
        
        .log-action.minus {
            background: rgba(239, 68, 68, 0.1);
            color: var(--danger);
        }
        
        .log-action.revoke {
            background: rgba(245, 158, 11, 0.1);
            color: var(--warning);
        }
        
        .system-info {
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(255, 255, 255, 0.9);
            border-radius: 12px;
            padding: 1rem;
            font-size: 0.75rem;
            color: var(--text-light);
            backdrop-filter: blur(10px);
            border: 1px solid var(--border);
            max-width: 300px;
        }
        
        @media (max-width: 768px) {
            .main-content { 
                padding: 1rem; 
            }
            
            .header { 
                padding: 1rem; 
                flex-direction: column;
                gap: 1rem;
            }
            
            .header-actions {
                width: 100%;
                justify-content: center;
                flex-wrap: wrap;
            }
            
            .students-grid {
                grid-template-columns: 1fr;
            }
            
            .modal-content {
                padding: 1.5rem;
                max-width: 95%;
            }
            
            .system-info {
                position: relative;
                bottom: auto;
                left: auto;
                margin: 2rem auto;
                max-width: 100%;
            }
        }
        
        .footer {
            text-align: center;
            padding: 2rem;
            color: var(--text-light);
            font-size: 0.875rem;
            margin-top: 2rem;
            border-top: 1px solid var(--border);
        }
        
        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 2rem;
        }
        
        .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid var(--border);
            border-top-color: var(--primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="notification-container" id="notificationContainer"></div>
    
    <div class="header">
        <div class="class-info">
            <h1>${settingMap.site_title || '2314班综合评分系统'}</h1>
            <div style="font-size: 0.875rem; color: var(--text-light);">
                ${settingMap.class_name || '2314班'} - 班级视图
            </div>
        </div>
        
        <div class="header-actions">
            <button class="btn btn-primary" onclick="createSnapshot()">
                <span>💾</span>
                保存快照
            </button>
            <a href="/snapshots" class="btn btn-secondary">
                <span>📊</span>
                历史数据
            </a>
            <button class="btn btn-secondary" onclick="showRanking()">
                <span>🏆</span>
                查看排名
            </button>
            <button class="btn btn-secondary" onclick="logout()">
                <span>🚪</span>
                退出登录
            </button>
        </div>
    </div>

    <div class="main-content">
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-title">
                    <span>👥</span>
                    学生总数
                </div>
                <div class="stat-value">${studentsData.students ? studentsData.students.length : 0}</div>
                <button class="btn btn-primary rank-btn" onclick="showRanking()">
                    查看排名
                </button>
            </div>
            
            <div class="stat-card">
                <div class="stat-title">
                    <span>📈</span>
                    总加分
                </div>
                <div class="stat-value add-score">${studentsData.students ? studentsData.students.reduce((acc, s) => acc + s.add_score, 0) : 0}</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-title">
                    <span>📉</span>
                    总扣分
                </div>
                <div class="stat-value minus-score">${studentsData.students ? studentsData.students.reduce((acc, s) => acc + s.minus_score, 0) : 0}</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-title">
                    <span>⚖️</span>
                    平均分
                </div>
                <div class="stat-value total-score">
                    ${studentsData.students && studentsData.students.length > 0 
                      ? (studentsData.students.reduce((acc, s) => acc + s.total_score, 0) / studentsData.students.length).toFixed(1)
                      : '0'}
                </div>
            </div>
        </div>

        <div class="students-section">
            <div class="section-header">
                <div class="section-title">
                    <span>👨‍🎓</span>
                    学生列表
                </div>
                
                <div class="batch-controls">
                    <div style="font-size: 0.875rem; color: var(--text-light);">
                        <span id="selectedCount">0</span> 名学生已选择
                    </div>
                    <button class="batch-btn" onclick="toggleBatchMode()">
                        <span>📝</span>
                        批量评分
                    </button>
                    <button class="batch-btn" onclick="clearSelection()">
                        <span>🗑️</span>
                        清除选择
                    </button>
                </div>
            </div>
            
            <div style="margin-bottom: 1rem; font-size: 0.875rem; color: var(--text-light);">
                最近评分：${recentStudents.success && recentStudents.students.length > 0 
                  ? recentStudents.students.map(s => s.name).join('、')
                  : '暂无'}
            </div>
            
            <div class="students-grid" id="studentsGrid">
                ${studentsData.students ? studentsData.students.map((student, index) => `
                    <div class="student-card" data-id="${student.id}" onclick="toggleSelectStudent(${student.id}, event)">
                        <div class="student-header">
                            <div class="student-name">${student.name}</div>
                            <div class="student-rank">${index + 1}</div>
                        </div>
                        
                        <div class="student-scores">
                            <div class="score-item">
                                <div class="score-label">加分</div>
                                <div class="score-value add-score">${student.add_score}</div>
                            </div>
                            <div class="score-item">
                                <div class="score-label">扣分</div>
                                <div class="score-value minus-score">${student.minus_score}</div>
                            </div>
                            <div class="score-item">
                                <div class="score-label">总分</div>
                                <div class="score-value total-score">${student.total_score > 0 ? '+' : ''}${student.total_score}</div>
                            </div>
                        </div>
                        
                        <div class="student-actions">
                            <button class="action-btn add-btn" onclick="startScoreProcess(${student.id}, 'add', '${student.name}', event)">
                                <span>➕</span>
                                加分
                            </button>
                            <button class="action-btn minus-btn" onclick="startScoreProcess(${student.id}, 'minus', '${student.name}', event)">
                                <span>➖</span>
                                扣分
                            </button>
                            <button class="action-btn detail-btn" onclick="showStudentDetail(${student.id}, '${student.name}', event)">
                                <span>📋</span>
                                详细
                            </button>
                        </div>
                    </div>
                `).join('') : '<div class="loading"><div class="spinner"></div></div>'}
            </div>
            
            <div id="batchActions" style="display: none;">
                <div class="modal-actions">
                    <button class="modal-btn submit-btn" onclick="startBatchScore('add')">
                        <span>➕</span>
                        批量加分
                    </button>
                    <button class="modal-btn cancel-btn" onclick="startBatchScore('minus')">
                        <span>➖</span>
                        批量扣分
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 评分弹窗 -->
    <div class="modal-overlay" id="scoreModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeScoreModal()">×</button>
            <div class="modal-title" id="scoreModalTitle"></div>
            
            <div class="input-group">
                <label>分值：</label>
                <div class="score-buttons" id="scoreButtons">
                    <div class="score-btn" data-score="1">1分</div>
                    <div class="score-btn" data-score="2">2分</div>
                    <div class="score-btn" data-score="3">3分</div>
                    <div class="score-btn" data-score="5">5分</div>
                    <div class="score-btn" data-score="10">10分</div>
                    <div class="score-btn" data-score="custom">自定义</div>
                </div>
                <input type="number" id="customScore" style="width: 100%; margin-top: 0.5rem; display: none;" placeholder="输入自定义分值" min="1" max="100">
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
                <textarea id="scoreNote" rows="3" placeholder="可选备注信息，自定义评分必须填写"></textarea>
            </div>
            
            <div class="modal-actions">
                <button class="modal-btn cancel-btn" onclick="closeScoreModal()">
                    <span>❌</span>
                    取消
                </button>
                <button class="modal-btn submit-btn" onclick="submitScore()" id="submitScoreBtn">
                    <span>✅</span>
                    提交评分
                </button>
            </div>
        </div>
    </div>

    <!-- 批量评分弹窗 -->
    <div class="modal-overlay" id="batchScoreModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeBatchScoreModal()">×</button>
            <div class="modal-title" id="batchScoreModalTitle"></div>
            
            <div class="input-group">
                <label>已选择 <span id="batchStudentCount">0</span> 名学生</label>
                <div style="max-height: 200px; overflow-y: auto; padding: 0.5rem; border: 1px solid var(--border); border-radius: 8px;">
                    <div id="selectedStudentsList"></div>
                </div>
            </div>
            
            <div class="input-group">
                <label>分值：</label>
                <div class="score-buttons" id="batchScoreButtons">
                    <div class="score-btn" data-score="1">1分</div>
                    <div class="score-btn" data-score="2">2分</div>
                    <div class="score-btn" data-score="3">3分</div>
                    <div class="score-btn" data-score="5">5分</div>
                    <div class="score-btn" data-score="10">10分</div>
                    <div class="score-btn" data-score="custom">自定义</div>
                </div>
                <input type="number" id="batchCustomScore" style="width: 100%; margin-top: 0.5rem; display: none;" placeholder="输入自定义分值" min="1" max="100">
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
                <textarea id="batchScoreNote" rows="3" placeholder="可选备注信息，自定义评分必须填写"></textarea>
            </div>
            
            <div class="modal-actions">
                <button class="modal-btn cancel-btn" onclick="closeBatchScoreModal()">
                    <span>❌</span>
                    取消
                </button>
                <button class="modal-btn submit-btn" onclick="submitBatchScore()" id="submitBatchScoreBtn">
                    <span>✅</span>
                    批量提交
                </button>
            </div>
        </div>
    </div>

    <!-- 学生详情弹窗 -->
    <div class="modal-overlay" id="detailModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeDetailModal()">×</button>
            <div class="modal-title" id="detailModalTitle"></div>
            
            <div class="student-scores" style="margin-bottom: 1.5rem;">
                <div class="score-item">
                    <div class="score-label">加分</div>
                    <div class="score-value add-score" id="detailAddScore">0</div>
                </div>
                <div class="score-item">
                    <div class="score-label">扣分</div>
                    <div class="score-value minus-score" id="detailMinusScore">0</div>
                </div>
                <div class="score-item">
                    <div class="score-label">总分</div>
                    <div class="score-value total-score" id="detailTotalScore">0</div>
                </div>
            </div>
            
            <div class="input-group">
                <label>操作记录：</label>
                <div class="logs-container" id="studentLogs">
                    <!-- 动态填充 -->
                </div>
            </div>
            
            <div class="modal-actions">
                <button class="modal-btn cancel-btn" onclick="closeDetailModal()">
                    <span>❌</span>
                    关闭
                </button>
            </div>
        </div>
    </div>

    <!-- 排名弹窗 -->
    <div class="modal-overlay" id="rankingModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeRankingModal()">×</button>
            <div class="modal-title">🏆 学生排名</div>
            
            <div style="max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--background);">
                            <th style="padding: 1rem; text-align: left; border-bottom: 1px solid var(--border);">排名</th>
                            <th style="padding: 1rem; text-align: left; border-bottom: 1px solid var(--border);">姓名</th>
                            <th style="padding: 1rem; text-align: left; border-bottom: 1px solid var(--border);">加分</th>
                            <th style="padding: 1rem; text-align: left; border-bottom: 1px solid var(--border);">扣分</th>
                            <th style="padding: 1rem; text-align: left; border-bottom: 1px solid var(--border);">总分</th>
                        </tr>
                    </thead>
                    <tbody id="rankingBody">
                        <!-- 动态填充 -->
                    </tbody>
                </table>
            </div>
            
            <div class="modal-actions">
                <button class="modal-btn cancel-btn" onclick="closeRankingModal()">
                    <span>❌</span>
                    关闭
                </button>
            </div>
        </div>
    </div>

    <div class="footer">
        <p>By 2314 刘沁熙 | 基于Cloudflare Worker搭建 | Cloudflare CDN提供加速服务</p>
        <p id="systemInfo">加载中...</p>
    </div>

    <script>
        let currentStudentId = null;
        let currentScoreType = 'add';
        let currentStudentName = '';
        let selectedScore = 1;
        let isBatchMode = false;
        let selectedStudents = new Set();
        let batchScoreType = 'add';
        let wallpaperUrl = '';
        let ipInfo = null;
        let pageLoadTime = Date.now();
        
        // 页面加载完成
        document.addEventListener('DOMContentLoaded', async function() {
            // 加载壁纸
            await loadWallpaper();
            
            // 加载IP信息
            await loadIPInfo();
            
            // 检查会话
            await checkSession();
            
            // 更新系统信息
            updateSystemInfo();
            
            // 评分按钮事件
            setupScoreButtons();
            setupBatchScoreButtons();
            
            // 加载评分项目
            loadScoreCategories();
            loadBatchScoreCategories();
        });
        
        // 加载壁纸
        async function loadWallpaper() {
            try {
                const response = await fetch('/api/wallpaper');
                const result = await response.json();
                
                if (result.success && result.data && result.data.length > 0) {
                    const wallpaper = result.data[0];
                    wallpaperUrl = 'https://www.bing.com' + wallpaper.url;
                    document.body.style.backgroundImage = \`url('\${wallpaperUrl}')\`;
                }
            } catch (error) {
                console.error('加载壁纸失败:', error);
            }
        }
        
        // 加载IP信息
        async function loadIPInfo() {
            try {
                const startTime = Date.now();
                const response = await fetch('/api/ip-info');
                const result = await response.json();
                
                if (result.success) {
                    ipInfo = result.data;
                    
                    // 显示IP通知
                    const latency = Date.now() - startTime;
                    showNotification(\`\${ipInfo.flag} \${ipInfo.city} | 延迟: \${latency}ms\`, 'info', 5000);
                }
            } catch (error) {
                console.error('加载IP信息失败:', error);
            }
        }
        
        // 检查会话
        async function checkSession() {
            try {
                const response = await fetch('/api/check-session');
                const result = await response.json();
                
                if (result.success) {
                    console.log('会话有效:', result.session);
                }
            } catch (error) {
                console.error('检查会话失败:', error);
            }
        }
        
        // 更新系统信息
        function updateSystemInfo() {
            const now = new Date();
            const loadTime = Date.now() - pageLoadTime;
            const timeStr = now.toLocaleString('zh-CN');
            
            let info = \`页面加载时间: \${loadTime}ms | 当前时间: \${timeStr}\`;
            
            if (ipInfo) {
                info += \` | IP: \${ipInfo.ip} | 位置: \${ipInfo.city}, \${ipInfo.countryRegion}\`;
            }
            
            document.getElementById('systemInfo').textContent = info;
        }
        
        // 显示通知
        function showNotification(message, type = 'info', duration = 3000) {
            const container = document.getElementById('notificationContainer');
            const notification = document.createElement('div');
            notification.className = \`notification \${type}\`;
            notification.innerHTML = \`
                <span>\${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</span>
                <span>\${message}</span>
            \`;
            
            container.appendChild(notification);
            
            setTimeout(() => {
                notification.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }, duration);
        }
        
        // 设置评分按钮事件
        function setupScoreButtons() {
            const buttons = document.querySelectorAll('#scoreButtons .score-btn');
            buttons.forEach(btn => {
                btn.addEventListener('click', function() {
                    buttons.forEach(b => b.classList.remove('selected'));
                    this.classList.add('selected');
                    
                    if (this.dataset.score === 'custom') {
                        document.getElementById('customScore').style.display = 'block';
                        document.getElementById('customScore').focus();
                    } else {
                        document.getElementById('customScore').style.display = 'none';
                        selectedScore = parseInt(this.dataset.score);
                    }
                });
            });
            
            document.getElementById('customScore').addEventListener('input', function() {
                selectedScore = parseInt(this.value) || 0;
            });
        }
        
        // 设置批量评分按钮事件
        function setupBatchScoreButtons() {
            const buttons = document.querySelectorAll('#batchScoreButtons .score-btn');
            buttons.forEach(btn => {
                btn.addEventListener('click', function() {
                    buttons.forEach(b => b.classList.remove('selected'));
                    this.classList.add('selected');
                    
                    if (this.dataset.score === 'custom') {
                        document.getElementById('batchCustomScore').style.display = 'block';
                        document.getElementById('batchCustomScore').focus();
                    } else {
                        document.getElementById('batchCustomScore').style.display = 'none';
                    }
                });
            });
            
            document.getElementById('batchCustomScore').addEventListener('input', function() {
                // 批量评分的分数在提交时获取
            });
        }
        
        // 开始评分流程
        function startScoreProcess(studentId, type, studentName, event) {
            if (event) event.stopPropagation();
            
            currentStudentId = studentId;
            currentScoreType = type;
            currentStudentName = studentName;
            
            // 更新界面
            document.getElementById('scoreModalTitle').textContent = 
                \`为 \${studentName} \${type === 'add' ? '加分' : '扣分'}\`;
            
            // 重置选择
            selectedScore = 1;
            document.querySelectorAll('#scoreButtons .score-btn').forEach((btn, index) => {
                btn.classList.remove('selected');
                if (index === 0) btn.classList.add('selected');
            });
            document.getElementById('customScore').style.display = 'none';
            document.getElementById('customScore').value = '';
            document.getElementById('scoreNote').value = '';
            
            // 显示模态框
            document.getElementById('scoreModal').style.display = 'flex';
        }
        
        // 关闭评分弹窗
        function closeScoreModal() {
            document.getElementById('scoreModal').style.display = 'none';
        }
        
        // 加载评分项目
        function loadScoreCategories() {
            const categories = ${JSON.stringify(modifiedCategories)};
            const categorySelect = document.getElementById('categorySelect');
            categorySelect.innerHTML = '';
            
            const filteredCategories = categories.filter(cat => cat.type === currentScoreType);
            
            filteredCategories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name;
                categorySelect.appendChild(option);
            });
        }
        
        // 加载批量评分项目
        function loadBatchScoreCategories() {
            const categories = ${JSON.stringify(modifiedCategories)};
            const categorySelect = document.getElementById('batchCategorySelect');
            categorySelect.innerHTML = '';
            
            const filteredCategories = categories.filter(cat => cat.type === batchScoreType);
            
            filteredCategories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name;
                categorySelect.appendChild(option);
            });
        }
        
        // 提交分数
        async function submitScore() {
            const categoryId = document.getElementById('categorySelect').value;
            const operator = document.getElementById('operatorSelect').value;
            const note = document.getElementById('scoreNote').value;
            
            // 获取分数
            let score = selectedScore;
            const customScoreInput = document.getElementById('customScore');
            if (customScoreInput.style.display === 'block') {
                score = parseInt(customScoreInput.value) || 1;
            }
            
            if (score <= 0) {
                showNotification('分值必须大于0', 'error');
                return;
            }
            
            // 检查是否为"其他"类别
            const selectedCategory = ${JSON.stringify(modifiedCategories)}.find(cat => cat.id == categoryId);
            if (selectedCategory && (selectedCategory.name.includes('其他') || selectedCategory.name.includes('自定义')) && (!note || note.trim() === '')) {
                showNotification('自定义评分必须填写备注', 'error');
                return;
            }
            
            const submitBtn = document.getElementById('submitScoreBtn');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = '提交中...';
            submitBtn.disabled = true;
            
            try {
                // 立即关闭弹窗，防止重复点击
                closeScoreModal();
                
                const response = await fetch('/api/score', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        studentId: currentStudentId,
                        categoryId: categoryId,
                        score: score,
                        operator: operator,
                        note: note,
                        userAgent: navigator.userAgent
                    })
                });

                const result = await response.json();

                if (result.success) {
                    showNotification('评分提交成功！', 'success');
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showNotification(result.error || '提交失败', 'error');
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        }
        
        // 切换批量模式
        function toggleBatchMode() {
            isBatchMode = !isBatchMode;
            const batchBtn = document.querySelector('.batch-btn');
            const batchActions = document.getElementById('batchActions');
            
            if (isBatchMode) {
                batchBtn.innerHTML = '<span>❌</span> 取消批量';
                batchActions.style.display = 'block';
            } else {
                batchBtn.innerHTML = '<span>📝</span> 批量评分';
                batchActions.style.display = 'none';
                clearSelection();
            }
        }
        
        // 切换学生选择
        function toggleSelectStudent(studentId, event) {
            if (!isBatchMode) return;
            if (event) event.stopPropagation();
            
            const card = document.querySelector(\`.student-card[data-id="\${studentId}"]\`);
            
            if (selectedStudents.has(studentId)) {
                selectedStudents.delete(studentId);
                card.classList.remove('selected');
            } else {
                selectedStudents.add(studentId);
                card.classList.add('selected');
            }
            
            updateSelectedCount();
        }
        
        // 更新选择计数
        function updateSelectedCount() {
            document.getElementById('selectedCount').textContent = selectedStudents.size;
        }
        
        // 清除选择
        function clearSelection() {
            selectedStudents.clear();
            document.querySelectorAll('.student-card.selected').forEach(card => {
                card.classList.remove('selected');
            });
            updateSelectedCount();
        }
        
        // 开始批量评分
        function startBatchScore(type) {
            if (selectedStudents.size === 0) {
                showNotification('请先选择学生', 'warning');
                return;
            }
            
            batchScoreType = type;
            
            // 更新界面
            document.getElementById('batchScoreModalTitle').textContent = 
                \`为 \${selectedStudents.size} 名学生批量\${type === 'add' ? '加分' : '扣分'}\`;
            
            document.getElementById('batchStudentCount').textContent = selectedStudents.size;
            
            // 显示已选择学生
            const studentList = document.getElementById('selectedStudentsList');
            studentList.innerHTML = '';
            
            selectedStudents.forEach(studentId => {
                const card = document.querySelector(\`.student-card[data-id="\${studentId}"]\`);
                const name = card.querySelector('.student-name').textContent;
                studentList.innerHTML += \`<div style="padding: 0.25rem; border-bottom: 1px solid var(--border);">\${name}</div>\`;
            });
            
            // 重置表单
            document.querySelectorAll('#batchScoreButtons .score-btn').forEach((btn, index) => {
                btn.classList.remove('selected');
                if (index === 0) btn.classList.add('selected');
            });
            document.getElementById('batchCustomScore').style.display = 'none';
            document.getElementById('batchCustomScore').value = '';
            document.getElementById('batchScoreNote').value = '';
            
            // 加载评分项目
            loadBatchScoreCategories();
            
            // 显示模态框
            document.getElementById('batchScoreModal').style.display = 'flex';
        }
        
        // 关闭批量评分弹窗
        function closeBatchScoreModal() {
            document.getElementById('batchScoreModal').style.display = 'none';
        }
        
        // 提交批量评分
        async function submitBatchScore() {
            const categoryId = document.getElementById('batchCategorySelect').value;
            const operator = document.getElementById('batchOperatorSelect').value;
            const note = document.getElementById('batchScoreNote').value;
            
            // 获取分数
            let score = 1;
            const selectedBtn = document.querySelector('#batchScoreButtons .score-btn.selected');
            if (selectedBtn.dataset.score === 'custom') {
                score = parseInt(document.getElementById('batchCustomScore').value) || 1;
            } else {
                score = parseInt(selectedBtn.dataset.score);
            }
            
            if (score <= 0) {
                showNotification('分值必须大于0', 'error');
                return;
            }
            
            // 检查是否为"其他"类别
            const selectedCategory = ${JSON.stringify(modifiedCategories)}.find(cat => cat.id == categoryId);
            if (selectedCategory && (selectedCategory.name.includes('其他') || selectedCategory.name.includes('自定义')) && (!note || note.trim() === '')) {
                showNotification('自定义评分必须填写备注', 'error');
                return;
            }
            
            const submitBtn = document.getElementById('submitBatchScoreBtn');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = '提交中...';
            submitBtn.disabled = true;
            
            try {
                // 立即关闭弹窗，防止重复点击
                closeBatchScoreModal();
                
                const response = await fetch('/api/batch-score', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        studentIds: Array.from(selectedStudents),
                        categoryId: categoryId,
                        score: score,
                        operator: operator,
                        note: note,
                        userAgent: navigator.userAgent
                    })
                });

                const result = await response.json();

                if (result.success) {
                    showNotification(result.message, 'success');
                    isBatchMode = false;
                    document.querySelector('.batch-btn').innerHTML = '<span>📝</span> 批量评分';
                    document.getElementById('batchActions').style.display = 'none';
                    clearSelection();
                    setTimeout(() => location.reload(), 1500);
                } else {
                    showNotification(result.error || '提交失败', 'error');
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        }
        
        // 显示学生详情
        async function showStudentDetail(studentId, studentName, event) {
            if (event) event.stopPropagation();
            
            currentStudentId = studentId;
            
            // 更新界面
            document.getElementById('detailModalTitle').textContent = \`\${studentName} 的评分记录\`;
            
            // 获取学生分数
            const students = ${JSON.stringify(studentsData.students || [])};
            const student = students.find(s => s.id === studentId);
            if (student) {
                document.getElementById('detailAddScore').textContent = student.add_score;
                document.getElementById('detailMinusScore').textContent = student.minus_score;
                document.getElementById('detailTotalScore').textContent = \`\${student.total_score > 0 ? '+' : ''}\${student.total_score}\`;
            }
            
            // 加载操作记录
            await loadStudentLogs(studentId);
            
            // 显示模态框
            document.getElementById('detailModal').style.display = 'flex';
        }
        
        // 加载学生日志
        async function loadStudentLogs(studentId) {
            try {
                const response = await fetch(\`/api/student-logs?studentId=\${studentId}\`);
                const result = await response.json();
                
                const logsContainer = document.getElementById('studentLogs');
                logsContainer.innerHTML = '';
                
                if (result.success && result.logs && result.logs.length > 0) {
                    result.logs.forEach(log => {
                        const logItem = document.createElement('div');
                        logItem.className = 'log-item';
                        
                        const time = new Date(log.created_at).toLocaleString('zh-CN');
                        let actionClass = '';
                        let actionText = '';
                        
                        if (log.action_type === 'add') {
                            actionClass = 'add';
                            actionText = \`+\${log.score_change}\`;
                        } else if (log.action_type === 'minus') {
                            actionClass = 'minus';
                            actionText = \`\${log.score_change}\`;
                        } else {
                            actionClass = 'revoke';
                            actionText = '撤销';
                        }
                        
                        logItem.innerHTML = \`
                            <div class="log-time">\${time}</div>
                            <div class="log-content">
                                <div>
                                    <strong>\${log.category_name}</strong>
                                    <div style="font-size: 0.75rem; color: var(--text-light);">\${log.note || '无备注'}</div>
                                    <div style="font-size: 0.75rem; color: var(--text-light);">操作者: \${log.operator}</div>
                                </div>
                                <div class="log-action \${actionClass}">\${actionText}</div>
                            </div>
                            \${log.action_type !== 'revoke' ? \`<button onclick="revokeLog(\${log.id})" style="margin-top: 0.5rem; padding: 0.25rem 0.5rem; font-size: 0.75rem; background: rgba(245, 158, 11, 0.1); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 4px; cursor: pointer;">撤销此操作</button>\` : ''}
                        \`;
                        
                        logsContainer.appendChild(logItem);
                    });
                } else {
                    logsContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-light);">暂无操作记录</div>';
                }
            } catch (error) {
                console.error('加载日志失败:', error);
                document.getElementById('studentLogs').innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--danger);">加载失败</div>';
            }
        }
        
        // 撤销日志
        async function revokeLog(logId) {
            if (!confirm('确定要撤销此操作吗？')) return;
            
            try {
                const response = await fetch('/api/revoke', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recordId: logId,
                        userAgent: navigator.userAgent
                    })
                });

                const result = await response.json();

                if (result.success) {
                    showNotification('撤销操作成功！', 'success');
                    await loadStudentLogs(currentStudentId);
                    
                    // 更新学生分数显示
                    const studentsResponse = await fetch('/api/students');
                    const studentsResult = await studentsResponse.json();
                    
                    if (studentsResult.success) {
                        const student = studentsResult.students.find(s => s.id === currentStudentId);
                        if (student) {
                            document.getElementById('detailAddScore').textContent = student.add_score;
                            document.getElementById('detailMinusScore').textContent = student.minus_score;
                            document.getElementById('detailTotalScore').textContent = \`\${student.total_score > 0 ? '+' : ''}\${student.total_score}\`;
                        }
                    }
                } else {
                    showNotification(result.error || '撤销失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }
        
        // 关闭详情弹窗
        function closeDetailModal() {
            document.getElementById('detailModal').style.display = 'none';
        }
        
        // 显示排名
        function showRanking() {
            const students = ${JSON.stringify(studentsData.students || [])};
            const rankingBody = document.getElementById('rankingBody');
            rankingBody.innerHTML = '';
            
            students.forEach((student, index) => {
                const row = document.createElement('tr');
                row.innerHTML = \`
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border);">
                        <div style="width: 28px; height: 28px; border-radius: 50%; background: \${index < 3 ? '#f59e0b' : '#6366f1'}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700;">\${index + 1}</div>
                    </td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border); font-weight: 600;">\${student.name}</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border); color: var(--secondary); font-weight: 600;">\${student.add_score}</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border); color: var(--danger); font-weight: 600;">\${student.minus_score}</td>
                    <td style="padding: 1rem; border-bottom: 1px solid var(--border); color: var(--primary); font-weight: 700;">\${student.total_score > 0 ? '+' : ''}\${student.total_score}</td>
                \`;
                rankingBody.appendChild(row);
            });
            
            document.getElementById('rankingModal').style.display = 'flex';
        }
        
        // 关闭排名弹窗
        function closeRankingModal() {
            document.getElementById('rankingModal').style.display = 'none';
        }
        
        // 创建快照
        async function createSnapshot() {
            const title = prompt('请输入快照标题（如：期中考核）:');
            if (!title) return;
            
            try {
                const response = await fetch('/api/snapshot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title })
                });

                const result = await response.json();

                if (result.success) {
                    showNotification('快照保存成功！', 'success');
                } else {
                    showNotification(result.error || '保存失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
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
        
        // 点击弹窗外部关闭
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.style.display = 'none';
                }
            });
        });
        
        // 定期更新系统信息
        setInterval(updateSystemInfo, 60000);
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

    const [studentsData, logs, settings] = await Promise.all([
      handleGetStudents(db).then(r => r.json()),
      db.prepare('SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT 100').all(),
      db.prepare('SELECT key, value FROM settings').all()
    ]);

    if (!studentsData.success) {
      throw new Error(studentsData.error);
    }

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    // 完整的管理员页面HTML
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settingMap.site_title || '班级评分系统'} - 管理员</title>
    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
            --background: #f8fafc;
            --surface: #ffffff;
            --text: #1e293b;
            --text-light: #64748b;
            --border: #e2e8f0;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
            --shadow-lg: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }
        
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
        }
        
        .notification-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            max-width: 350px;
        }
        
        .notification {
            background: var(--surface);
            border-radius: 12px;
            padding: 1rem 1.5rem;
            margin-bottom: 1rem;
            box-shadow: var(--shadow-lg);
            border-left: 4px solid var(--primary);
            animation: slideInRight 0.3s ease;
            display: flex;
            align-items: center;
            gap: 1rem;
            backdrop-filter: blur(10px);
            border: 1px solid var(--border);
        }
        
        .notification.success { border-left-color: var(--secondary); }
        .notification.error { border-left-color: var(--danger); }
        .notification.warning { border-left-color: var(--warning); }
        
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        .header { 
            background: rgba(255, 255, 255, 0.9); 
            color: var(--text); 
            padding: 1rem 2rem; 
            box-shadow: var(--shadow);
            position: sticky;
            top: 0;
            z-index: 1000;
            backdrop-filter: blur(10px);
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border);
        }
        
        .admin-info h1 { 
            font-weight: 700; 
            margin-bottom: 0.25rem; 
            font-size: 1.5rem;
            color: var(--primary);
        }
        
        .admin-badge {
            background: var(--primary);
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        
        .header-actions {
            display: flex;
            gap: 0.75rem;
            align-items: center;
        }
        
        .btn {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            text-decoration: none;
            font-size: 0.875rem;
        }
        
        .btn-primary {
            background: var(--primary);
            color: white;
        }
        
        .btn-primary:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
        }
        
        .btn-secondary {
            background: var(--background);
            color: var(--text);
            border: 1px solid var(--border);
        }
        
        .btn-secondary:hover {
            background: var(--surface);
            transform: translateY(-2px);
        }
        
        .btn-danger {
            background: var(--danger);
            color: white;
        }
        
        .btn-danger:hover {
            background: #dc2626;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
        }
        
        .main-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .stat-card {
            background: var(--surface);
            border-radius: 16px;
            padding: 1.5rem;
            box-shadow: var(--shadow);
            transition: all 0.3s ease;
            border: 1px solid var(--border);
        }
        
        .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-lg);
        }
        
        .stat-title {
            color: var(--text-light);
            font-size: 0.875rem;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .stat-value {
            font-size: 2rem;
            font-weight: 700;
            color: var(--text);
        }
        
        .admin-section {
            background: var(--surface);
            border-radius: 16px;
            padding: 2rem;
            box-shadow: var(--shadow);
            margin-bottom: 2rem;
            border: 1px solid var(--border);
        }
        
        .section-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 1.5rem;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        .danger-zone {
            border: 2px solid var(--danger);
            background: rgba(239, 68, 68, 0.05);
        }
        
        .danger-zone .section-title {
            color: var(--danger);
        }
        
        .settings-form {
            display: grid;
            gap: 1.5rem;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        
        .form-group label {
            font-weight: 600;
            color: var(--text);
        }
        
        .form-group input {
            padding: 0.75rem 1rem;
            border: 2px solid var(--border);
            border-radius: 8px;
            font-size: 1rem;
            transition: all 0.3s ease;
            background: var(--surface);
            color: var(--text);
        }
        
        .form-group input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        
        .logs-container {
            max-height: 400px;
            overflow-y: auto;
            border: 1px solid var(--border);
            border-radius: 8px;
        }
        
        .log-item {
            padding: 1rem;
            border-bottom: 1px solid var(--border);
            font-size: 0.875rem;
        }
        
        .log-item:last-child {
            border-bottom: none;
        }
        
        .log-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.5rem;
        }
        
        .log-student {
            font-weight: 600;
            color: var(--text);
        }
        
        .log-time {
            color: var(--text-light);
            font-size: 0.75rem;
        }
        
        .log-details {
            color: var(--text-light);
            margin-bottom: 0.5rem;
        }
        
        .log-score {
            font-weight: 700;
            padding: 0.25rem 0.5rem;
            border-radius: 12px;
            font-size: 0.75rem;
        }
        
        .log-score.add {
            background: rgba(16, 185, 129, 0.1);
            color: var(--secondary);
        }
        
        .log-score.minus {
            background: rgba(239, 68, 68, 0.1);
            color: var(--danger);
        }
        
        .log-score.revoke {
            background: rgba(245, 158, 11, 0.1);
            color: var(--warning);
        }
        
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.3s ease;
            backdrop-filter: blur(5px);
            padding: 1rem;
        }
        
        .modal-content {
            background: var(--surface);
            padding: 2rem;
            border-radius: 20px;
            width: 100%;
            max-width: 500px;
            animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: var(--shadow-lg);
            border: 1px solid var(--border);
            position: relative;
        }
        
        .modal-close {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: var(--text-light);
            transition: color 0.3s ease;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .modal-close:hover {
            color: var(--danger);
            background: rgba(239, 68, 68, 0.1);
        }
        
        @keyframes fadeIn { 
            from { opacity: 0; } 
            to { opacity: 1; } 
        }
        
        @keyframes slideUp { 
            from { transform: translateY(30px); opacity: 0; } 
            to { transform: translateY(0); opacity: 1; } 
        }
        
        .modal-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 1.5rem;
            color: var(--text);
            text-align: center;
        }
        
        .modal-actions { 
            display: flex; 
            gap: 1rem; 
            margin-top: 2rem; 
        }
        
        .modal-btn { 
            flex: 1; 
            padding: 0.75rem; 
            border: none; 
            border-radius: 8px; 
            cursor: pointer; 
            transition: all 0.3s ease; 
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }
        
        .submit-btn { 
            background: var(--secondary); 
            color: white; 
        }
        
        .submit-btn:hover { 
            background: #0da271;
            transform: translateY(-2px);
        }
        
        .cancel-btn { 
            background: var(--text-light); 
            color: white; 
        }
        
        .cancel-btn:hover { 
            background: #475569;
            transform: translateY(-2px);
        }
        
        .danger-btn { 
            background: var(--danger); 
            color: white; 
        }
        
        .danger-btn:hover { 
            background: #dc2626;
            transform: translateY(-2px);
        }
        
        .system-info {
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(255, 255, 255, 0.9);
            border-radius: 12px;
            padding: 1rem;
            font-size: 0.75rem;
            color: var(--text-light);
            backdrop-filter: blur(10px);
            border: 1px solid var(--border);
            max-width: 300px;
        }
        
        .footer {
            text-align: center;
            padding: 2rem;
            color: var(--text-light);
            font-size: 0.875rem;
            margin-top: 2rem;
            border-top: 1px solid var(--border);
        }
        
        @media (max-width: 768px) {
            .main-content { 
                padding: 1rem; 
            }
            
            .header { 
                padding: 1rem; 
                flex-direction: column;
                gap: 1rem;
            }
            
            .header-actions {
                width: 100%;
                justify-content: center;
                flex-wrap: wrap;
            }
            
            .modal-content {
                padding: 1.5rem;
                max-width: 95%;
            }
            
            .system-info {
                position: relative;
                bottom: auto;
                left: auto;
                margin: 2rem auto;
                max-width: 100%;
            }
        }
    </style>
</head>
<body>
    <div class="notification-container" id="notificationContainer"></div>
    
    <div class="header">
        <div class="admin-info">
            <h1>${settingMap.site_title || '2314班综合评分系统'}
                <span class="admin-badge">管理员模式</span>
            </h1>
            <div style="font-size: 0.875rem; color: var(--text-light);">
                系统管理面板
            </div>
        </div>
        
        <div class="header-actions">
            <a href="/class" class="btn btn-primary">
                <span>📊</span>
                班级视图
            </a>
            <button class="btn btn-secondary" onclick="createSnapshot()">
                <span>💾</span>
                保存快照
            </button>
            <a href="/snapshots" class="btn btn-secondary">
                <span>📈</span>
                历史数据
            </a>
            <button class="btn btn-secondary" onclick="logout()">
                <span>🚪</span>
                退出登录
            </button>
        </div>
    </div>

    <div class="main-content">
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-title">
                    <span>👥</span>
                    学生总数
                </div>
                <div class="stat-value">${studentsData.students ? studentsData.students.length : 0}</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-title">
                    <span>📈</span>
                    总加分
                </div>
                <div class="stat-value" style="color: var(--secondary);">${studentsData.students ? studentsData.students.reduce((acc, s) => acc + s.add_score, 0) : 0}</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-title">
                    <span>📉</span>
                    总扣分
                </div>
                <div class="stat-value" style="color: var(--danger);">${studentsData.students ? studentsData.students.reduce((acc, s) => acc + s.minus_score, 0) : 0}</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-title">
                    <span>📋</span>
                    操作日志数
                </div>
                <div class="stat-value" style="color: var(--primary);">${logs.results ? logs.results.length : 0}</div>
            </div>
        </div>

        <div class="admin-section">
            <div class="section-title">
                <span>⚙️</span>
                系统设置
            </div>
            
            <form class="settings-form" id="settingsForm">
                <div class="form-group">
                    <label>网站标题：</label>
                    <input type="text" name="site_title" value="${settingMap.site_title || ''}" required>
                </div>
                
                <div class="form-group">
                    <label>班级名称：</label>
                    <input type="text" name="class_name" value="${settingMap.class_name || ''}" required>
                </div>
                
                <div class="form-group">
                    <label>班级账号：</label>
                    <input type="text" name="class_username" value="${settingMap.class_username || ''}" required>
                </div>
                
                <div class="form-group">
                    <label>班级密码：</label>
                    <input type="password" name="class_password" value="${settingMap.class_password || ''}" required>
                </div>
                
                <div class="form-group">
                    <label>管理员账号：</label>
                    <input type="text" name="admin_username" value="${settingMap.admin_username || ''}" required>
                </div>
                
                <div class="form-group">
                    <label>管理员密码：</label>
                    <input type="password" name="admin_password" value="${settingMap.admin_password || ''}" required>
                </div>
                
                <button type="submit" class="btn btn-primary">
                    <span>💾</span>
                    保存设置
                </button>
            </form>
        </div>

        <div class="admin-section">
            <div class="section-title">
                <span>📋</span>
                系统操作日志
            </div>
            
            <div class="logs-container">
                ${logs.results ? logs.results.map(log => `
                    <div class="log-item">
                        <div class="log-header">
                            <div class="log-student">${log.student_name || '系统'}</div>
                            <div class="log-time">${new Date(log.created_at).toLocaleString('zh-CN')}</div>
                        </div>
                        <div class="log-details">
                            ${log.category_name || '系统操作'} - ${log.operator || '系统'} 
                            ${log.note ? ` - ${log.note}` : ''}
                            ${log.ip_address ? `<div style="font-size: 0.75rem; color: var(--text-light); margin-top: 0.25rem;">IP: ${log.ip_address}</div>` : ''}
                        </div>
                        <div class="log-score ${log.action_type}">
                            ${log.action_type === 'add' ? '+' : ''}${log.score_change}
                        </div>
                    </div>
                `).join('') : '<div style="text-align: center; padding: 2rem; color: var(--text-light);">暂无日志</div>'}
            </div>
        </div>

        <div class="admin-section danger-zone">
            <div class="section-title">
                <span>⚠️</span>
                危险操作区
            </div>
            
            <p style="color: var(--text-light); margin-bottom: 1.5rem;">
                以下操作不可逆，请谨慎操作！
            </p>
            
            <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                <button class="btn btn-danger" onclick="resetScores()">
                    <span>🔄</span>
                    重置所有分数
                </button>
                
                <button class="btn btn-danger" onclick="clearAllData()">
                    <span>🗑️</span>
                    清除所有数据
                </button>
            </div>
        </div>
    </div>

    <!-- 重置确认弹窗 -->
    <div class="modal-overlay" id="resetModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeResetModal()">×</button>
            <div class="modal-title">⚠️ 重置所有分数</div>
            
            <div style="margin-bottom: 1.5rem; color: var(--text-light);">
                <p>此操作将清空所有学生的评分记录，不可恢复！</p>
                <p>请确认您要执行此操作。</p>
            </div>
            
            <div class="form-group">
                <label>管理员账号：</label>
                <input type="text" id="resetAdminUsername" placeholder="请输入管理员账号">
            </div>
            
            <div class="form-group">
                <label>管理员密码：</label>
                <input type="password" id="resetAdminPassword" placeholder="请输入管理员密码">
            </div>
            
            <div class="form-group">
                <label>确认文本：</label>
                <input type="text" id="resetConfirmText" placeholder="请输入'确认清除所有数据'">
            </div>
            
            <div class="modal-actions">
                <button class="modal-btn cancel-btn" onclick="closeResetModal()">
                    <span>❌</span>
                    取消
                </button>
                <button class="modal-btn danger-btn" onclick="confirmReset()">
                    <span>✅</span>
                    确认重置
                </button>
            </div>
        </div>
    </div>

    <div class="footer">
        <p>By 2314 刘沁熙 | 基于Cloudflare Worker搭建 | Cloudflare CDN提供加速服务</p>
        <p id="systemInfo">加载中...</p>
    </div>

    <script>
        let wallpaperUrl = '';
        let ipInfo = null;
        let pageLoadTime = Date.now();
        
        // 页面加载完成
        document.addEventListener('DOMContentLoaded', async function() {
            // 加载壁纸
            await loadWallpaper();
            
            // 加载IP信息
            await loadIPInfo();
            
            // 更新系统信息
            updateSystemInfo();
            
            // 表单提交
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
                        showNotification('设置保存成功！', 'success');
                        setTimeout(() => location.reload(), 1000);
                    } else {
                        showNotification('保存失败，请重试', 'error');
                    }
                } catch (error) {
                    showNotification('网络错误，请重试', 'error');
                }
            });
        });
        
        // 加载壁纸
        async function loadWallpaper() {
            try {
                const response = await fetch('/api/wallpaper');
                const result = await response.json();
                
                if (result.success && result.data && result.data.length > 0) {
                    const wallpaper = result.data[0];
                    wallpaperUrl = 'https://www.bing.com' + wallpaper.url;
                    document.body.style.backgroundImage = \`url('\${wallpaperUrl}')\`;
                }
            } catch (error) {
                console.error('加载壁纸失败:', error);
            }
        }
        
        // 加载IP信息
        async function loadIPInfo() {
            try {
                const startTime = Date.now();
                const response = await fetch('/api/ip-info');
                const result = await response.json();
                
                if (result.success) {
                    ipInfo = result.data;
                    
                    // 显示IP通知
                    const latency = Date.now() - startTime;
                    showNotification(\`\${ipInfo.flag} \${ipInfo.city} | 延迟: \${latency}ms\`, 'info', 5000);
                }
            } catch (error) {
                console.error('加载IP信息失败:', error);
            }
        }
        
        // 更新系统信息
        function updateSystemInfo() {
            const now = new Date();
            const loadTime = Date.now() - pageLoadTime;
            const timeStr = now.toLocaleString('zh-CN');
            
            let info = \`页面加载时间: \${loadTime}ms | 当前时间: \${timeStr}\`;
            
            if (ipInfo) {
                info += \` | IP: \${ipInfo.ip} | 位置: \${ipInfo.city}, \${ipInfo.countryRegion}\`;
            }
            
            document.getElementById('systemInfo').textContent = info;
        }
        
        // 显示通知
        function showNotification(message, type = 'info', duration = 3000) {
            const container = document.getElementById('notificationContainer');
            const notification = document.createElement('div');
            notification.className = \`notification \${type}\`;
            notification.innerHTML = \`
                <span>\${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</span>
                <span>\${message}</span>
            \`;
            
            container.appendChild(notification);
            
            setTimeout(() => {
                notification.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }, duration);
        }
        
        // 创建快照
        async function createSnapshot() {
            const title = prompt('请输入快照标题（如：期中考核）:');
            if (!title) return;
            
            try {
                const response = await fetch('/api/snapshot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title })
                });

                const result = await response.json();

                if (result.success) {
                    showNotification('快照保存成功！', 'success');
                } else {
                    showNotification(result.error || '保存失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }
        
        // 重置分数
        function resetScores() {
            document.getElementById('resetModal').style.display = 'flex';
        }
        
        // 关闭重置弹窗
        function closeResetModal() {
            document.getElementById('resetModal').style.display = 'none';
        }
        
        // 确认重置
        async function confirmReset() {
            const username = document.getElementById('resetAdminUsername').value;
            const password = document.getElementById('resetAdminPassword').value;
            const confirmText = document.getElementById('resetConfirmText').value;
            
            if (!username || !password || !confirmText) {
                showNotification('请填写所有字段', 'error');
                return;
            }
            
            if (confirmText !== '确认清除所有数据') {
                showNotification('确认文本不正确', 'error');
                return;
            }
            
            try {
                const response = await fetch('/api/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        adminUsername: username,
                        adminPassword: password,
                        confirm: confirmText
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showNotification('重置成功！', 'success');
                    closeResetModal();
                    setTimeout(() => location.reload(), 1500);
                } else {
                    showNotification(result.error || '重置失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }
        
        // 清除所有数据
        async function clearAllData() {
            if (!confirm('⚠️ 警告：这将清空所有数据（包括历史记录）！确定要继续吗？')) return;
            if (!confirm('🚨 最后一次确认：此操作将永久删除所有数据！')) return;
            
            // 需要二次验证
            const username = prompt('请输入管理员账号:');
            const password = prompt('请输入管理员密码:');
            
            if (!username || !password) {
                showNotification('验证失败', 'error');
                return;
            }
            
            try {
                // 验证管理员
                const verifyResponse = await fetch('/api/verify-admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                
                const verifyResult = await verifyResponse.json();
                
                if (!verifyResult.success) {
                    showNotification('管理员验证失败', 'error');
                    return;
                }
                
                // 执行重置
                const resetResponse = await fetch('/api/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        adminUsername: username,
                        adminPassword: password,
                        confirm: '确认清除所有数据'
                    })
                });
                
                const resetResult = await resetResponse.json();
                
                if (resetResult.success) {
                    showNotification('所有数据已清除', 'success');
                    setTimeout(() => location.reload(), 1500);
                } else {
                    showNotification('操作失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
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
        
        // 点击弹窗外部关闭
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.style.display = 'none';
                }
            });
        });
        
        // 定期更新系统信息
        setInterval(updateSystemInfo, 60000);
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
async function renderVisitorPage(db) {
  try {
    const studentsData = await handleGetStudents(db).then(r => r.json());
    const settings = await db.prepare(
      'SELECT key, value FROM settings WHERE key IN (?, ?)'
    ).bind('site_title', 'class_name').all();

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    // 完整的访客页面HTML
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settingMap.site_title || '班级评分系统'} - 访客视图</title>
    <style>
        html, body { 
            height: 100%; 
            margin: 0; 
            overflow: auto; 
            background-color: #e0f7fa;
            font-family: 'Roboto', Arial, sans-serif;
        }
        
        body { 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center; 
            min-height: 100vh; 
            color: #333333;
            background-image: url('https://www.loliapi.com/acg/');
            background-size: cover; 
            background-position: center; 
            background-repeat: no-repeat;
            position: relative;
        }
        
        .content {
            text-align: center; 
            max-width: 90%;
            padding: 30px; 
            background-color: rgba(255, 255, 255, 0.3);
            border-radius: 15px; 
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            transform: scale(0.5);
            opacity: 0.5;
            filter: blur(10px);
            transition: transform 1s ease-out, opacity 1s ease-out, filter 1s ease-out;
        }
        
        .content.loaded {
            transform: scale(1);
            opacity: 1;
            filter: blur(0);
        }
        
        .content:hover {
            transform: scale(1.03);
            box-shadow: 0 12px 40px rgba(79, 195, 247, 0.5), 0 0 20px rgba(176, 196, 222, 0.3);
        }
        
        h1 { 
            font-size: 2.5rem; 
            margin-bottom: 20px; 
            color: #0277bd;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
        }
        
        .login-prompt { 
            text-align: center; 
            padding: 20px; 
            background: rgba(255, 255, 255, 0.2);
            border-radius: 10px;
            margin: 20px 0;
        }
        
        .login-btn { 
            background: linear-gradient(45deg, #4fc3f7, #81d4fa); 
            color: #333333; 
            padding: 12px 24px; 
            border: none; 
            border-radius: 25px; 
            text-decoration: none; 
            display: inline-block; 
            margin-top: 10px;
            font-weight: bold; 
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(79, 195, 247, 0.3);
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .login-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(79, 195, 247, 0.4);
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
        }
        
        .ranking-table { 
            width: 100%; 
            border-collapse: separate; 
            border-spacing: 0;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 10px;
            overflow: hidden;
            margin: 20px 0;
        }
        
        .ranking-table th, .ranking-table td { 
            padding: 15px; 
            text-align: center; 
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .ranking-table th { 
            background: rgba(79, 195, 247, 0.3); 
            font-weight: bold; 
            color: #333333;
        }
        
        .ranking-table tr:last-child td { 
            border-bottom: none; 
        }
        
        .ranking-table tr:hover td {
            background: rgba(79, 195, 247, 0.1);
        }
        
        .rank-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            color: white;
            font-weight: bold;
            font-size: 0.875rem;
            box-shadow: 0 2px 8px rgba(79, 195, 247, 0.3);
        }
        
        .rank-1 { 
            background: linear-gradient(45deg, #f59e0b, #d97706);
        }
        .rank-2 { 
            background: linear-gradient(45deg, #6b7280, #4b5563);
        }
        .rank-3 { 
            background: linear-gradient(45deg, #92400e, #78350f);
        }
        
        .positive { color: #10b981; font-weight: bold; }
        .negative { color: #ef4444; font-weight: bold; }
        .total { color: #0277bd; font-weight: bold; }
        
        .footer {
            margin-top: 30px;
            padding: 15px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 10px;
            font-size: 0.875rem;
            color: #333333;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        @media (max-width: 768px) {
            .content {
                max-width: 95%;
                padding: 20px;
            }
            
            h1 {
                font-size: 1.8rem;
            }
            
            .ranking-table {
                font-size: 0.9rem;
            }
            
            .ranking-table th, .ranking-table td {
                padding: 10px 5px;
            }
        }
    </style>
</head>
<body>
    <div class="content" id="contentContainer">
        <h1>${settingMap.site_title || '2314班综合评分系统'}</h1>
        <div style="color: #0277bd; margin-bottom: 20px; font-weight: bold;">
            ${settingMap.class_name || '2314班'} - 访客视图
        </div>
        
        <div class="login-prompt">
            <p style="font-size: 1.1rem; margin-bottom: 10px; color: #333333; font-weight: bold;">查看完整功能请登录系统</p>
            <a href="/login" class="login-btn">🔐 立即登录</a>
        </div>
        
        <div style="font-size: 1.2rem; margin: 20px 0; color: #0277bd; font-weight: bold;">🏆 学生评分总榜</div>
        
        <table class="ranking-table">
            <thead>
                <tr>
                    <th width="80">排名</th>
                    <th>姓名</th>
                    <th width="120">总分</th>
                </tr>
            </thead>
            <tbody>
                ${studentsData.success ? (studentsData.students || []).map((student, index) => `
                    <tr>
                        <td>
                            <div class="rank-badge ${index < 3 ? `rank-${index + 1}` : ''}">
                                ${index + 1}
                            </div>
                        </td>
                        <td style="font-weight: bold;">${student.name}</td>
                        <td class="total">
                            ${student.total_score > 0 ? '+' : ''}${student.total_score}
                        </td>
                    </tr>
                `).join('') : '<tr><td colspan="3" style="text-align: center; padding: 20px;">加载中...</td></tr>'}
            </tbody>
        </table>
        
        <div class="footer">
            <p>By 2314 刘沁熙 | 基于Cloudflare Worker搭建 | Cloudflare CDN提供加速服务</p>
            <p id="visitorInfo">加载中...</p>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', async function() {
            var container = document.getElementById('contentContainer');
            setTimeout(function() {
                container.classList.add('loaded');
            }, 100);
            
            // 加载IP信息
            await loadIPInfo();
            
            // 更新访客信息
            updateVisitorInfo();
        });
        
        // 加载IP信息
        async function loadIPInfo() {
            try {
                const startTime = Date.now();
                const response = await fetch('/api/ip-info');
                const result = await response.json();
                
                if (result.success) {
                    window.ipInfo = result.data;
                    window.pageLoadTime = startTime;
                }
            } catch (error) {
                console.error('加载IP信息失败:', error);
            }
        }
        
        // 更新访客信息
        function updateVisitorInfo() {
            const now = new Date();
            const loadTime = Date.now() - window.pageLoadTime;
            const timeStr = now.toLocaleString('zh-CN');
            
            let info = \`页面加载时间: \${loadTime}ms | 当前时间: \${timeStr}\`;
            
            if (window.ipInfo) {
                info += \` | 位置: \${window.ipInfo.city}, \${window.ipInfo.countryRegion}\`;
            }
            
            document.getElementById('visitorInfo').textContent = info;
        }
    </script>
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

// 渲染快照页面
async function renderSnapshotsPage(db, request) {
  try {
    const session = await validateSession(request, db);
    if (!session) {
      return Response.redirect(new URL('/login', request.url));
    }

    const snapshots = await handleGetSnapshots(db).then(r => r.json());
    const settings = await db.prepare(
      'SELECT key, value FROM settings WHERE key IN (?, ?)'
    ).bind('site_title', 'class_name').all();

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>历史数据 - ${settingMap.site_title || '班级评分系统'}</title>
    <style>
        html, body { 
            height: 100%; 
            margin: 0; 
            overflow: auto; 
            background-color: #e0f7fa;
            font-family: 'Roboto', Arial, sans-serif;
        }
        
        body { 
            min-height: 100vh; 
            color: #333333;
            background-image: url('https://www.loliapi.com/acg/');
            background-size: cover; 
            background-position: center; 
            background-repeat: no-repeat;
            position: relative;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.9);
            padding: 1rem 2rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .header h1 {
            color: #0277bd;
            font-size: 1.5rem;
            margin: 0;
        }
        
        .btn {
            padding: 0.5rem 1rem;
            border-radius: 25px;
            text-decoration: none;
            font-weight: bold;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .btn-primary {
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            color: #333333;
        }
        
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(79, 195, 247, 0.4);
        }
        
        .main-content {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        .snapshots-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 1.5rem;
            margin-top: 2rem;
        }
        
        .snapshot-card {
            background: rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            padding: 1.5rem;
            transition: all 0.3s ease;
            border: 1px solid rgba(79, 195, 247, 0.3);
            backdrop-filter: blur(5px);
        }
        
        .snapshot-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            background: rgba(255, 255, 255, 0.4);
        }
        
        .snapshot-title {
            font-size: 1.25rem;
            font-weight: bold;
            color: #0277bd;
            margin-bottom: 0.5rem;
        }
        
        .snapshot-meta {
            font-size: 0.875rem;
            color: #666666;
            margin-bottom: 1rem;
        }
        
        .snapshot-actions {
            display: flex;
            gap: 0.5rem;
            margin-top: 1rem;
        }
        
        .action-btn {
            flex: 1;
            padding: 0.5rem;
            border-radius: 8px;
            border: none;
            background: rgba(79, 195, 247, 0.2);
            color: #0277bd;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.25rem;
        }
        
        .action-btn:hover {
            background: rgba(79, 195, 247, 0.3);
            transform: translateY(-2px);
        }
        
        .empty-state {
            text-align: center;
            padding: 4rem 2rem;
            color: #666666;
        }
        
        .footer {
            text-align: center;
            padding: 2rem;
            color: #666666;
            font-size: 0.875rem;
            margin-top: 2rem;
        }
        
        @media (max-width: 768px) {
            .main-content {
                padding: 1rem;
            }
            
            .header {
                padding: 1rem;
                flex-direction: column;
                gap: 1rem;
            }
            
            .snapshots-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 历史数据 - ${settingMap.site_title || '班级评分系统'}</h1>
        <div>
            <a href="/class" class="btn btn-primary">
                <span>⬅️</span>
                返回班级视图
            </a>
        </div>
    </div>
    
    <div class="main-content">
        <p style="color: #666666; text-align: center;">
            这里是历史保存的快照数据，点击查看详情可以查看当时的评分情况。
        </p>
        
        ${snapshots.success && snapshots.snapshots && snapshots.snapshots.length > 0 ? `
            <div class="snapshots-grid">
                ${snapshots.snapshots.map(snapshot => `
                    <div class="snapshot-card">
                        <div class="snapshot-title">${snapshot.title}</div>
                        <div class="snapshot-meta">
                            <div>月份: ${snapshot.month}</div>
                            <div>保存时间: ${new Date(snapshot.created_at).toLocaleString('zh-CN')}</div>
                        </div>
                        <div class="snapshot-actions">
                            <button class="action-btn" onclick="viewSnapshot(${snapshot.id})">
                                <span>👁️</span>
                                查看详情
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : `
            <div class="empty-state">
                <h3>暂无历史数据</h3>
                <p>还没有保存过任何快照数据。</p>
            </div>
        `}
    </div>
    
    <div class="footer">
        <p>By 2314 刘沁熙 | 基于Cloudflare Worker搭建 | Cloudflare CDN提供加速服务</p>
    </div>

    <script>
        function viewSnapshot(snapshotId) {
            window.open(\`/snapshot-detail?id=\${snapshotId}\`, '_blank');
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

// 渲染快照详情页面
async function renderSnapshotDetailPage(db, url) {
  try {
    const snapshotId = url.searchParams.get('id');
    
    if (!snapshotId) {
      return renderErrorPage('缺少快照ID');
    }

    const snapshot = await handleGetSnapshotDetail(db, snapshotId).then(r => r.json());
    
    if (!snapshot.success) {
      return renderErrorPage(snapshot.error || '快照不存在');
    }

    const snapshotData = JSON.parse(snapshot.snapshot.snapshot_data);

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${snapshotData.title} - 历史数据详情</title>
    <style>
        html, body { 
            height: 100%; 
            margin: 0; 
            overflow: auto; 
            background-color: #e0f7fa;
            font-family: 'Roboto', Arial, sans-serif;
        }
        
        body { 
            min-height: 100vh; 
            color: #333333;
            background-image: url('https://www.loliapi.com/acg/');
            background-size: cover; 
            background-position: center; 
            background-repeat: no-repeat;
            position: relative;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.9);
            padding: 1rem 2rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .header h1 {
            color: #0277bd;
            font-size: 1.5rem;
            margin: 0;
        }
        
        .btn {
            padding: 0.5rem 1rem;
            border-radius: 25px;
            text-decoration: none;
            font-weight: bold;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .btn-primary {
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            color: #333333;
        }
        
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(79, 195, 247, 0.4);
        }
        
        .main-content {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        .snapshot-info {
            background: rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            padding: 1.5rem;
            margin-bottom: 2rem;
            border: 1px solid rgba(79, 195, 247, 0.3);
            backdrop-filter: blur(5px);
        }
        
        .snapshot-title {
            font-size: 1.5rem;
            font-weight: bold;
            color: #0277bd;
            margin-bottom: 0.5rem;
        }
        
        .snapshot-meta {
            font-size: 0.875rem;
            color: #666666;
        }
        
        .ranking-table { 
            width: 100%; 
            border-collapse: separate; 
            border-spacing: 0;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 10px;
            overflow: hidden;
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .ranking-table th, .ranking-table td { 
            padding: 15px; 
            text-align: center; 
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .ranking-table th { 
            background: rgba(79, 195, 247, 0.3); 
            font-weight: bold; 
            color: #333333;
        }
        
        .ranking-table tr:last-child td { 
            border-bottom: none; 
        }
        
        .ranking-table tr:hover td {
            background: rgba(79, 195, 247, 0.1);
        }
        
        .rank-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            color: white;
            font-weight: bold;
            font-size: 0.875rem;
            box-shadow: 0 2px 8px rgba(79, 195, 247, 0.3);
        }
        
        .rank-1 { 
            background: linear-gradient(45deg, #f59e0b, #d97706);
        }
        .rank-2 { 
            background: linear-gradient(45deg, #6b7280, #4b5563);
        }
        .rank-3 { 
            background: linear-gradient(45deg, #92400e, #78350f);
        }
        
        .positive { color: #10b981; font-weight: bold; }
        .negative { color: #ef4444; font-weight: bold; }
        .total { color: #0277bd; font-weight: bold; }
        
        .footer {
            text-align: center;
            padding: 2rem;
            color: #666666;
            font-size: 0.875rem;
            margin-top: 2rem;
        }
        
        @media (max-width: 768px) {
            .main-content {
                padding: 1rem;
            }
            
            .header {
                padding: 1rem;
                flex-direction: column;
                gap: 1rem;
            }
            
            .ranking-table {
                font-size: 0.9rem;
            }
            
            .ranking-table th, .ranking-table td {
                padding: 10px 5px;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 历史数据详情</h1>
        <div>
            <a href="/snapshots" class="btn btn-primary">
                <span>⬅️</span>
                返回历史数据
            </a>
        </div>
    </div>
    
    <div class="main-content">
        <div class="snapshot-info">
            <div class="snapshot-title">${snapshotData.title}</div>
            <div class="snapshot-meta">
                <div>保存时间: ${new Date(snapshotData.timestamp).toLocaleString('zh-CN')}</div>
                <div>快照ID: ${snapshot.snapshot.id}</div>
            </div>
        </div>
        
        <div style="font-size: 1.2rem; margin: 20px 0; color: #0277bd; font-weight: bold;">🏆 学生评分排名</div>
        
        <table class="ranking-table">
            <thead>
                <tr>
                    <th width="80">排名</th>
                    <th>姓名</th>
                    <th width="120">加分</th>
                    <th width="120">扣分</th>
                    <th width="120">总分</th>
                </tr>
            </thead>
            <tbody>
                ${snapshotData.students.sort((a, b) => b.total_score - a.total_score).map((student, index) => `
                    <tr>
                        <td>
                            <div class="rank-badge ${index < 3 ? `rank-${index + 1}` : ''}">
                                ${index + 1}
                            </div>
                        </td>
                        <td style="font-weight: bold;">${student.name}</td>
                        <td class="positive">${student.add_score}</td>
                        <td class="negative">${student.minus_score}</td>
                        <td class="total">${student.total_score > 0 ? '+' : ''}${student.total_score}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    
    <div class="footer">
        <p>By 2314 刘沁熙 | 基于Cloudflare Worker搭建 | Cloudflare CDN提供加速服务</p>
        <p>快照时间: ${new Date(snapshotData.timestamp).toLocaleString('zh-CN')}</p>
    </div>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    return renderErrorPage('快照详情页面加载失败: ' + error.message);
  }
}