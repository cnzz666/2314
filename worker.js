// main.js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 初始化数据库
    if (path === '/init' && request.method === 'POST') {
      return await initializeDatabase(env.DB);
    }

    // API路由
    if (path.startsWith('/api/')) {
      return await handleAPI(request, env, url);
    }

    // 静态文件服务
    if (path.startsWith('/static/')) {
      return await serveStatic(request, env);
    }

    // 主页面
    return new Response(await getHTML(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
};

// 初始化数据库
async function initializeDatabase(db) {
  try {
    // 创建学生表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        class_discipline INTEGER DEFAULT 0,
        homework_quality INTEGER DEFAULT 0,
        daily_practice INTEGER DEFAULT 0,
        punctuality INTEGER DEFAULT 0,
        hygiene INTEGER DEFAULT 0,
        behavior INTEGER DEFAULT 0,
        morning_exercise INTEGER DEFAULT 0,
        class_focus INTEGER DEFAULT 0,
        late_homework INTEGER DEFAULT 0,
        other INTEGER DEFAULT 0,
        total_score INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建操作日志表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        student_name TEXT,
        category TEXT,
        operation_type TEXT,
        points INTEGER,
        teacher_subject TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students (id)
      )
    `);

    // 创建任务表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT,
        assigned_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建公告表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建月度数据表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS monthly_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        student_name TEXT,
        year_month TEXT,
        data JSON,
        total_score INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students (id)
      )
    `);

    // 插入初始学生数据
    const students = [
      "曾钰景", "陈金语", "陈金卓", "陈明英", "陈兴旺", "陈钰琳", "代紫涵", "丁玉文",
      "高建航", "高奇", "高思凡", "高兴扬", "关戎", "胡菡", "胡人溪", "胡延鑫",
      "胡意佳", "胡语欣", "李国华", "李昊蓉", "李浩", "李灵芯", "李荣蝶", "李鑫蓉",
      "廖聪斌", "刘沁熙", "刘屹", "孟舒玲", "孟卫佳", "庞清清", "任雲川", "邵金平",
      "宋毓佳", "唐旺", "唐正高", "王恒", "王文琪", "吴良涛", "吴永贵", "夏碧涛",
      "徐程", "徐海俊", "徐小龙", "颜荣蕊", "晏灏", "杨青望", "余芳", "张灿",
      "张航", "张杰", "张毅", "赵丽瑞", "赵美婷", "赵威", "周安融", "周思棋", "朱蕊"
    ];

    for (const name of students) {
      await db.prepare(
        'INSERT OR IGNORE INTO students (name) VALUES (?)'
      ).bind(name).run();
    }

    // 插入默认公告
    await db.prepare(
      'INSERT OR IGNORE INTO announcements (content) VALUES (?)'
    ).bind('欢迎使用2314班综合评分系统！').run();

    return new Response(JSON.stringify({ success: true, message: '数据库初始化成功' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// API处理
async function handleAPI(request, env, url) {
  const path = url.pathname;

  switch (path) {
    case '/api/login':
      return await handleLogin(request, env);
    case '/api/students':
      return await handleStudents(request, env);
    case '/api/update-score':
      return await handleUpdateScore(request, env);
    case '/api/tasks':
      return await handleTasks(request, env);
    case '/api/announcements':
      return await handleAnnouncements(request, env);
    case '/api/save-monthly':
      return await handleSaveMonthly(request, env);
    case '/api/reset-scores':
      return await handleResetScores(request, env);
    case '/api/operation-logs':
      return await handleOperationLogs(request, env);
    default:
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }
}

// 登录处理
async function handleLogin(request, env) {
  const { username, password } = await request.json();
  
  if (username === '2314' && password === 'hzwy2314') {
    return new Response(JSON.stringify({ 
      success: true, 
      role: 'class',
      token: btoa(JSON.stringify({ role: 'class', class: '2314' }))
    }));
  } else if (username === '2314admin' && password === '2314admin2314admin') {
    return new Response(JSON.stringify({ 
      success: true, 
      role: 'teacher',
      token: btoa(JSON.stringify({ role: 'teacher', class: '2314' }))
    }));
  } else if (username === 'guest' && password === 'guest') {
    return new Response(JSON.stringify({ 
      success: true, 
      role: 'guest',
      token: btoa(JSON.stringify({ role: 'guest', class: '2314' }))
    }));
  } else {
    return new Response(JSON.stringify({ 
      success: false, 
      error: '用户名或密码错误' 
    }));
  }
}

// 学生数据处理
async function handleStudents(request, env) {
  if (request.method === 'GET') {
    const students = await env.DB.prepare(`
      SELECT * FROM students ORDER BY total_score DESC
    `).all();
    
    return new Response(JSON.stringify(students.results));
  }
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}

// 更新分数
async function handleUpdateScore(request, env) {
  const { studentId, category, points, teacherSubject, operation } = await request.json();
  
  try {
    // 更新学生分数
    const columnMap = {
      '上课违纪': 'class_discipline',
      '作业完成质量': 'homework_quality',
      '天天练是否达标': 'daily_practice',
      '准时上课': 'punctuality',
      '卫生完成情况': 'hygiene',
      '行为习惯': 'behavior',
      '早操出勤': 'morning_exercise',
      '上课专注': 'class_focus',
      '未交，拖延作业': 'late_homework',
      '其它': 'other'
    };

    const column = columnMap[category];
    if (!column) {
      throw new Error('Invalid category');
    }

    // 获取当前分数
    const current = await env.DB.prepare(
      `SELECT ${column}, name FROM students WHERE id = ?`
    ).bind(studentId).first();

    let newPoints;
    if (operation === 'add') {
      newPoints = (current[column] || 0) + points;
    } else {
      newPoints = (current[column] || 0) - points;
    }

    // 更新具体项目分数
    await env.DB.prepare(
      `UPDATE students SET ${column} = ? WHERE id = ?`
    ).bind(newPoints, studentId).run();

    // 重新计算总分
    await env.DB.prepare(`
      UPDATE students SET total_score = 
        (COALESCE(class_discipline, 0) + 
         COALESCE(homework_quality, 0) + 
         COALESCE(daily_practice, 0) + 
         COALESCE(punctuality, 0) + 
         COALESCE(hygiene, 0) + 
         COALESCE(behavior, 0) + 
         COALESCE(morning_exercise, 0) + 
         COALESCE(class_focus, 0) + 
         COALESCE(late_homework, 0) + 
         COALESCE(other, 0))
      WHERE id = ?
    `).bind(studentId).run();

    // 记录操作日志
    await env.DB.prepare(`
      INSERT INTO operation_logs (student_id, student_name, category, operation_type, points, teacher_subject, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      studentId,
      current.name,
      category,
      operation === 'add' ? '加分' : '扣分',
      points,
      teacherSubject,
      `${operation === 'add' ? '加分' : '扣分'}${points}分 - ${category}`
    ).run();

    return new Response(JSON.stringify({ success: true }));
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
  }
}

// 任务管理
async function handleTasks(request, env) {
  if (request.method === 'GET') {
    const tasks = await env.DB.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
    return new Response(JSON.stringify(tasks.results));
  } else if (request.method === 'POST') {
    const { title, content, assignedBy } = await request.json();
    await env.DB.prepare(
      'INSERT INTO tasks (title, content, assigned_by) VALUES (?, ?, ?)'
    ).bind(title, content, assignedBy).run();
    return new Response(JSON.stringify({ success: true }));
  }
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}

// 公告管理
async function handleAnnouncements(request, env) {
  if (request.method === 'GET') {
    const announcements = await env.DB.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 1').first();
    return new Response(JSON.stringify(announcements));
  } else if (request.method === 'POST') {
    const { content } = await request.json();
    await env.DB.prepare('INSERT INTO announcements (content) VALUES (?)').bind(content).run();
    return new Response(JSON.stringify({ success: true }));
  }
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}

// 保存月度数据
async function handleSaveMonthly(request, env) {
  const { month } = await request.json();
  const students = await env.DB.prepare('SELECT * FROM students').all();
  
  for (const student of students.results) {
    await env.DB.prepare(`
      INSERT INTO monthly_data (student_id, student_name, year_month, data, total_score)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      student.id,
      student.name,
      month,
      JSON.stringify(student),
      student.total_score
    ).run();
  }
  
  return new Response(JSON.stringify({ success: true }));
}

// 重置分数
async function handleResetScores(request, env) {
  await env.DB.prepare(`
    UPDATE students SET 
      class_discipline = 0,
      homework_quality = 0,
      daily_practice = 0,
      punctuality = 0,
      hygiene = 0,
      behavior = 0,
      morning_exercise = 0,
      class_focus = 0,
      late_homework = 0,
      other = 0,
      total_score = 0
  `).run();
  
  return new Response(JSON.stringify({ success: true }));
}

// 操作日志
async function handleOperationLogs(request, env) {
  const { studentId } = Object.fromEntries(new URL(request.url).searchParams);
  
  let query = 'SELECT * FROM operation_logs';
  let params = [];
  
  if (studentId) {
    query += ' WHERE student_id = ?';
    params.push(studentId);
  }
  
  query += ' ORDER BY created_at DESC';
  
  const logs = await env.DB.prepare(query).bind(...params).all();
  return new Response(JSON.stringify(logs.results));
}

// 静态文件服务
async function serveStatic(request, env) {
  // 这里可以添加静态资源服务逻辑
  return new Response('Not found', { status: 404 });
}

// HTML页面
async function getHTML() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>2314班综合评分系统</title>
    <style>
        ${await getCSS()}
    </style>
</head>
<body>
    <div id="app">
        <div class="login-container" id="loginPage">
            <div class="login-card">
                <h1>2314班评分系统</h1>
                <form id="loginForm">
                    <div class="input-group">
                        <input type="text" id="username" placeholder="用户名" required>
                    </div>
                    <div class="input-group">
                        <input type="password" id="password" placeholder="密码" required>
                    </div>
                    <button type="submit" class="login-btn">登录</button>
                </form>
                <div class="login-tips">
                    <p>班级登录: 2314 / hzwy2314</p>
                    <p>班主任登录: 2314admin / 2314admin2314admin</p>
                    <p>游客登录: guest / guest</p>
                </div>
            </div>
        </div>

        <div class="main-container hidden" id="mainPage">
            <header class="header">
                <div class="header-left">
                    <h1>2314班综合评分表</h1>
                    <div class="date-display" id="currentDate"></div>
                </div>
                <div class="header-right">
                    <div class="announcement" id="announcement"></div>
                    <div class="user-info">
                        <span id="userRole"></span>
                        <button class="btn-secondary" onclick="logout()">退出</button>
                    </div>
                </div>
            </header>

            <div class="content">
                <div class="sidebar">
                    <div class="sidebar-section">
                        <h3>快速操作</h3>
                        <button class="sidebar-btn" onclick="showTaskModal()">布置任务</button>
                        <button class="sidebar-btn" onclick="showRankings()">查看排名</button>
                        <button class="sidebar-btn" onclick="showLogs()">操作日志</button>
                    </div>
                    <div class="sidebar-section" id="teacherSection" style="display: none;">
                        <h3>班主任功能</h3>
                        <button class="sidebar-btn" onclick="showAnnouncementModal()">发布公告</button>
                        <button class="sidebar-btn" onclick="saveMonthlyData()">保存月度数据</button>
                        <button class="sidebar-btn" onclick="resetScores()">重置计分</button>
                    </div>
                </div>

                <div class="main-content">
                    <div class="score-summary">
                        <div class="score-card positive">
                            <h3>加分项总分</h3>
                            <div class="score" id="positiveTotal">0</div>
                        </div>
                        <div class="score-card negative">
                            <h3>扣分项总分</h3>
                            <div class="score" id="negativeTotal">0</div>
                        </div>
                    </div>

                    <div class="table-container">
                        <table class="score-table" id="scoreTable">
                            <thead>
                                <tr>
                                    <th>姓名</th>
                                    <th>上课违纪</th>
                                    <th>作业完成质量</th>
                                    <th>天天练是否达标</th>
                                    <th>准时上课</th>
                                    <th>卫生完成情况</th>
                                    <th>行为习惯</th>
                                    <th>早操出勤</th>
                                    <th>上课专注</th>
                                    <th>未交，拖延作业</th>
                                    <th>其它</th>
                                    <th>总分</th>
                                </tr>
                            </thead>
                            <tbody id="tableBody">
                                <!-- 表格数据将通过JavaScript动态生成 -->
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 操作模态框 -->
    <div class="modal hidden" id="operationModal">
        <div class="modal-content">
            <span class="close" onclick="closeModal()">&times;</span>
            <h3 id="modalTitle">操作</h3>
            <div class="operation-buttons">
                <button class="point-btn" onclick="addPoints(1)">+1</button>
                <button class="point-btn" onclick="addPoints(2)">+2</button>
                <button class="point-btn" onclick="addPoints(3)">+3</button>
                <button class="point-btn" onclick="addPoints(4)">+4</button>
                <input type="number" id="customPoints" placeholder="自定义" class="custom-input">
            </div>
            <div class="teacher-selection">
                <label>操作教师:</label>
                <select id="teacherSelect">
                    <option value="语文">语文</option>
                    <option value="数学">数学</option>
                    <option value="英语">英语</option>
                    <option value="政治">政治</option>
                    <option value="历史">历史</option>
                    <option value="物理">物理</option>
                    <option value="化学">化学</option>
                </select>
            </div>
            <div class="modal-actions">
                <button class="btn-primary" onclick="submitOperation()">提交</button>
                <button class="btn-secondary" onclick="undoLastOperation()">撤销上一次操作</button>
            </div>
        </div>
    </div>

    <!-- 其他模态框 -->
    ${await getModals()}

    <script>
        ${await getJavaScript()}
    </script>
</body>
</html>`;
}

// CSS样式
async function getCSS() {
  return `
    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
    }

    body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
    }

    .hidden {
        display: none !important;
    }

    /* 登录页面样式 */
    .login-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        padding: 20px;
    }

    .login-card {
        background: white;
        padding: 40px;
        border-radius: 20px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        width: 100%;
        max-width: 400px;
        transform: translateY(0);
        transition: all 0.3s ease;
    }

    .login-card:hover {
        transform: translateY(-5px);
    }

    .login-card h1 {
        text-align: center;
        margin-bottom: 30px;
        color: #333;
        font-weight: 300;
    }

    .input-group {
        margin-bottom: 20px;
    }

    .input-group input {
        width: 100%;
        padding: 15px;
        border: 2px solid #e1e5e9;
        border-radius: 10px;
        font-size: 16px;
        transition: all 0.3s ease;
    }

    .input-group input:focus {
        border-color: #667eea;
        outline: none;
        transform: scale(1.02);
    }

    .login-btn {
        width: 100%;
        padding: 15px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 10px;
        font-size: 16px;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .login-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
    }

    .login-tips {
        margin-top: 20px;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 10px;
        font-size: 12px;
        color: #666;
    }

    /* 主页面样式 */
    .main-container {
        min-height: 100vh;
        background: #f5f6fa;
    }

    .header {
        background: white;
        padding: 20px 40px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .header-left h1 {
        color: #333;
        font-weight: 300;
        margin-bottom: 5px;
    }

    .date-display {
        color: #666;
        font-size: 14px;
    }

    .announcement {
        background: #fff3cd;
        padding: 10px 15px;
        border-radius: 5px;
        border-left: 4px solid #ffc107;
        margin-right: 20px;
    }

    .user-info {
        display: flex;
        align-items: center;
        gap: 15px;
    }

    .content {
        display: flex;
        min-height: calc(100vh - 80px);
    }

    .sidebar {
        width: 250px;
        background: white;
        padding: 20px;
        box-shadow: 2px 0 10px rgba(0,0,0,0.1);
    }

    .sidebar-section {
        margin-bottom: 30px;
    }

    .sidebar-section h3 {
        margin-bottom: 15px;
        color: #333;
        font-weight: 500;
    }

    .sidebar-btn {
        width: 100%;
        padding: 12px;
        margin-bottom: 10px;
        background: white;
        border: 2px solid #e1e5e9;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .sidebar-btn:hover {
        border-color: #667eea;
        transform: translateX(5px);
    }

    .main-content {
        flex: 1;
        padding: 30px;
    }

    .score-summary {
        display: flex;
        gap: 20px;
        margin-bottom: 30px;
    }

    .score-card {
        flex: 1;
        background: white;
        padding: 25px;
        border-radius: 15px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        text-align: center;
        transition: all 0.3s ease;
    }

    .score-card:hover {
        transform: translateY(-5px);
    }

    .score-card.positive {
        border-top: 4px solid #28a745;
    }

    .score-card.negative {
        border-top: 4px solid #dc3545;
    }

    .score-card h3 {
        margin-bottom: 15px;
        color: #666;
        font-weight: 500;
    }

    .score {
        font-size: 2.5em;
        font-weight: bold;
    }

    .score-card.positive .score {
        color: #28a745;
    }

    .score-card.negative .score {
        color: #dc3545;
    }

    .table-container {
        background: white;
        border-radius: 15px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        overflow: hidden;
    }

    .score-table {
        width: 100%;
        border-collapse: collapse;
    }

    .score-table th,
    .score-table td {
        padding: 15px;
        text-align: center;
        border-bottom: 1px solid #e1e5e9;
        transition: all 0.3s ease;
    }

    .score-table th {
        background: #f8f9fa;
        font-weight: 600;
        color: #333;
        position: sticky;
        top: 0;
    }

    .score-table tbody tr:hover {
        background: #f8f9fa;
    }

    .score-table tbody tr:hover td {
        transform: scale(1.02);
    }

    .score-table td {
        cursor: pointer;
    }

    .positive-score {
        color: #28a745;
        font-weight: bold;
    }

    .negative-score {
        color: #dc3545;
        font-weight: bold;
    }

    /* 模态框样式 */
    .modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        opacity: 0;
        animation: fadeIn 0.3s ease forwards;
    }

    @keyframes fadeIn {
        to { opacity: 1; }
    }

    .modal-content {
        background: white;
        padding: 30px;
        border-radius: 15px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.2);
        transform: scale(0.7);
        animation: scaleIn 0.3s ease forwards;
        min-width: 400px;
    }

    @keyframes scaleIn {
        to { transform: scale(1); }
    }

    .close {
        float: right;
        font-size: 24px;
        cursor: pointer;
        color: #999;
    }

    .close:hover {
        color: #333;
    }

    .operation-buttons {
        display: flex;
        gap: 10px;
        margin: 20px 0;
        flex-wrap: wrap;
    }

    .point-btn {
        flex: 1;
        padding: 15px;
        background: #667eea;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s ease;
        min-width: 60px;
    }

    .point-btn:hover {
        background: #764ba2;
        transform: translateY(-2px);
    }

    .custom-input {
        flex: 2;
        padding: 15px;
        border: 2px solid #e1e5e9;
        border-radius: 8px;
        font-size: 16px;
    }

    .teacher-selection {
        margin: 20px 0;
    }

    .teacher-selection select {
        width: 100%;
        padding: 10px;
        border: 2px solid #e1e5e9;
        border-radius: 8px;
        margin-top: 5px;
    }

    .modal-actions {
        display: flex;
        gap: 10px;
    }

    .btn-primary {
        flex: 1;
        padding: 12px;
        background: #667eea;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .btn-primary:hover {
        background: #764ba2;
    }

    .btn-secondary {
        flex: 1;
        padding: 12px;
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .btn-secondary:hover {
        background: #545b62;
    }

    /* 响应式设计 */
    @media (max-width: 768px) {
        .content {
            flex-direction: column;
        }

        .sidebar {
            width: 100%;
            order: 2;
        }

        .main-content {
            order: 1;
        }

        .score-summary {
            flex-direction: column;
        }

        .header {
            padding: 15px 20px;
            flex-direction: column;
            gap: 15px;
        }

        .header-right {
            width: 100%;
            justify-content: space-between;
        }

        .modal-content {
            min-width: 90%;
            margin: 20px;
        }

        .operation-buttons {
            flex-direction: column;
        }
    }
    `;
}

// 模态框HTML
async function getModals() {
  return `
    <!-- 任务模态框 -->
    <div class="modal hidden" id="taskModal">
        <div class="modal-content">
            <span class="close" onclick="closeModal()">&times;</span>
            <h3>布置任务</h3>
            <form id="taskForm">
                <div class="input-group">
                    <input type="text" id="taskTitle" placeholder="任务标题" required>
                </div>
                <div class="input-group">
                    <textarea id="taskContent" placeholder="任务内容" rows="4" required></textarea>
                </div>
                <button type="submit" class="btn-primary">发布任务</button>
            </form>
        </div>
    </div>

    <!-- 公告模态框 -->
    <div class="modal hidden" id="announcementModal">
        <div class="modal-content">
            <span class="close" onclick="closeModal()">&times;</span>
            <h3>发布公告</h3>
            <form id="announcementForm">
                <div class="input-group">
                    <textarea id="announcementContent" placeholder="公告内容" rows="4" required></textarea>
                </div>
                <button type="submit" class="btn-primary">发布公告</button>
            </form>
        </div>
    </div>

    <!-- 排名模态框 -->
    <div class="modal hidden" id="rankingModal">
        <div class="modal-content">
            <span class="close" onclick="closeModal()">&times;</span>
            <h3>学生排名</h3>
            <div class="ranking-list" id="rankingList">
                <!-- 排名数据将通过JavaScript动态生成 -->
            </div>
        </div>
    </div>

    <!-- 日志模态框 -->
    <div class="modal hidden" id="logModal">
        <div class="modal-content">
            <span class="close" onclick="closeModal()">&times;</span>
            <h3>操作日志</h3>
            <div class="log-list" id="logList">
                <!-- 日志数据将通过JavaScript动态生成 -->
            </div>
        </div>
    </div>
    `;
}

// JavaScript代码
async function getJavaScript() {
  return `
    let currentUser = null;
    let currentStudent = null;
    let currentCategory = null;
    let students = [];
    let operationHistory = [];

    // 页面加载完成后初始化
    document.addEventListener('DOMContentLoaded', function() {
        updateDate();
        checkInitialization();
    });

    // 更新日期显示
    function updateDate() {
        const now = new Date();
        const options = { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            weekday: 'long'
        };
        document.getElementById('currentDate').textContent = now.toLocaleDateString('zh-CN', options);
    }

    // 检查数据库初始化
    async function checkInitialization() {
        try {
            const response = await fetch('/api/students');
            if (!response.ok) {
                await initializeDatabase();
            }
        } catch (error) {
            await initializeDatabase();
        }
    }

    // 初始化数据库
    async function initializeDatabase() {
        try {
            const response = await fetch('/init', { method: 'POST' });
            const result = await response.json();
            if (!result.success) {
                console.error('数据库初始化失败:', result.error);
            }
        } catch (error) {
            console.error('初始化请求失败:', error);
        }
    }

    // 登录处理
    document.getElementById('loginForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const result = await response.json();

            if (result.success) {
                currentUser = result;
                localStorage.setItem('authToken', result.token);
                showMainPage();
                loadData();
            } else {
                alert('登录失败: ' + result.error);
            }
        } catch (error) {
            alert('登录请求失败: ' + error.message);
        }
    });

    // 显示主页面
    function showMainPage() {
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('mainPage').classList.remove('hidden');
        
        // 更新用户角色显示
        document.getElementById('userRole').textContent = 
            currentUser.role === 'teacher' ? '班主任' : 
            currentUser.role === 'class' ? '班级' : '游客';
        
        // 显示/隐藏班主任功能
        if (currentUser.role === 'teacher') {
            document.getElementById('teacherSection').style.display = 'block';
        }
    }

    // 加载数据
    async function loadData() {
        await loadStudents();
        await loadAnnouncement();
    }

    // 加载学生数据
    async function loadStudents() {
        try {
            const response = await fetch('/api/students');
            students = await response.json();
            renderTable();
            calculateTotals();
        } catch (error) {
            console.error('加载学生数据失败:', error);
        }
    }

    // 渲染表格
    function renderTable() {
        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = '';

        students.forEach(student => {
            const row = document.createElement('tr');
            row.innerHTML = \`
                <td>\${student.name}</td>
                <td class="\${getScoreClass(student.class_discipline)}" onclick="showOperationModal(\${student.id}, '上课违纪')">\${formatScore(student.class_discipline)}</td>
                <td class="\${getScoreClass(student.homework_quality)}" onclick="showOperationModal(\${student.id}, '作业完成质量')">\${formatScore(student.homework_quality)}</td>
                <td class="\${getScoreClass(student.daily_practice)}" onclick="showOperationModal(\${student.id}, '天天练是否达标')">\${formatScore(student.daily_practice)}</td>
                <td class="\${getScoreClass(student.punctuality)}" onclick="showOperationModal(\${student.id}, '准时上课')">\${formatScore(student.punctuality)}</td>
                <td class="\${getScoreClass(student.hygiene)}" onclick="showOperationModal(\${student.id}, '卫生完成情况')">\${formatScore(student.hygiene)}</td>
                <td class="\${getScoreClass(student.behavior)}" onclick="showOperationModal(\${student.id}, '行为习惯')">\${formatScore(student.behavior)}</td>
                <td class="\${getScoreClass(student.morning_exercise)}" onclick="showOperationModal(\${student.id}, '早操出勤')">\${formatScore(student.morning_exercise)}</td>
                <td class="\${getScoreClass(student.class_focus)}" onclick="showOperationModal(\${student.id}, '上课专注')">\${formatScore(student.class_focus)}</td>
                <td class="\${getScoreClass(student.late_homework)}" onclick="showOperationModal(\${student.id}, '未交，拖延作业')">\${formatScore(student.late_homework)}</td>
                <td class="\${getScoreClass(student.other)}" onclick="showOperationModal(\${student.id}, '其它')">\${formatScore(student.other)}</td>
                <td class="total-score">\${formatScore(student.total_score)}</td>
            \`;
            tbody.appendChild(row);
        });
    }

    // 获取分数样式类
    function getScoreClass(score) {
        if (score > 0) return 'positive-score';
        if (score < 0) return 'negative-score';
        return '';
    }

    // 格式化分数显示
    function formatScore(score) {
        if (score === null || score === undefined) return '0';
        return score > 0 ? '+' + score : score.toString();
    }

    // 计算总分
    function calculateTotals() {
        let positiveTotal = 0;
        let negativeTotal = 0;

        students.forEach(student => {
            const scores = [
                student.class_discipline, student.homework_quality, student.daily_practice,
                student.punctuality, student.hygiene, student.behavior, student.morning_exercise,
                student.class_focus, student.late_homework, student.other
            ];

            scores.forEach(score => {
                if (score > 0) positiveTotal += score;
                if (score < 0) negativeTotal += Math.abs(score);
            });
        });

        document.getElementById('positiveTotal').textContent = positiveTotal;
        document.getElementById('negativeTotal').textContent = negativeTotal;
    }

    // 显示操作模态框
    function showOperationModal(studentId, category) {
        if (currentUser.role === 'guest') {
            alert('游客无法进行操作');
            return;
        }

        currentStudent = studentId;
        currentCategory = category;
        document.getElementById('modalTitle').textContent = \`\${category} - \${getStudentName(studentId)}\`;
        document.getElementById('operationModal').classList.remove('hidden');
    }

    // 获取学生姓名
    function getStudentName(studentId) {
        const student = students.find(s => s.id === studentId);
        return student ? student.name : '';
    }

    // 关闭模态框
    function closeModal() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.add('hidden');
        });
        resetOperationForm();
    }

    // 重置操作表单
    function resetOperationForm() {
        document.getElementById('customPoints').value = '';
        currentStudent = null;
        currentCategory = null;
    }

    // 添加分数
    function addPoints(points) {
        submitOperation('add', points);
    }

    // 提交操作
    async function submitOperation(operation = 'add', points = null) {
        if (!currentStudent || !currentCategory) return;

        if (!points) {
            points = parseInt(document.getElementById('customPoints').value);
            if (isNaN(points) || points <= 0) {
                alert('请输入有效的分数');
                return;
            }
        }

        const teacherSubject = document.getElementById('teacherSelect').value;

        try {
            const response = await fetch('/api/update-score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId: currentStudent,
                    category: currentCategory,
                    points: points,
                    teacherSubject: teacherSubject,
                    operation: operation
                })
            });

            const result = await response.json();

            if (result.success) {
                // 记录操作历史用于撤销
                operationHistory.push({
                    studentId: currentStudent,
                    category: currentCategory,
                    points: points,
                    teacherSubject: teacherSubject,
                    operation: operation
                });

                closeModal();
                await loadStudents();
                showSuccess('操作成功');
            } else {
                alert('操作失败: ' + result.error);
            }
        } catch (error) {
            alert('操作请求失败: ' + error.message);
        }
    }

    // 撤销上一次操作
    async function undoLastOperation() {
        if (operationHistory.length === 0) {
            alert('没有可撤销的操作');
            return;
        }

        const lastOp = operationHistory.pop();
        const reverseOperation = lastOp.operation === 'add' ? 'subtract' : 'add';

        try {
            const response = await fetch('/api/update-score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId: lastOp.studentId,
                    category: lastOp.category,
                    points: lastOp.points,
                    teacherSubject: lastOp.teacherSubject,
                    operation: reverseOperation
                })
            });

            const result = await response.json();

            if (result.success) {
                await loadStudents();
                showSuccess('撤销成功');
            } else {
                alert('撤销失败: ' + result.error);
            }
        } catch (error) {
            alert('撤销请求失败: ' + error.message);
        }
    }

    // 显示成功消息
    function showSuccess(message) {
        // 可以在这里添加更美观的成功提示
        console.log(message);
    }

    // 任务管理
    function showTaskModal() {
        if (currentUser.role === 'guest') {
            alert('游客无法布置任务');
            return;
        }
        document.getElementById('taskModal').classList.remove('hidden');
    }

    document.getElementById('taskForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const title = document.getElementById('taskTitle').value;
        const content = document.getElementById('taskContent').value;

        try {
            const response = await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title,
                    content: content,
                    assignedBy: currentUser.role === 'teacher' ? '班主任' : '班级'
                })
            });

            const result = await response.json();

            if (result.success) {
                closeModal();
                document.getElementById('taskForm').reset();
                showSuccess('任务发布成功');
            } else {
                alert('任务发布失败');
            }
        } catch (error) {
            alert('任务发布请求失败: ' + error.message);
        }
    });

    // 公告管理
    function showAnnouncementModal() {
        document.getElementById('announcementModal').classList.remove('hidden');
    }

    document.getElementById('announcementForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const content = document.getElementById('announcementContent').value;

        try {
            const response = await fetch('/api/announcements', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: content })
            });

            const result = await response.json();

            if (result.success) {
                closeModal();
                document.getElementById('announcementForm').reset();
                await loadAnnouncement();
                showSuccess('公告发布成功');
            } else {
                alert('公告发布失败');
            }
        } catch (error) {
            alert('公告发布请求失败: ' + error.message);
        }
    });

    // 加载公告
    async function loadAnnouncement() {
        try {
            const response = await fetch('/api/announcements');
            const announcement = await response.json();
            if (announcement) {
                document.getElementById('announcement').textContent = announcement.content;
            }
        } catch (error) {
            console.error('加载公告失败:', error);
        }
    }

    // 显示排名
    async function showRankings() {
        const rankingList = document.getElementById('rankingList');
        rankingList.innerHTML = '';

        // 按总分排序
        const sortedStudents = [...students].sort((a, b) => b.total_score - a.total_score);

        sortedStudents.forEach((student, index) => {
            const rankItem = document.createElement('div');
            rankItem.className = 'rank-item';
            rankItem.innerHTML = \`
                <span class="rank-number">\${index + 1}</span>
                <span class="rank-name">\${student.name}</span>
                <span class="rank-score \${getScoreClass(student.total_score)}">\${formatScore(student.total_score)}</span>
            \`;
            rankingList.appendChild(rankItem);
        });

        document.getElementById('rankingModal').classList.remove('hidden');
    }

    // 显示日志
    async function showLogs(studentId = null) {
        const logList = document.getElementById('logList');
        logList.innerHTML = '';

        try {
            const url = studentId ? \`/api/operation-logs?studentId=\${studentId}\` : '/api/operation-logs';
            const response = await fetch(url);
            const logs = await response.json();

            if (logs.length === 0) {
                logList.innerHTML = '<p>暂无操作日志</p>';
                return;
            }

            logs.forEach(log => {
                const logItem = document.createElement('div');
                logItem.className = 'log-item';
                logItem.innerHTML = \`
                    <div class="log-header">
                        <span class="log-student">\${log.student_name}</span>
                        <span class="log-teacher">\${log.teacher_subject}</span>
                    </div>
                    <div class="log-content">
                        <span class="log-operation \${log.operation_type === '加分' ? 'positive-score' : 'negative-score'}">\${log.operation_type}\${log.points}分</span>
                        <span class="log-category">\${log.category}</span>
                    </div>
                    <div class="log-time">\${new Date(log.created_at).toLocaleString()}</div>
                \`;
                logList.appendChild(logItem);
            });

            document.getElementById('logModal').classList.remove('hidden');
        } catch (error) {
            console.error('加载日志失败:', error);
        }
    }

    // 保存月度数据
    async function saveMonthlyData() {
        const month = prompt('请输入月份 (格式: YYYY-MM):', new Date().toISOString().slice(0, 7));
        if (!month) return;

        try {
            const response = await fetch('/api/save-monthly', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ month: month })
            });

            const result = await response.json();

            if (result.success) {
                showSuccess('月度数据保存成功');
            } else {
                alert('保存失败');
            }
        } catch (error) {
            alert('保存请求失败: ' + error.message);
        }
    }

    // 重置分数
    async function resetScores() {
        if (!confirm('确定要重置所有分数吗？此操作不可撤销！')) {
            return;
        }

        try {
            const response = await fetch('/api/reset-scores', { method: 'POST' });
            const result = await response.json();

            if (result.success) {
                await loadStudents();
                showSuccess('分数重置成功');
            } else {
                alert('重置失败');
            }
        } catch (error) {
            alert('重置请求失败: ' + error.message);
        }
    }

    // 退出登录
    function logout() {
        currentUser = null;
        localStorage.removeItem('authToken');
        document.getElementById('mainPage').classList.add('hidden');
        document.getElementById('loginPage').classList.remove('hidden');
        document.getElementById('loginForm').reset();
    }

    // 添加一些额外的CSS样式
    const additionalStyles = document.createElement('style');
    additionalStyles.textContent = \`
        .rank-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            border-bottom: 1px solid #e1e5e9;
            transition: all 0.3s ease;
        }

        .rank-item:hover {
            background: #f8f9fa;
        }

        .rank-number {
            font-weight: bold;
            color: #667eea;
            min-width: 30px;
        }

        .rank-name {
            flex: 1;
            margin: 0 15px;
        }

        .rank-score {
            font-weight: bold;
            min-width: 60px;
            text-align: right;
        }

        .log-item {
            padding: 15px;
            border-bottom: 1px solid #e1e5e9;
            transition: all 0.3s ease;
        }

        .log-item:hover {
            background: #f8f9fa;
        }

        .log-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
        }

        .log-student {
            font-weight: bold;
        }

        .log-teacher {
            color: #666;
            font-size: 0.9em;
        }

        .log-content {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
        }

        .log-time {
            color: #999;
            font-size: 0.8em;
        }

        .total-score {
            font-weight: bold;
            color: #333;
        }
    \`;
    document.head.appendChild(additionalStyles);
    `;
}