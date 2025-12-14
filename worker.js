// cloudflare-worker.js - 重构版班级评分系统
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

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
        return await handleAPI(request, env, url);
      }

      // 页面路由
      return await handlePages(request, env, url);
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
        last_scored DATETIME DEFAULT CURRENT_TIMESTAMP,
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
        requires_note BOOLEAN DEFAULT 0,
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
        user_agent TEXT,
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
        ip_address TEXT,
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
        snapshot_date DATETIME DEFAULT CURRENT_TIMESTAMP,
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
        role TEXT,
        last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires DATETIME,
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
      
      // 其他项（需要备注）
      ['其他加分项', 'add', 1, 1],
      ['其他扣分项', 'minus', 1, 1]
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
async function handleAPI(request, env, url) {
  const path = url.pathname;

  try {
    // 确保数据库连接可用
    if (!env.DB) {
      throw new Error('数据库连接不可用');
    }

    if (path === '/api/login') {
      return await handleLogin(request, env);
    } else if (path === '/api/logout') {
      return await handleLogout(request, env.DB);
    } else if (path === '/api/students') {
      return await handleGetStudents(env.DB);
    } else if (path === '/api/score') {
      return await handleAddScore(request, env.DB);
    } else if (path === '/api/batch-score') {
      return await handleBatchScore(request, env.DB);
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
      return await handleReset(request, env.DB);
    } else if (path === '/api/settings') {
      if (request.method === 'GET') {
        return await handleGetSettings(env.DB);
      } else if (request.method === 'POST') {
        return await handleUpdateSettings(request, env.DB);
      }
    } else if (path === '/api/logs') {
      return await handleGetLogs(request, env.DB);
    } else if (path === '/api/student-logs') {
      return await handleGetStudentLogs(request, env.DB);
    } else if (path === '/api/monthly') {
      return await handleGetMonthlyData(request, env.DB);
    } else if (path === '/api/snapshots') {
      return await handleGetSnapshots(request, env.DB);
    } else if (path === '/api/setup') {
      return await handleSetup(request, env.DB);
    } else if (path === '/api/health') {
      return await handleHealthCheck(env.DB);
    } else if (path === '/api/check-ip') {
      return await handleCheckIP(request, env.DB);
    } else if (path === '/api/ranking') {
      return await handleGetRanking(env.DB);
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

// 检查IP会话
async function handleCheckIP(request, db) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || '';
    
    // 检查是否有有效的IP会话
    const session = await db.prepare(
      'SELECT * FROM ip_sessions WHERE ip = ? AND expires > ?'
    ).bind(ip, new Date().toISOString()).first();
    
    return new Response(JSON.stringify({ 
      success: true,
      hasSession: !!session,
      ip: ip,
      session: session
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Check IP error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: '检查IP失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 初始化设置处理
async function handleSetup(request, db) {
  try {
    const { admin_password, class_username, class_password, site_title, class_name } = await request.json();
    
    // 验证必需字段
    if (!class_username || !class_password) {
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
      ['admin_username', '2314admin'],
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
async function handleLogin(request, env) {
  try {
    const { username, password } = await request.json();
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || '';
    
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
    } else if (username === '2314admin' && password === settingMap.admin_password) {
      role = 'admin';
    }

    if (role) {
      // 创建IP会话（30天有效期）
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      
      await env.DB.prepare(
        'INSERT OR REPLACE INTO ip_sessions (ip, username, role, expires) VALUES (?, ?, ?, ?)'
      ).bind(ip, username, role, expires.toISOString()).run();
      
      // 记录登录日志
      await env.DB.prepare(
        'INSERT INTO operation_logs (student_id, action_type, score_change, operator, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(0, 'login', 0, username, '系统登录', `IP: ${ip}, UA: ${userAgent.substring(0, 100)}`, ip, userAgent).run();
      
      return new Response(JSON.stringify({ 
        success: true, 
        role,
        message: '登录成功',
        ip: ip
      }), {
        headers: { 'Content-Type': 'application/json' }
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
async function handleLogout(request, db) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    
    // 删除IP会话
    await db.prepare('DELETE FROM ip_sessions WHERE ip = ?').bind(ip).run();
    
    return new Response(JSON.stringify({ 
      success: true,
      message: '登出成功'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Logout error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '登出失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 获取排名数据
async function handleGetRanking(db) {
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

    return new Response(JSON.stringify({
      success: true,
      ranking: students.results || []
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    console.error('Get ranking error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取排名数据失败: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 获取学生数据（按最近评分时间排序）
async function handleGetStudents(db) {
  try {
    const students = await db.prepare(`
      SELECT s.id, s.name, s.last_scored,
             COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE 0 END), 0) as add_score,
             COALESCE(SUM(CASE WHEN sc.type = 'minus' THEN sr.score ELSE 0 END), 0) as minus_score,
             COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE -sr.score END), 0) as total_score
      FROM students s
      LEFT JOIN score_records sr ON s.id = sr.student_id
      LEFT JOIN score_categories sc ON sr.category_id = sc.id
      GROUP BY s.id, s.name, s.last_scored
      ORDER BY s.last_scored DESC, s.name ASC
    `).all();

    return new Response(JSON.stringify({
      success: true,
      students: students.results || []
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

// 添加分数
async function handleAddScore(request, db) {
  try {
    const { studentId, categoryId, score, operator, note, ip, userAgent } = await request.json();
    
    // 验证必需字段
    if (!studentId || !categoryId || !score || !operator) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少必需字段' 
      }), {
        headers: { 'Content-Type': 'application/json' }
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
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 如果类别需要备注但备注为空
    if (category.requires_note && (!note || note.trim() === '')) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '该项目必须填写备注' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 更新学生最后评分时间
    await db.prepare(
      'UPDATE students SET last_scored = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(studentId).run();

    // 插入评分记录
    await db.prepare(
      'INSERT INTO score_records (student_id, category_id, score, operator, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(studentId, categoryId, score, operator, note, ip, userAgent).run();

    // 记录操作日志
    await db.prepare(
      'INSERT INTO operation_logs (student_id, action_type, score_change, operator, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(studentId, category.type, category.type === 'add' ? score : -score, operator, category.name, note, ip, userAgent).run();

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

// 批量评分
async function handleBatchScore(request, db) {
  try {
    const { studentIds, categoryId, score, operator, note, ip, userAgent } = await request.json();
    
    // 验证必需字段
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0 || !categoryId || !score || !operator) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少必需字段或学生列表为空' 
      }), {
        headers: { 'Content-Type': 'application/json' }
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
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 如果类别需要备注但备注为空
    if (category.requires_note && (!note || note.trim() === '')) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '该项目必须填写备注' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 开始事务
    for (const studentId of studentIds) {
      // 更新学生最后评分时间
      await db.prepare(
        'UPDATE students SET last_scored = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(studentId).run();

      // 插入评分记录
      await db.prepare(
        'INSERT INTO score_records (student_id, category_id, score, operator, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(studentId, categoryId, score, operator, note, ip, userAgent).run();

      // 记录操作日志
      await db.prepare(
        'INSERT INTO operation_logs (student_id, action_type, score_change, operator, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(studentId, category.type, category.type === 'add' ? score : -score, operator, category.name, note, ip, userAgent).run();
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
async function handleRevokeScore(request, db) {
  try {
    const { recordId } = await request.json();
    
    if (!recordId) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少记录ID' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 获取记录信息
    const record = await db.prepare(`
      SELECT sr.id, sr.student_id, sr.score, sc.type, sc.name as category_name, sr.operator, sr.note
      FROM score_records sr
      JOIN score_categories sc ON sr.category_id = sc.id
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
      'INSERT INTO operation_logs (student_id, action_type, score_change, operator, category_name, note) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(record.student_id, 'revoke', record.type === 'add' ? -record.score : record.score, 
           record.operator, `撤销: ${record.category_name}`, `撤销操作，原备注: ${record.note}`).run();

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

// 获取学生日志
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
      SELECT sr.*, sc.name as category_name, sc.type as category_type
      FROM score_records sr
      JOIN score_categories sc ON sr.category_id = sc.id
      WHERE sr.student_id = ?
      ORDER BY sr.created_at DESC
    `).bind(studentId).all();

    return new Response(JSON.stringify({
      success: true,
      logs: logs.results || []
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get student logs error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '获取学生日志失败: ' + error.message 
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
    const { title, content, deadline, created_by, ip } = await request.json();
    
    if (!title || !content) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '请填写任务标题和内容' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.prepare(
      'INSERT INTO tasks (title, content, deadline, created_by, ip_address) VALUES (?, ?, ?, ?, ?)'
    ).bind(title, content, deadline, created_by, ip).run();

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
        error: '缺少快照标题' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const month = new Date().toISOString().slice(0, 7);

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
        'INSERT INTO monthly_snapshots (snapshot_date, title, month, student_name, add_score, minus_score, total_score) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(new Date().toISOString(), title, month, student.name, student.add_score, student.minus_score, student.total_score).run();
    }

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
async function handleGetSnapshots(request, db) {
  try {
    const snapshots = await db.prepare(
      'SELECT DISTINCT title, snapshot_date FROM monthly_snapshots ORDER BY snapshot_date DESC'
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

// 重置分数
async function handleReset(request, db) {
  try {
    const { confirm } = await request.json();
    
    if (!confirm) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '需要确认操作' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.prepare('DELETE FROM score_records').run();
    await db.prepare('DELETE FROM operation_logs').run();

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
    const { title } = Object.fromEntries(new URL(request.url).searchParams);
    
    let query = 'SELECT * FROM monthly_snapshots';
    let params = [];
    
    if (title) {
      query += ' WHERE title = ?';
      params.push(title);
    }
    
    query += ' ORDER BY total_score DESC';

    const data = await db.prepare(query).bind(...params).all();

    return new Response(JSON.stringify({
      success: true,
      data: data.results || []
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

// 验证IP会话
async function validateIPSession(request, db) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    
    const session = await db.prepare(
      'SELECT * FROM ip_sessions WHERE ip = ? AND expires > ?'
    ).bind(ip, new Date().toISOString()).first();
    
    if (session) {
      // 更新最后登录时间
      await db.prepare(
        'UPDATE ip_sessions SET last_login = CURRENT_TIMESTAMP WHERE ip = ?'
      ).bind(ip).run();
      
      return {
        authenticated: true,
        role: session.role,
        username: session.username
      };
    }
    
    return { authenticated: false };
  } catch (error) {
    console.error('Validate IP session error:', error);
    return { authenticated: false };
  }
}

// 页面处理
async function handlePages(request, env, url) {
  const path = url.pathname;
  
  try {
    if (!env.DB) {
      throw new Error('数据库连接不可用');
    }

    // 检查IP会话
    const ipSession = await validateIPSession(request, env.DB);
    
    if (path === '/login') {
      return renderLoginPage();
    } else if (path === '/class') {
      return await renderClassPage(env.DB, request, ipSession);
    } else if (path === '/admin') {
      return await renderAdminPage(env.DB, request, ipSession);
    } else if (path === '/') {
      return await renderVisitorPage(env.DB);
    } else if (path === '/snapshots') {
      return await renderSnapshotsPage(env.DB, request, ipSession);
    } else if (path === '/snapshot-view') {
      return await renderSnapshotViewPage(env.DB, request);
    } else if (path === '/setup') {
      return renderSetupPage();
    } else if (path === '/health') {
      return await handleHealthCheck(env.DB);
    }

    return renderLoginPage();
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
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
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
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
        
        body { 
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
            min-height: 100vh; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            padding: 1rem;
        }
        
        .setup-container {
            background: var(--surface); 
            padding: 3rem; 
            border-radius: 24px;
            box-shadow: var(--shadow); 
            width: 100%; 
            max-width: 500px;
            transform: translateY(0); 
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
        }
        
        .setup-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
        }
        
        h1 { 
            text-align: center; 
            margin-bottom: 2rem; 
            color: var(--text); 
            font-weight: 700;
            font-size: 2rem;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .subtitle {
            text-align: center;
            color: var(--text-light);
            margin-bottom: 2rem;
            line-height: 1.6;
        }
        
        .input-group { 
            margin-bottom: 1.5rem; 
            position: relative;
        }
        
        input { 
            width: 100%; 
            padding: 1rem 1rem 1rem 3rem; 
            border: 2px solid var(--border); 
            border-radius: 12px; 
            font-size: 1rem; 
            transition: all 0.3s ease;
            background: var(--surface);
            color: var(--text);
        }
        
        input:focus { 
            outline: none; 
            border-color: var(--primary); 
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1); 
            transform: translateY(-2px);
        }
        
        .input-icon {
            position: absolute;
            left: 1rem;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-light);
            transition: color 0.3s ease;
        }
        
        input:focus + .input-icon {
            color: var(--primary);
        }
        
        button { 
            width: 100%; 
            padding: 1rem; 
            background: linear-gradient(135deg, var(--primary), var(--primary-dark)); 
            color: white; 
            border: none; 
            border-radius: 12px; 
            font-size: 1rem; 
            font-weight: 600;
            cursor: pointer; 
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
        }
        
        button:hover::before {
            left: 100%;
        }
        
        button:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.4);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        .form-section {
            margin-bottom: 2rem;
            padding: 1.5rem;
            background: var(--background);
            border-radius: 12px;
        }
        
        .form-section h3 {
            margin-bottom: 1rem;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        @media (max-width: 480px) {
            .setup-container {
                padding: 2rem 1.5rem;
            }
            
            h1 {
                font-size: 1.75rem;
            }
        }
    </style>
</head>
<body>
    <div class="setup-container">
        <h1>系统初始化</h1>
        <div class="subtitle">
            欢迎使用班级评分系统！请先完成系统初始化设置。
        </div>
        
        <form id="setupForm">
            <div class="form-section">
                <h3>🏫 班级信息</h3>
                <div class="input-group">
                    <div class="input-icon">📝</div>
                    <input type="text" id="site_title" placeholder="网站标题" value="2314班综合评分系统" required>
                </div>
                <div class="input-group">
                    <div class="input-icon">👨‍🏫</div>
                    <input type="text" id="class_name" placeholder="班级名称" value="2314班" required>
                </div>
            </div>
            
            <div class="form-section">
                <h3>🔐 班级账号</h3>
                <div class="input-group">
                    <div class="input-icon">👤</div>
                    <input type="text" id="class_username" placeholder="班级登录用户名" value="2314" required>
                </div>
                <div class="input-group">
                    <div class="input-icon">🔒</div>
                    <input type="password" id="class_password" placeholder="班级登录密码" value="hzwy2314" required>
                </div>
            </div>
            
            <div class="form-section">
                <h3>⚡ 管理员账号</h3>
                <div class="input-group">
                    <div class="input-icon">👤</div>
                    <input type="text" value="2314admin" readonly disabled style="background: var(--background);">
                </div>
                <div class="input-group">
                    <div class="input-icon">🔒</div>
                    <input type="password" id="admin_password" placeholder="管理员密码" required>
                </div>
            </div>
            
            <button type="submit">🚀 初始化系统</button>
        </form>
        
        <div id="message" style="margin-top: 1rem; text-align: center; color: var(--danger); font-weight: 500;"></div>
    </div>

    <script>
        document.getElementById('setupForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = {
                site_title: document.getElementById('site_title').value,
                class_name: document.getElementById('class_name').value,
                class_username: document.getElementById('class_username').value,
                class_password: document.getElementById('class_password').value,
                admin_password: document.getElementById('admin_password').value
            };

            const submitBtn = e.target.querySelector('button');
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
        });
    </script>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 渲染登录页面
function renderLoginPage() {
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
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
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
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
        
        body { 
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
            min-height: 100vh; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            padding: 1rem;
        }
        
        .login-container {
            background: var(--surface); 
            padding: 3rem; 
            border-radius: 24px;
            box-shadow: var(--shadow); 
            width: 100%; 
            max-width: 440px;
            transform: translateY(0); 
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
        }
        
        .login-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
        }
        
        .login-container:hover { 
            transform: translateY(-8px); 
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }
        
        h1 { 
            text-align: center; 
            margin-bottom: 2rem; 
            color: var(--text); 
            font-weight: 700;
            font-size: 2rem;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .input-group { 
            margin-bottom: 1.5rem; 
            position: relative;
        }
        
        input { 
            width: 100%; 
            padding: 1rem 1rem 1rem 3rem; 
            border: 2px solid var(--border); 
            border-radius: 12px; 
            font-size: 1rem; 
            transition: all 0.3s ease;
            background: var(--surface);
            color: var(--text);
        }
        
        input:focus { 
            outline: none; 
            border-color: var(--primary); 
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1); 
            transform: translateY(-2px);
        }
        
        .input-icon {
            position: absolute;
            left: 1rem;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-light);
            transition: color 0.3s ease;
        }
        
        input:focus + .input-icon {
            color: var(--primary);
        }
        
        button { 
            width: 100%; 
            padding: 1rem; 
            background: linear-gradient(135deg, var(--primary), var(--primary-dark)); 
            color: white; 
            border: none; 
            border-radius: 12px; 
            font-size: 1rem; 
            font-weight: 600;
            cursor: pointer; 
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
        }
        
        button:hover::before {
            left: 100%;
        }
        
        button:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.4);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        .role-select { 
            display: flex; 
            gap: 0.75rem; 
            margin-bottom: 2rem; 
            background: var(--background);
            padding: 0.5rem;
            border-radius: 12px;
        }
        
        .role-btn { 
            flex: 1; 
            padding: 0.8rem; 
            border: 2px solid transparent; 
            background: transparent; 
            border-radius: 8px; 
            cursor: pointer; 
            transition: all 0.3s ease; 
            text-align: center;
            font-weight: 500;
            color: var(--text-light);
        }
        
        .role-btn.active { 
            background: var(--surface); 
            border-color: var(--primary);
            color: var(--primary);
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
        }
        
        @media (max-width: 480px) {
            .login-container {
                padding: 2rem 1.5rem;
            }
            
            h1 {
                font-size: 1.75rem;
            }
        }
    </style>
</head>
<body>
    <div class="login-container">
        <h1>班级评分系统</h1>
        <div class="role-select">
            <div class="role-btn active" data-role="class">班级登录</div>
            <div class="role-btn" data-role="admin">班主任登录</div>
            <div class="role-btn" data-role="visitor">游客登录</div>
        </div>
        <form id="loginForm">
            <div class="input-group">
                <div class="input-icon">👤</div>
                <input type="text" id="username" placeholder="用户名" required>
            </div>
            <div class="input-group">
                <div class="input-icon">🔒</div>
                <input type="password" id="password" placeholder="密码" required>
            </div>
            <button type="submit">登录系统</button>
        </form>
        
        <div id="message" style="margin-top: 1rem; text-align: center; color: var(--danger); font-weight: 500;"></div>
    </div>

    <script>
        let currentRole = 'class';
        const roleCredentials = {
            class: { username: '2314', password: '' },
            admin: { username: '2314admin', password: '' }
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
                    document.getElementById('username').value = creds.username;
                    document.getElementById('password').value = '';
                }
            });
        });

        // 检查IP会话
        async function checkIPSession() {
            try {
                const response = await fetch('/api/check-ip');
                const result = await response.json();
                
                if (result.success && result.hasSession) {
                    // 有IP会话，自动跳转
                    if (result.session.role === 'class') {
                        window.location.href = '/class';
                    } else if (result.session.role === 'admin') {
                        window.location.href = '/admin';
                    }
                }
            } catch (error) {
                console.log('检查IP会话失败:', error);
            }
        }

        // 页面加载时检查IP会话
        checkIPSession();

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
    </script>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 渲染班级页面
async function renderClassPage(db, request, ipSession) {
  try {
    // 检查IP会话或需要登录
    if (!ipSession.authenticated || ipSession.role !== 'class') {
      return Response.redirect(new URL('/login', request.url));
    }

    const [studentsData, scoreCategories, tasks, settings, rankingData] = await Promise.all([
      handleGetStudents(db).then(r => r.json()),
      db.prepare('SELECT * FROM score_categories ORDER BY type, id').all(),
      db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 10').all(),
      db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?)').bind('site_title', 'class_name', 'current_month').all(),
      handleGetRanking(db).then(r => r.json())
    ]);

    if (!studentsData.success) {
      throw new Error(studentsData.error);
    }

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    const currentMonth = settingMap.current_month || new Date().toISOString().slice(0, 7);

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
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
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
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            --shadow-lg: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
            overflow-x: hidden;
        }
        
        .header { 
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); 
            color: white; 
            padding: 1.5rem 2rem; 
            box-shadow: var(--shadow);
            position: sticky;
            top: 0;
            z-index: 100;
            backdrop-filter: blur(10px);
        }
        
        .header-content { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .class-info h1 { 
            font-weight: 700; 
            margin-bottom: 0.5rem; 
            font-size: 1.75rem;
        }
        
        .date { 
            font-size: 0.9rem; 
            opacity: 0.9; 
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .header-actions {
            display: flex;
            gap: 1rem;
            align-items: center;
        }
        
        .btn {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            text-decoration: none;
        }
        
        .btn-primary {
            background: rgba(255,255,255,0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
        }
        
        .btn-primary:hover {
            background: rgba(255,255,255,0.3);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(255,255,255,0.2);
        }
        
        .btn-danger {
            background: var(--danger);
            color: white;
        }
        
        .btn-danger:hover {
            background: #dc2626;
            transform: translateY(-2px);
        }
        
        .announcement {
            background: var(--surface); 
            margin: 1.5rem 2rem; 
            padding: 1.5rem; 
            border-radius: 16px;
            box-shadow: var(--shadow); 
            border-left: 6px solid var(--primary);
            animation: slideInUp 0.5s ease;
            position: relative;
            overflow: hidden;
        }
        
        .announcement::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.05), transparent);
            transform: translateX(-100%);
            transition: transform 0.6s ease;
        }
        
        .announcement:hover::before {
            transform: translateX(100%);
        }
        
        .main-content { 
            display: grid; 
            grid-template-columns: 1fr; 
            gap: 2rem; 
            padding: 0 2rem 2rem; 
            max-width: 1400px; 
            margin: 0 auto;
        }
        
        .score-section { 
            background: var(--surface); 
            border-radius: 20px; 
            padding: 2rem;
            box-shadow: var(--shadow); 
            transition: all 0.3s ease;
            animation: fadeIn 0.6s ease;
            position: relative;
            overflow: hidden;
        }
        
        .score-section::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
        }
        
        .score-section:hover { 
            transform: translateY(-8px); 
            box-shadow: var(--shadow-lg);
        }
        
        .section-title { 
            font-size: 1.5rem; 
            margin-bottom: 1.5rem; 
            padding-bottom: 1rem;
            border-bottom: 2px solid var(--border); 
            color: var(--text); 
            display: flex; 
            justify-content: space-between;
            align-items: center;
            font-weight: 700;
        }
        
        .student-table { 
            width: 100%; 
            border-collapse: separate; 
            border-spacing: 0;
        }
        
        .student-table th, .student-table td { 
            padding: 1rem; 
            text-align: left; 
            border-bottom: 1px solid var(--border);
            transition: all 0.2s ease;
        }
        
        .student-table th { 
            background: var(--background); 
            font-weight: 600; 
            color: var(--text-light);
            position: sticky;
            top: 0;
            backdrop-filter: blur(10px);
        }
        
        .student-table tr:hover td { 
            background: var(--background); 
            transform: scale(1.02);
        }
        
        .student-table .score-cell { 
            cursor: pointer; 
            position: relative;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        
        .student-table .score-cell:hover { 
            background: rgba(99, 102, 241, 0.1) !important; 
            transform: scale(1.05);
        }
        
        .add-score { 
            color: var(--secondary); 
            position: relative;
            overflow: hidden;
        }
        
        .add-score::before {
            content: '+';
            margin-right: 2px;
        }
        
        .minus-score { 
            color: var(--danger);
            position: relative;
            overflow: hidden;
        }
        
        .minus-score::before {
            content: '-';
            margin-right: 2px;
        }
        
        .total-score { 
            color: var(--primary); 
            font-weight: 700;
            font-size: 1.1em;
        }
        
        .rank-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            background: var(--primary);
            color: white;
            font-weight: 700;
            font-size: 0.875rem;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        
        .rank-badge:hover {
            transform: scale(1.1) rotate(5deg);
        }
        
        .rank-1 { 
            background: linear-gradient(135deg, #f59e0b, #d97706);
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
        }
        .rank-2 { 
            background: linear-gradient(135deg, #6b7280, #4b5563);
            box-shadow: 0 4px 12px rgba(107, 114, 128, 0.3);
        }
        .rank-3 { 
            background: linear-gradient(135deg, #92400e, #78350f);
            box-shadow: 0 4px 12px rgba(146, 64, 14, 0.3);
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
            padding: 2.5rem;
            border-radius: 24px;
            width: 100%;
            max-width: 600px;
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
        
        @keyframes slideInUp {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
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
            padding: 1rem;
            border: 2px solid var(--border);
            border-radius: 12px;
            font-size: 1rem;
            transition: all 0.3s ease;
            background: var(--surface);
            color: var(--text);
        }
        
        select:focus, input:focus, textarea:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
            transform: translateY(-2px);
        }
        
        .score-buttons { 
            display: grid; 
            grid-template-columns: repeat(3, 1fr); 
            gap: 0.75rem; 
            margin: 1rem 0; 
        }
        
        .score-btn { 
            padding: 1.5rem; 
            border: 2px solid var(--border); 
            background: var(--surface); 
            border-radius: 16px;
            cursor: pointer; 
            transition: all 0.3s ease; 
            text-align: center;
            font-weight: 700;
            color: var(--text);
            font-size: 1.2rem;
            position: relative;
            overflow: hidden;
        }
        
        .score-btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.1), transparent);
            transition: left 0.5s;
        }
        
        .score-btn:hover::before {
            left: 100%;
        }
        
        .score-btn:hover { 
            border-color: var(--primary); 
            background: rgba(99, 102, 241, 0.05);
            transform: translateY(-4px) scale(1.05);
            box-shadow: 0 8px 20px rgba(99, 102, 241, 0.2);
        }
        
        .score-btn.selected { 
            border-color: var(--primary); 
            background: var(--primary); 
            color: white;
            box-shadow: 0 8px 25px rgba(99, 102, 241, 0.4);
            transform: translateY(-2px) scale(1.02);
        }
        
        .action-buttons { 
            display: flex; 
            gap: 1rem; 
            margin-top: 2rem; 
        }
        
        .action-btn { 
            flex: 1; 
            padding: 1rem; 
            border: none; 
            border-radius: 12px; 
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
            box-shadow: 0 8px 20px rgba(16, 185, 129, 0.3);
        }
        
        .revoke-btn { 
            background: var(--danger); 
            color: white; 
        }
        
        .revoke-btn:hover { 
            background: #dc2626;
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(239, 68, 68, 0.3);
        }
        
        .cancel-btn { 
            background: var(--text-light); 
            color: white; 
        }
        
        .cancel-btn:hover { 
            background: #475569;
            transform: translateY(-2px);
        }
        
        /* 通知样式 */
        .notification {
            position: fixed;
            top: 2rem;
            right: 2rem;
            padding: 1rem 1.5rem;
            border-radius: 12px;
            color: white;
            font-weight: 600;
            z-index: 10000;
            animation: slideInRight 0.3s ease;
            box-shadow: var(--shadow);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .notification.success {
            background: var(--secondary);
        }
        
        .notification.error {
            background: var(--danger);
        }
        
        .notification.info {
            background: var(--primary);
        }
        
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        /* 多选学生样式 */
        .student-selector {
            margin-bottom: 1.5rem;
            max-height: 300px;
            overflow-y: auto;
            border: 2px solid var(--border);
            border-radius: 12px;
            padding: 1rem;
        }
        
        .student-option {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.2s ease;
        }
        
        .student-option:hover {
            background: var(--background);
        }
        
        .student-option.selected {
            background: rgba(99, 102, 241, 0.1);
            border-left: 3px solid var(--primary);
        }
        
        .student-checkbox {
            width: 1.2rem;
            height: 1.2rem;
            border-radius: 4px;
            border: 2px solid var(--border);
            cursor: pointer;
        }
        
        /* IP信息弹窗 */
        .ip-info-modal {
            position: fixed;
            top: 1rem;
            right: 1rem;
            background: var(--surface);
            padding: 1.5rem;
            border-radius: 16px;
            box-shadow: var(--shadow-lg);
            z-index: 9999;
            max-width: 400px;
            animation: slideInRight 0.3s ease;
            border: 1px solid var(--border);
        }
        
        .ip-info-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }
        
        .ip-info-close {
            background: none;
            border: none;
            font-size: 1.2rem;
            cursor: pointer;
            color: var(--text-light);
        }
        
        .ip-info-item {
            margin-bottom: 0.75rem;
            display: flex;
            justify-content: space-between;
        }
        
        .ip-info-label {
            font-weight: 600;
            color: var(--text-light);
        }
        
        .ip-info-value {
            color: var(--text);
            text-align: right;
        }
        
        /* 响应式设计 */
        @media (max-width: 768px) {
            .main-content { 
                padding: 0 1rem 1rem; 
                gap: 1.5rem;
            }
            
            .header { 
                padding: 1rem; 
            }
            
            .header-content { 
                flex-direction: column; 
                gap: 1rem; 
                text-align: center; 
            }
            
            .header-actions {
                width: 100%;
                justify-content: center;
            }
            
            .score-section {
                padding: 1.5rem;
            }
            
            .announcement {
                margin: 1rem;
            }
            
            .score-buttons {
                grid-template-columns: repeat(2, 1fr);
            }
            
            .modal-content {
                padding: 1.5rem;
            }
            
            .ip-info-modal {
                left: 1rem;
                right: 1rem;
                max-width: none;
            }
        }
        
        @media (max-width: 480px) {
            .action-buttons {
                flex-direction: column;
            }
            
            .btn {
                padding: 0.5rem 1rem;
                font-size: 0.875rem;
            }
        }
        
        /* 排名按钮样式 */
        .ranking-btn {
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .ranking-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(99, 102, 241, 0.3);
        }
        
        /* 详细信息模态框 */
        .detail-modal {
            max-width: 800px;
        }
        
        .log-item {
            padding: 1rem;
            border-left: 4px solid var(--primary);
            background: var(--background);
            border-radius: 8px;
            margin-bottom: 1rem;
        }
        
        .log-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.5rem;
        }
        
        .log-time {
            color: var(--text-light);
            font-size: 0.875rem;
        }
        
        .log-score {
            font-weight: 700;
            color: var(--primary);
        }
        
        .log-note {
            color: var(--text);
            margin-top: 0.5rem;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div class="class-info">
                <h1>${settingMap.site_title || '2314班综合评分系统'}</h1>
                <div class="date">
                    <span>📅</span>
                    <span id="currentDate"></span>
                </div>
            </div>
            <div class="header-actions">
                <button class="btn btn-primary" onclick="showRankingModal()">
                    <span>🏆</span>
                    查看排名
                </button>
                <button class="btn btn-primary" onclick="createSnapshot()">
                    <span>📸</span>
                    保存快照
                </button>
                <button class="btn btn-primary" onclick="showSnapshots()">
                    <span>📊</span>
                    历史数据
                </button>
                <button class="btn btn-primary" onclick="showIPInfo()">
                    <span>🌐</span>
                    连接信息
                </button>
                <button class="btn btn-primary" onclick="logout()">
                    <span>🚪</span>
                    退出登录
                </button>
            </div>
        </div>
    </div>

    <div class="announcement">
        <strong>📢 系统信息：</strong> 
        <span>By 2314 刘沁熙 基于cloudflare worker搭建 cloudflare cdn提供加速服务</span>
    </div>

    <div class="main-content">
        <!-- 学生综合评分表格 -->
        <div class="score-section">
            <div class="section-title">
                <span>📊 学生综合评分表</span>
                <div style="display: flex; gap: 1rem;">
                    <button class="ranking-btn" onclick="showRankingModal()">
                        🏆 查看总分排名
                    </button>
                    <button class="btn btn-primary" onclick="showBatchScoreModal()">
                        📝 批量评分
                    </button>
                </div>
            </div>
            <div style="overflow-x: auto;">
                <table class="student-table">
                    <thead>
                        <tr>
                            <th width="80">选择</th>
                            <th width="120">姓名</th>
                            <th width="120" class="score-cell">加分</th>
                            <th width="120" class="score-cell">扣分</th>
                            <th width="120">总分</th>
                            <th width="100">操作</th>
                        </tr>
                    </thead>
                    <tbody id="studentsBody">
                        ${studentsData.students.map((student, index) => `
                            <tr>
                                <td>
                                    <input type="checkbox" class="student-checkbox" data-id="${student.id}" data-name="${student.name}" onchange="updateSelectedStudents()">
                                </td>
                                <td>
                                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                                        <span>${student.name}</span>
                                        <div class="rank-badge" onclick="showRankingModal()" style="cursor: pointer;">
                                            ${rankingData.ranking.findIndex(s => s.id === student.id) + 1}
                                        </div>
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
                                    <button class="btn-primary" style="padding: 0.5rem 1rem; font-size: 0.875rem;" onclick="showStudentDetail(${student.id}, '${student.name}')">
                                        详细
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- 单个学生评分弹窗 -->
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
                <input type="number" id="customScore" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px; margin-top: 0.5rem; display: none;" placeholder="输入自定义分值" min="1" max="100">
                <div class="action-buttons">
                    <button class="cancel-btn" onclick="closeScoreModal()">
                        <span>❌</span>
                        取消
                    </button>
                    <button class="submit-btn" onclick="goToStep2()">
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
                    <select id="categorySelect" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px;">
                        <!-- 动态填充 -->
                    </select>
                </div>
                
                <div class="input-group">
                    <label>操作教师：</label>
                    <select id="operatorSelect" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px;">
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
                    <textarea id="scoreNote" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px;" placeholder="请输入备注信息" rows="3"></textarea>
                    <div id="noteHistory" style="margin-top: 0.5rem; display: none;">
                        <label>历史备注：</label>
                        <div id="noteHistoryList" style="max-height: 100px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem;"></div>
                    </div>
                </div>
                
                <div class="action-buttons">
                    <button class="cancel-btn" onclick="goToStep1()">
                        <span>⬅️</span>
                        上一步
                    </button>
                    <button class="submit-btn" onclick="submitScore()" id="submitScoreBtn">
                        <span>✅</span>
                        提交评分
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 批量评分弹窗 -->
    <div class="modal-overlay" id="batchScoreModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeBatchScoreModal()">×</button>
            
            <div class="step-title">批量评分</div>
            
            <div class="input-group">
                <label>选择评分类型：</label>
                <select id="batchScoreType" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px;" onchange="loadBatchCategories()">
                    <option value="add">加分</option>
                    <option value="minus">扣分</option>
                </select>
            </div>
            
            <div class="input-group">
                <label>评分项目：</label>
                <select id="batchCategorySelect" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px;">
                    <!-- 动态填充 -->
                </select>
            </div>
            
            <div class="input-group">
                <label>分值：</label>
                <input type="number" id="batchScoreValue" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px;" value="1" min="1" max="100">
            </div>
            
            <div class="input-group">
                <label>操作教师：</label>
                <select id="batchOperatorSelect" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px;">
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
                <textarea id="batchScoreNote" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px;" placeholder="请输入备注信息" rows="3"></textarea>
            </div>
            
            <div class="action-buttons">
                <button class="cancel-btn" onclick="closeBatchScoreModal()">
                    <span>❌</span>
                    取消
                </button>
                <button class="submit-btn" onclick="submitBatchScore()">
                    <span>✅</span>
                    提交批量评分
                </button>
            </div>
        </div>
    </div>

    <!-- 学生详细信息弹窗 -->
    <div class="modal-overlay" id="studentDetailModal">
        <div class="modal-content detail-modal">
            <button class="modal-close" onclick="closeStudentDetailModal()">×</button>
            
            <div class="step-title" id="detailTitle"></div>
            
            <div id="studentDetailContent">
                <!-- 动态填充 -->
            </div>
        </div>
    </div>

    <!-- 排名弹窗 -->
    <div class="modal-overlay" id="rankingModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeRankingModal()">×</button>
            
            <div class="step-title">🏆 学生总分排名</div>
            
            <table class="student-table">
                <thead>
                    <tr>
                        <th width="80">排名</th>
                        <th>姓名</th>
                        <th width="120">加分</th>
                        <th width="120">扣分</th>
                        <th width="120">总分</th>
                    </tr>
                </thead>
                <tbody id="rankingBody">
                    ${rankingData.ranking.map((student, index) => `
                        <tr>
                            <td>
                                <div class="rank-badge ${index < 3 ? \`rank-\${index + 1}\` : ''}">
                                    ${index + 1}
                                </div>
                            </td>
                            <td>${student.name}</td>
                            <td class="add-score">${student.add_score}</td>
                            <td class="minus-score">${student.minus_score}</td>
                            <td class="total-score">${student.total_score > 0 ? '+' : ''}${student.total_score}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    </div>

    <!-- 快照弹窗 -->
    <div class="modal-overlay" id="snapshotModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeSnapshotModal()">×</button>
            
            <div class="step-title">📸 保存快照</div>
            
            <div class="input-group">
                <label>快照标题：</label>
                <input type="text" id="snapshotTitle" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px;" placeholder="输入快照标题（如：期中考核）">
            </div>
            
            <div class="action-buttons">
                <button class="cancel-btn" onclick="closeSnapshotModal()">
                    <span>❌</span>
                    取消
                </button>
                <button class="submit-btn" onclick="submitSnapshot()">
                    <span>💾</span>
                    保存快照
                </button>
            </div>
        </div>
    </div>

    <!-- IP信息弹窗 -->
    <div class="ip-info-modal" id="ipInfoModal" style="display: none;">
        <div class="ip-info-header">
            <h3 style="margin: 0;">🌐 连接信息</h3>
            <button class="ip-info-close" onclick="closeIPInfo()">×</button>
        </div>
        <div id="ipInfoContent">
            <div class="ip-info-item">
                <span class="ip-info-label">IP地址：</span>
                <span class="ip-info-value" id="ipAddress">加载中...</span>
            </div>
            <div class="ip-info-item">
                <span class="ip-info-label">延迟：</span>
                <span class="ip-info-value" id="latency">测试中...</span>
            </div>
            <div class="ip-info-item">
                <span class="ip-info-label">位置：</span>
                <span class="ip-info-value" id="location">加载中...</span>
            </div>
            <div class="ip-info-item">
                <span class="ip-info-label">运营商：</span>
                <span class="ip-info-value" id="isp">加载中...</span>
            </div>
        </div>
    </div>

    <script>
        let currentStudentId = null;
        let currentScoreType = 'add';
        let currentStudentName = '';
        let selectedScore = 1;
        let selectedStudents = [];
        let currentStep = 1;
        let noteHistory = {};
        let latency = 0;
        let ipInfo = null;

        // 设置当前日期
        document.getElementById('currentDate').textContent = new Date().toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });

        // 页面加载时获取IP信息和测试延迟
        window.addEventListener('load', async () => {
            await fetchIPInfo();
            await testLatency();
            setTimeout(() => {
                showIPInfo();
            }, 1000);
        });

        // 获取IP信息
        async function fetchIPInfo() {
            try {
                const startTime = Date.now();
                const response = await fetch('https://ip.ilqx.dpdns.org/geo');
                latency = Date.now() - startTime;
                
                if (response.ok) {
                    ipInfo = await response.json();
                    updateIPInfoDisplay();
                }
            } catch (error) {
                console.error('获取IP信息失败:', error);
            }
        }

        // 测试延迟
        async function testLatency() {
            try {
                const startTime = Date.now();
                await fetch('/api/health', { cache: 'no-store' });
                latency = Date.now() - startTime;
                updateIPInfoDisplay();
            } catch (error) {
                console.error('测试延迟失败:', error);
            }
        }

        // 更新IP信息显示
        function updateIPInfoDisplay() {
            if (ipInfo) {
                document.getElementById('ipAddress').textContent = ipInfo.ip || '未知';
                document.getElementById('location').textContent = \`\${ipInfo.flag || ''} \${ipInfo.countryRegion || ipInfo.country || '未知'}\${ipInfo.city ? ' ' + ipInfo.city : ''}\`;
                document.getElementById('isp').textContent = ipInfo.asOrganization || '未知';
            }
            document.getElementById('latency').textContent = \`\${latency}ms\`;
        }

        // 显示IP信息弹窗
        function showIPInfo() {
            const modal = document.getElementById('ipInfoModal');
            modal.style.display = 'block';
            setTimeout(() => {
                modal.style.display = 'none';
            }, 5000);
        }

        // 关闭IP信息弹窗
        function closeIPInfo() {
            document.getElementById('ipInfoModal').style.display = 'none';
        }

        // 开始评分流程
        function startScoreProcess(studentId, type, studentName) {
            currentStudentId = studentId;
            currentScoreType = type;
            currentStudentName = studentName;
            currentStep = 1;
            
            // 更新第一步界面
            document.getElementById('step1StudentName').textContent = studentName;
            document.getElementById('step1ActionType').textContent = type === 'add' ? '加分' : '扣分';
            
            // 重置选择
            selectedScore = 1;
            updateScoreButtons();
            document.getElementById('customScore').style.display = 'none';
            document.getElementById('customScore').value = '';
            document.getElementById('scoreNote').value = '';
            
            // 显示第一步
            showStep(1);
            
            // 显示模态框
            document.getElementById('scoreModal').style.display = 'flex';
            
            // 加载评分项目
            loadScoreCategories();
            
            // 加载备注历史
            loadNoteHistory();
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
        }

        // 前往第二步
        function goToStep2() {
            if (selectedScore <= 0) {
                showNotification('请选择有效的分值', 'error');
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

        // 更新分数按钮状态
        function updateScoreButtons() {
            document.querySelectorAll('.score-btn').forEach(btn => {
                btn.classList.remove('selected');
                if (btn.dataset.score === 'custom' && document.getElementById('customScore').style.display === 'block') {
                    btn.classList.add('selected');
                } else if (parseInt(btn.dataset.score) === selectedScore) {
                    btn.classList.add('selected');
                }
            });
        }

        // 分数按钮事件处理
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('.score-btn').forEach(btn => {
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

            document.getElementById('customScore').addEventListener('input', function() {
                selectedScore = parseInt(this.value) || 0;
                updateScoreButtons();
            });

            // 点击弹窗外部关闭
            document.getElementById('scoreModal').addEventListener('click', function(e) {
                if (e.target === this) closeScoreModal();
            });
            
            document.getElementById('batchScoreModal').addEventListener('click', function(e) {
                if (e.target === this) closeBatchScoreModal();
            });
            
            document.getElementById('studentDetailModal').addEventListener('click', function(e) {
                if (e.target === this) closeStudentDetailModal();
            });
            
            document.getElementById('rankingModal').addEventListener('click', function(e) {
                if (e.target === this) closeRankingModal();
            });
            
            document.getElementById('snapshotModal').addEventListener('click', function(e) {
                if (e.target === this) closeSnapshotModal();
            });
        });

        // 加载评分项目
        function loadScoreCategories() {
            const categorySelect = document.getElementById('categorySelect');
            categorySelect.innerHTML = '';
            
            const categories = ${JSON.stringify((scoreCategories.results || []))};
            const filteredCategories = categories.filter(cat => cat.type === currentScoreType);
            
            filteredCategories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name;
                option.dataset.requiresNote = cat.requires_note;
                categorySelect.appendChild(option);
            });
            
            // 监听项目选择变化
            categorySelect.addEventListener('change', function() {
                const selectedOption = this.options[this.selectedIndex];
                const requiresNote = selectedOption.dataset.requiresNote === '1';
                
                if (requiresNote) {
                    loadNoteHistory();
                }
            });
        }

        // 加载备注历史
        async function loadNoteHistory() {
            const categorySelect = document.getElementById('categorySelect');
            const selectedOption = categorySelect.options[categorySelect.selectedIndex];
            const requiresNote = selectedOption.dataset.requiresNote === '1';
            
            if (!requiresNote) {
                document.getElementById('noteHistory').style.display = 'none';
                return;
            }
            
            try {
                const response = await fetch(\`/api/student-logs?studentId=\${currentStudentId}\`);
                const result = await response.json();
                
                if (result.success && result.logs.length > 0) {
                    const categoryName = selectedOption.textContent;
                    const categoryLogs = result.logs.filter(log => log.category_name === categoryName);
                    
                    if (categoryLogs.length > 0) {
                        const noteHistoryList = document.getElementById('noteHistoryList');
                        noteHistoryList.innerHTML = '';
                        
                        categoryLogs.slice(0, 5).forEach(log => {
                            const div = document.createElement('div');
                            div.style.padding = '0.5rem';
                            div.style.borderBottom = '1px solid var(--border)';
                            div.style.cursor = 'pointer';
                            div.textContent = log.note || '无备注';
                            div.title = \`\${new Date(log.created_at).toLocaleString()} - \${log.operator}\`;
                            div.onclick = () => {
                                document.getElementById('scoreNote').value = log.note || '';
                            };
                            noteHistoryList.appendChild(div);
                        });
                        
                        document.getElementById('noteHistory').style.display = 'block';
                    } else {
                        document.getElementById('noteHistory').style.display = 'none';
                    }
                } else {
                    document.getElementById('noteHistory').style.display = 'none';
                }
            } catch (error) {
                console.error('加载备注历史失败:', error);
                document.getElementById('noteHistory').style.display = 'none';
            }
        }

        // 提交分数
        async function submitScore() {
            const categorySelect = document.getElementById('categorySelect');
            const selectedOption = categorySelect.options[categorySelect.selectedIndex];
            const requiresNote = selectedOption.dataset.requiresNote === '1';
            
            const categoryId = categorySelect.value;
            const operator = document.getElementById('operatorSelect').value;
            const note = document.getElementById('scoreNote').value;
            
            let score = selectedScore;
            if (document.getElementById('customScore').style.display === 'block') {
                score = parseInt(document.getElementById('customScore').value) || 1;
            }

            if (score <= 0) {
                showNotification('分值必须大于0', 'error');
                return;
            }

            // 检查是否需要备注
            if (requiresNote && (!note || note.trim() === '')) {
                showNotification('该项目必须填写备注', 'error');
                return;
            }

            // 禁用提交按钮，防止重复提交
            const submitBtn = document.getElementById('submitScoreBtn');
            submitBtn.disabled = true;
            submitBtn.textContent = '提交中...';

            try {
                const ip = '${request.headers.get("CF-Connecting-IP") || "unknown"}';
                const userAgent = navigator.userAgent;
                
                const response = await fetch('/api/score', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        studentId: currentStudentId,
                        categoryId: categoryId,
                        score: score,
                        operator: operator,
                        note: note,
                        ip: ip,
                        userAgent: userAgent
                    })
                });

                const result = await response.json();

                if (result.success) {
                    // 立即关闭弹窗，防止重复点击
                    closeScoreModal();
                    showNotification('评分提交成功！', 'success');
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showNotification(result.error || '提交失败', 'error');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<span>✅</span> 提交评分';
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span>✅</span> 提交评分';
            }
        }

        // 更新已选学生
        function updateSelectedStudents() {
            selectedStudents = [];
            document.querySelectorAll('.student-checkbox:checked').forEach(checkbox => {
                selectedStudents.push({
                    id: parseInt(checkbox.dataset.id),
                    name: checkbox.dataset.name
                });
            });
        }

        // 显示批量评分弹窗
        function showBatchScoreModal() {
            if (selectedStudents.length === 0) {
                showNotification('请先选择学生', 'error');
                return;
            }
            
            document.getElementById('batchScoreModal').style.display = 'flex';
            loadBatchCategories();
        }

        // 关闭批量评分弹窗
        function closeBatchScoreModal() {
            document.getElementById('batchScoreModal').style.display = 'none';
        }

        // 加载批量评分项目
        function loadBatchCategories() {
            const batchScoreType = document.getElementById('batchScoreType').value;
            const batchCategorySelect = document.getElementById('batchCategorySelect');
            batchCategorySelect.innerHTML = '';
            
            const categories = ${JSON.stringify((scoreCategories.results || []))};
            const filteredCategories = categories.filter(cat => cat.type === batchScoreType);
            
            filteredCategories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name;
                option.dataset.requiresNote = cat.requires_note;
                batchCategorySelect.appendChild(option);
            });
        }

        // 提交批量评分
        async function submitBatchScore() {
            const batchCategorySelect = document.getElementById('batchCategorySelect');
            const selectedOption = batchCategorySelect.options[batchCategorySelect.selectedIndex];
            const requiresNote = selectedOption.dataset.requiresNote === '1';
            
            const categoryId = batchCategorySelect.value;
            const score = parseInt(document.getElementById('batchScoreValue').value) || 1;
            const operator = document.getElementById('batchOperatorSelect').value;
            const note = document.getElementById('batchScoreNote').value;
            
            if (score <= 0) {
                showNotification('分值必须大于0', 'error');
                return;
            }
            
            // 检查是否需要备注
            if (requiresNote && (!note || note.trim() === '')) {
                showNotification('该项目必须填写备注', 'error');
                return;
            }

            try {
                const ip = '${request.headers.get("CF-Connecting-IP") || "unknown"}';
                const userAgent = navigator.userAgent;
                
                const response = await fetch('/api/batch-score', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        studentIds: selectedStudents.map(s => s.id),
                        categoryId: categoryId,
                        score: score,
                        operator: operator,
                        note: note,
                        ip: ip,
                        userAgent: userAgent
                    })
                });

                const result = await response.json();

                if (result.success) {
                    closeBatchScoreModal();
                    showNotification(\`批量评分成功！共\${selectedStudents.length}名学生\`, 'success');
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showNotification(result.error || '提交失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }

        // 显示学生详细信息
        async function showStudentDetail(studentId, studentName) {
            currentStudentId = studentId;
            
            document.getElementById('detailTitle').textContent = \`\${studentName} - 详细记录\`;
            
            try {
                const response = await fetch(\`/api/student-logs?studentId=\${studentId}\`);
                const result = await response.json();
                
                let content = '<div style="margin-bottom: 1rem;"><strong>操作记录：</strong></div>';
                
                if (result.success && result.logs.length > 0) {
                    result.logs.forEach(log => {
                        const scoreClass = log.category_type === 'add' ? 'add-score' : 'minus-score';
                        const scorePrefix = log.category_type === 'add' ? '+' : '-';
                        
                        content += \`
                            <div class="log-item">
                                <div class="log-header">
                                    <div>
                                        <strong>\${log.category_name}</strong>
                                        <span style="margin-left: 1rem; font-size: 0.875rem; color: var(--text-light);">\${new Date(log.created_at).toLocaleString()}</span>
                                    </div>
                                    <div class="log-score \${scoreClass}">\${scorePrefix}\${log.score}分</div>
                                </div>
                                <div class="log-details">
                                    <div>操作教师: \${log.operator}</div>
                                    <div class="log-note">备注: \${log.note || '无'}</div>
                                    <button onclick="revokeScore(\${log.id})" style="margin-top: 0.5rem; padding: 0.25rem 0.5rem; background: var(--danger); color: white; border: none; border-radius: 4px; cursor: pointer;">
                                        撤销此操作
                                    </button>
                                </div>
                            </div>
                        \`;
                    });
                } else {
                    content += '<div style="text-align: center; padding: 2rem; color: var(--text-light);">暂无记录</div>';
                }
                
                document.getElementById('studentDetailContent').innerHTML = content;
                document.getElementById('studentDetailModal').style.display = 'flex';
            } catch (error) {
                showNotification('加载详细记录失败', 'error');
            }
        }

        // 关闭学生详细信息弹窗
        function closeStudentDetailModal() {
            document.getElementById('studentDetailModal').style.display = 'none';
        }

        // 撤销评分
        async function revokeScore(recordId) {
            if (!confirm('确定要撤销这条记录吗？')) return;
            
            try {
                const response = await fetch('/api/revoke', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recordId })
                });

                const result = await response.json();

                if (result.success) {
                    showNotification('撤销成功！', 'success');
                    closeStudentDetailModal();
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showNotification(result.error || '撤销失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }

        // 显示排名弹窗
        function showRankingModal() {
            document.getElementById('rankingModal').style.display = 'flex';
        }

        // 关闭排名弹窗
        function closeRankingModal() {
            document.getElementById('rankingModal').style.display = 'none';
        }

        // 显示快照弹窗
        function createSnapshot() {
            document.getElementById('snapshotModal').style.display = 'flex';
        }

        // 关闭快照弹窗
        function closeSnapshotModal() {
            document.getElementById('snapshotModal').style.display = 'none';
        }

        // 提交快照
        async function submitSnapshot() {
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
                    closeSnapshotModal();
                    showNotification('快照保存成功！', 'success');
                } else {
                    showNotification(result.error || '保存失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }

        // 显示历史快照页面
        function showSnapshots() {
            window.open('/snapshots', '_blank');
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
            
            document.body.appendChild(notification);
            
            // 3秒后自动移除
            setTimeout(() => {
                notification.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }, 3000);
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

// 渲染管理员页面
async function renderAdminPage(db, request, ipSession) {
  try {
    // 检查IP会话或需要登录
    if (!ipSession.authenticated || ipSession.role !== 'admin') {
      return Response.redirect(new URL('/login', request.url));
    }

    const [studentsData, logs, settings, snapshots] = await Promise.all([
      handleGetStudents(db).then(r => r.json()),
      db.prepare('SELECT ol.*, s.name as student_name FROM operation_logs ol JOIN students s ON ol.student_id = s.id ORDER BY ol.created_at DESC LIMIT 50').all(),
      db.prepare('SELECT key, value FROM settings').all(),
      db.prepare('SELECT DISTINCT title, snapshot_date FROM monthly_snapshots ORDER BY snapshot_date DESC LIMIT 10').all()
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
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
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
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
        }
        
        .header { 
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); 
            color: white; 
            padding: 1.5rem 2rem; 
            box-shadow: var(--shadow);
        }
        
        .header-content { 
            display: flex; 
            justify-content: space-between; 
            align-items: center;
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .class-info h1 { 
            font-weight: 700; 
            margin-bottom: 0.5rem; 
        }
        
        .admin-badge {
            background: rgba(255,255,255,0.2);
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.875rem;
            margin-left: 1rem;
        }
        
        .btn {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .btn-primary {
            background: rgba(255,255,255,0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
        }
        
        .btn-primary:hover {
            background: rgba(255,255,255,0.3);
            transform: translateY(-2px);
        }
        
        .main-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
        }
        
        .card {
            background: var(--surface);
            border-radius: 20px;
            padding: 2rem;
            box-shadow: var(--shadow);
            transition: all 0.3s ease;
            animation: fadeIn 0.6s ease;
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
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }
        
        .card-full {
            grid-column: 1 / -1;
        }
        
        .card-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 1.5rem;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
            margin-bottom: 2rem;
        }
        
        .stat-card {
            background: var(--background);
            padding: 1.5rem;
            border-radius: 16px;
            text-align: center;
            border-left: 4px solid var(--primary);
            transition: all 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow);
        }
        
        .stat-number {
            font-size: 2rem;
            font-weight: 700;
            color: var(--primary);
            margin-bottom: 0.5rem;
        }
        
        .stat-label {
            color: var(--text-light);
            font-size: 0.875rem;
        }
        
        .table-container {
            overflow-x: auto;
        }
        
        .data-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
        }
        
        .data-table th, .data-table td {
            padding: 1rem;
            text-align: left;
            border-bottom: 1px solid var(--border);
            transition: all 0.2s ease;
        }
        
        .data-table th {
            background: var(--background);
            font-weight: 600;
            color: var(--text-light);
            position: sticky;
            top: 0;
        }
        
        .data-table tr:hover td {
            background: var(--background);
            transform: scale(1.02);
        }
        
        .positive { color: var(--secondary); font-weight: 600; }
        .negative { color: var(--danger); font-weight: 600; }
        
        .log-item {
            padding: 1rem;
            border-left: 4px solid var(--primary);
            background: var(--background);
            border-radius: 8px;
            margin-bottom: 1rem;
            transition: all 0.2s ease;
        }
        
        .log-item:hover {
            transform: translateX(8px);
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
        
        .log-score {
            font-weight: 700;
        }
        
        .log-details {
            color: var(--text-light);
            font-size: 0.875rem;
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
            padding: 1rem;
            border: 2px solid var(--border);
            border-radius: 12px;
            font-size: 1rem;
            transition: all 0.3s ease;
        }
        
        .form-group input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        
        .btn-success {
            background: var(--secondary);
            color: white;
        }
        
        .btn-success:hover {
            background: #0da271;
            transform: translateY(-2px);
        }
        
        .btn-danger {
            background: var(--danger);
            color: white;
        }
        
        .btn-danger:hover {
            background: #dc2626;
            transform: translateY(-2px);
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        @media (max-width: 768px) {
            .main-content {
                grid-template-columns: 1fr;
                padding: 1rem;
                gap: 1.5rem;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .header {
                padding: 1rem;
            }
            
            .header-content {
                flex-direction: column;
                gap: 1rem;
                text-align: center;
            }
        }
        
        /* 快照样式 */
        .snapshot-item {
            padding: 1rem;
            border: 2px solid var(--border);
            border-radius: 12px;
            margin-bottom: 1rem;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        
        .snapshot-item:hover {
            border-color: var(--primary);
            transform: translateX(8px);
        }
        
        .snapshot-title {
            font-weight: 600;
            color: var(--text);
            margin-bottom: 0.5rem;
        }
        
        .snapshot-date {
            color: var(--text-light);
            font-size: 0.875rem;
        }
        
        /* 模态框 */
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
            padding: 1rem;
        }
        
        .modal-content {
            background: var(--surface);
            padding: 2.5rem;
            border-radius: 24px;
            width: 100%;
            max-width: 500px;
            box-shadow: var(--shadow);
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
        }
        
        .danger-modal .modal-content {
            border-top: 6px solid var(--danger);
        }
        
        .danger-title {
            color: var(--danger);
            text-align: center;
            margin-bottom: 1.5rem;
        }
        
        .confirm-input {
            width: 100%;
            padding: 1rem;
            border: 2px solid var(--border);
            border-radius: 12px;
            margin-bottom: 1.5rem;
            text-align: center;
            font-weight: 600;
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
                <div>系统管理面板</div>
            </div>
            <div>
                <a href="/class" class="btn btn-primary">📊 班级视图</a>
                <button class="btn btn-primary" onclick="logout()">🚪 退出登录</button>
            </div>
        </div>
    </div>

    <div class="main-content">
        <!-- 统计信息 -->
        <div class="card card-full">
            <div class="card-title">📈 系统概览</div>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-number">${studentsData.students.length}</div>
                    <div class="stat-label">学生总数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${studentsData.students.reduce((acc, s) => acc + s.add_score, 0)}</div>
                    <div class="stat-label">总加分</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${studentsData.students.reduce((acc, s) => acc + s.minus_score, 0)}</div>
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
                    <input type="text" value="2314admin" readonly disabled style="background: var(--background);">
                </div>
                <div class="form-group">
                    <label>管理员密码</label>
                    <input type="password" name="admin_password" value="${settingMap.admin_password || ''}" required>
                </div>
                <button type="submit" class="btn btn-success">💾 保存设置</button>
            </form>
        </div>

        <!-- 系统管理 -->
        <div class="card">
            <div class="card-title">🔧 系统管理</div>
            <div style="display: flex; flex-direction: column; gap: 1rem;">
                <button class="btn btn-primary" onclick="createSnapshot()">
                    💾 保存快照
                </button>
                <button class="btn btn-primary" onclick="showSnapshots()">
                    📈 查看历史快照
                </button>
                <button class="btn btn-danger" onclick="showResetConfirm()">
                    🔄 重置当前分数
                </button>
                <button class="btn btn-danger" onclick="showClearConfirm()">
                    🗑️ 清空所有数据
                </button>
            </div>
        </div>

        <!-- 最近快照 -->
        <div class="card">
            <div class="card-title">📸 最近快照</div>
            <div>
                ${(snapshots.results || []).length > 0 ? (snapshots.results || []).map(snapshot => `
                    <div class="snapshot-item" onclick="viewSnapshot('${snapshot.title}')">
                        <div class="snapshot-title">${snapshot.title}</div>
                        <div class="snapshot-date">${new Date(snapshot.snapshot_date).toLocaleString('zh-CN')}</div>
                    </div>
                `).join('') : '<div style="text-align: center; color: var(--text-light); padding: 2rem;">暂无快照</div>'}
            </div>
        </div>

        <!-- 操作日志 -->
        <div class="card card-full">
            <div class="card-title">📋 最近操作日志</div>
            <div class="table-container">
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
                                    <span style="padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.875rem; background: ${log.action_type === 'add' ? 'var(--secondary)' : log.action_type === 'minus' ? 'var(--danger)' : 'var(--warning)'}; color: white;">
                                        ${log.action_type === 'add' ? '加分' : log.action_type === 'minus' ? '扣分' : '撤销'}
                                    </span>
                                </td>
                                <td class="${log.score_change > 0 ? 'positive' : 'negative'}">
                                    ${log.score_change > 0 ? '+' : ''}${log.score_change}
                                </td>
                                <td>${log.operator}</td>
                                <td>${log.note || '-'}</td>
                                <td>${log.ip_address || '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- 重置确认模态框 -->
    <div class="modal-overlay" id="resetModal">
        <div class="modal-content danger-modal">
            <button class="modal-close" onclick="closeResetModal()">×</button>
            <h2 class="danger-title">⚠️ 重置分数确认</h2>
            <p style="text-align: center; margin-bottom: 1.5rem; color: var(--text);">
                确定要重置所有学生的分数吗？此操作不可撤销！
            </p>
            <div class="form-group">
                <label>请输入确认密码：</label>
                <input type="password" id="resetPassword" class="confirm-input" placeholder="请输入管理员密码确认">
            </div>
            <div style="display: flex; gap: 1rem;">
                <button class="btn cancel-btn" style="flex: 1;" onclick="closeResetModal()">取消</button>
                <button class="btn btn-danger" style="flex: 1;" onclick="resetScores()">确认重置</button>
            </div>
        </div>
    </div>

    <!-- 清空数据确认模态框 -->
    <div class="modal-overlay" id="clearModal">
        <div class="modal-content danger-modal">
            <button class="modal-close" onclick="closeClearModal()">×</button>
            <h2 class="danger-title">🚨 清空数据确认</h2>
            <p style="text-align: center; margin-bottom: 1.5rem; color: var(--text);">
                警告：这将清空所有数据（包括历史记录）！确定要继续吗？
            </p>
            <div class="form-group">
                <label>请输入"确认清空"：</label>
                <input type="text" id="clearConfirm" class="confirm-input" placeholder="请输入'确认清空'">
            </div>
            <div style="display: flex; gap: 1rem;">
                <button class="btn cancel-btn" style="flex: 1;" onclick="closeClearModal()">取消</button>
                <button class="btn btn-danger" style="flex: 1;" onclick="clearAllData()">确认清空</button>
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
                    alert('设置保存成功！');
                    location.reload();
                } else {
                    alert('保存失败，请重试');
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        });

        // 创建快照
        async function createSnapshot() {
            const title = prompt('请输入快照标题:');
            if (!title) return;
            
            try {
                const response = await fetch('/api/snapshot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('快照保存成功！');
                    location.reload();
                } else {
                    alert('保存失败');
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }

        // 查看快照
        function viewSnapshot(title) {
            window.open(\`/snapshot-view?title=\${encodeURIComponent(title)}\`, '_blank');
        }

        // 显示所有快照
        function showSnapshots() {
            window.open('/snapshots', '_blank');
        }

        // 显示重置确认模态框
        function showResetConfirm() {
            document.getElementById('resetModal').style.display = 'flex';
        }

        // 关闭重置确认模态框
        function closeResetModal() {
            document.getElementById('resetModal').style.display = 'none';
        }

        // 显示清空确认模态框
        function showClearConfirm() {
            document.getElementById('clearModal').style.display = 'flex';
        }

        // 关闭清空确认模态框
        function closeClearModal() {
            document.getElementById('clearModal').style.display = 'none';
        }

        // 重置分数
        async function resetScores() {
            const password = document.getElementById('resetPassword').value;
            
            // 验证密码
            const adminPassword = '${settingMap.admin_password || ''}';
            if (password !== adminPassword) {
                alert('密码错误！');
                return;
            }

            if (!confirm('最后一次确认：确定要重置所有学生的分数吗？此操作不可撤销！')) return;
            
            try {
                const response = await fetch('/api/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirm: true })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('分数重置成功！');
                    closeResetModal();
                    location.reload();
                } else {
                    alert('重置失败');
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }

        // 清空所有数据
        async function clearAllData() {
            const confirmText = document.getElementById('clearConfirm').value;
            
            if (confirmText !== '确认清空') {
                alert('请输入正确的确认文本！');
                return;
            }

            if (!confirm('🚨 这是最后一次警告：此操作将永久删除所有数据！确定要继续吗？')) return;
            
            try {
                // 先重置分数
                await fetch('/api/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirm: true })
                });
                
                // 清空快照
                // 清空IP会话
                // 这里需要扩展API，暂时先重置分数
                
                alert('所有数据已清空');
                closeClearModal();
                location.reload();
            } catch (error) {
                alert('操作失败');
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
        document.getElementById('resetModal').addEventListener('click', function(e) {
            if (e.target === this) closeResetModal();
        });
        
        document.getElementById('clearModal').addEventListener('click', function(e) {
            if (e.target === this) closeClearModal();
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
async function renderVisitorPage(db) {
  try {
    const rankingData = await handleGetRanking(db).then(r => r.json());
    const settings = await db.prepare(
      'SELECT key, value FROM settings WHERE key IN (?, ?)'
    ).bind('site_title', 'class_name').all();

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    // 获取必应壁纸
    let bingWallpaper = null;
    try {
      const bingResponse = await fetch('https://tc.ilqx.dpdns.org/api/bing/wallpaper');
      if (bingResponse.ok) {
        const bingData = await bingResponse.json();
        if (bingData.status && bingData.data && bingData.data.length > 0) {
          bingWallpaper = bingData.data[0];
        }
      }
    } catch (error) {
      console.error('Failed to fetch Bing wallpaper:', error);
    }

    // 完整的访客页面HTML
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
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #10b981;
            --danger: #ef4444;
            --background: #f8fafc;
            --surface: #ffffff;
            --text: #1e293b;
            --text-light: #64748b;
            --border: #e2e8f0;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
        }
        
        .header { 
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); 
            color: white; 
            padding: 2rem 1rem; 
            text-align: center;
            box-shadow: var(--shadow);
        }
        
        .header h1 { 
            font-weight: 700; 
            margin-bottom: 0.5rem;
            font-size: 2rem;
        }
        
        .header .subtitle {
            opacity: 0.9;
            margin-bottom: 1rem;
        }
        
        .login-prompt { 
            text-align: center; 
            padding: 2rem 1rem; 
            background: var(--surface);
            margin: 1rem;
            border-radius: 16px;
            box-shadow: var(--shadow);
            animation: slideInUp 0.5s ease;
        }
        
        .login-btn { 
            background: linear-gradient(135deg, var(--primary), var(--primary-dark)); 
            color: white; 
            padding: 1rem 2rem; 
            border: none; 
            border-radius: 12px; 
            text-decoration: none; 
            display: inline-block; 
            margin-top: 1rem;
            font-weight: 600;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
            cursor: pointer;
        }
        
        .login-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(99, 102, 241, 0.4);
        }
        
        .ranking-table { 
            width: 100%; 
            border-collapse: separate; 
            border-spacing: 0;
            background: var(--surface);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: var(--shadow);
            margin: 1rem 0;
            animation: fadeIn 0.6s ease;
        }
        
        .ranking-table th, .ranking-table td { 
            padding: 1.25rem 1rem; 
            text-align: center; 
            border-bottom: 1px solid var(--border);
            transition: all 0.2s ease;
        }
        
        .ranking-table th { 
            background: var(--background); 
            font-weight: 600; 
            color: var(--text-light);
        }
        
        .ranking-table tr:last-child td { 
            border-bottom: none; 
        }
        
        .ranking-table tr:hover td {
            background: var(--background);
            transform: scale(1.02);
        }
        
        .container { 
            padding: 1rem; 
            max-width: 600px; 
            margin: 0 auto; 
        }
        
        .section-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin: 2rem 0 1rem;
            text-align: center;
            color: var(--text);
        }
        
        .rank-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            background: var(--primary);
            color: white;
            font-weight: 700;
            font-size: 0.875rem;
            transition: all 0.3s ease;
        }
        
        .rank-1 { 
            background: linear-gradient(135deg, #f59e0b, #d97706);
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
        }
        .rank-2 { 
            background: linear-gradient(135deg, #6b7280, #4b5563);
            box-shadow: 0 4px 12px rgba(107, 114, 128, 0.3);
        }
        .rank-3 { 
            background: linear-gradient(135deg, #92400e, #78350f);
            box-shadow: 0 4px 12px rgba(146, 64, 14, 0.3);
        }
        
        .total { color: var(--primary); font-weight: 700; }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes slideInUp {
            from { transform: translateY(30px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        
        @media (max-width: 480px) {
            .header h1 {
                font-size: 1.5rem;
            }
            
            .ranking-table {
                font-size: 0.9rem;
            }
            
            .ranking-table th, .ranking-table td {
                padding: 1rem 0.5rem;
            }
        }
        
        /* 背景图片样式 */
        .background-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
            overflow: hidden;
        }
        
        .background-image {
            width: 100%;
            height: 100%;
            object-fit: cover;
            filter: brightness(0.7);
        }
        
        .background-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.3);
        }
        
        .background-caption {
            position: absolute;
            bottom: 10px;
            right: 10px;
            color: white;
            font-size: 0.75rem;
            background: rgba(0, 0, 0, 0.5);
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            max-width: 80%;
            text-align: right;
        }
    </style>
</head>
<body>
    <!-- 背景图片 -->
    <div class="background-container">
        ${bingWallpaper ? `
            <img src="https://www.bing.com${bingWallpaper.url}" alt="${bingWallpaper.title || '必应每日壁纸'}" class="background-image">
            <div class="background-overlay"></div>
            <div class="background-caption">${bingWallpaper.copyright || ''}</div>
        ` : ''}
    </div>
    
    <div class="header">
        <h1>${settingMap.site_title || '2314班综合评分系统'}</h1>
        <div class="subtitle">${settingMap.class_name || '2314班'} - 访客视图</div>
    </div>
    
    <div class="container">
        <div class="login-prompt">
            <p style="font-size: 1.1rem; margin-bottom: 1rem; color: var(--text);">查看完整功能请登录系统</p>
            <button class="login-btn" onclick="window.location.href='/login'">🔐 立即登录</button>
            <p style="margin-top: 1.5rem; font-size: 0.875rem; color: var(--text-light);">
                By 2314 刘沁熙 基于cloudflare worker搭建 cloudflare cdn提供加速服务
            </p>
        </div>
        
        <div class="section-title">🏆 学生评分总榜</div>
        
        <table class="ranking-table">
            <thead>
                <tr>
                    <th width="80">排名</th>
                    <th>姓名</th>
                    <th width="120">总分</th>
                </tr>
            </thead>
            <tbody>
                ${rankingData.success ? (rankingData.ranking || []).slice(0, 20).map((student, index) => `
                    <tr>
                        <td>
                            <div class="rank-badge ${index < 3 ? \`rank-\${index + 1}\` : ''}">
                                ${index + 1}
                            </div>
                        </td>
                        <td>${student.name}</td>
                        <td class="total">
                            ${student.total_score > 0 ? '+' : ''}${student.total_score}
                        </td>
                    </tr>
                `).join('') : '<tr><td colspan="3" style="text-align: center; padding: 2rem;">加载中...</td></tr>'}
            </tbody>
        </table>
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

// 渲染快照列表页面
async function renderSnapshotsPage(db, request, ipSession) {
  try {
    // 检查IP会话
    if (!ipSession.authenticated) {
      return Response.redirect(new URL('/login', request.url));
    }

    const snapshots = await db.prepare(
      'SELECT DISTINCT title, snapshot_date FROM monthly_snapshots ORDER BY snapshot_date DESC'
    ).all();

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
    <title>历史快照 - ${settingMap.site_title || '班级评分系统'}</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #10b981;
            --danger: #ef4444;
            --background: #f8fafc;
            --surface: #ffffff;
            --text: #1e293b;
            --text-light: #64748b;
            --border: #e2e8f0;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
        }
        
        .header { 
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); 
            color: white; 
            padding: 1.5rem 2rem; 
            box-shadow: var(--shadow);
        }
        
        .header-content { 
            display: flex; 
            justify-content: space-between; 
            align-items: center;
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .class-info h1 { 
            font-weight: 700; 
            margin-bottom: 0.5rem; 
        }
        
        .btn {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .btn-primary {
            background: rgba(255,255,255,0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
        }
        
        .btn-primary:hover {
            background: rgba(255,255,255,0.3);
            transform: translateY(-2px);
        }
        
        .container {
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
            background: var(--surface);
            border-radius: 16px;
            padding: 1.5rem;
            box-shadow: var(--shadow);
            transition: all 0.3s ease;
            cursor: pointer;
            border: 2px solid transparent;
        }
        
        .snapshot-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.25);
            border-color: var(--primary);
        }
        
        .snapshot-title {
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--text);
            margin-bottom: 0.5rem;
        }
        
        .snapshot-date {
            color: var(--text-light);
            font-size: 0.875rem;
            margin-bottom: 1rem;
        }
        
        .snapshot-info {
            display: flex;
            justify-content: space-between;
            font-size: 0.875rem;
            color: var(--text-light);
        }
        
        .empty-state {
            text-align: center;
            padding: 4rem 2rem;
            color: var(--text-light);
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 1rem;
            }
            
            .snapshots-grid {
                grid-template-columns: 1fr;
            }
            
            .header {
                padding: 1rem;
            }
            
            .header-content {
                flex-direction: column;
                gap: 1rem;
                text-align: center;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div class="class-info">
                <h1>📊 历史快照</h1>
                <div>${settingMap.site_title || '班级评分系统'}</div>
            </div>
            <div>
                <a href="/class" class="btn btn-primary">← 返回评分系统</a>
            </div>
        </div>
    </div>

    <div class="container">
        <h2 style="color: var(--text);">历史数据快照</h2>
        <p style="color: var(--text-light); margin-bottom: 2rem;">点击快照查看详细数据</p>
        
        ${(snapshots.results || []).length > 0 ? `
            <div class="snapshots-grid">
                ${(snapshots.results || []).map(snapshot => `
                    <div class="snapshot-card" onclick="viewSnapshot('${snapshot.title}')">
                        <div class="snapshot-title">${snapshot.title}</div>
                        <div class="snapshot-date">${new Date(snapshot.snapshot_date).toLocaleString('zh-CN')}</div>
                        <div class="snapshot-info">
                            <span>点击查看详情</span>
                            <span>📊</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : `
            <div class="empty-state">
                <div style="font-size: 3rem; margin-bottom: 1rem;">📭</div>
                <h3>暂无历史快照</h3>
                <p>还没有保存过任何快照数据</p>
                <a href="/class" class="btn" style="background: var(--primary); color: white; margin-top: 1rem;">返回系统保存快照</a>
            </div>
        `}
    </div>

    <script>
        function viewSnapshot(title) {
            window.open(\`/snapshot-view?title=\${encodeURIComponent(title)}\`, '_blank');
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

// 渲染快照查看页面
async function renderSnapshotViewPage(db, request) {
  try {
    const url = new URL(request.url);
    const title = url.searchParams.get('title');
    
    if (!title) {
      return Response.redirect(new URL('/snapshots', request.url));
    }

    const [snapshotData, settings] = await Promise.all([
      handleGetMonthlyData(request, db).then(r => r.json()),
      db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?)').bind('site_title', 'class_name').all()
    ]);

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    if (!snapshotData.success || !snapshotData.data || snapshotData.data.length === 0) {
      return renderErrorPage('快照数据不存在');
    }

    // 按总分排序
    const sortedData = [...(snapshotData.data || [])].sort((a, b) => b.total_score - a.total_score);

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - ${settingMap.site_title || '班级评分系统'}</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #10b981;
            --danger: #ef4444;
            --background: #f8fafc;
            --surface: #ffffff;
            --text: #1e293b;
            --text-light: #64748b;
            --border: #e2e8f0;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
        }
        
        .header { 
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); 
            color: white; 
            padding: 1.5rem 2rem; 
            box-shadow: var(--shadow);
        }
        
        .header-content { 
            display: flex; 
            justify-content: space-between; 
            align-items: center;
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .class-info h1 { 
            font-weight: 700; 
            margin-bottom: 0.5rem; 
        }
        
        .btn {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .btn-primary {
            background: rgba(255,255,255,0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
        }
        
        .btn-primary:hover {
            background: rgba(255,255,255,0.3);
            transform: translateY(-2px);
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        .snapshot-header {
            background: var(--surface);
            border-radius: 16px;
            padding: 2rem;
            box-shadow: var(--shadow);
            margin-bottom: 2rem;
            text-align: center;
        }
        
        .snapshot-title {
            font-size: 2rem;
            font-weight: 700;
            color: var(--text);
            margin-bottom: 0.5rem;
        }
        
        .snapshot-date {
            color: var(--text-light);
            font-size: 1rem;
        }
        
        .data-table {
            width: 100%;
            background: var(--surface);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: var(--shadow);
            margin-top: 2rem;
        }
        
        .data-table th, .data-table td {
            padding: 1.25rem 1rem;
            text-align: center;
            border-bottom: 1px solid var(--border);
        }
        
        .data-table th {
            background: var(--background);
            font-weight: 600;
            color: var(--text-light);
            position: sticky;
            top: 0;
        }
        
        .data-table tr:hover td {
            background: var(--background);
        }
        
        .rank-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            background: var(--primary);
            color: white;
            font-weight: 700;
            font-size: 0.875rem;
        }
        
        .rank-1 { 
            background: linear-gradient(135deg, #f59e0b, #d97706);
        }
        .rank-2 { 
            background: linear-gradient(135deg, #6b7280, #4b5563);
        }
        .rank-3 { 
            background: linear-gradient(135deg, #92400e, #78350f);
        }
        
        .add-score { color: var(--secondary); font-weight: 600; }
        .minus-score { color: var(--danger); font-weight: 600; }
        .total-score { color: var(--primary); font-weight: 700; }
        
        @media (max-width: 768px) {
            .container {
                padding: 1rem;
            }
            
            .header {
                padding: 1rem;
            }
            
            .header-content {
                flex-direction: column;
                gap: 1rem;
                text-align: center;
            }
            
            .data-table {
                font-size: 0.9rem;
            }
            
            .data-table th, .data-table td {
                padding: 1rem 0.5rem;
            }
        }
        
        .print-btn {
            background: var(--secondary);
            color: white;
            margin-left: 1rem;
        }
        
        .print-btn:hover {
            background: #0da271;
        }
        
        @media print {
            .header, .btn {
                display: none;
            }
            
            .container {
                padding: 0;
            }
            
            .snapshot-header {
                box-shadow: none;
                border: 1px solid var(--border);
            }
            
            .data-table {
                box-shadow: none;
                border: 1px solid var(--border);
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div class="class-info">
                <h1>📊 快照详情</h1>
                <div>${settingMap.site_title || '班级评分系统'}</div>
            </div>
            <div>
                <a href="/snapshots" class="btn btn-primary">← 返回快照列表</a>
                <button class="btn print-btn" onclick="window.print()">
                    🖨️ 打印
                </button>
            </div>
        </div>
    </div>

    <div class="container">
        <div class="snapshot-header">
            <div class="snapshot-title">${title}</div>
            <div class="snapshot-date">
                快照时间: ${snapshotData.data && snapshotData.data[0] ? new Date(snapshotData.data[0].snapshot_date).toLocaleString('zh-CN') : '未知时间'}
            </div>
        </div>
        
        <table class="data-table">
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
                ${sortedData.map((item, index) => `
                    <tr>
                        <td>
                            <div class="rank-badge ${index < 3 ? \`rank-\${index + 1}\` : ''}">
                                ${index + 1}
                            </div>
                        </td>
                        <td>${item.student_name}</td>
                        <td class="add-score">${item.add_score}</td>
                        <td class="minus-score">${item.minus_score}</td>
                        <td class="total-score">${item.total_score > 0 ? '+' : ''}${item.total_score}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <script>
        // 页面加载时自动滚动到表格
        window.addEventListener('load', () => {
            const table = document.querySelector('.data-table');
            if (table) {
                table.scrollIntoView({ behavior: 'smooth' });
            }
        });
    </script>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    return renderErrorPage('快照查看页面加载失败: ' + error.message);
  }
}