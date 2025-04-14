const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client } = require('ssh2');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');

// 创建Express应用
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 设置静态文件目录
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 设置文件上传
const upload = multer({ dest: 'uploads/' });

// 存储SSH连接
const sshConnections = {};

// 处理SSH连接
io.on('connection', (socket) => {
    console.log('客户端已连接:', socket.id);
    let sshClient = null;

    // 处理SSH连接请求
    socket.on('ssh-connect', async (data) => {
        try {
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
            return res.status(400).json({ error: '未提供文件' });
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

        sshClient.sftp((err, sftp) => {
            if (err) {
                return socket.emit('ssh-error', `SFTP错误: ${err.message}`);
            }

            sftp.mkdir(data.path, (err) => {
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

    // 处理命令提示请求
    socket.on('command-suggestion', async (command) => {
        try {
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
                    'Authorization': 'Bearer xai-C2pYeM9PZ090poP67eoAMYUhh3qhmQ6qfddZM7MrrgoHUodhp21FuqtLeak7ERWjLCSf0ULxSD1sJFdN'
                }
            });

            const suggestions = response.data.choices[0].message.content;
            socket.emit('command-suggestions', suggestions);
        } catch (error) {
            console.error('命令提示API错误:', error);
            socket.emit('command-suggestions', '无法获取命令提示');
        }
    });

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

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`SSH客户端服务器运行在 http://localhost:${PORT}`);
});
