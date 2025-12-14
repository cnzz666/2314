﻿// cloudflare-worker.js - 现代化班级评分系统
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

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
      return await handlePages(request, env, url, clientIP);
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
        snapshot_time DATETIME DEFAULT CURRENT_TIMESTAMP,
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
      ['其他加分项', 'add', 1],
      
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
      ['其他扣分项', 'minus', 1]
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
async function handleAPI(request, env, url) {
  const path = url.pathname;
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

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
      return await handleAddScore(request, env.DB, clientIP, request.headers.get('User-Agent'));
    } else if (path === '/api/score-batch') {
      return await handleBatchScore(request, env.DB, clientIP, request.headers.get('User-Agent'));
    } else if (path === '/api/revoke') {
      return await handleRevokeScore(request, env.DB, clientIP);
    } else if (path === '/api/tasks') {
      if (request.method === 'GET') {
        return await handleGetTasks(env.DB);
      } else if (request.method === 'POST') {
        return await handleAddTask(request, env.DB, clientIP);
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
    } else if (path === '/api/monthly') {
      return await handleGetMonthlyData(request, env.DB);
    } else if (path === '/api/snapshots') {
      return await handleGetSnapshots(request, env.DB);
    } else if (path === '/api/setup') {
      return await handleSetup(request, env.DB);
    } else if (path === '/api/health') {
      return await handleHealthCheck(env.DB);
    } else if (path === '/api/ip-session') {
      return await handleIPSession(request, env.DB, clientIP);
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

// IP会话处理
async function handleIPSession(request, db, clientIP) {
  try {
    const session = await db.prepare(
      'SELECT username, role, expires FROM ip_sessions WHERE ip = ? AND expires > ?'
    ).bind(clientIP, new Date().toISOString()).first();
    
    return new Response(JSON.stringify({ 
      success: true,
      session: session || null
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false,
      error: error.message
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
    if (!class_username || !class_password || !admin_password) {
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
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    
    const settings = await env.DB.prepare(
      'SELECT key, value FROM settings WHERE key IN (?, ?, ?)'
    ).bind('class_username', 'class_password', 'admin_password').all();

    const settingMap = {};
    settings.results.forEach(row => {
      settingMap[row.key] = row.value;
    });

    let role = '';
    if (username === settingMap.class_username && password === settingMap.class_password) {
      role = 'class';
    } else if (password === settingMap.admin_password) {
      role = 'admin';
    }

    if (role) {
      // 存储IP会话
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30天
      await env.DB.prepare(
        'INSERT OR REPLACE INTO ip_sessions (ip, username, role, expires) VALUES (?, ?, ?, ?)'
      ).bind(clientIP, username, role, expires.toISOString()).run();
      
      // 记录登录日志
      await env.DB.prepare(
        'INSERT INTO operation_logs (student_id, action_type, score_change, operator, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(0, 'login', 0, username, '系统登录', `${role}用户登录`, clientIP, userAgent).run();
      
      return new Response(JSON.stringify({ 
        success: true, 
        role,
        message: '登录成功'
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
async function handleLogout(request, db, clientIP) {
  try {
    await db.prepare('DELETE FROM ip_sessions WHERE ip = ?').bind(clientIP).run();
    
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

// 添加分数
async function handleAddScore(request, db, clientIP, userAgent) {
  try {
    const { studentId, categoryId, score, operator, note } = await request.json();
    
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

    // 检查是否为其他项且无备注
    if ((category.name === '其他加分项' || category.name === '其他扣分项') && (!note || note.trim() === '')) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '其他项必须填写备注' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 插入评分记录
    await db.prepare(
      'INSERT INTO score_records (student_id, category_id, score, operator, note) VALUES (?, ?, ?, ?, ?)'
    ).bind(studentId, categoryId, score, operator, note || '').run();

    // 记录操作日志
    await db.prepare(
      'INSERT INTO operation_logs (student_id, action_type, score_change, operator, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(studentId, category.type, category.type === 'add' ? score : -score, operator, category.name, note || '', clientIP, userAgent).run();

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
async function handleBatchScore(request, db, clientIP, userAgent) {
  try {
    const { studentIds, categoryId, score, operator, note } = await request.json();
    
    // 验证必需字段
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0 || !categoryId || !score || !operator) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少必需字段' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 获取类别信息
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

    // 检查是否为其他项且无备注
    if ((category.name === '其他加分项' || category.name === '其他扣分项') && (!note || note.trim() === '')) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '其他项必须填写备注' 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 批量插入评分记录
    for (const studentId of studentIds) {
      await db.prepare(
        'INSERT INTO score_records (student_id, category_id, score, operator, note) VALUES (?, ?, ?, ?, ?)'
      ).bind(studentId, categoryId, score, operator, note || '').run();

      // 记录操作日志
      await db.prepare(
        'INSERT INTO operation_logs (student_id, action_type, score_change, operator, category_name, note, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(studentId, category.type, category.type === 'add' ? score : -score, operator, category.name, note || '', clientIP, userAgent).run();
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
      'INSERT INTO operation_logs (student_id, action_type, score_change, operator, category_name, note, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(record.student_id, 'revoke', record.type === 'add' ? -record.score : record.score, 
           record.operator, `撤销: ${record.category_name}`, '撤销操作', clientIP).run();

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
async function handleAddTask(request, db, clientIP) {
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

    // 记录操作日志
    await db.prepare(
      'INSERT INTO operation_logs (student_id, action_type, score_change, operator, category_name, note, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(0, 'task', 0, created_by, '发布任务', title, clientIP).run();

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
    const snapshotTime = new Date().toISOString();

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
        'INSERT INTO monthly_snapshots (snapshot_time, title, month, student_name, add_score, minus_score, total_score) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(snapshotTime, title, month, student.name, student.add_score, student.minus_score, student.total_score).run();
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: '快照保存成功',
      snapshot_time: snapshotTime,
      title: title
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
      'SELECT DISTINCT snapshot_time, title, month FROM monthly_snapshots ORDER BY snapshot_time DESC'
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
    await db.prepare('DELETE FROM score_records').run();
    await db.prepare('DELETE FROM operation_logs WHERE action_type != "login"').run();

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
      LEFT JOIN students s ON ol.student_id = s.id
      WHERE ol.student_id != 0
    `;
    let params = [];

    if (studentId) {
      query += ' AND ol.student_id = ?';
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
    const { snapshot_time } = Object.fromEntries(new URL(request.url).searchParams);
    
    let query = 'SELECT * FROM monthly_snapshots';
    let params = [];
    
    if (snapshot_time) {
      query += ' WHERE snapshot_time = ?';
      params.push(snapshot_time);
    }
    
    query += ' ORDER BY total_score DESC';
    
    const data = await db.prepare(query).bind(...params).all();

    return new Response(JSON.stringify({
      success: true,
      data: data.results || [],
      snapshot_time: snapshot_time || null
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

// 页面处理
async function handlePages(request, env, url, clientIP) {
  const path = url.pathname;
  
  try {
    if (!env.DB) {
      throw new Error('数据库连接不可用');
    }

    // 检查IP会话
    const ipSession = await env.DB.prepare(
      'SELECT username, role, expires FROM ip_sessions WHERE ip = ? AND expires > ?'
    ).bind(clientIP, new Date().toISOString()).first();

    if (path === '/login') {
      return renderLoginPage(ipSession);
    } else if (path === '/class') {
      return await renderClassPage(env.DB, request, clientIP, ipSession);
    } else if (path === '/admin') {
      return await renderAdminPage(env.DB, request, clientIP, ipSession);
    } else if (path === '/') {
      return await renderVisitorPage(env.DB);
    } else if (path === '/logs') {
      return await renderLogsPage(env.DB, url);
    } else if (path === '/snapshots') {
      return await renderSnapshotsPage(env.DB);
    } else if (path === '/snapshot-view') {
      return await renderSnapshotViewPage(env.DB, url);
    } else if (path === '/setup') {
      return renderSetupPage();
    } else if (path === '/health') {
      return await handleHealthCheck(env.DB);
    }

    return renderLoginPage(ipSession);
  } catch (error) {
    console.error('Page render error:', error);
    return renderErrorPage('页面渲染错误: ' + error.message);
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
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        body { 
            background: #e0f7fa;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            position: relative;
            overflow: hidden;
        }
        
        body::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('https://tc.ilqx.dpdns.org/api/bing/wallpaper');
            background-size: cover;
            background-position: center;
            filter: blur(8px);
            z-index: -2;
        }
        
        body::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, rgba(79, 195, 247, 0.2), rgba(176, 196, 222, 0.2));
            z-index: -1;
        }
        
        .error-container {
            background: rgba(255, 255, 255, 0.3);
            padding: 3rem;
            border-radius: 15px;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            text-align: center;
            max-width: 500px;
            transform: scale(0.5);
            opacity: 0.5;
            filter: blur(10px);
            transition: transform 1s ease-out, opacity 1s ease-out, filter 1s ease-out;
        }
        
        .error-container.loaded {
            transform: scale(1);
            opacity: 1;
            filter: blur(0);
        }
        
        .error-container:hover {
            transform: scale(1.03);
            box-shadow: 0 12px 40px rgba(79, 195, 247, 0.5), 0 0 20px rgba(176, 196, 222, 0.3);
        }
        
        h1 { 
            color: #0277bd;
            margin-bottom: 1rem;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
        }
        
        p { 
            color: #333333;
            margin-bottom: 2rem;
            line-height: 1.6;
        }
        
        .btn { 
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            color: #333333;
            padding: 1rem 2rem;
            border: none;
            border-radius: 25px;
            text-decoration: none;
            display: inline-block;
            font-weight: bold;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        
        .btn:hover {
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
    </style>
</head>
<body>
    <div class="error-container loaded">
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
        
        body { 
            background: #e0f7fa;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            position: relative;
            overflow: hidden;
        }
        
        body::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('https://tc.ilqx.dpdns.org/api/bing/wallpaper');
            background-size: cover;
            background-position: center;
            filter: blur(8px);
            z-index: -2;
        }
        
        body::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, rgba(79, 195, 247, 0.2), rgba(176, 196, 222, 0.2));
            z-index: -1;
        }
        
        .setup-container {
            background: rgba(255, 255, 255, 0.3);
            padding: 3rem;
            border-radius: 15px;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            width: 100%;
            max-width: 500px;
            transform: scale(0.5);
            opacity: 0.5;
            filter: blur(10px);
            transition: transform 1s ease-out, opacity 1s ease-out, filter 1s ease-out;
            position: relative;
        }
        
        .setup-container.loaded {
            transform: scale(1);
            opacity: 1;
            filter: blur(0);
        }
        
        .setup-container:hover {
            transform: scale(1.03);
            box-shadow: 0 12px 40px rgba(79, 195, 247, 0.5), 0 0 20px rgba(176, 196, 222, 0.3);
        }
        
        h1 { 
            text-align: center;
            margin-bottom: 2rem;
            color: #0277bd;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
        }
        
        .subtitle {
            text-align: center;
            color: #333333;
            margin-bottom: 2rem;
            line-height: 1.6;
            opacity: 0.9;
        }
        
        .input-group { 
            margin-bottom: 1.5rem;
        }
        
        input { 
            width: 100%;
            padding: 1rem;
            background-color: rgba(255, 255, 255, 0.5);
            border: 1px solid rgba(79, 195, 247, 0.5);
            border-radius: 25px;
            font-size: 1rem;
            color: #333333;
            text-align: center;
            outline: none;
            transition: all 0.3s ease;
        }
        
        input:focus {
            background-color: rgba(255, 255, 255, 0.7);
            border-color: #0277bd;
            box-shadow: 0 0 10px rgba(79, 195, 247, 0.3);
        }
        
        button { 
            width: 100%;
            padding: 1rem;
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            border: none;
            border-radius: 25px;
            color: #333333;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        button:hover {
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
        
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .form-section {
            margin-bottom: 2rem;
            padding: 1.5rem;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 12px;
        }
        
        .form-section h3 {
            margin-bottom: 1rem;
            color: #0277bd;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        #message {
            margin-top: 1rem;
            text-align: center;
            color: #ef4444;
            font-weight: 500;
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
    <div class="setup-container loaded">
        <h1>系统初始化</h1>
        <div class="subtitle">
            欢迎使用班级评分系统！请先完成系统初始化设置。
        </div>
        
        <form id="setupForm">
            <div class="form-section">
                <h3>🏫 班级信息</h3>
                <div class="input-group">
                    <input type="text" id="site_title" placeholder="网站标题" value="2314班综合评分系统" required>
                </div>
                <div class="input-group">
                    <input type="text" id="class_name" placeholder="班级名称" value="2314班" required>
                </div>
            </div>
            
            <div class="form-section">
                <h3>🔐 班级账号</h3>
                <div class="input-group">
                    <input type="text" id="class_username" placeholder="班级登录用户名" value="2314" required>
                </div>
                <div class="input-group">
                    <input type="password" id="class_password" placeholder="班级登录密码" value="hzwy2314" required>
                </div>
            </div>
            
            <div class="form-section">
                <h3>⚡ 管理员密码</h3>
                <div class="input-group">
                    <input type="password" id="admin_password" placeholder="管理员密码" value="2314admin2314admin" required>
                </div>
            </div>
            
            <button type="submit" id="submitBtn">🚀 初始化系统</button>
        </form>
        
        <div id="message"></div>
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

            const submitBtn = document.getElementById('submitBtn');
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
function renderLoginPage(ipSession) {
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
        
        body { 
            background: #e0f7fa;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            position: relative;
            overflow: hidden;
        }
        
        body::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('https://tc.ilqx.dpdns.org/api/bing/wallpaper');
            background-size: cover;
            background-position: center;
            filter: blur(8px);
            z-index: -2;
        }
        
        body::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, rgba(79, 195, 247, 0.2), rgba(176, 196, 222, 0.2));
            z-index: -1;
        }
        
        .login-container {
            background: rgba(255, 255, 255, 0.3);
            padding: 3rem;
            border-radius: 15px;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            width: 100%;
            max-width: 440px;
            transform: scale(0.5);
            opacity: 0.5;
            filter: blur(10px);
            transition: transform 1s ease-out, opacity 1s ease-out, filter 1s ease-out;
            position: relative;
        }
        
        .login-container.loaded {
            transform: scale(1);
            opacity: 1;
            filter: blur(0);
        }
        
        .login-container:hover {
            transform: scale(1.03);
            box-shadow: 0 12px 40px rgba(79, 195, 247, 0.5), 0 0 20px rgba(176, 196, 222, 0.3);
        }
        
        h1 { 
            text-align: center;
            margin-bottom: 2rem;
            color: #0277bd;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
        }
        
        .input-group { 
            margin-bottom: 1.5rem;
        }
        
        input { 
            width: 100%;
            padding: 1rem;
            background-color: rgba(255, 255, 255, 0.5);
            border: 1px solid rgba(79, 195, 247, 0.5);
            border-radius: 25px;
            font-size: 1rem;
            color: #333333;
            text-align: center;
            outline: none;
            transition: all 0.3s ease;
        }
        
        input:focus {
            background-color: rgba(255, 255, 255, 0.7);
            border-color: #0277bd;
            box-shadow: 0 0 10px rgba(79, 195, 247, 0.3);
        }
        
        button { 
            width: 100%;
            padding: 1rem;
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            border: none;
            border-radius: 25px;
            color: #333333;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        button:hover {
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
        
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .role-select { 
            display: flex;
            gap: 0.75rem;
            margin-bottom: 2rem;
            background: rgba(255, 255, 255, 0.2);
            padding: 0.5rem;
            border-radius: 12px;
        }
        
        .role-btn { 
            flex: 1;
            padding: 0.8rem;
            background: transparent;
            border: 2px solid transparent;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            text-align: center;
            font-weight: 500;
            color: #333333;
        }
        
        .role-btn.active { 
            background: rgba(255, 255, 255, 0.3);
            border-color: #0277bd;
            color: #0277bd;
            box-shadow: 0 4px 12px rgba(79, 195, 247, 0.15);
        }
        
        .login-info {
            margin-top: 1.5rem;
            padding: 1rem;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 12px;
            font-size: 0.875rem;
            color: #333333;
            opacity: 0.9;
            text-align: center;
        }
        
        #message {
            margin-top: 1rem;
            text-align: center;
            color: #ef4444;
            font-weight: 500;
        }
        
        .ip-info {
            margin-top: 1rem;
            padding: 0.5rem;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            font-size: 0.75rem;
            color: #333333;
            text-align: center;
        }
        
        @media (max-width: 480px) {
            .login-container {
                padding: 2rem 1.5rem;
            }
            
            h1 {
                font-size: 1.75rem;
            }
            
            .role-select {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="login-container loaded">
        <h1>班级评分系统</h1>
        <div class="role-select">
            <div class="role-btn active" data-role="class">班级登录</div>
            <div class="role-btn" data-role="visitor">游客登录</div>
        </div>
        <form id="loginForm">
            <div class="input-group">
                <input type="text" id="username" placeholder="用户名" required>
            </div>
            <div class="input-group">
                <input type="password" id="password" placeholder="密码" required>
            </div>
            <button type="submit" id="loginBtn">登录系统</button>
        </form>
        
        <div class="login-info">
            <p>By 2314 刘沁熙 基于Cloudflare Worker搭建 Cloudflare CDN提供加速服务</p>
        </div>
        
        ${ipSession ? `
        <div class="ip-info">
            检测到已有登录会话: ${ipSession.username} (${ipSession.role})
            <br>
            <button onclick="useExistingSession()" style="margin-top: 0.5rem; padding: 0.5rem 1rem; font-size: 0.75rem;">使用现有会话</button>
        </div>
        ` : ''}
        
        <div id="message"></div>
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
                    document.getElementById('username').value = creds.username;
                    document.getElementById('password').value = creds.password;
                }
            });
        });

        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            const loginBtn = document.getElementById('loginBtn');
            const originalText = loginBtn.textContent;
            loginBtn.textContent = '登录中...';
            loginBtn.disabled = true;

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const result = await response.json();
                
                if (result.success) {
                    loginBtn.textContent = '登录成功!';
                    setTimeout(() => {
                        if (result.role === 'class') {
                            window.location.href = '/class';
                        } else if (result.role === 'admin') {
                            window.location.href = '/admin';
                        }
                    }, 500);
                } else {
                    document.getElementById('message').textContent = result.error;
                    loginBtn.textContent = originalText;
                    loginBtn.disabled = false;
                }
            } catch (error) {
                document.getElementById('message').textContent = '网络错误，请重试';
                loginBtn.textContent = originalText;
                loginBtn.disabled = false;
            }
        });

        function useExistingSession() {
            window.location.href = '/class';
        }

        // 设置默认用户名密码
        document.getElementById('username').value = '2314';
        document.getElementById('password').value = 'hzwy2314';
        
        // 加载动画
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(function() {
                document.querySelector('.login-container').classList.add('loaded');
            }, 100);
        });
    </script>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 获取IP信息
async function getIPInfo() {
  try {
    const response = await fetch('https://ip.ilqx.dpdns.org/geo');
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error('获取IP信息失败:', error);
  }
  return null;
}

// 获取必应壁纸
async function getBingWallpaper() {
  try {
    const response = await fetch('https://tc.ilqx.dpdns.org/api/bing/wallpaper');
    if (response.ok) {
      const data = await response.json();
      if (data.status && data.data && data.data.length > 0) {
        return `https://www.bing.com${data.data[0].url}`;
      }
    }
  } catch (error) {
    console.error('获取必应壁纸失败:', error);
  }
  return 'https://www.loliapi.com/acg/';
}

// 渲染班级页面
async function renderClassPage(db, request, clientIP, ipSession) {
  try {
    if (!ipSession || ipSession.role !== 'class') {
      return Response.redirect(new URL('/login', request.url));
    }

    const [studentsData, scoreCategories, tasks, settings, ipInfo, wallpaper] = await Promise.all([
      handleGetStudents(db).then(r => r.json()),
      db.prepare('SELECT * FROM score_categories ORDER BY type, id').all(),
      db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 5').all(),
      db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?)').bind('site_title', 'class_name', 'current_month').all(),
      getIPInfo(),
      getBingWallpaper()
    ]);

    if (!studentsData.success) {
      throw new Error(studentsData.error);
    }

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    const currentMonth = settingMap.current_month || new Date().toISOString().slice(0, 7);
    const userAgent = request.headers.get('User-Agent') || 'unknown';

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
        
        body { 
            background: #e0f7fa;
            min-height: 100vh;
            position: relative;
            overflow-x: hidden;
        }
        
        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('${wallpaper}');
            background-size: cover;
            background-position: center;
            filter: blur(8px);
            z-index: -2;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, rgba(79, 195, 247, 0.2), rgba(176, 196, 222, 0.2));
            z-index: -1;
        }
        
        .header { 
            background: rgba(255, 255, 255, 0.3);
            padding: 1rem 2rem;
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
            position: sticky;
            top: 0;
            z-index: 1000;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }
        
        .class-info h1 { 
            color: #0277bd;
            margin-bottom: 0.5rem;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
        }
        
        .date { 
            color: #333333;
            opacity: 0.9;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.9rem;
        }
        
        .header-actions {
            display: flex;
            gap: 1rem;
            align-items: center;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 0.75rem 1.5rem;
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            border: none;
            border-radius: 25px;
            color: #333333;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            white-space: nowrap;
        }
        
        .btn:hover {
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
        
        .btn-danger {
            background: linear-gradient(45deg, #ef4444, #f87171);
        }
        
        .btn-danger:hover {
            background: linear-gradient(45deg, #dc2626, #ef4444);
        }
        
        .btn-success {
            background: linear-gradient(45deg, #10b981, #34d399);
        }
        
        .btn-success:hover {
            background: linear-gradient(45deg, #0da271, #10b981);
        }
        
        .announcement {
            background: rgba(255, 255, 255, 0.3);
            margin: 1.5rem 2rem;
            padding: 1.5rem;
            border-radius: 15px;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            border-left: 6px solid #0277bd;
            animation: slideInUp 0.5s ease;
        }
        
        .announcement:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 40px rgba(79, 195, 247, 0.5), 0 0 20px rgba(176, 196, 222, 0.3);
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
            background: rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            padding: 2rem;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            transition: all 0.3s ease;
            animation: fadeIn 0.6s ease;
        }
        
        .score-section:hover { 
            transform: translateY(-8px);
            box-shadow: 0 25px 50px -12px rgba(79, 195, 247, 0.5);
        }
        
        .section-title { 
            font-size: 1.5rem;
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 2px solid rgba(79, 195, 247, 0.3);
            color: #0277bd;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }
        
        .student-table { 
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
        }
        
        .student-table th, .student-table td { 
            padding: 1rem;
            text-align: left;
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
            transition: all 0.2s ease;
        }
        
        .student-table th { 
            background: rgba(255, 255, 255, 0.2);
            font-weight: 600;
            color: #333333;
            position: sticky;
            top: 0;
            backdrop-filter: blur(10px);
        }
        
        .student-table tr:hover td { 
            background: rgba(255, 255, 255, 0.2);
            transform: scale(1.02);
        }
        
        .student-table .score-cell { 
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        
        .student-table .score-cell:hover { 
            background: rgba(79, 195, 247, 0.1) !important;
            transform: scale(1.05);
        }
        
        .add-score { 
            color: #10b981;
        }
        
        .minus-score { 
            color: #ef4444;
        }
        
        .total-score { 
            color: #0277bd;
            font-weight: 700;
            font-size: 1.1em;
        }
        
        .rank-btn {
            padding: 0.5rem 1rem;
            background: linear-gradient(45deg, #f59e0b, #fbbf24);
            border: none;
            border-radius: 20px;
            color: #333333;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .rank-btn:hover {
            background: linear-gradient(45deg, #d97706, #f59e0b);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(245, 158, 11, 0.4);
        }
        
        /* 模态框样式 */
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 2000;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.3s ease;
            backdrop-filter: blur(5px);
            padding: 1rem;
        }
        
        .modal-content {
            background: rgba(255, 255, 255, 0.3);
            padding: 2.5rem;
            border-radius: 15px;
            width: 100%;
            max-width: 500px;
            animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 25px 50px -12px rgba(79, 195, 247, 0.5);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            position: relative;
            transform: scale(0.5);
            opacity: 0.5;
            filter: blur(10px);
            transition: transform 0.5s ease-out, opacity 0.5s ease-out, filter 0.5s ease-out;
        }
        
        .modal-content.loaded {
            transform: scale(1);
            opacity: 1;
            filter: blur(0);
        }
        
        .modal-close {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: #333333;
            transition: color 0.3s ease;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .modal-close:hover {
            color: #ef4444;
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
            color: #333333;
        }
        
        select, input[type="text"], input[type="number"], textarea {
            width: 100%;
            padding: 1rem;
            background-color: rgba(255, 255, 255, 0.5);
            border: 1px solid rgba(79, 195, 247, 0.5);
            border-radius: 25px;
            font-size: 1rem;
            color: #333333;
            outline: none;
            transition: all 0.3s ease;
        }
        
        select:focus, input:focus, textarea:focus {
            background-color: rgba(255, 255, 255, 0.7);
            border-color: #0277bd;
            box-shadow: 0 0 10px rgba(79, 195, 247, 0.3);
        }
        
        .score-buttons { 
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 0.75rem;
            margin: 1rem 0;
        }
        
        .score-btn { 
            padding: 1.5rem;
            background: rgba(255, 255, 255, 0.5);
            border: 2px solid rgba(79, 195, 247, 0.5);
            border-radius: 15px;
            cursor: pointer;
            transition: all 0.3s ease;
            text-align: center;
            font-weight: 700;
            color: #333333;
            font-size: 1.2rem;
        }
        
        .score-btn:hover { 
            border-color: #0277bd;
            background: rgba(79, 195, 247, 0.1);
            transform: translateY(-4px) scale(1.05);
            box-shadow: 0 8px 20px rgba(79, 195, 247, 0.2);
        }
        
        .score-btn.selected { 
            border-color: #0277bd;
            background: #0277bd;
            color: white;
            box-shadow: 0 8px 25px rgba(79, 195, 247, 0.4);
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
            border-radius: 25px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }
        
        .submit-btn { 
            background: linear-gradient(45deg, #10b981, #34d399);
            color: white;
        }
        
        .submit-btn:hover { 
            background: linear-gradient(45deg, #0da271, #10b981);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(16, 185, 129, 0.3);
        }
        
        .revoke-btn { 
            background: linear-gradient(45deg, #ef4444, #f87171);
            color: white;
        }
        
        .revoke-btn:hover { 
            background: linear-gradient(45deg, #dc2626, #ef4444);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(239, 68, 68, 0.3);
        }
        
        .cancel-btn { 
            background: linear-gradient(45deg, #6b7280, #9ca3af);
            color: white;
        }
        
        .cancel-btn:hover { 
            background: linear-gradient(45deg, #4b5563, #6b7280);
            transform: translateY(-2px);
        }
        
        /* 批量选择样式 */
        .batch-select {
            margin-bottom: 1rem;
            padding: 1rem;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 15px;
        }
        
        .batch-actions {
            display: flex;
            gap: 0.5rem;
            margin-top: 0.5rem;
        }
        
        .batch-btn {
            padding: 0.5rem 1rem;
            background: rgba(79, 195, 247, 0.2);
            border: 1px solid rgba(79, 195, 247, 0.5);
            border-radius: 20px;
            color: #0277bd;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.875rem;
        }
        
        .batch-btn:hover {
            background: rgba(79, 195, 247, 0.3);
            transform: translateY(-2px);
        }
        
        .batch-btn.active {
            background: #0277bd;
            color: white;
        }
        
        .student-checkbox {
            margin-right: 0.5rem;
            transform: scale(1.2);
        }
        
        /* 详细记录样式 */
        .details-modal {
            max-width: 800px;
        }
        
        .details-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
        }
        
        .details-table th, .details-table td {
            padding: 0.75rem;
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
            text-align: left;
        }
        
        .details-table th {
            background: rgba(255, 255, 255, 0.2);
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
            z-index: 3000;
            animation: slideInRight 0.3s ease;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
            display: flex;
            align-items: center;
            gap: 0.5rem;
            max-width: 400px;
        }
        
        .notification.success {
            background: linear-gradient(45deg, rgba(16, 185, 129, 0.8), rgba(52, 211, 153, 0.8));
            border: 1px solid rgba(16, 185, 129, 0.3);
        }
        
        .notification.error {
            background: linear-gradient(45deg, rgba(239, 68, 68, 0.8), rgba(248, 113, 113, 0.8));
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        
        .notification.info {
            background: linear-gradient(45deg, rgba(79, 195, 247, 0.8), rgba(129, 212, 250, 0.8));
            border: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .notification.warning {
            background: linear-gradient(45deg, rgba(245, 158, 11, 0.8), rgba(251, 191, 36, 0.8));
            border: 1px solid rgba(245, 158, 11, 0.3);
        }
        
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        /* IP信息弹窗 */
        .ip-notification {
            position: fixed;
            top: 2rem;
            left: 2rem;
            padding: 1rem 1.5rem;
            border-radius: 12px;
            background: linear-gradient(45deg, rgba(79, 195, 247, 0.8), rgba(129, 212, 250, 0.8));
            backdrop-filter: blur(10px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            color: #333333;
            font-weight: 600;
            z-index: 3000;
            animation: slideInLeft 0.3s ease;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3);
            max-width: 300px;
        }
        
        @keyframes slideInLeft {
            from { transform: translateX(-100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        .ip-details {
            font-size: 0.875rem;
            font-weight: normal;
            margin-top: 0.5rem;
            opacity: 0.9;
        }
        
        /* 底部信息栏 */
        .footer-info {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: rgba(255, 255, 255, 0.3);
            padding: 0.5rem 1rem;
            backdrop-filter: blur(10px);
            border-top: 1px solid rgba(79, 195, 247, 0.3);
            font-size: 0.75rem;
            color: #333333;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 0.5rem;
            z-index: 1000;
        }
        
        .footer-left, .footer-right {
            display: flex;
            gap: 1rem;
            align-items: center;
        }
        
        .footer-separator {
            color: rgba(79, 195, 247, 0.5);
        }
        
        /* 响应式设计 */
        @media (max-width: 768px) {
            .main-content { 
                grid-template-columns: 1fr;
                padding: 0 1rem 1rem;
                gap: 1.5rem;
            }
            
            .header { 
                padding: 1rem;
                flex-direction: column;
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
            
            .action-buttons {
                flex-direction: column;
            }
            
            .modal-content {
                padding: 1.5rem;
            }
            
            .ip-notification {
                left: 1rem;
                right: 1rem;
                max-width: none;
            }
            
            .footer-info {
                flex-direction: column;
                text-align: center;
                padding: 0.5rem;
            }
            
            .footer-left, .footer-right {
                justify-content: center;
                flex-wrap: wrap;
            }
        }
        
        @media (max-width: 480px) {
            .score-buttons {
                grid-template-columns: 1fr;
            }
            
            .student-table {
                font-size: 0.9rem;
            }
            
            .student-table th, .student-table td {
                padding: 0.75rem 0.5rem;
            }
        }
    </style>
</head>
<body>
    <!-- IP信息弹窗 -->
    <div class="ip-notification" id="ipNotification">
        <div>🌐 IP信息加载中...</div>
        <div class="ip-details" id="ipDetails"></div>
        <div class="ip-details" id="latencyInfo"></div>
    </div>

    <div class="header">
        <div class="class-info">
            <h1>${settingMap.site_title || '2314班综合评分系统'}</h1>
            <div class="date">
                <span>📅</span>
                <span id="currentDate"></span>
            </div>
        </div>
        <div class="header-actions">
            <button class="btn" onclick="showRankings()">
                <span>🏆</span>
                查看排名
            </button>
            <button class="btn" onclick="createSnapshot()">
                <span>💾</span>
                保存快照
            </button>
            <button class="btn" onclick="showSnapshots()">
                <span>📊</span>
                历史数据
            </button>
            <button class="btn btn-danger" onclick="logout()">
                <span>🚪</span>
                退出登录
            </button>
        </div>
    </div>

    <div class="announcement">
        <strong>📢 班级公告：</strong> 
        <span id="announcementText">欢迎使用班级综合评分系统！请遵守纪律，积极表现。</span>
        <button onclick="editAnnouncement()" style="margin-left: 1rem; background: none; border: none; color: #0277bd; cursor: pointer; padding: 0.25rem 0.5rem; border-radius: 6px; transition: background 0.2s ease;">编辑</button>
    </div>

    <div class="main-content">
        <!-- 批量操作区域 -->
        <div class="score-section">
            <div class="section-title">
                <span>🎯 批量操作</span>
                <span id="selectedCount">已选择 0 名学生</span>
            </div>
            <div class="batch-select">
                <div class="batch-actions">
                    <button class="batch-btn" onclick="selectAllStudents()">全选</button>
                    <button class="batch-btn" onclick="deselectAllStudents()">取消全选</button>
                    <button class="batch-btn" onclick="invertSelection()">反选</button>
                </div>
            </div>
            <div class="batch-actions" style="margin-top: 1rem;">
                <button class="btn btn-success" onclick="startBatchScoreProcess('add')" id="batchAddBtn" disabled>
                    <span>➕</span>
                    批量加分
                </button>
                <button class="btn btn-danger" onclick="startBatchScoreProcess('minus')" id="batchMinusBtn" disabled>
                    <span>➖</span>
                    批量扣分
                </button>
            </div>
        </div>

        <!-- 详细评分表格 -->
        <div class="score-section">
            <div class="section-title">
                <span>📊 学生综合评分表</span>
                <span style="font-size: 0.9rem; color: #333333; opacity: 0.9;">点击分数单元格进行评分操作</span>
            </div>
            <div style="overflow-x: auto;">
                <table class="student-table">
                    <thead>
                        <tr>
                            <th width="50">
                                <input type="checkbox" id="selectAll" class="student-checkbox" onchange="toggleSelectAll(this)">
                            </th>
                            <th width="120">姓名</th>
                            <th width="120" class="score-cell" onclick="startScoreProcess(null, 'add', '全体学生')">加分总分</th>
                            <th width="120" class="score-cell" onclick="startScoreProcess(null, 'minus', '全体学生')">扣分总分</th>
                            <th width="120">最终得分</th>
                            <th width="150">操作</th>
                        </tr>
                    </thead>
                    <tbody id="studentsBody">
                        ${studentsData.students.map((student, index) => `
                            <tr data-id="${student.id}">
                                <td>
                                    <input type="checkbox" class="student-checkbox student-select" data-id="${student.id}" onchange="updateSelectedCount()">
                                </td>
                                <td>
                                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                                        <span>${student.name}</span>
                                        ${index < 3 ? `<span class="rank-btn" style="width: 1.5rem; height: 1.5rem; font-size: 0.75rem; padding: 0;">${index + 1}</span>` : ''}
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
                                    <button class="btn" style="padding: 0.5rem 1rem; font-size: 0.875rem;" onclick="showStudentDetails(${student.id}, '${student.name}')">
                                        <span>📋</span>
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

    <!-- 评分弹窗 -->
    <div class="modal-overlay" id="scoreModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeScoreModal()">×</button>
            
            <div class="step-indicator" style="display: flex; justify-content: center; margin-bottom: 2rem; gap: 0.5rem;">
                <div class="step-dot active" style="width: 12px; height: 12px; border-radius: 50%; background: #0277bd;"></div>
            </div>
            
            <div class="step-container active" id="step1">
                <div class="step-title" style="text-align: center; margin-bottom: 1.5rem; font-size: 1.3rem; font-weight: 700; color: #0277bd;">
                    为 <span class="student-highlight" id="step1StudentName"></span> 
                    <span id="step1ActionType"></span>
                </div>
                
                <div class="input-group">
                    <label>分值：</label>
                    <div class="score-buttons" id="scoreButtons">
                        <div class="score-btn" data-score="1">1分</div>
                        <div class="score-btn" data-score="2">2分</div>
                        <div class="score-btn" data-score="3">3分</div>
                        <div class="score-btn" data-score="4">4分</div>
                        <div class="score-btn" data-score="5">5分</div>
                        <div class="score-btn" data-score="custom">自定义</div>
                    </div>
                    <input type="number" id="customScore" style="width: 100%; padding: 1rem; margin-top: 0.5rem; display: none;" placeholder="输入自定义分值" min="1" max="100">
                </div>
                
                <div class="input-group">
                    <label>评分项目：</label>
                    <select id="categorySelect" style="width: 100%;">
                        <!-- 动态填充 -->
                    </select>
                </div>
                
                <div class="input-group">
                    <label>操作教师：</label>
                    <select id="operatorSelect" style="width: 100%;">
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
                    <textarea id="scoreNote" rows="3" placeholder="请输入备注信息（其他项必填）"></textarea>
                    <div id="noteHistory" style="margin-top: 0.5rem; font-size: 0.875rem; color: #666;"></div>
                </div>
                
                <div class="action-buttons">
                    <button class="cancel-btn" onclick="closeScoreModal()">
                        <span>❌</span>
                        取消
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
            
            <div class="step-title" style="text-align: center; margin-bottom: 1.5rem; font-size: 1.3rem; font-weight: 700; color: #0277bd;">
                批量<span id="batchActionType"></span>
                <div style="font-size: 1rem; color: #333; margin-top: 0.5rem;">
                    共 <span id="batchStudentCount">0</span> 名学生
                </div>
            </div>
            
            <div class="input-group">
                <label>分值：</label>
                <div class="score-buttons" id="batchScoreButtons">
                    <div class="score-btn" data-score="1">1分</div>
                    <div class="score-btn" data-score="2">2分</div>
                    <div class="score-btn" data-score="3">3分</div>
                    <div class="score-btn" data-score="4">4分</div>
                    <div class="score-btn" data-score="5">5分</div>
                    <div class="score-btn" data-score="custom">自定义</div>
                </div>
                <input type="number" id="batchCustomScore" style="width: 100%; padding: 1rem; margin-top: 0.5rem; display: none;" placeholder="输入自定义分值" min="1" max="100">
            </div>
            
            <div class="input-group">
                <label>评分项目：</label>
                <select id="batchCategorySelect" style="width: 100%;">
                    <!-- 动态填充 -->
                </select>
            </div>
            
            <div class="input-group">
                <label>操作教师：</label>
                <select id="batchOperatorSelect" style="width: 100%;">
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
                <textarea id="batchScoreNote" rows="3" placeholder="请输入备注信息（其他项必填）"></textarea>
            </div>
            
            <div class="action-buttons">
                <button class="cancel-btn" onclick="closeBatchScoreModal()">
                    <span>❌</span>
                    取消
                </button>
                <button class="submit-btn" onclick="submitBatchScore()" id="submitBatchScoreBtn">
                    <span>✅</span>
                    提交批量评分
                </button>
            </div>
        </div>
    </div>

    <!-- 详细记录弹窗 -->
    <div class="modal-overlay" id="detailsModal">
        <div class="modal-content details-modal">
            <button class="modal-close" onclick="closeDetailsModal()">×</button>
            
            <div class="step-title" style="text-align: center; margin-bottom: 1.5rem; font-size: 1.3rem; font-weight: 700; color: #0277bd;">
                <span id="detailsStudentName"></span> 的详细记录
            </div>
            
            <div id="detailsContent">
                <!-- 动态填充 -->
            </div>
            
            <div class="action-buttons" style="margin-top: 2rem;">
                <button class="cancel-btn" onclick="closeDetailsModal()">
                    <span>❌</span>
                    关闭
                </button>
            </div>
        </div>
    </div>

    <!-- 快照弹窗 -->
    <div class="modal-overlay" id="snapshotModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeSnapshotModal()">×</button>
            
            <div class="step-title" style="text-align: center; margin-bottom: 1.5rem; font-size: 1.3rem; font-weight: 700; color: #0277bd;">
                保存快照
            </div>
            
            <div class="input-group">
                <label>快照标题：</label>
                <input type="text" id="snapshotTitle" placeholder="请输入快照标题（如：期中考核）" style="width: 100%;">
            </div>
            
            <div class="input-group">
                <label>快照时间：</label>
                <div id="snapshotTime" style="padding: 1rem; background: rgba(255, 255, 255, 0.2); border-radius: 12px; text-align: center;">
                    ${new Date().toLocaleString('zh-CN')}
                </div>
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

    <!-- 底部信息栏 -->
    <div class="footer-info">
        <div class="footer-left">
            <span>By 2314 刘沁熙</span>
            <span class="footer-separator">|</span>
            <span>基于Cloudflare Worker搭建</span>
            <span class="footer-separator">|</span>
            <span>Cloudflare CDN提供加速服务</span>
        </div>
        <div class="footer-right">
            <span id="connectionInfo">连接状态: 加载中...</span>
            <span class="footer-separator">|</span>
            <span id="userAgentInfo">UA: ${userAgent.substring(0, 30)}...</span>
        </div>
    </div>

    <script>
        // 全局变量
        let currentStudentId = null;
        let currentScoreType = 'add';
        let currentStudentName = '';
        let selectedScore = 1;
        let batchScoreType = 'add';
        let selectedStudents = new Set();
        let noteHistory = {};
        let ipInfo = ${JSON.stringify(ipInfo || {})};
        let connectionStartTime = Date.now();

        // 设置当前日期
        document.getElementById('currentDate').textContent = new Date().toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });

        // 显示IP信息
        function showIPInfo() {
            const ipNotification = document.getElementById('ipNotification');
            const ipDetails = document.getElementById('ipDetails');
            const latencyInfo = document.getElementById('latencyInfo');
            
            if (ipInfo && ipInfo.ip) {
                let details = '';
                if (ipInfo.flag) details += ${ipInfo.flag} ;
                if (ipInfo.countryRegion) details += \` \${ipInfo.countryRegion}\`;
                if (ipInfo.city) details += \` \${ipInfo.city}\`;
                if (details) details += ' | ';
                details += \`IP: \${ipInfo.ip}\`;
                
                ipDetails.textContent = details;
            } else {
                ipDetails.textContent = 'IP信息获取失败';
            }
            
            // 计算延迟
            const latency = Date.now() - connectionStartTime;
            latencyInfo.textContent = \`延迟: \${latency}ms | 时间: \${new Date().toLocaleTimeString('zh-CN')}\`;
            
            // 5秒后自动隐藏
            setTimeout(() => {
                ipNotification.style.animation = 'slideOutLeft 0.3s ease';
                setTimeout(() => {
                    ipNotification.style.display = 'none';
                }, 300);
            }, 5000);
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
                <span>\${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</span>
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

        // 开始评分流程
        function startScoreProcess(studentId, type, studentName) {
            currentStudentId = studentId;
            currentScoreType = type;
            currentStudentName = studentName;
            selectedScore = 1;
            
            // 更新界面
            document.getElementById('step1StudentName').textContent = studentName || '选中学生';
            document.getElementById('step1ActionType').textContent = type === 'add' ? '加分' : '扣分';
            
            // 重置选择
            updateScoreButtons();
            document.getElementById('customScore').style.display = 'none';
            document.getElementById('customScore').value = '';
            document.getElementById('scoreNote').value = '';
            document.getElementById('noteHistory').innerHTML = '';
            
            // 加载评分项目
            loadScoreCategories();
            
            // 显示模态框
            const modal = document.getElementById('scoreModal');
            const modalContent = modal.querySelector('.modal-content');
            modal.style.display = 'flex';
            
            // 重置动画
            modalContent.classList.remove('loaded');
            setTimeout(() => {
                modalContent.classList.add('loaded');
            }, 10);
        }

        // 开始批量评分流程
        function startBatchScoreProcess(type) {
            if (selectedStudents.size === 0) {
                showNotification('请先选择学生', 'warning');
                return;
            }
            
            batchScoreType = type;
            selectedScore = 1;
            
            // 更新界面
            document.getElementById('batchActionType').textContent = type === 'add' ? '加分' : '扣分';
            document.getElementById('batchStudentCount').textContent = selectedStudents.size;
            
            // 重置选择
            updateBatchScoreButtons();
            document.getElementById('batchCustomScore').style.display = 'none';
            document.getElementById('batchCustomScore').value = '';
            document.getElementById('batchScoreNote').value = '';
            
            // 加载评分项目
            loadBatchScoreCategories();
            
            // 显示模态框
            const modal = document.getElementById('batchScoreModal');
            const modalContent = modal.querySelector('.modal-content');
            modal.style.display = 'flex';
            
            // 重置动画
            modalContent.classList.remove('loaded');
            setTimeout(() => {
                modalContent.classList.add('loaded');
            }, 10);
        }

        // 关闭评分弹窗
        function closeScoreModal() {
            document.getElementById('scoreModal').style.display = 'none';
        }

        // 关闭批量评分弹窗
        function closeBatchScoreModal() {
            document.getElementById('batchScoreModal').style.display = 'none';
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

        // 更新批量分数按钮状态
        function updateBatchScoreButtons() {
            document.querySelectorAll('#batchScoreButtons .score-btn').forEach(btn => {
                btn.classList.remove('selected');
                if (btn.dataset.score === 'custom' && document.getElementById('batchCustomScore').style.display === 'block') {
                    btn.classList.add('selected');
                } else if (parseInt(btn.dataset.score) === selectedScore) {
                    btn.classList.add('selected');
                }
            });
        }

        // 分数按钮事件处理
        document.addEventListener('DOMContentLoaded', function() {
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

            document.getElementById('customScore').addEventListener('input', function() {
                selectedScore = parseInt(this.value) || 0;
                updateScoreButtons();
            });

            // 批量评分按钮
            document.querySelectorAll('#batchScoreButtons .score-btn').forEach(btn => {
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

            document.getElementById('batchCustomScore').addEventListener('input', function() {
                selectedScore = parseInt(this.value) || 0;
                updateBatchScoreButtons();
            });

            // 点击弹窗外部关闭
            document.getElementById('scoreModal').addEventListener('click', function(e) {
                if (e.target === this) closeScoreModal();
            });
            
            document.getElementById('batchScoreModal').addEventListener('click', function(e) {
                if (e.target === this) closeBatchScoreModal();
            });
            
            document.getElementById('detailsModal').addEventListener('click', function(e) {
                if (e.target === this) closeDetailsModal();
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
                categorySelect.appendChild(option);
            });
            
            // 监听类别变化，加载备注历史
            categorySelect.addEventListener('change', function() {
                loadNoteHistory(this.value);
            });
            
            // 初始加载
            loadNoteHistory(categorySelect.value);
        }

        // 加载批量评分项目
        function loadBatchScoreCategories() {
            const categorySelect = document.getElementById('batchCategorySelect');
            categorySelect.innerHTML = '';
            
            const categories = ${JSON.stringify((scoreCategories.results || []))};
            const filteredCategories = categories.filter(cat => cat.type === batchScoreType);
            
            filteredCategories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name;
                categorySelect.appendChild(option);
            });
        }

        // 加载备注历史
        async function loadNoteHistory(categoryId) {
            const categories = ${JSON.stringify((scoreCategories.results || []))};
            const category = categories.find(cat => cat.id == categoryId);
            
            if (!category || (category.name !== '其他加分项' && category.name !== '其他扣分项')) {
                document.getElementById('noteHistory').innerHTML = '';
                return;
            }
            
            try {
                const response = await fetch('/api/logs');
                const result = await response.json();
                
                if (result.success && result.logs) {
                    const notes = result.logs
                        .filter(log => log.category_name === category.name && log.note)
                        .map(log => log.note)
                        .filter((note, index, self) => self.indexOf(note) === index)
                        .slice(0, 5);
                    
                    if (notes.length > 0) {
                        let html = '<strong>历史备注：</strong><br>';
                        notes.forEach(note => {
                            html += \`<span style="cursor: pointer; color: #0277bd; margin-right: 0.5rem;" onclick="document.getElementById('scoreNote').value = '\${note}';">\${note}</span>\`;
                        });
                        document.getElementById('noteHistory').innerHTML = html;
                    } else {
                        document.getElementById('noteHistory').innerHTML = '<em>暂无历史备注</em>';
                    }
                }
            } catch (error) {
                console.error('加载备注历史失败:', error);
            }
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

            if (score <= 0) {
                showNotification('分值必须大于0', 'error');
                return;
            }

            // 检查是否为其他项且无备注
            const categories = ${JSON.stringify((scoreCategories.results || []))};
            const category = categories.find(cat => cat.id == categoryId);
            if ((category.name === '其他加分项' || category.name === '其他扣分项') && !note) {
                showNotification('其他项必须填写备注', 'error');
                return;
            }

            const submitBtn = document.getElementById('submitScoreBtn');
            submitBtn.disabled = true;
            submitBtn.textContent = '提交中...';

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
                    showNotification('评分提交成功！', 'success');
                    closeScoreModal();
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

        // 提交批量分数
        async function submitBatchScore() {
            const categoryId = document.getElementById('batchCategorySelect').value;
            const operator = document.getElementById('batchOperatorSelect').value;
            const note = document.getElementById('batchScoreNote').value.trim();
            
            let score = selectedScore;
            if (document.getElementById('batchCustomScore').style.display === 'block') {
                score = parseInt(document.getElementById('batchCustomScore').value) || 1;
            }

            if (score <= 0) {
                showNotification('分值必须大于0', 'error');
                return;
            }

            // 检查是否为其他项且无备注
            const categories = ${JSON.stringify((scoreCategories.results || []))};
            const category = categories.find(cat => cat.id == categoryId);
            if ((category.name === '其他加分项' || category.name === '其他扣分项') && !note) {
                showNotification('其他项必须填写备注', 'error');
                return;
            }

            const submitBtn = document.getElementById('submitBatchScoreBtn');
            submitBtn.disabled = true;
            submitBtn.textContent = '提交中...';

            try {
                const response = await fetch('/api/score-batch', {
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
                    showNotification(result.message || '批量评分成功！', 'success');
                    closeBatchScoreModal();
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showNotification(result.error || '提交失败', 'error');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<span>✅</span> 提交批量评分';
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span>✅</span> 提交批量评分';
            }
        }

        // 学生选择功能
        function toggleSelectAll(checkbox) {
            const studentCheckboxes = document.querySelectorAll('.student-select');
            studentCheckboxes.forEach(cb => {
                cb.checked = checkbox.checked;
                if (checkbox.checked) {
                    selectedStudents.add(parseInt(cb.dataset.id));
                } else {
                    selectedStudents.delete(parseInt(cb.dataset.id));
                }
            });
            updateSelectedCount();
        }

        function selectAllStudents() {
            const checkboxes = document.querySelectorAll('.student-select');
            checkboxes.forEach(cb => {
                cb.checked = true;
                selectedStudents.add(parseInt(cb.dataset.id));
            });
            document.getElementById('selectAll').checked = true;
            updateSelectedCount();
        }

        function deselectAllStudents() {
            const checkboxes = document.querySelectorAll('.student-select');
            checkboxes.forEach(cb => {
                cb.checked = false;
                selectedStudents.delete(parseInt(cb.dataset.id));
            });
            document.getElementById('selectAll').checked = false;
            updateSelectedCount();
        }

        function invertSelection() {
            const checkboxes = document.querySelectorAll('.student-select');
            checkboxes.forEach(cb => {
                cb.checked = !cb.checked;
                if (cb.checked) {
                    selectedStudents.add(parseInt(cb.dataset.id));
                } else {
                    selectedStudents.delete(parseInt(cb.dataset.id));
                }
            });
            updateSelectedCount();
        }

        function updateSelectedCount() {
            const checkboxes = document.querySelectorAll('.student-select');
            selectedStudents.clear();
            checkboxes.forEach(cb => {
                if (cb.checked) {
                    selectedStudents.add(parseInt(cb.dataset.id));
                }
            });
            
            const count = selectedStudents.size;
            document.getElementById('selectedCount').textContent = \`已选择 \${count} 名学生\`;
            
            const batchAddBtn = document.getElementById('batchAddBtn');
            const batchMinusBtn = document.getElementById('batchMinusBtn');
            batchAddBtn.disabled = count === 0;
            batchMinusBtn.disabled = count === 0;
            
            // 更新全选复选框状态
            const allChecked = count === checkboxes.length;
            const someChecked = count > 0 && count < checkboxes.length;
            document.getElementById('selectAll').checked = allChecked;
            document.getElementById('selectAll').indeterminate = someChecked;
        }

        // 显示学生详细记录
        async function showStudentDetails(studentId, studentName) {
            document.getElementById('detailsStudentName').textContent = studentName;
            
            try {
                const response = await fetch(\`/api/logs?studentId=\${studentId}\`);
                const result = await response.json();
                
                let html = '';
                if (result.success && result.logs && result.logs.length > 0) {
                    html += \`
                        <div style="overflow-x: auto;">
                            <table class="details-table">
                                <thead>
                                    <tr>
                                        <th>时间</th>
                                        <th>操作类型</th>
                                        <th>分数变化</th>
                                        <th>操作教师</th>
                                        <th>项目</th>
                                        <th>备注</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                    \`;
                    
                    result.logs.forEach(log => {
                        const actionType = log.action_type === 'add' ? '加分' : log.action_type === 'minus' ? '扣分' : '撤销';
                        const scoreChange = log.score_change > 0 ? \`+\${log.score_change}\` : log.score_change;
                        const scoreColor = log.score_change > 0 ? '#10b981' : log.score_change < 0 ? '#ef4444' : '#6b7280';
                        
                        html += \`
                            <tr>
                                <td>\${new Date(log.created_at).toLocaleString('zh-CN')}</td>
                                <td>
                                    <span style="padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; background: \${log.action_type === 'add' ? '#10b981' : log.action_type === 'minus' ? '#ef4444' : '#f59e0b'}; color: white;">
                                        \${actionType}
                                    </span>
                                </td>
                                <td style="color: \${scoreColor}; font-weight: 600;">\${scoreChange}</td>
                                <td>\${log.operator}</td>
                                <td>\${log.category_name}</td>
                                <td>\${log.note || '-'}</td>
                                <td>
                                    \${log.action_type !== 'revoke' ? \`
                                    <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="revokeRecord(\${log.id})">
                                        撤销
                                    </button>
                                    \` : '已撤销'}
                                </td>
                            </tr>
                        \`;
                    });
                    
                    html += \`
                                </tbody>
                            </table>
                        </div>
                    \`;
                } else {
                    html = '<p style="text-align: center; color: #666;">暂无记录</p>';
                }
                
                document.getElementById('detailsContent').innerHTML = html;
                
                // 显示模态框
                const modal = document.getElementById('detailsModal');
                const modalContent = modal.querySelector('.modal-content');
                modal.style.display = 'flex';
                
                // 重置动画
                modalContent.classList.remove('loaded');
                setTimeout(() => {
                    modalContent.classList.add('loaded');
                }, 10);
            } catch (error) {
                showNotification('加载详细记录失败', 'error');
            }
        }

        // 撤销记录
        async function revokeRecord(recordId) {
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
                    closeDetailsModal();
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showNotification(result.error || '撤销失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }

        // 关闭详细记录弹窗
        function closeDetailsModal() {
            document.getElementById('detailsModal').style.display = 'none';
        }

        // 显示排名
        function showRankings() {
            const students = ${JSON.stringify(studentsData.students || [])};
            let message = '🏆 学生总分排名：\\n\\n';
            
            students.forEach((student, index) => {
                const rank = index + 1;
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : \`\${rank}.\`;
                message += \`\${medal} \${student.name}: \${student.total_score > 0 ? '+' : ''}\${student.total_score}\\n\`;
            });
            
            alert(message);
        }

        // 创建快照
        function createSnapshot() {
            // 显示快照模态框
            const modal = document.getElementById('snapshotModal');
            const modalContent = modal.querySelector('.modal-content');
            modal.style.display = 'flex';
            
            // 重置动画
            modalContent.classList.remove('loaded');
            setTimeout(() => {
                modalContent.classList.add('loaded');
            }, 10);
            
            // 更新时间
            document.getElementById('snapshotTime').textContent = new Date().toLocaleString('zh-CN');
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
                    showNotification('快照保存成功！', 'success');
                    closeSnapshotModal();
                } else {
                    showNotification(result.error || '保存失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }

        // 显示快照列表
        async function showSnapshots() {
            try {
                const response = await fetch('/api/snapshots');
                const result = await response.json();
                
                if (!result.success || !result.snapshots || result.snapshots.length === 0) {
                    showNotification('暂无历史快照', 'info');
                    return;
                }
                
                window.open('/snapshots', '_blank');
            } catch (error) {
                showNotification('获取快照列表失败', 'error');
            }
        }

        // 编辑公告
        function editAnnouncement() {
            const currentText = document.getElementById('announcementText').textContent;
            const newText = prompt('编辑班级公告:', currentText);
            if (newText !== null) {
                document.getElementById('announcementText').textContent = newText;
                showNotification('公告更新成功！', 'success');
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

        // 初始化
        document.addEventListener('DOMContentLoaded', function() {
            // 显示IP信息
            setTimeout(showIPInfo, 500);
            
            // 更新连接状态
            const connectionInfo = document.getElementById('connectionInfo');
            const latency = Date.now() - connectionStartTime;
            connectionInfo.textContent = \`连接状态: 良好 | 延迟: \${latency}ms\`;
            
            // 更新UA信息
            const userAgentInfo = document.getElementById('userAgentInfo');
            const ua = '${userAgent}';
            userAgentInfo.textContent = \`UA: \${ua.length > 30 ? ua.substring(0, 30) + '...' : ua}\`;
            
            // 加载动画
            setTimeout(function() {
                document.querySelectorAll('.modal-content').forEach(modal => {
                    if (modal.parentElement.style.display === 'flex') {
                        modal.classList.add('loaded');
                    }
                });
            }, 100);
        });
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

// 渲染管理员页面（简化版，与班级页面类似但功能更多）
async function renderAdminPage(db, request, clientIP, ipSession) {
  try {
    if (!ipSession || ipSession.role !== 'admin') {
      return Response.redirect(new URL('/login', request.url));
    }

    const [studentsData, scoreCategories, tasks, settings, ipInfo, wallpaper] = await Promise.all([
      handleGetStudents(db).then(r => r.json()),
      db.prepare('SELECT * FROM score_categories ORDER BY type, id').all(),
      db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 10').all(),
      db.prepare('SELECT key, value FROM settings').all(),
      getIPInfo(),
      getBingWallpaper()
    ]);

    if (!studentsData.success) {
      throw new Error(studentsData.error);
    }

    const settingMap = {};
    (settings.results || []).forEach(row => {
      settingMap[row.key] = row.value;
    });

    const currentMonth = settingMap.current_month || new Date().toISOString().slice(0, 7);
    const userAgent = request.headers.get('User-Agent') || 'unknown';

    // 管理员页面HTML（简化版，主要展示管理功能）
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
        
        body { 
            background: #e0f7fa;
            min-height: 100vh;
            position: relative;
            overflow-x: hidden;
        }
        
        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('${wallpaper}');
            background-size: cover;
            background-position: center;
            filter: blur(8px);
            z-index: -2;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, rgba(79, 195, 247, 0.2), rgba(176, 196, 222, 0.2));
            z-index: -1;
        }
        
        .header { 
            background: rgba(255, 255, 255, 0.3);
            padding: 1rem 2rem;
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
            position: sticky;
            top: 0;
            z-index: 1000;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }
        
        .class-info h1 { 
            color: #0277bd;
            margin-bottom: 0.5rem;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
        }
        
        .admin-badge {
            background: linear-gradient(45deg, #ef4444, #f87171);
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.875rem;
            color: white;
            margin-left: 1rem;
        }
        
        .btn {
            padding: 0.75rem 1.5rem;
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            border: none;
            border-radius: 25px;
            color: #333333;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            white-space: nowrap;
        }
        
        .btn:hover {
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
        
        .btn-danger {
            background: linear-gradient(45deg, #ef4444, #f87171);
        }
        
        .btn-danger:hover {
            background: linear-gradient(45deg, #dc2626, #ef4444);
        }
        
        .main-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
        }
        
        .card {
            background: rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            padding: 2rem;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            transition: all 0.3s ease;
            animation: fadeIn 0.6s ease;
        }
        
        .card:hover {
            transform: translateY(-8px);
            box-shadow: 0 25px 50px -12px rgba(79, 195, 247, 0.5);
        }
        
        .card-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 1.5rem;
            color: #0277bd;
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1rem;
            margin-bottom: 2rem;
        }
        
        .stat-card {
            background: rgba(255, 255, 255, 0.2);
            padding: 1.5rem;
            border-radius: 12px;
            text-align: center;
            border-left: 4px solid #0277bd;
            transition: all 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3);
        }
        
        .stat-number {
            font-size: 2rem;
            font-weight: 700;
            color: #0277bd;
            margin-bottom: 0.5rem;
        }
        
        .stat-label {
            color: #333333;
            font-size: 0.875rem;
            opacity: 0.9;
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
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
            transition: all 0.2s ease;
        }
        
        .data-table th {
            background: rgba(255, 255, 255, 0.2);
            font-weight: 600;
            color: #333333;
            position: sticky;
            top: 0;
            backdrop-filter: blur(10px);
        }
        
        .data-table tr:hover td {
            background: rgba(255, 255, 255, 0.2);
            transform: scale(1.02);
        }
        
        .positive { color: #10b981; font-weight: 600; }
        .negative { color: #ef4444; font-weight: 600; }
        
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
            color: #333333;
        }
        
        .form-group input {
            padding: 1rem;
            background-color: rgba(255, 255, 255, 0.5);
            border: 1px solid rgba(79, 195, 247, 0.5);
            border-radius: 25px;
            font-size: 1rem;
            color: #333333;
            outline: none;
            transition: all 0.3s ease;
        }
        
        .form-group input:focus {
            background-color: rgba(255, 255, 255, 0.7);
            border-color: #0277bd;
            box-shadow: 0 0 10px rgba(79, 195, 247, 0.3);
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        /* 底部信息栏 */
        .footer-info {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: rgba(255, 255, 255, 0.3);
            padding: 0.5rem 1rem;
            backdrop-filter: blur(10px);
            border-top: 1px solid rgba(79, 195, 247, 0.3);
            font-size: 0.75rem;
            color: #333333;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 0.5rem;
            z-index: 1000;
        }
        
        @media (max-width: 768px) {
            .main-content {
                grid-template-columns: 1fr;
                padding: 1rem;
                gap: 1.5rem;
            }
            
            .header {
                padding: 1rem;
                flex-direction: column;
                text-align: center;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="class-info">
            <h1>${settingMap.site_title || '2314班综合评分系统'}
                <span class="admin-badge">管理员模式</span>
            </h1>
            <div>系统管理面板</div>
        </div>
        <div class="header-actions">
            <a href="/class" class="btn">📊 班级视图</a>
            <button class="btn btn-danger" onclick="logout()">🚪 退出登录</button>
        </div>
    </div>

    <div class="main-content">
        <!-- 统计信息 -->
        <div class="card">
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
                <div class="stat-card">
                    <div class="stat-number">${studentsData.students.reduce((acc, s) => acc + s.total_score, 0)}</div>
                    <div class="stat-label">总分合计</div>
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
                    <label>管理员密码</label>
                    <input type="password" name="admin_password" value="${settingMap.admin_password || ''}" required>
                </div>
                <button type="submit" class="btn" style="background: linear-gradient(45deg, #10b981, #34d399); color: white; width: 100%;">
                    💾 保存设置
                </button>
            </form>
        </div>

        <!-- 系统管理 -->
        <div class="card">
            <div class="card-title">🔧 系统管理</div>
            <div style="display: flex; flex-direction: column; gap: 1rem;">
                <button class="btn" onclick="createSnapshot()">
                    💾 保存快照
                </button>
                <button class="btn" onclick="window.open('/snapshots', '_blank')">
                    📊 查看历史数据
                </button>
                <button class="btn btn-danger" onclick="resetScores()">
                    🔄 重置当前分数
                </button>
            </div>
        </div>

        <!-- 操作日志 -->
        <div class="card">
            <div class="card-title">📋 最近操作</div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>时间</th>
                            <th>学生</th>
                            <th>操作类型</th>
                            <th>分数变化</th>
                            <th>操作教师</th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- 动态加载 -->
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <div class="footer-info">
        <div style="flex: 1; text-align: center;">
            <span>By 2314 刘沁熙 | 基于Cloudflare Worker搭建 | Cloudflare CDN提供加速服务</span>
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
                } else {
                    alert('保存失败');
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }

        // 重置分数
        async function resetScores() {
            if (!confirm('确定要重置所有学生的分数吗？此操作不可撤销！')) return;
            
            try {
                const response = await fetch('/api/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('分数重置成功！');
                    location.reload();
                } else {
                    alert('重置失败');
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

        // 加载操作日志
        async function loadLogs() {
            try {
                const response = await fetch('/api/logs?limit=10');
                const result = await response.json();
                
                if (result.success && result.logs) {
                    const tbody = document.querySelector('.data-table tbody');
                    tbody.innerHTML = '';
                    
                    result.logs.forEach(log => {
                        const row = document.createElement('tr');
                        row.innerHTML = \`
                            <td>\${new Date(log.created_at).toLocaleString('zh-CN')}</td>
                            <td>\${log.student_name || '系统'}</td>
                            <td>
                                <span style="padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; background: \${log.action_type === 'add' ? '#10b981' : log.action_type === 'minus' ? '#ef4444' : log.action_type === 'login' ? '#0277bd' : '#f59e0b'}; color: white;">
                                    \${log.action_type === 'add' ? '加分' : log.action_type === 'minus' ? '扣分' : log.action_type === 'login' ? '登录' : '撤销'}
                                </span>
                            </td>
                            <td class="\${log.score_change > 0 ? 'positive' : 'negative'}">
                                \${log.score_change > 0 ? '+' : ''}\${log.score_change}
                            </td>
                            <td>\${log.operator || '系统'}</td>
                        \`;
                        tbody.appendChild(row);
                    });
                }
            } catch (error) {
                console.error('加载日志失败:', error);
            }
        }

        // 页面加载完成
        document.addEventListener('DOMContentLoaded', function() {
            loadLogs();
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
    const studentsData = await handleGetStudents(db).then(r => r.json());
    const settings = await db.prepare(
      'SELECT key, value FROM settings WHERE key IN (?, ?)'
    ).bind('site_title', 'class_name').all();
    
    const wallpaper = await getBingWallpaper();

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
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        body { 
            background: #e0f7fa;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            position: relative;
            overflow-x: hidden;
        }
        
        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('${wallpaper}');
            background-size: cover;
            background-position: center;
            filter: blur(8px);
            z-index: -2;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, rgba(79, 195, 247, 0.2), rgba(176, 196, 222, 0.2));
            z-index: -1;
        }
        
        .header { 
            background: rgba(255, 255, 255, 0.3);
            padding: 2rem 1rem;
            text-align: center;
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .header h1 { 
            color: #0277bd;
            margin-bottom: 0.5rem;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
            font-size: 2rem;
        }
        
        .header .subtitle {
            color: #333333;
            opacity: 0.9;
            margin-bottom: 1rem;
        }
        
        .login-prompt { 
            text-align: center;
            padding: 2rem 1rem;
            background: rgba(255, 255, 255, 0.3);
            margin: 1rem;
            border-radius: 15px;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            animation: slideInUp 0.5s ease;
        }
        
        .login-prompt:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 40px rgba(79, 195, 247, 0.5), 0 0 20px rgba(176, 196, 222, 0.3);
        }
        
        .login-btn { 
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            color: #333333;
            padding: 1rem 2rem;
            border: none;
            border-radius: 25px;
            text-decoration: none;
            display: inline-block;
            font-weight: bold;
            transition: all 0.3s ease;
            margin-top: 1rem;
            box-shadow: 0 4px 12px rgba(79, 195, 247, 0.3);
        }
        
        .login-btn:hover {
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(79, 195, 247, 0.4);
        }
        
        .ranking-table { 
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            overflow: hidden;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            margin: 1rem 0;
            animation: fadeIn 0.6s ease;
        }
        
        .ranking-table th, .ranking-table td { 
            padding: 1.25rem 1rem;
            text-align: center;
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
            transition: all 0.2s ease;
        }
        
        .ranking-table th { 
            background: rgba(255, 255, 255, 0.2);
            font-weight: 600;
            color: #333333;
        }
        
        .ranking-table tr:last-child td { 
            border-bottom: none;
        }
        
        .ranking-table tr:hover td {
            background: rgba(255, 255, 255, 0.2);
            transform: scale(1.02);
        }
        
        .container { 
            padding: 1rem;
            max-width: 600px;
            margin: 0 auto;
            flex: 1;
        }
        
        .section-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin: 2rem 0 1rem;
            text-align: center;
            color: #0277bd;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
        }
        
        .rank-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            color: #333333;
            font-weight: 700;
            font-size: 0.875rem;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(79, 195, 247, 0.3);
        }
        
        .rank-badge:hover {
            transform: scale(1.1) rotate(5deg);
        }
        
        .rank-1 { 
            background: linear-gradient(45deg, #f59e0b, #fbbf24);
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
        }
        .rank-2 { 
            background: linear-gradient(45deg, #6b7280, #9ca3af);
            box-shadow: 0 4px 12px rgba(107, 114, 128, 0.3);
        }
        .rank-3 { 
            background: linear-gradient(45deg, #92400e, #b45309);
            box-shadow: 0 4px 12px rgba(146, 64, 14, 0.3);
        }
        
        .positive { color: #10b981; font-weight: 600; }
        .negative { color: #ef4444; font-weight: 600; }
        .total { color: #0277bd; font-weight: 700; }
        
        .footer {
            background: rgba(255, 255, 255, 0.3);
            padding: 1rem;
            text-align: center;
            backdrop-filter: blur(10px);
            border-top: 1px solid rgba(79, 195, 247, 0.3);
            margin-top: auto;
            color: #333333;
            font-size: 0.875rem;
        }
        
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
    </style>
</head>
<body>
    <div class="header">
        <h1>${settingMap.site_title || '2314班综合评分系统'}</h1>
        <div class="subtitle">${settingMap.class_name || '2314班'} - 访客视图</div>
    </div>
    
    <div class="container">
        <div class="login-prompt">
            <p style="font-size: 1.1rem; margin-bottom: 1rem; color: #333333;">查看完整功能请登录系统</p>
            <a href="/login" class="login-btn">🔐 立即登录</a>
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
                ${studentsData.success ? (studentsData.students || []).map((student, index) => `
                    <tr>
                        <td>
                            <div class="rank-badge ${index < 3 ? `rank-${index + 1}` : ''}">
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
    
    <div class="footer">
        <p>By 2314 刘沁熙 | 基于Cloudflare Worker搭建 | Cloudflare CDN提供加速服务</p>
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
    const wallpaper = await getBingWallpaper();
    
    let logs;
    if (studentId) {
      logs = await db.prepare(`
        SELECT ol.*, s.name as student_name 
        FROM operation_logs ol
        LEFT JOIN students s ON ol.student_id = s.id
        WHERE ol.student_id = ?
        ORDER BY ol.created_at DESC
        LIMIT 100
      `).bind(studentId).all();
    } else {
      logs = await db.prepare(`
        SELECT ol.*, s.name as student_name 
        FROM operation_logs ol
        LEFT JOIN students s ON ol.student_id = s.id
        WHERE ol.student_id != 0
        ORDER BY ol.created_at DESC
        LIMIT 100
      `).all();
    }

    const students = await db.prepare('SELECT id, name FROM students ORDER BY name').all();

    // 完整的日志页面HTML
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
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        body { 
            background: #e0f7fa;
            min-height: 100vh;
            position: relative;
            overflow-x: hidden;
        }
        
        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('${wallpaper}');
            background-size: cover;
            background-position: center;
            filter: blur(8px);
            z-index: -2;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, rgba(79, 195, 247, 0.2), rgba(176, 196, 222, 0.2));
            z-index: -1;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.3);
            padding: 1rem 2rem;
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .header-content {
            max-width: 1200px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }
        
        .back-btn {
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            color: #333333;
            padding: 0.75rem 1.5rem;
            border-radius: 25px;
            text-decoration: none;
            font-weight: bold;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .back-btn:hover {
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
        
        .container {
            max-width: 1200px;
            margin: 2rem auto;
            padding: 0 1rem;
        }
        
        .filters {
            background: rgba(255, 255, 255, 0.3);
            padding: 1.5rem;
            border-radius: 15px;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            margin-bottom: 2rem;
            display: flex;
            gap: 1rem;
            align-items: center;
            flex-wrap: wrap;
        }
        
        select, button {
            padding: 0.75rem 1rem;
            background-color: rgba(255, 255, 255, 0.5);
            border: 1px solid rgba(79, 195, 247, 0.5);
            border-radius: 25px;
            font-size: 1rem;
            color: #333333;
            outline: none;
            transition: all 0.3s ease;
        }
        
        button {
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            border: none;
            cursor: pointer;
            font-weight: bold;
        }
        
        button:hover {
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
        
        .log-table {
            width: 100%;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            overflow: hidden;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .log-table th, .log-table td {
            padding: 1rem;
            text-align: left;
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .log-table th {
            background: rgba(255, 255, 255, 0.2);
            font-weight: 600;
            color: #333333;
            position: sticky;
            top: 0;
            backdrop-filter: blur(10px);
        }
        
        .log-table tr:hover td {
            background: rgba(255, 255, 255, 0.2);
        }
        
        .positive { color: #10b981; font-weight: 600; }
        .negative { color: #ef4444; font-weight: 600; }
        
        @media (max-width: 768px) {
            .header-content {
                flex-direction: column;
                text-align: center;
            }
            
            .filters {
                flex-direction: column;
            }
            
            select, button {
                width: 100%;
            }
            
            .log-table {
                font-size: 0.9rem;
            }
            
            .log-table th, .log-table td {
                padding: 0.75rem 0.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <h1 style="color: #0277bd; margin: 0;">操作日志</h1>
            <a href="/class" class="back-btn">← 返回班级视图</a>
        </div>
    </div>
    
    <div class="container">
        <div class="filters">
            <select id="studentFilter">
                <option value="">所有学生</option>
                ${(students.results || []).map(s => `
                    <option value="${s.id}" ${studentId == s.id ? 'selected' : ''}>${s.name}</option>
                `).join('')}
            </select>
            <button onclick="filterLogs()">筛选</button>
            <button onclick="clearFilter()">清除筛选</button>
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
                    <th>IP地址</th>
                </tr>
            </thead>
            <tbody>
                ${(logs.results || []).map(log => `
                    <tr>
                        <td>${new Date(log.created_at).toLocaleString('zh-CN')}</td>
                        <td>${log.student_name || '系统'}</td>
                        <td>
                            <span style="padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; background: ${log.action_type === 'add' ? '#10b981' : log.action_type === 'minus' ? '#ef4444' : log.action_type === 'login' ? '#0277bd' : '#f59e0b'}; color: white;">
                                ${log.action_type === 'add' ? '加分' : log.action_type === 'minus' ? '扣分' : log.action_type === 'login' ? '登录' : '撤销'}
                            </span>
                        </td>
                        <td class="${log.score_change > 0 ? 'positive' : 'negative'}">
                            ${log.score_change > 0 ? '+' : ''}${log.score_change}
                        </td>
                        <td>${log.operator || '系统'}</td>
                        <td>${log.category_name || '-'}</td>
                        <td>${log.note || '-'}</td>
                        <td style="font-size: 0.75rem;">${log.ip_address || '-'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    
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

// 渲染快照列表页面
async function renderSnapshotsPage(db) {
  try {
    const snapshots = await db.prepare(
      'SELECT DISTINCT snapshot_time, title, month FROM monthly_snapshots ORDER BY snapshot_time DESC'
    ).all();
    
    const wallpaper = await getBingWallpaper();

    // 快照列表页面HTML
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>历史快照 - 班级评分系统</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        body { 
            background: #e0f7fa;
            min-height: 100vh;
            position: relative;
            overflow-x: hidden;
        }
        
        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('${wallpaper}');
            background-size: cover;
            background-position: center;
            filter: blur(8px);
            z-index: -2;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, rgba(79, 195, 247, 0.2), rgba(176, 196, 222, 0.2));
            z-index: -1;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.3);
            padding: 1rem 2rem;
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .header-content {
            max-width: 1200px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }
        
        .back-btn {
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            color: #333333;
            padding: 0.75rem 1.5rem;
            border-radius: 25px;
            text-decoration: none;
            font-weight: bold;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .back-btn:hover {
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
        
        .container {
            max-width: 1200px;
            margin: 2rem auto;
            padding: 0 1rem;
        }
        
        .section-title {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 2rem;
            color: #0277bd;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
            text-align: center;
        }
        
        .snapshots-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 1.5rem;
        }
        
        .snapshot-card {
            background: rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            padding: 1.5rem;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            transition: all 0.3s ease;
            cursor: pointer;
        }
        
        .snapshot-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 25px 50px -12px rgba(79, 195, 247, 0.5);
        }
        
        .snapshot-title {
            font-size: 1.25rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            color: #0277bd;
        }
        
        .snapshot-time {
            color: #333333;
            opacity: 0.8;
            font-size: 0.9rem;
            margin-bottom: 1rem;
        }
        
        .snapshot-month {
            background: rgba(79, 195, 247, 0.2);
            padding: 0.25rem 0.75rem;
            border-radius: 12px;
            font-size: 0.875rem;
            color: #0277bd;
            display: inline-block;
        }
        
        .empty-state {
            text-align: center;
            padding: 3rem;
            color: #333333;
            opacity: 0.8;
            grid-column: 1 / -1;
        }
        
        @media (max-width: 768px) {
            .header-content {
                flex-direction: column;
                text-align: center;
            }
            
            .snapshots-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <h1 style="color: #0277bd; margin: 0;">历史快照</h1>
            <a href="/class" class="back-btn">← 返回班级视图</a>
        </div>
    </div>
    
    <div class="container">
        <div class="section-title">📊 历史数据快照</div>
        
        <div class="snapshots-grid">
            ${snapshots.results && snapshots.results.length > 0 ? snapshots.results.map(snapshot => `
                <div class="snapshot-card" onclick="viewSnapshot('${snapshot.snapshot_time}')">
                    <div class="snapshot-title">${snapshot.title || '未命名快照'}</div>
                    <div class="snapshot-time">${new Date(snapshot.snapshot_time).toLocaleString('zh-CN')}</div>
                    <div class="snapshot-month">${snapshot.month}</div>
                </div>
            `).join('') : `
                <div class="empty-state">
                    <h3>暂无历史快照</h3>
                    <p>快照功能可以保存当前时间点的所有学生分数数据</p>
                    <p>请在班级视图中使用"保存快照"功能创建第一个快照</p>
                </div>
            `}
        </div>
    </div>
    
    <script>
        function viewSnapshot(snapshotTime) {
            window.open(\`/snapshot-view?snapshot_time=\${encodeURIComponent(snapshotTime)}\`, '_blank');
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
async function renderSnapshotViewPage(db, url) {
  try {
    const snapshotTime = url.searchParams.get('snapshot_time');
    
    if (!snapshotTime) {
      return renderErrorPage('缺少快照时间参数');
    }
    
    const [snapshotData, snapshotInfo] = await Promise.all([
      handleGetMonthlyData({url: new URL(`http://localhost/api/monthly?snapshot_time=${snapshotTime}`)}, db).then(r => r.json()),
      db.prepare('SELECT DISTINCT title, month FROM monthly_snapshots WHERE snapshot_time = ?').bind(snapshotTime).first()
    ]);
    
    const wallpaper = await getBingWallpaper();
    
    if (!snapshotData.success || !snapshotData.data || snapshotData.data.length === 0) {
      return renderErrorPage('快照数据不存在');
    }

    // 快照查看页面HTML
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${snapshotInfo?.title || '快照详情'} - 班级评分系统</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        body { 
            background: #e0f7fa;
            min-height: 100vh;
            position: relative;
            overflow-x: hidden;
        }
        
        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('${wallpaper}');
            background-size: cover;
            background-position: center;
            filter: blur(8px);
            z-index: -2;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, rgba(79, 195, 247, 0.2), rgba(176, 196, 222, 0.2));
            z-index: -1;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.3);
            padding: 1rem 2rem;
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .header-content {
            max-width: 1200px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }
        
        .back-btn {
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            color: #333333;
            padding: 0.75rem 1.5rem;
            border-radius: 25px;
            text-decoration: none;
            font-weight: bold;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .back-btn:hover {
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
        
        .container {
            max-width: 1200px;
            margin: 2rem auto;
            padding: 0 1rem;
        }
        
        .snapshot-header {
            background: rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            padding: 2rem;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            margin-bottom: 2rem;
            text-align: center;
        }
        
        .snapshot-title {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            color: #0277bd;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
        }
        
        .snapshot-meta {
            color: #333333;
            opacity: 0.8;
            display: flex;
            justify-content: center;
            gap: 2rem;
            flex-wrap: wrap;
            margin-top: 1rem;
        }
        
        .data-table {
            width: 100%;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            overflow: hidden;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .data-table th, .data-table td {
            padding: 1rem;
            text-align: left;
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        .data-table th {
            background: rgba(255, 255, 255, 0.2);
            font-weight: 600;
            color: #333333;
            position: sticky;
            top: 0;
            backdrop-filter: blur(10px);
        }
        
        .data-table tr:hover td {
            background: rgba(255, 255, 255, 0.2);
        }
        
        .rank-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            color: #333333;
            font-weight: 700;
            font-size: 0.875rem;
            box-shadow: 0 4px 12px rgba(79, 195, 247, 0.3);
        }
        
        .rank-1 { 
            background: linear-gradient(45deg, #f59e0b, #fbbf24);
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
        }
        .rank-2 { 
            background: linear-gradient(45deg, #6b7280, #9ca3af);
            box-shadow: 0 4px 12px rgba(107, 114, 128, 0.3);
        }
        .rank-3 { 
            background: linear-gradient(45deg, #92400e, #b45309);
            box-shadow: 0 4px 12px rgba(146, 64, 14, 0.3);
        }
        
        .add-score { color: #10b981; font-weight: 600; }
        .minus-score { color: #ef4444; font-weight: 600; }
        .total-score { color: #0277bd; font-weight: 700; }
        
        @media (max-width: 768px) {
            .header-content {
                flex-direction: column;
                text-align: center;
            }
            
            .snapshot-meta {
                flex-direction: column;
                gap: 0.5rem;
            }
            
            .data-table {
                font-size: 0.9rem;
            }
            
            .data-table th, .data-table td {
                padding: 0.75rem 0.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <h1 style="color: #0277bd; margin: 0;">快照详情</h1>
            <a href="/snapshots" class="back-btn">← 返回快照列表</a>
        </div>
    </div>
    
    <div class="container">
        <div class="snapshot-header">
            <div class="snapshot-title">${snapshotInfo?.title || '历史快照'}</div>
            <div class="snapshot-meta">
                <span>📅 时间: ${new Date(snapshotTime).toLocaleString('zh-CN')}</span>
                <span>📊 月份: ${snapshotInfo?.month || '未知'}</span>
                <span>👥 学生数: ${snapshotData.data.length}</span>
            </div>
        </div>
        
        <div style="overflow-x: auto;">
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
                    ${snapshotData.data.map((student, index) => `
                        <tr>
                            <td>
                                <div class="rank-badge ${index < 3 ? `rank-${index + 1}` : ''}">
                                    ${index + 1}
                                </div>
                            </td>
                            <td>${student.student_name}</td>
                            <td class="add-score">${student.add_score}</td>
                            <td class="minus-score">${student.minus_score}</td>
                            <td class="total-score">${student.total_score > 0 ? '+' : ''}${student.total_score}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    </div>
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