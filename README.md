# CodeStream

CodeStream 是一个个人使用的代码流程复习工具：手机端用于按目录阅读常用代码流，电脑端用于创建、修改和拖拽排序。它只展示代码，不会执行代码；内容保存在服务器本地 JSON 文件中，不使用数据库，也不包含登录或用户权限系统。

## 主要功能

- 手机学习页：目录切换、代码流搜索、步骤式阅读、代码横向滚动、一键复制；学习内容优先读取浏览器缓存，只有目录主页的手动刷新按钮会请求服务器最新数据。
- 电脑管理页：新增、修改、删除目录和代码流；添加代码或说明步骤；三级拖拽排序。
- JSON 存储：首次启动从 `data/seed.json` 创建 `data/content.json`，保存时先校验，再原子替换并保留一个 `.backup` 备份。
- 备份迁移：管理页可以下载完整 JSON，也可以导入 JSON 覆盖现有内容。
- 单服务器部署：Node.js 只监听 `127.0.0.1:3020`，Nginx 对外监听 `16020`，systemd 保持服务运行。

## 页面地址

- 手机学习页：`http://服务器公网IP:16020/`
- 电脑管理页：`http://服务器公网IP:16020/admin`
- 健康检查：`http://服务器公网IP:16020/healthz`

## 项目结构

```text
CodeStream/
├── backend/
│   ├── data-store.js
│   └── server.js
├── data/
│   └── seed.json
├── deploy/
│   ├── nginx/codestream.conf
│   └── systemd/codestream.service
├── public/
│   ├── admin.html
│   ├── admin.js
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── tests/server.test.js
├── package.json
└── README.md
```

运行后生成的正式数据文件是 `/opt/CodeStream/data/content.json`。它被 `.gitignore` 排除，因此以后执行 `git pull` 不会覆盖个人内容。

## Ubuntu 完整部署步骤

下面的命令均使用 `root` 用户执行，不需要 `sudo`。

### 1. 安装 Node.js、Nginx 和 Git

建议使用 Node.js 20 或更高版本。若服务器已经安装，可以先检查：

```bash
node --version
npm --version
nginx -v
git --version
```

Ubuntu 软件源提供的 Node.js 版本满足要求时，可以直接安装：

```bash
apt update
apt install -y nodejs npm nginx git
```

### 2. 创建项目目录并下载代码

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/LIKE9426334946/CodeStream.git
cd /opt/CodeStream
git checkout main
npm ci --omit=dev
```

如果 `/opt/CodeStream` 已经存在，则更新代码：

```bash
cd /opt/CodeStream
git pull origin main
npm ci --omit=dev
```

### 3. 创建 systemd 服务文件

项目已经提供完整配置，将它复制到系统目录：

```bash
cp /opt/CodeStream/deploy/systemd/codestream.service /etc/systemd/system/codestream.service
systemctl daemon-reload
systemctl enable codestream
systemctl restart codestream
systemctl status codestream --no-pager
```

systemd 实际使用的关键配置如下：

```ini
User=root
WorkingDirectory=/opt/CodeStream
ExecStart=/usr/bin/node /opt/CodeStream/backend/server.js
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3020
Restart=always
```

可以先在服务器内部验证 Node.js 服务：

```bash
curl http://127.0.0.1:3020/healthz
```

正常结果应包含 `"status":"ok"`。

### 4. 创建并启用 Nginx 配置

完整配置文件位于 `deploy/nginx/codestream.conf`。复制、启用并测试：

```bash
cp /opt/CodeStream/deploy/nginx/codestream.conf /etc/nginx/sites-available/codestream
ln -sf /etc/nginx/sites-available/codestream /etc/nginx/sites-enabled/codestream
nginx -t
systemctl enable nginx
systemctl reload nginx
```

Nginx 会监听公网端口 `16020`，并将请求转发到只在本机监听的 Node.js 端口 `3020`。配置中已经包含真实 IP、转发协议和 WebSocket 所需的请求头。

### 5. 放行公网端口

需要在云服务器安全组中放行 TCP `16020`。如果服务器启用了 UFW，再执行：

```bash
ufw allow 16020/tcp
ufw status
```

不需要向公网开放 `3020`，它仅供 Nginx 在服务器内部访问。

### 6. 访问项目

```text
手机学习页：http://服务器公网IP:16020/
电脑管理页：http://服务器公网IP:16020/admin
```

## 日常更新

```bash
cd /opt/CodeStream
git pull origin main
npm ci --omit=dev
systemctl restart codestream
systemctl reload nginx
```

查看运行日志：

```bash
journalctl -u codestream -n 100 --no-pager
journalctl -u codestream -f
```

## JSON 数据备份

最直接的备份方式：

```bash
cp /opt/CodeStream/data/content.json /root/codestream-content-backup.json
```

恢复前先停止服务，再替换文件：

```bash
systemctl stop codestream
cp /root/codestream-content-backup.json /opt/CodeStream/data/content.json
systemctl start codestream
```

也可以直接在电脑管理页使用“下载备份”和“导入备份”。每次正常保存时，服务器还会自动更新 `/opt/CodeStream/data/content.json.backup`。

## 本地开发与测试

```bash
npm install
npm test
npm run dev
```

默认开发地址为 `http://127.0.0.1:3020`。需要临时修改监听地址或端口时，可以设置 `HOST` 和 `PORT` 环境变量。
