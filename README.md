# Brother Meow SSH客户端

这是一个基于Web的SSH客户端，具有优雅的用户界面、命令提示功能和文件管理系统。

## 功能特点

### SSH连接功能
- 支持密码和私钥认证
- 实时终端模拟
- 连接状态显示

### 文件管理系统
- 文件浏览功能
- 文件上传/下载功能
- 文件编辑功能
- 创建/删除文件和目录

### 命令提示功能
- 集成命令提示API
- 智能命令历史记录
- 优雅的命令提示显示界面

### 用户界面
- 现代化设计
- 响应式布局，适配不同设备
- 暗色模式支持
- 平滑的交互动画

## 安装指南

### 前提条件
- Node.js (v14.0.0或更高版本)
- npm (v6.0.0或更高版本)

### 安装步骤

1. 解压下载的zip文件
```bash
unzip ssh-client.zip -d ssh-client
cd ssh-client
```

2. 安装依赖
```bash
npm install --production
```

3. 启动服务器
```bash
node server.js
```

4. 访问应用
在浏览器中打开 http://localhost:3000

## 使用说明

### 连接到SSH服务器

1. 在左侧边栏的连接设置中填写以下信息：
   - 主机地址：SSH服务器的IP地址或域名
   - 端口：SSH服务器的端口（默认为22）
   - 用户名：SSH服务器的用户名
   - 认证方式：选择密码或私钥
   - 如果选择密码认证，输入密码
   - 如果选择私钥认证，上传私钥文件并输入私钥密码（如果有）

2. 点击"连接"按钮

### 使用终端

1. 连接成功后，终端会自动显示
2. 在终端中输入命令，按Enter键执行
3. 命令提示区域会显示相关的命令建议
4. 点击命令提示可以将命令插入到终端中

### 使用文件管理器

1. 点击顶部的"文件管理"标签切换到文件管理界面
2. 文件列表显示当前目录下的文件和文件夹
3. 点击文件夹可以进入该文件夹
4. 点击"返回上级目录"可以返回上一级目录
5. 使用工具栏上的按钮可以：
   - 上传文件：点击"上传"按钮，选择要上传的文件
   - 新建文件夹：点击"新建文件夹"按钮，输入文件夹名称
   - 刷新文件列表：点击"刷新"按钮
6. 对于文件，可以：
   - 下载：点击文件行中的下载按钮
   - 编辑：点击文件行中的编辑按钮（仅适用于文本文件）
   - 删除：点击文件行中的删除按钮

## 安全注意事项

- 此应用默认在本地运行，不建议直接暴露到公网
- 如需在公网访问，请确保使用HTTPS和适当的身份验证
- 所有SSH凭据仅在会话期间保存在内存中，不会持久化存储
- 私钥文件在上传后会立即用于认证，不会保存在服务器上

## 故障排除

### 连接问题
- 确保SSH服务器地址和端口正确
- 检查用户名和密码/私钥是否正确
- 确保SSH服务器允许密码或密钥认证

### 文件管理问题
- 确保用户有足够的权限访问和修改文件
- 大文件上传可能需要更长时间，请耐心等待
- 如果文件列表不显示，尝试点击刷新按钮

### 命令提示问题
- 确保应用可以访问命令提示API
- 如果命令提示不显示，尝试重新输入命令

## 技术栈

- 前端：HTML, CSS, JavaScript, Bootstrap, Xterm.js
- 后端：Node.js, Express, Socket.io
- SSH连接：ssh2
- 文件上传：multer
- API请求：axios

## 许可证

MIT
