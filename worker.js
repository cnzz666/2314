// cloudflare-worker.js - 完整可用的班级评分系统
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 初始化数据库
      await initDatabase(env.DB);

      // API路由
      if (path.startsWith('/api/')) {
        return await handleAPI(request, env, url);
      }

      // 页面路由
      return await handlePages(request, env, url);
    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ error: '服务器错误: ' + error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

// 初始化数据库
async function initDatabase(db) {
  try {
    // 创建学生表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建评分项表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS score_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        type TEXT,
        weight INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建评分记录表
    await db.exec(`
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
    `);

    // 创建任务表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT,
        deadline DATETIME,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建系统设置表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建月度快照表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS monthly_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month TEXT,
        student_name TEXT,
        add_score INTEGER,
        minus_score INTEGER,
        total_score INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建操作日志表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        student_name TEXT,
        action_type TEXT,
        score_change INTEGER,
        operator TEXT,
        category_name TEXT,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 初始化默认设置
    const defaultSettings = [
      ['class_username', '2314'],
      ['class_password', 'hzwy2314'],
      ['admin_username', '2314admin'],
      ['admin_password', '2314admin2314admin'],
      ['site_title', '2314班综合评分系统'],
      ['class_name', '2314班'],
      ['current_month', new Date().toISOString().slice(0, 7)],
      ['announcement', '欢迎使用班级综合评分系统！请各位同学遵守纪律，积极表现！']
    ];

    for (const [key, value] of defaultSettings) {
      await db.prepare(
        'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
      ).bind(key, value).run();
    }

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
      await db.prepare(
        'INSERT OR IGNORE INTO students (name) VALUES (?)'
      ).bind(name).run();
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
      ['作业完成质量差', 'minus', 2],
      ['天天练未达标', 'minus', 1],
      ['迟到', 'minus', 1],
      ['卫生未完成', 'minus', 1],
      ['行为习惯差', 'minus', 1],
      ['早操缺勤', 'minus', 1],
      ['上课不专注', 'minus', 1],
      ['未交/拖延作业', 'minus', 1],
      ['破坏课堂纪律', 'minus', 1]
    ];

    for (const [name, type, weight] of scoreCategories) {
      await db.prepare(
        'INSERT OR IGNORE INTO score_categories (name, type, weight) VALUES (?, ?, ?)'
      ).bind(name, type, weight).run();
    }

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}

// API处理
async function handleAPI(request, env, url) {
  const path = url.pathname;

  try {
    if (path === '/api/login') {
      return await handleLogin(request, env);
    } else if (path === '/api/logout') {
      return handleLogout();
    } else if (path === '/api/students') {
      return await handleGetStudents(env.DB);
    } else if (path === '/api/score') {
      return await handleAddScore(request, env.DB);
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
      return await handleReset(env.DB);
    } else if (path === '/api/settings') {
      if (request.method === 'GET') {
        return await handleGetSettings(env.DB);
      } else if (request.method === 'POST') {
        return await handleUpdateSettings(request, env.DB);
      }
    } else if (path === '/api/logs') {
      return await handleGetLogs(request, env.DB);
    } else if (path === '/api/monthly') {
      return await handleGetMonthlyData(env.DB);
    } else if (path === '/api/clear-all') {
      return await handleClearAllData(env.DB);
    }

    return new Response('Not Found', { status: 404 });
  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ error: 'API错误: ' + error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 登录处理
async function handleLogin(request, env) {
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
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const cookie = `session=${sessionId}; Path=/; HttpOnly; Expires=${expires.toUTCString()}; SameSite=Lax`;
      
      await env.DB.prepare(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
      ).bind(`session_${sessionId}`, JSON.stringify({ username, role, expires: expires.getTime() })).run();
      
      return new Response(JSON.stringify({ success: true, role }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': cookie
        }
      });
    }

    return new Response(JSON.stringify({ success: false, error: '用户名或密码错误' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: '登录失败: ' + error.message }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 登出处理
function handleLogout() {
  const cookie = 'session=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie
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
             COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE -sr.score END), 0) as total_score
      FROM students s
      LEFT JOIN score_records sr ON s.id = sr.student_id
      LEFT JOIN score_categories sc ON sr.category_id = sc.id
      GROUP BY s.id, s.name
      ORDER BY total_score DESC
    `).all();

    const addRankings = [...students.results]
      .map(s => ({ ...s, score: s.add_score }))
      .sort((a, b) => b.score - a.score);
    
    const minusRankings = [...students.results]
      .map(s => ({ ...s, score: s.minus_score }))
      .sort((a, b) => b.score - a.score);

    return new Response(JSON.stringify({
      students: students.results,
      addRankings: addRankings.slice(0, 10),
      minusRankings: minusRankings.slice(0, 10)
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    throw new Error('获取学生数据失败: ' + error.message);
  }
}

// 添加分数
async function handleAddScore(request, db) {
  try {
    const { studentId, categoryId, score, operator, note } = await request.json();
    
    // 获取类别信息
    const category = await db.prepare(
      'SELECT name, type FROM score_categories WHERE id = ?'
    ).bind(categoryId).first();
    
    if (!category) {
      return new Response(JSON.stringify({ success: false, error: '评分项目不存在' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 获取学生姓名
    const student = await db.prepare(
      'SELECT name FROM students WHERE id = ?'
    ).bind(studentId).first();

    if (!student) {
      return new Response(JSON.stringify({ success: false, error: '学生不存在' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 插入评分记录
    await db.prepare(
      'INSERT INTO score_records (student_id, category_id, score, operator, note) VALUES (?, ?, ?, ?, ?)'
    ).bind(studentId, categoryId, score, operator, note).run();

    // 记录操作日志
    await db.prepare(
      'INSERT INTO operation_logs (student_id, student_name, action_type, score_change, operator, category_name, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(studentId, student.name, category.type, category.type === 'add' ? score : -score, operator, category.name, note).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    throw new Error('添加分数失败: ' + error.message);
  }
}

// 撤销操作
async function handleRevokeScore(request, db) {
  try {
    const { studentId } = await request.json();
    
    // 获取最近一条记录
    const lastRecord = await db.prepare(`
      SELECT sr.id, sr.score, sc.type, sc.name as category_name, sr.operator, sr.note, s.name as student_name
      FROM score_records sr
      JOIN score_categories sc ON sr.category_id = sc.id
      JOIN students s ON sr.student_id = s.id
      WHERE sr.student_id = ?
      ORDER BY sr.created_at DESC 
      LIMIT 1
    `).bind(studentId).first();

    if (!lastRecord) {
      return new Response(JSON.stringify({ success: false, error: '没有可撤销的记录' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 删除记录
    await db.prepare('DELETE FROM score_records WHERE id = ?').bind(lastRecord.id).run();

    // 记录撤销日志
    await db.prepare(
      'INSERT INTO operation_logs (student_id, student_name, action_type, score_change, operator, category_name, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(studentId, lastRecord.student_name, 'revoke', lastRecord.type === 'add' ? -lastRecord.score : lastRecord.score, 
           lastRecord.operator, `撤销: ${lastRecord.category_name}`, '撤销操作').run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    throw new Error('撤销操作失败: ' + error.message);
  }
}

// 获取任务
async function handleGetTasks(db) {
  try {
    const tasks = await db.prepare(
      'SELECT * FROM tasks ORDER BY created_at DESC'
    ).all();

    return new Response(JSON.stringify(tasks.results), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    throw new Error('获取任务失败: ' + error.message);
  }
}

// 添加任务
async function handleAddTask(request, db) {
  try {
    const { title, content, deadline, created_by } = await request.json();
    
    await db.prepare(
      'INSERT INTO tasks (title, content, deadline, created_by) VALUES (?, ?, ?, ?)'
    ).bind(title, content, deadline, created_by).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    throw new Error('添加任务失败: ' + error.message);
  }
}

// 删除任务
async function handleDeleteTask(request, db) {
  try {
    const { id } = await request.json();
    
    await db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    throw new Error('删除任务失败: ' + error.message);
  }
}

// 创建快照
async function handleSnapshot(request, db) {
  try {
    const { month, title } = await request.json();
    
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
    for (const student of students.results) {
      await db.prepare(
        'INSERT INTO monthly_snapshots (month, student_name, add_score, minus_score, total_score) VALUES (?, ?, ?, ?, ?)'
      ).bind(`${month}-${title}`, student.name, student.add_score, student.minus_score, student.total_score).run();
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    throw new Error('创建快照失败: ' + error.message);
  }
}

// 重置分数
async function handleReset(db) {
  try {
    await db.prepare('DELETE FROM score_records').run();
    await db.prepare('DELETE FROM operation_logs').run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    throw new Error('重置分数失败: ' + error.message);
  }
}

// 获取设置
async function handleGetSettings(db) {
  try {
    const settings = await db.prepare('SELECT key, value FROM settings').all();
    const settingMap = {};
    settings.results.forEach(row => {
      settingMap[row.key] = row.value;
    });
    
    return new Response(JSON.stringify(settingMap), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    throw new Error('获取设置失败: ' + error.message);
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

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    throw new Error('更新设置失败: ' + error.message);
  }
}

// 获取操作日志
async function handleGetLogs(request, db) {
  try {
    const { studentId } = Object.fromEntries(new URL(request.url).searchParams);
    
    let query = `
      SELECT ol.*
      FROM operation_logs ol
    `;
    let params = [];

    if (studentId) {
      query += ' WHERE ol.student_id = ?';
      params.push(studentId);
    }

    query += ' ORDER BY ol.created_at DESC LIMIT 100';

    const logs = await db.prepare(query).bind(...params).all();

    return new Response(JSON.stringify(logs.results), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    throw new Error('获取日志失败: ' + error.message);
  }
}

// 获取月度数据
async function handleGetMonthlyData(db) {
  try {
    const months = await db.prepare(
      'SELECT DISTINCT month FROM monthly_snapshots ORDER BY month DESC'
    ).all();

    return new Response(JSON.stringify(months.results.map(m => m.month)), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    throw new Error('获取月度数据失败: ' + error.message);
  }
}

// 清空所有数据
async function handleClearAllData(db) {
  try {
    await db.prepare('DELETE FROM score_records').run();
    await db.prepare('DELETE FROM operation_logs').run();
    await db.prepare('DELETE FROM tasks').run();
    await db.prepare('DELETE FROM monthly_snapshots').run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    throw new Error('清空数据失败: ' + error.message);
  }
}

// 页面处理
async function handlePages(request, env, url) {
  const path = url.pathname;
  
  try {
    if (path === '/login') {
      return renderLoginPage();
    } else if (path === '/class') {
      return await renderClassPage(env.DB);
    } else if (path === '/admin') {
      return await renderAdminPage(env.DB);
    } else if (path === '/') {
      return await renderVisitorPage(env.DB);
    } else if (path === '/logs') {
      return await renderLogsPage(env.DB, url);
    }

    return renderLoginPage();
  } catch (error) {
    console.error('Page render error:', error);
    return new Response('页面渲染错误: ' + error.message, { status: 500 });
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
  } catch {
    return null;
  }
}

// 渲染登录页面
function renderLoginPage() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>班级评分系统 - 登录</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial, sans-serif; }
        body { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .login-container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); width: 100%; max-width: 400px; }
        h1 { text-align: center; margin-bottom: 30px; color: #333; }
        .input-group { margin-bottom: 20px; }
        input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 16px; }
        button { width: 100%; padding: 12px; background: #667eea; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; }
        button:hover { background: #5a6fd8; }
        .role-select { display: flex; gap: 10px; margin-bottom: 20px; }
        .role-btn { flex: 1; padding: 10px; border: 1px solid #ddd; background: white; border-radius: 5px; cursor: pointer; text-align: center; }
        .role-btn.active { background: #667eea; color: white; }
        .login-info { margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 5px; font-size: 14px; }
        .info-item { display: flex; justify-content: space-between; margin-bottom: 5px; }
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
            <div class="input-group"><input type="text" id="username" placeholder="用户名" required></div>
            <div class="input-group"><input type="password" id="password" placeholder="密码" required></div>
            <button type="submit">登录系统</button>
        </form>
        <div class="login-info">
            <div class="info-item"><span>班级账号:</span><span>2314 / hzwy2314</span></div>
            <div class="info-item"><span>班主任账号:</span><span>2314admin / 2314admin2314admin</span></div>
        </div>
        <div id="message" style="margin-top: 15px; text-align: center; color: red;"></div>
    </div>
    <script>
        let currentRole = 'class';
        document.querySelectorAll('.role-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentRole = btn.dataset.role;
                if (currentRole === 'visitor') window.location.href = '/';
            });
        });
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const response = await fetch('/api/login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const result = await response.json();
            if (result.success) {
                if (result.role === 'class') window.location.href = '/class';
                else if (result.role === 'admin') window.location.href = '/admin';
            } else {
                document.getElementById('message').textContent = result.error;
            }
        });
        document.getElementById('username').value = '2314';
        document.getElementById('password').value = 'hzwy2314';
    </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// 渲染班级页面
async function renderClassPage(db) {
  try {
    const session = await validateSession(new Request('http://localhost'), db);
    if (!session || session.role !== 'class') {
      return Response.redirect(new URL('/login', 'http://localhost'));
    }

    // 获取所有必要数据
    const [studentsResult, categoriesResult, tasksResult, settingsResult] = await Promise.all([
      db.prepare(`
        SELECT s.id, s.name, 
               COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE 0 END), 0) as add_score,
               COALESCE(SUM(CASE WHEN sc.type = 'minus' THEN sr.score ELSE 0 END), 0) as minus_score,
               COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE -sr.score END), 0) as total_score
        FROM students s
        LEFT JOIN score_records sr ON s.id = sr.student_id
        LEFT JOIN score_categories sc ON sr.category_id = sc.id
        GROUP BY s.id, s.name
        ORDER BY total_score DESC
      `).all(),
      db.prepare('SELECT * FROM score_categories ORDER BY type, id').all(),
      db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 10').all(),
      db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?)').bind('site_title', 'class_name', 'announcement').all()
    ]);

    const students = studentsResult.results;
    const scoreCategories = categoriesResult.results;
    const tasks = tasksResult.results;
    
    const settingMap = {};
    settingsResult.results.forEach(row => {
      settingMap[row.key] = row.value;
    });

    // 计算排行榜
    const addRankings = [...students].sort((a, b) => b.add_score - a.add_score).slice(0, 10);
    const minusRankings = [...students].sort((a, b) => b.minus_score - a.minus_score).slice(0, 10);

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settingMap.site_title || '2314班综合评分系统'}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial, sans-serif; }
        body { background: #f5f7fa; color: #333; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; }
        .header-content { display: flex; justify-content: space-between; align-items: center; max-width: 1200px; margin: 0 auto; }
        .class-info h1 { margin-bottom: 5px; }
        .date { font-size: 14px; opacity: 0.9; }
        .btn { padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; text-decoration: none; display: inline-block; margin-left: 10px; }
        .btn-primary { background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.3); }
        .btn-danger { background: #e74c3c; color: white; }
        .announcement { background: white; margin: 20px; padding: 15px; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .main-content { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 20px; max-width: 1200px; margin: 0 auto; }
        .score-section { background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .section-title { font-size: 18px; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; }
        .student-table { width: 100%; border-collapse: collapse; }
        .student-table th, .student-table td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
        .student-table th { background: #f8f9fa; }
        .student-table tr:hover td { background: #f8f9fa; }
        .score-cell { cursor: pointer; }
        .add-score { color: #27ae60; font-weight: bold; }
        .minus-score { color: #e74c3c; font-weight: bold; }
        .total-score { color: #2980b9; font-weight: bold; }
        .score-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
        .modal-content { background: white; padding: 30px; border-radius: 10px; width: 90%; max-width: 500px; }
        .input-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        select, input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
        .score-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 15px 0; }
        .score-btn { padding: 10px; border: 1px solid #ddd; background: white; border-radius: 5px; cursor: pointer; text-align: center; }
        .score-btn.selected { background: #667eea; color: white; }
        .action-buttons { display: flex; gap: 10px; margin-top: 20px; }
        .action-btn { flex: 1; padding: 10px; border: none; border-radius: 5px; cursor: pointer; }
        .submit-btn { background: #27ae60; color: white; }
        .cancel-btn { background: #95a5a6; color: white; }
        .tasks-panel { position: fixed; top: 0; right: -400px; width: 400px; height: 100vh; background: white; box-shadow: -5px 0 15px rgba(0,0,0,0.1); transition: right 0.3s; padding: 20px; overflow-y: auto; }
        .tasks-panel.active { right: 0; }
        .panel-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 999; }
        .panel-overlay.active { display: block; }
        .task-item { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 10px; }
        .admin-panel { position: fixed; bottom: 20px; right: 20px; }
        .admin-btn { background: #667eea; color: white; border: none; border-radius: 50%; width: 60px; height: 60px; font-size: 20px; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.2); }
        .admin-menu { position: absolute; bottom: 70px; right: 0; background: white; border-radius: 10px; box-shadow: 0 5px 15px rgba(0,0,0,0.2); padding: 10px; min-width: 200px; display: none; }
        .admin-menu.active { display: block; }
        .menu-item { padding: 10px; border: none; background: none; width: 100%; text-align: left; cursor: pointer; border-radius: 5px; }
        .menu-item:hover { background: #f5f5f5; }
        @media (max-width: 768px) {
            .main-content { grid-template-columns: 1fr; }
            .header-content { flex-direction: column; gap: 10px; text-align: center; }
            .tasks-panel { width: 100%; right: -100%; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div class="class-info">
                <h1>${settingMap.site_title || '2314班综合评分系统'}</h1>
                <div class="date" id="currentDate"></div>
            </div>
            <div>
                <button class="btn btn-primary" onclick="openTasksPanel()">任务管理</button>
                <button class="btn btn-primary" onclick="openLogsPage()">操作日志</button>
                <button class="btn btn-danger" onclick="logout()">退出登录</button>
            </div>
        </div>
    </div>

    <div class="announcement">
        <strong>班级公告：</strong> <span id="announcementText">${settingMap.announcement || '欢迎使用班级综合评分系统！'}</span>
        <button onclick="editAnnouncement()" style="margin-left: 10px; background: none; border: none; color: #667eea; cursor: pointer;">编辑</button>
    </div>

    <div class="main-content">
        <div class="score-section">
            <div class="section-title"><span>加分排行榜</span><span>总分</span></div>
            <table class="student-table">
                <thead><tr><th>排名</th><th>姓名</th><th>加分</th></tr></thead>
                <tbody>${addRankings.map((s, i) => `<tr><td>${i+1}</td><td>${s.name}</td><td class="add-score">+${s.add_score}</td></tr>`).join('')}</tbody>
            </table>
        </div>

        <div class="score-section">
            <div class="section-title"><span>扣分排行榜</span><span>总分</span></div>
            <table class="student-table">
                <thead><tr><th>排名</th><th>姓名</th><th>扣分</th></tr></thead>
                <tbody>${minusRankings.map((s, i) => `<tr><td>${i+1}</td><td>${s.name}</td><td class="minus-score">-${s.minus_score}</td></tr>`).join('')}</tbody>
            </table>
        </div>

        <div class="score-section" style="grid-column: 1 / -1;">
            <div class="section-title"><span>学生综合评分表</span><span style="font-size: 14px; color: #666;">点击分数单元格进行评分</span></div>
            <div style="overflow-x: auto;">
                <table class="student-table">
                    <thead><tr><th>姓名</th><th>加分总分</th><th>扣分总分</th><th>最终得分</th><th>操作</th></tr></thead>
                    <tbody>${students.map(s => `<tr>
                        <td>${s.name}</td>
                        <td class="score-cell add-score" onclick="openScoreModal(${s.id}, 'add', '${s.name}')">+${s.add_score}</td>
                        <td class="score-cell minus-score" onclick="openScoreModal(${s.id}, 'minus', '${s.name}')">-${s.minus_score}</td>
                        <td class="total-score">${s.total_score > 0 ? '+' : ''}${s.total_score}</td>
                        <td><button class="btn btn-danger" style="padding: 5px 10px; font-size: 12px;" onclick="revokeLastAction(${s.id})">撤销</button></td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>
        </div>
    </div>

    <div class="score-modal" id="scoreModal">
        <div class="modal-content">
            <h3 id="modalTitle">评分操作</h3>
            <div class="input-group">
                <label>评分项目：</label>
                <select id="categorySelect">${scoreCategories.filter(c => c.type === 'add').map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
            </div>
            <div class="input-group">
                <label>操作教师：</label>
                <select id="operatorSelect">
                    <option value="语文老师">语文老师</option><option value="数学老师">数学老师</option><option value="英语老师">英语老师</option>
                    <option value="政治老师">政治老师</option><option value="历史老师">历史老师</option><option value="物理老师">物理老师</option>
                    <option value="化学老师">化学老师</option><option value="班主任">班主任</option>
                </select>
            </div>
            <div class="input-group">
                <label>分值：</label>
                <div class="score-buttons" id="scoreButtons">
                    <div class="score-btn" data-score="1">+1</div><div class="score-btn" data-score="2">+2</div><div class="score-btn" data-score="3">+3</div>
                    <div class="score-btn" data-score="4">+4</div><div class="score-btn" data-score="5">+5</div><div class="score-btn" data-score="custom">自定义</div>
                </div>
                <input type="number" id="customScore" style="display: none; margin-top: 10px;" placeholder="输入分值" min="1">
            </div>
            <div class="input-group">
                <label>备注：</label>
                <input type="text" id="scoreNote" placeholder="可选备注">
            </div>
            <div class="action-buttons">
                <button class="cancel-btn" onclick="closeScoreModal()">取消</button>
                <button class="submit-btn" onclick="submitScore()">提交</button>
            </div>
        </div>
    </div>

    <div class="panel-overlay" id="panelOverlay" onclick="closeTasksPanel()"></div>
    <div class="tasks-panel" id="tasksPanel">
        <h2>任务管理</h2>
        <div style="margin: 20px 0;">
            <input type="text" id="taskTitle" placeholder="任务标题" style="width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 5px;">
            <textarea id="taskContent" placeholder="任务内容" style="width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 5px; height: 100px;"></textarea>
            <input type="datetime-local" id="taskDeadline" style="width: 100%; padding: 10px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 5px;">
            <button class="submit-btn" style="width: 100%; padding: 10px;" onclick="addTask()">发布任务</button>
        </div>
        <h3>最近任务</h3>
        <div id="tasksList">${tasks.map(t => `<div class="task-item">
            <h4>${t.title}</h4><p>${t.content}</p>
            <div style="font-size: 12px; color: #666;">截止: ${new Date(t.deadline).toLocaleString()} | 发布: ${t.created_by}</div>
        </div>`).join('')}</div>
    </div>

    <div class="admin-panel">
        <button class="admin-btn" onclick="toggleAdminMenu()">⚙️</button>
        <div class="admin-menu" id="adminMenu">
            <button class="menu-item" onclick="createSnapshot()">保存月度数据</button>
            <button class="menu-item" onclick="showMonthlyData()">查看历史数据</button>
            <button class="menu-item" onclick="resetScores()">重置当前分数</button>
            <button class="menu-item" onclick="clearAllData()">清空所有数据</button>
        </div>
    </div>

    <script>
        let currentStudentId = null, currentScoreType = 'add', currentStudentName = '', selectedScore = 1;
        document.getElementById('currentDate').textContent = new Date().toLocaleDateString('zh-CN');
        function openScoreModal(studentId, type, studentName) {
            currentStudentId = studentId; currentScoreType = type; currentStudentName = studentName;
            document.getElementById('modalTitle').textContent = '为 ' + studentName + (type === 'add' ? ' 加分' : ' 扣分');
            const select = document.getElementById('categorySelect');
            select.innerHTML = ${JSON.stringify(scoreCategories)}.filter(c => c.type === type).map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
            document.getElementById('scoreModal').style.display = 'flex';
        }
        function closeScoreModal() { document.getElementById('scoreModal').style.display = 'none'; }
        document.querySelectorAll('.score-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                if (this.dataset.score === 'custom') {
                    document.getElementById('customScore').style.display = 'block';
                } else {
                    document.getElementById('customScore').style.display = 'none';
                    selectedScore = parseInt(this.dataset.score);
                }
                document.querySelectorAll('.score-btn').forEach(b => b.classList.remove('selected'));
                this.classList.add('selected');
            });
        });
        async function submitScore() {
            const categoryId = document.getElementById('categorySelect').value;
            const operator = document.getElementById('operatorSelect').value;
            const note = document.getElementById('scoreNote').value;
            let score = selectedScore;
            if (document.getElementById('customScore').style.display === 'block') {
                score = parseInt(document.getElementById('customScore').value) || 1;
            }
            const response = await fetch('/api/score', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId: currentStudentId, categoryId, score, operator, note })
            });
            const result = await response.json();
            if (result.success) { closeScoreModal(); setTimeout(() => location.reload(), 500); }
            else alert(result.error || '提交失败');
        }
        async function revokeLastAction(studentId) {
            if (!confirm('确定撤销最后一次操作？')) return;
            const response = await fetch('/api/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId }) });
            const result = await response.json();
            if (result.success) setTimeout(() => location.reload(), 500);
            else alert('撤销失败');
        }
        function openTasksPanel() {
            document.getElementById('tasksPanel').classList.add('active');
            document.getElementById('panelOverlay').classList.add('active');
        }
        function closeTasksPanel() {
            document.getElementById('tasksPanel').classList.remove('active');
            document.getElementById('panelOverlay').classList.remove('active');
        }
        async function addTask() {
            const title = document.getElementById('taskTitle').value;
            const content = document.getElementById('taskContent').value;
            const deadline = document.getElementById('taskDeadline').value;
            if (!title || !content) { alert('请填写任务标题和内容'); return; }
            const response = await fetch('/api/tasks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, content, deadline, created_by: '班级账号' })
            });
            const result = await response.json();
            if (result.success) { closeTasksPanel(); setTimeout(() => location.reload(), 500); }
            else alert('发布失败');
        }
        function toggleAdminMenu() {
            document.getElementById('adminMenu').classList.toggle('active');
        }
        async function createSnapshot() {
            const month = new Date().toISOString().slice(0,7);
            const title = prompt('输入快照标题:');
            if (!title) return;
            const response = await fetch('/api/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, title }) });
            const result = await response.json();
            alert(result.success ? '保存成功' : '保存失败');
        }
        async function resetScores() {
            if (!confirm('确定重置所有分数？')) return;
            const response = await fetch('/api/reset', { method: 'POST' });
            const result = await response.json();
            if (result.success) setTimeout(() => location.reload(), 500);
            else alert('重置失败');
        }
        async function clearAllData() {
            if (!confirm('确定清空所有数据？')) return;
            const response = await fetch('/api/clear-all', { method: 'POST' });
            const result = await response.json();
            if (result.success) setTimeout(() => location.reload(), 500);
            else alert('清空失败');
        }
        async function showMonthlyData() {
            const response = await fetch('/api/monthly');
            const months = await response.json();
            alert(months.length ? '历史数据: ' + months.join(', ') : '暂无数据');
        }
        function editAnnouncement() {
            const current = document.getElementById('announcementText').textContent;
            const newText = prompt('编辑公告:', current);
            if (newText !== null) document.getElementById('announcementText').textContent = newText;
        }
        function openLogsPage() { window.open('/logs', '_blank'); }
        async function logout() { await fetch('/api/logout'); window.location.href = '/login'; }
        document.getElementById('scoreModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeScoreModal(); });
    </script>
</body>
</html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error) {
    throw new Error('渲染班级页面失败: ' + error.message);
  }
}

// 渲染访客页面
async function renderVisitorPage(db) {
  try {
    const studentsResult = await db.prepare(`
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

    const settingsResult = await db.prepare(
      'SELECT key, value FROM settings WHERE key IN (?, ?)'
    ).bind('site_title', 'class_name').all();

    const students = studentsResult.results;
    const settingMap = {};
    settingsResult.results.forEach(row => {
      settingMap[row.key] = row.value;
    });

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settingMap.site_title || '班级评分系统'} - 访客视图</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial, sans-serif; }
        body { background: #f5f7fa; color: #333; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 20px; text-align: center; }
        .login-prompt { text-align: center; padding: 30px 20px; background: white; margin: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .login-btn { background: #667eea; color: white; padding: 12px 30px; border: none; border-radius: 5px; text-decoration: none; display: inline-block; margin-top: 15px; }
        .ranking-table { width: 100%; border-collapse: collapse; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin: 20px 0; }
        .ranking-table th, .ranking-table td { padding: 15px; text-align: center; border-bottom: 1px solid #eee; }
        .ranking-table th { background: #f8f9fa; }
        .container { padding: 20px; max-width: 600px; margin: 0 auto; }
        .section-title { font-size: 24px; margin: 30px 0 20px; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <h1>${settingMap.site_title || '2314班综合评分系统'}</h1>
        <div>${settingMap.class_name || '2314班'} - 访客视图</div>
    </div>
    <div class="container">
        <div class="login-prompt">
            <p>查看完整功能请登录系统</p>
            <a href="/login" class="login-btn">立即登录</a>
        </div>
        <div class="section-title">学生评分总榜</div>
        <table class="ranking-table">
            <thead><tr><th>排名</th><th>姓名</th><th>总分</th></tr></thead>
            <tbody>${students.map((s, i) => `<tr>
                <td>${i+1}</td><td>${s.name}</td>
                <td style="font-weight: bold; color: ${s.total_score >= 0 ? '#27ae60' : '#e74c3c'}">${s.total_score > 0 ? '+' : ''}${s.total_score}</td>
            </tr>`).join('')}</tbody>
        </table>
    </div>
</body>
</html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error) {
    throw new Error('渲染访客页面失败: ' + error.message);
  }
}

// 渲染管理员页面
async function renderAdminPage(db) {
  try {
    const session = await validateSession(new Request('http://localhost'), db);
    if (!session || session.role !== 'admin') {
      return Response.redirect(new URL('/login', 'http://localhost'));
    }

    const [studentsResult, logsResult, settingsResult] = await Promise.all([
      db.prepare(`
        SELECT s.id, s.name, 
               COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE 0 END), 0) as add_score,
               COALESCE(SUM(CASE WHEN sc.type = 'minus' THEN sr.score ELSE 0 END), 0) as minus_score,
               COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE -sr.score END), 0) as total_score
        FROM students s
        LEFT JOIN score_records sr ON s.id = sr.student_id
        LEFT JOIN score_categories sc ON sr.category_id = sc.id
        GROUP BY s.id, s.name
        ORDER BY total_score DESC
      `).all(),
      db.prepare('SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT 50').all(),
      db.prepare('SELECT key, value FROM settings').all()
    ]);

    const students = studentsResult.results;
    const logs = logsResult.results;
    const settingMap = {};
    settingsResult.results.forEach(row => {
      settingMap[row.key] = row.value;
    });

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settingMap.site_title || '班级评分系统'} - 管理员</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial, sans-serif; }
        body { background: #f5f7fa; color: #333; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; }
        .header-content { display: flex; justify-content: space-between; align-items: center; max-width: 1200px; margin: 0 auto; }
        .btn { padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; text-decoration: none; display: inline-block; margin-left: 10px; }
        .btn-primary { background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.3); }
        .main-content { max-width: 1200px; margin: 0 auto; padding: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .card { background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .card-full { grid-column: 1 / -1; }
        .card-title { font-size: 18px; margin-bottom: 15px; }
        .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px; }
        .stat-card { background: #f8f9fa; padding: 15px; border-radius: 5px; text-align: center; }
        .stat-number { font-size: 24px; font-weight: bold; color: #667eea; }
        .data-table { width: 100%; border-collapse: collapse; }
        .data-table th, .data-table td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
        .data-table th { background: #f8f9fa; }
        .settings-form { display: grid; gap: 15px; }
        .form-group { display: flex; flex-direction: column; gap: 5px; }
        .form-group input { padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
        .btn-success { background: #27ae60; color: white; }
        .btn-danger { background: #e74c3c; color: white; }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div><h1>${settingMap.site_title || '2314班综合评分系统'} <span style="background: rgba(255,255,255,0.2); padding: 5px 10px; border-radius: 20px; font-size: 14px;">管理员模式</span></h1></div>
            <div><a href="/class" class="btn btn-primary">班级视图</a><button class="btn btn-primary" onclick="logout()">退出登录</button></div>
        </div>
    </div>
    <div class="main-content">
        <div class="card card-full">
            <div class="card-title">系统概览</div>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-number">${students.length}</div><div>学生总数</div></div>
                <div class="stat-card"><div class="stat-number">${students.reduce((a, s) => a + s.add_score, 0)}</div><div>总加分</div></div>
                <div class="stat-card"><div class="stat-number">${students.reduce((a, s) => a + s.minus_score, 0)}</div><div>总扣分</div></div>
            </div>
        </div>
        <div class="card">
            <div class="card-title">系统设置</div>
            <form class="settings-form" id="settingsForm">
                <div class="form-group"><label>网站标题</label><input type="text" name="site_title" value="${settingMap.site_title || ''}" required></div>
                <div class="form-group"><label>班级名称</label><input type="text" name="class_name" value="${settingMap.class_name || ''}" required></div>
                <div class="form-group"><label>班级账号</label><input type="text" name="class_username" value="${settingMap.class_username || ''}" required></div>
                <div class="form-group"><label>班级密码</label><input type="password" name="class_password" value="${settingMap.class_password || ''}" required></div>
                <div class="form-group"><label>管理员账号</label><input type="text" name="admin_username" value="${settingMap.admin_username || ''}" required></div>
                <div class="form-group"><label>管理员密码</label><input type="password" name="admin_password" value="${settingMap.admin_password || ''}" required></div>
                <button type="submit" class="btn btn-success">保存设置</button>
            </form>
        </div>
        <div class="card">
            <div class="card-title">系统管理</div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <button class="btn btn-primary" onclick="createSnapshot()">保存月度数据</button>
                <button class="btn btn-primary" onclick="showMonthlyData()">查看历史数据</button>
                <button class="btn btn-danger" onclick="resetScores()">重置当前分数</button>
                <button class="btn btn-danger" onclick="clearAllData()">清空所有数据</button>
            </div>
        </div>
        <div class="card card-full">
            <div class="card-title">最近操作日志</div>
            <div style="overflow-x: auto;">
                <table class="data-table">
                    <thead><tr><th>时间</th><th>学生</th><th>操作类型</th><th>分数变化</th><th>操作教师</th><th>备注</th></tr></thead>
                    <tbody>${logs.map(l => `<tr>
                        <td>${new Date(l.created_at).toLocaleString('zh-CN')}</td>
                        <td>${l.student_name}</td>
                        <td><span style="padding: 3px 8px; border-radius: 10px; font-size: 12px; background: ${l.action_type === 'add' ? '#27ae60' : l.action_type === 'minus' ? '#e74c3c' : '#f39c12'}; color: white;">${l.action_type === 'add' ? '加分' : l.action_type === 'minus' ? '扣分' : '撤销'}</span></td>
                        <td style="color: ${l.score_change > 0 ? '#27ae60' : '#e74c3c'}; font-weight: bold;">${l.score_change > 0 ? '+' : ''}${l.score_change}</td>
                        <td>${l.operator}</td>
                        <td>${l.note || '-'}</td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>
        </div>
    </div>
    <script>
        document.getElementById('settingsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const settings = Object.fromEntries(formData);
            const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
            const result = await response.json();
            alert(result.success ? '保存成功' : '保存失败');
        });
        async function createSnapshot() {
            const month = new Date().toISOString().slice(0,7);
            const title = prompt('输入快照标题:');
            if (!title) return;
            const response = await fetch('/api/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, title }) });
            const result = await response.json();
            alert(result.success ? '保存成功' : '保存失败');
        }
        async function showMonthlyData() {
            const response = await fetch('/api/monthly');
            const months = await response.json();
            alert(months.length ? '历史数据: ' + months.join(', ') : '暂无数据');
        }
        async function resetScores() {
            if (!confirm('确定重置所有分数？')) return;
            const response = await fetch('/api/reset', { method: 'POST' });
            const result = await response.json();
            if (result.success) setTimeout(() => location.reload(), 500);
            else alert('重置失败');
        }
        async function clearAllData() {
            if (!confirm('确定清空所有数据？')) return;
            const response = await fetch('/api/clear-all', { method: 'POST' });
            const result = await response.json();
            if (result.success) setTimeout(() => location.reload(), 500);
            else alert('清空失败');
        }
        async function logout() { await fetch('/api/logout'); window.location.href = '/login'; }
    </script>
</body>
</html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error) {
    throw new Error('渲染管理员页面失败: ' + error.message);
  }
}

// 渲染日志页面
async function renderLogsPage(db, url) {
  try {
    const studentId = url.searchParams.get('studentId');
    
    let logs;
    if (studentId) {
      logs = await db.prepare(`
        SELECT * FROM operation_logs WHERE student_id = ? ORDER BY created_at DESC LIMIT 100
      `).bind(studentId).all();
    } else {
      logs = await db.prepare(`
        SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT 100
      `).all();
    }

    const students = await db.prepare('SELECT id, name FROM students ORDER BY name').all();

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>操作日志 - 班级评分系统</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial, sans-serif; }
        body { background: #f5f7fa; color: #333; padding: 20px; }
        .header { text-align: center; margin-bottom: 20px; }
        .filters { background: white; padding: 15px; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 20px; display: flex; gap: 10px; }
        select, button { padding: 8px 12px; border: 1px solid #ddd; border-radius: 5px; }
        button { background: #667eea; color: white; border: none; cursor: pointer; }
        .log-table { width: 100%; background: white; border-radius: 5px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .log-table th, .log-table td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
        .log-table th { background: #f8f9fa; }
        .back-btn { display: inline-block; margin-bottom: 15px; color: #667eea; text-decoration: none; }
    </style>
</head>
<body>
    <a href="/class" class="back-btn">← 返回班级视图</a>
    <div class="header"><h1>操作日志</h1></div>
    <div class="filters">
        <select id="studentFilter"><option value="">所有学生</option>${students.results.map(s => `<option value="${s.id}" ${studentId == s.id ? 'selected' : ''}>${s.name}</option>`).join('')}</select>
        <button onclick="filterLogs()">筛选</button>
        <button onclick="clearFilter()">清除筛选</button>
    </div>
    <table class="log-table">
        <thead><tr><th>时间</th><th>学生</th><th>操作类型</th><th>分数变化</th><th>操作教师</th><th>项目</th><th>备注</th></tr></thead>
        <tbody>${logs.results.map(l => `<tr>
            <td>${new Date(l.created_at).toLocaleString('zh-CN')}</td>
            <td>${l.student_name}</td>
            <td><span style="padding: 3px 8px; border-radius: 10px; font-size: 12px; background: ${l.action_type === 'add' ? '#27ae60' : l.action_type === 'minus' ? '#e74c3c' : '#f39c12'}; color: white;">${l.action_type === 'add' ? '加分' : l.action_type === 'minus' ? '扣分' : '撤销'}</span></td>
            <td style="color: ${l.score_change > 0 ? '#27ae60' : '#e74c3c'}; font-weight: bold;">${l.score_change > 0 ? '+' : ''}${l.score_change}</td>
            <td>${l.operator}</td>
            <td>${l.category_name}</td>
            <td>${l.note || '-'}</td>
        </tr>`).join('')}</tbody>
    </table>
    <script>
        function filterLogs() {
            const studentId = document.getElementById('studentFilter').value;
            window.location.href = studentId ? '/logs?studentId=' + studentId : '/logs';
        }
        function clearFilter() { window.location.href = '/logs'; }
    </script>
</body>
</html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error) {
    throw new Error('渲染日志页面失败: ' + error.message);
  }
}