const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client } = require('ssh2');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

// 创建Express应用
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 设置静态文件目录
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 设置文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = process.env.UPLOAD_DIR || './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // 生成唯一文件名以避免冲突
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { 
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB 默认
    },
    fileFilter: (req, file, cb) => {
        // 定义允许的文件类型
        const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'text/plain,text/html,application/javascript,application/json').split(',');
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('不支持的文件类型'), false);
        }
    }
});

// 存储SSH连接
const sshConnections = {};

// 验证SSH连接参数的函数
function validateSSHParams(data) {
    const errors = [];
    
    // 验证主机地址
    if (!data.host || typeof data.host !== 'string' || data.host.length > 255) {
        errors.push('无效的主机地址');
    } else if (!isValidHostnameOrIP(data.host)) {
        errors.push('主机地址格式不正确');
    }
    
    // 验证端口
    const port = parseInt(data.port);
    if (isNaN(port) || port < 1 || port > 65535) {
        errors.push('端口必须是1-65535之间的数字');
    }
    
    // 验证用户名
    if (!data.username || typeof data.username !== 'string' || data.username.length > 64) {
        errors.push('用户名不能为空且长度不能超过64字符');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(data.username)) {
        errors.push('用户名只能包含字母、数字、下划线和连字符');
    }
    
    // 验证认证方式
    if (!['password', 'privateKey'].includes(data.authType)) {
        errors.push('认证方式必须是password或privateKey');
    }
    
    // 根据认证方式验证相应字段
    if (data.authType === 'password') {
        if (!data.password || typeof data.password !== 'string') {
            errors.push('密码不能为空');
        }
    } else if (data.authType === 'privateKey') {
        if (!data.privateKey) {
            errors.push('私钥不能为空');
        }
        // 如果有密码短语，验证其类型
        if (data.passphrase && typeof data.passphrase !== 'string') {
            errors.push('密码短语格式不正确');
        }
    }
    
    return errors;
}

// 验证主机名或IP地址
function isValidHostnameOrIP(hostname) {
    // IP地址正则
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    // 主机名正则
    const hostnameRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9](\.[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9])*$/;

    if (ipRegex.test(hostname)) {
        // 验证IP地址每个段是否在0-255范围内
        const parts = hostname.split('.');
        return parts.every(part => {
            const num = parseInt(part);
            return num >= 0 && num <= 255;
        });
    }

    return hostnameRegex.test(hostname) || hostname === 'localhost';
}

// 验证文件路径以防止路径遍历攻击
function validateFilePath(filePath) {
    if (!filePath || typeof filePath !== 'string') {
        return false;
    }

    // 防止路径遍历攻击
    if (filePath.includes('../') || filePath.includes('..\\')) {
        return false;
    }

    // 检查是否包含危险字符
    if (/[<>'"&]/.test(filePath)) {
        return false;
    }

    return true;
}

// 处理SSH连接
io.on('connection', (socket) => {
    console.log('客户端已连接:', socket.id);
    let sshClient = null;

    // 处理SSH连接请求
    socket.on('ssh-connect', async (data) => {
        try {
            // 首先验证输入参数
            const validationErrors = validateSSHParams(data);
            if (validationErrors.length > 0) {
                return socket.emit('ssh-error', `参数验证失败: ${validationErrors.join(', ')}`);
            }

            // 关闭现有连接
            if (sshClient) {
                sshClient.end();
            }

            // 创建新的SSH连接
            sshClient = new Client();
            
            // 准备连接配置
            const config = {
                host: data.host,
                port: data.port || 22,
                username: data.username,
                readyTimeout: 20000,
                keepaliveInterval: 30000
            };

            // 根据认证类型设置认证方式
            if (data.authType === 'password') {
                config.password = data.password;
            } else if (data.authType === 'privateKey') {
                // 如果提供了私钥文件路径
                if (data.privateKeyPath) {
                    try {
                        config.privateKey = fs.readFileSync(data.privateKeyPath);
                        if (data.passphrase) {
                            config.passphrase = data.passphrase;
                        }
                    } catch (err) {
                        return socket.emit('ssh-error', `无法读取私钥文件: ${err.message}`);
                    }
                } else {
                    return socket.emit('ssh-error', '未提供私钥文件');
                }
            }

            // 连接事件处理
            sshClient.on('ready', () => {
                socket.emit('ssh-connected', {
                    host: data.host,
                    username: data.username
                });
                
                // 创建SSH Shell
                sshClient.shell((err, stream) => {
                    if (err) {
                        return socket.emit('ssh-error', `无法创建Shell: ${err.message}`);
                    }

                    // 存储连接信息
                    sshConnections[socket.id] = {
                        client: sshClient,
                        stream: stream
                    };

                    // 处理来自终端的数据
                    stream.on('data', (data) => {
                        socket.emit('terminal-output', data.toString('utf-8'));
                    });

                    // 处理SSH流关闭
                    stream.on('close', () => {
                        socket.emit('ssh-closed');
                        if (sshClient) {
                            sshClient.end();
                            sshClient = null;
                        }
                    });

                    // 处理SSH流错误
                    stream.on('error', (err) => {
                        socket.emit('ssh-error', `Shell错误: ${err.message}`);
                    });

                    // 处理来自客户端的终端输入
                    socket.on('terminal-input', (data) => {
                        if (stream && stream.writable) {
                            stream.write(data);
                        }
                    });

                    // 处理终端调整大小
                    socket.on('terminal-resize', (data) => {
                        if (stream) {
                            stream.setWindow(data.rows, data.cols);
                        }
                    });
                });
            });

            // 处理SSH连接错误
            sshClient.on('error', (err) => {
                socket.emit('ssh-error', `SSH连接错误: ${err.message}`);
                if (sshClient) {
                    sshClient.end();
                    sshClient = null;
                }
            });

            // 处理SSH连接关闭
            sshClient.on('close', () => {
                socket.emit('ssh-closed');
                sshClient = null;
            });

            // 连接到SSH服务器
            sshClient.connect(config);
        } catch (err) {
            socket.emit('ssh-error', `连接错误: ${err.message}`);
        }
    });

    // 处理文件列表请求
    socket.on('list-files', (path) => {
        if (!sshClient || !sshClient.sftp) {
            return socket.emit('ssh-error', '未连接到SSH服务器或SFTP不可用');
        }

        // 验证路径
        if (!validateFilePath(path)) {
            return socket.emit('ssh-error', '无效的文件路径');
        }

        sshClient.sftp((err, sftp) => {
            if (err) {
                return socket.emit('ssh-error', `SFTP错误: ${err.message}`);
            }

            sftp.readdir(path, (err, list) => {
                if (err) {
                    return socket.emit('ssh-error', `无法读取目录: ${err.message}`);
                }

                socket.emit('file-list', { path, files: list });
            });
        });
    });

    // 处理文件下载请求
    socket.on('download-file', (filePath) => {
        if (!sshClient) {
            return socket.emit('ssh-error', '未连接到SSH服务器');
        }

        // 验证路径
        if (!validateFilePath(filePath)) {
            return socket.emit('ssh-error', '无效的文件路径');
        }

        sshClient.sftp((err, sftp) => {
            if (err) {
                return socket.emit('ssh-error', `SFTP错误: ${err.message}`);
            }

            const fileName = path.basename(filePath);
            const localPath = path.join(__dirname, 'downloads', fileName);

            // 确保下载目录存在
            if (!fs.existsSync(path.join(__dirname, 'downloads'))) {
                fs.mkdirSync(path.join(__dirname, 'downloads'), { recursive: true });
            }

            sftp.fastGet(filePath, localPath, (err) => {
                if (err) {
                    return socket.emit('ssh-error', `文件下载错误: ${err.message}`);
                }

                socket.emit('download-complete', {
                    fileName,
                    downloadPath: `/downloads/${fileName}`
                });
            });
        });
    });

    // 处理文件上传请求
    app.post('/upload', upload.single('file'), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: '未提供文件或文件过大' });
        }

        const socketId = req.body.socketId;
        const remotePath = req.body.remotePath;
        
        if (!socketId || !sshConnections[socketId] || !remotePath) {
            return res.status(400).json({ error: '无效的请求参数' });
        }

        const sshClient = sshConnections[socketId].client;
        
        sshClient.sftp((err, sftp) => {
            if (err) {
                return res.status(500).json({ error: `SFTP错误: ${err.message}` });
            }

            const remoteFilePath = path.join(remotePath, req.file.originalname);
            const localFilePath = req.file.path;

            sftp.fastPut(localFilePath, remoteFilePath, (err) => {
                // 删除临时文件
                fs.unlinkSync(localFilePath);
                
                if (err) {
                    return res.status(500).json({ error: `文件上传错误: ${err.message}` });
                }

                res.json({ success: true, message: '文件上传成功' });
                io.to(socketId).emit('upload-complete', {
                    fileName: req.file.originalname,
                    path: remotePath
                });
            });
        });
    });

    // 处理文件读取请求
    socket.on('read-file', (filePath) => {
        if (!sshClient) {
            return socket.emit('ssh-error', '未连接到SSH服务器');
        }

        // 验证路径
        if (!validateFilePath(filePath)) {
            return socket.emit('ssh-error', '无效的文件路径');
        }

        sshClient.sftp((err, sftp) => {
            if (err) {
                return socket.emit('ssh-error', `SFTP错误: ${err.message}`);
            }

            let content = '';
            const stream = sftp.createReadStream(filePath);

            stream.on('data', (data) => {
                content += data.toString('utf-8');
            });

            stream.on('end', () => {
                socket.emit('file-content', {
                    path: filePath,
                    content: content
                });
            });

            stream.on('error', (err) => {
                socket.emit('ssh-error', `文件读取错误: ${err.message}`);
            });
        });
    });

    // 处理文件写入请求
    socket.on('write-file', (data) => {
        if (!sshClient) {
            return socket.emit('ssh-error', '未连接到SSH服务器');
        }

        // 验证路径
        if (!validateFilePath(data.path)) {
            return socket.emit('ssh-error', '无效的文件路径');
        }

        sshClient.sftp((err, sftp) => {
            if (err) {
                return socket.emit('ssh-error', `SFTP错误: ${err.message}`);
            }

            const stream = sftp.createWriteStream(data.path);

            stream.write(data.content, (err) => {
                if (err) {
                    return socket.emit('ssh-error', `文件写入错误: ${err.message}`);
                }

                stream.end();
                socket.emit('file-saved', { path: data.path });
            });

            stream.on('error', (err) => {
                socket.emit('ssh-error', `文件写入错误: ${err.message}`);
            });
        });
    });

    // 处理创建目录请求
    socket.on('create-directory', (data) => {
        if (!sshClient) {
            return socket.emit('ssh-error', '未连接到SSH服务器');
        }

        // 验证路径
        if (!validateFilePath(data.path)) {
            return socket.emit('ssh-error', '无效的文件路径');
        }

        sshClient.sftp((err, sftp) => {
            if (err) {
                return socket.emit('ssh-error', `SFTP错误: ${err.message}`);
            }

            sftp.mkdir(data.path, { mode: 0o755 }, (err) => {
                if (err) {
                    return socket.emit('ssh-error', `创建目录错误: ${err.message}`);
                }

                socket.emit('directory-created', { path: data.path });
            });
        });
    });

    // 处理删除文件请求
    socket.on('delete-file', (filePath) => {
        if (!sshClient) {
            return socket.emit('ssh-error', '未连接到SSH服务器');
        }

        // 验证路径
        if (!validateFilePath(filePath)) {
            return socket.emit('ssh-error', '无效的文件路径');
        }

        sshClient.sftp((err, sftp) => {
            if (err) {
                return socket.emit('ssh-error', `SFTP错误: ${err.message}`);
            }

            sftp.unlink(filePath, (err) => {
                if (err) {
                    return socket.emit('ssh-error', `删除文件错误: ${err.message}`);
                }

                socket.emit('file-deleted', { path: filePath });
            });
        });
    });

    // 处理命令提示请求（安全版本 - 使用环境变量中的API密钥）
    socket.on('command-suggestion', async (command) => {
        try {
            // 验证命令输入，防止注入攻击
            if (!command || typeof command !== 'string' || command.length > 100) {
                return socket.emit('command-suggestions', '无效的命令输入');
            }

            // 检查是否配置了API密钥
            const apiKey = process.env.COMMAND_SUGGESTION_API_KEY;
            if (!apiKey) {
                // 如果没有配置API密钥，则返回通用命令提示
                return socket.emit('command-suggestions', generateLocalCommandSuggestions(command));
            }

            const response = await axios.post('https://api.x.ai/v1/chat/completions', {
                messages: [
                    {
                        role: "system",
                        content: "你是一个Linux命令提示助手，根据用户输入的命令前缀或描述，提供相关的Linux命令建议和简短说明。只返回命令和简短说明，不要有多余的文字。"
                    },
                    {
                        role: "user",
                        content: `为这个命令提供建议: ${command}`
                    }
                ],
                model: "grok-3-latest",
                stream: false,
                temperature: 0
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            const suggestions = response.data.choices[0].message.content;
            socket.emit('command-suggestions', suggestions);
        } catch (error) {
            console.error('命令提示API错误:', error);
            // 发生错误时返回本地生成的建议
            socket.emit('command-suggestions', generateLocalCommandSuggestions(command));
        }
    });

    // 本地命令建议生成函数（当API不可用时的备用方案）
    function generateLocalCommandSuggestions(command) {
        const suggestions = [];
        
        // 基于常见命令的建议
        if (command.startsWith('ls')) {
            suggestions.push('ls -la 列出所有文件（包含隐藏文件）');
            suggestions.push('ls -lh 以人类可读格式显示文件大小');
        } else if (command.startsWith('cd')) {
            suggestions.push('cd .. 返回上级目录');
            suggestions.push('cd ~ 进入主目录');
            suggestions.push('cd / 进入根目录');
        } else if (command.startsWith('mkdir')) {
            suggestions.push('mkdir -p 创建多级目录');
        } else if (command.startsWith('rm')) {
            suggestions.push('rm -rf 强制删除目录（谨慎使用）');
            suggestions.push('rm -i 删除前询问确认');
        } else if (command.startsWith('cp')) {
            suggestions.push('cp -r 递归复制目录');
            suggestions.push('cp -i 复制前询问确认');
        } else if (command.startsWith('mv')) {
            suggestions.push('mv -i 移动前询问确认');
        } else if (command.startsWith('ps')) {
            suggestions.push('ps aux 显示所有进程');
            suggestions.push('ps ef 显示完整进程树');
        } else if (command.startsWith('grep')) {
            suggestions.push('grep -r 递归搜索文件内容');
            suggestions.push('grep -i 忽略大小写搜索');
            suggestions.push('grep -n 显示行号');
        } else if (command.startsWith('find')) {
            suggestions.push('find . -name 按名称查找文件');
            suggestions.push('find . -type d 按类型查找（目录）');
            suggestions.push('find . -type f 按类型查找（文件）');
        } else if (command.startsWith('chmod')) {
            suggestions.push('chmod 755 设置权限为 rwxr-xr-x');
            suggestions.push('chmod +x 添加执行权限');
        } else if (command.startsWith('chown')) {
            suggestions.push('chown user:group 更改文件所有者和组');
        } else if (command.startsWith('tar')) {
            suggestions.push('tar -czf archive.tar.gz dir/ 创建gzip压缩包');
            suggestions.push('tar -xzf archive.tar.gz 解压gzip压缩包');
        } else if (command.startsWith('netstat')) {
            suggestions.push('netstat -tuln 显示TCP/UDP监听端口');
        } else if (command.startsWith('df')) {
            suggestions.push('df -h 以人类可读格式显示磁盘空间');
        } else if (command.startsWith('du')) {
            suggestions.push('du -sh 显示目录总大小');
            suggestions.push('du -h 以人类可读格式显示详细大小');
        } else if (command.startsWith('top') || command.startsWith('htop')) {
            suggestions.push('htop 更直观的系统监控工具（如已安装）');
        } else {
            // 通用命令建议
            suggestions.push('man command 查看命令手册');
            suggestions.push('command --help 查看命令帮助');
            suggestions.push('which command 查找命令路径');
        }
        
        return suggestions.join('\n');
    }

    // 处理断开连接
    socket.on('disconnect', () => {
        console.log('客户端已断开连接:', socket.id);
        
        // 关闭SSH连接
        if (sshConnections[socket.id]) {
            const connection = sshConnections[socket.id];
            if (connection.stream) {
                connection.stream.end();
            }
            if (connection.client) {
                connection.client.end();
            }
            delete sshConnections[socket.id];
        }
    });
});

// 添加健康检查端点
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 添加错误处理中间件
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: '文件太大' });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ error: '意外的文件字段' });
        }
    }
    console.error('应用错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
    console.log(`SSH客户端服务器运行在 http://${HOST}:${PORT}`);
    console.log(`访问 http://${HOST}:${PORT} 开始使用`);
});