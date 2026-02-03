# 部署说明

本文档介绍了如何部署和配置优化后的 SSH 客户端应用。

## 环境要求

- Node.js v18 或更高版本
- npm

## 安装步骤

### 1. 克隆仓库

```bash
git clone https://github.com/guioalis/ssh.git
cd ssh
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制示例配置文件并根据需要进行修改：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 服务器配置
PORT=3000
HOST=0.0.0.0

# 命令提示API配置（可选）
COMMAND_SUGGESTION_API_KEY=your_api_key_here

# 文件上传配置
MAX_FILE_SIZE=10485760  # 10MB
UPLOAD_DIR=./uploads

# 安全配置
ALLOWED_FILE_TYPES=text/plain,text/html,application/javascript,application/json
```

## 启动应用

### 开发模式

```bash
npm run dev
```

### 生产模式

```bash
npm start
```

## Docker 部署

### 构建并运行

```bash
docker-compose up -d
```

### 单独使用 Docker

```bash
# 构建镜像
docker build -t ssh-client .

# 运行容器
docker run -d -p 3000:3000 \
  -e PORT=3000 \
  -e HOST=0.0.0.0 \
  -v $(pwd)/uploads:/app/uploads \
  -v $(pwd)/downloads:/app/downloads \
  ssh-client
```

## 安全说明

- 请勿在生产环境中暴露 API 密钥
- 配置适当的防火墙规则
- 定期更新依赖包
- 限制上传文件类型和大小

## 配置选项

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| PORT | 3000 | 应用监听端口 |
| HOST | 0.0.0.0 | 应用绑定地址 |
| COMMAND_SUGGESTION_API_KEY | (无) | 命令建议 API 密钥 |
| MAX_FILE_SIZE | 10485760 | 最大上传文件大小（字节） |
| UPLOAD_DIR | ./uploads | 上传文件存储目录 |
| ALLOWED_FILE_TYPES | text/plain,... | 允许的文件类型 |

## 管理命令

- `npm start` - 启动应用
- `npm run dev` - 开发模式启动（带热重载）
- `npm test` - 运行测试（如有）

## 健康检查

应用提供健康检查端点：`/health`

## 故障排除

如果遇到问题，请检查：

1. 确保所有必需的环境变量都已设置
2. 确保端口未被占用
3. 检查防火墙设置
4. 查看应用日志