const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const { validateSSHConnectionParams, validateFilePath } = require('../utils/validation');

class SSHService {
    constructor() {
        this.connections = new Map(); // 使用Map替代对象，更好地管理连接
    }

    /**
     * 连接到SSH服务器
     * @param {string} socketId - Socket连接ID
     * @param {Object} config - SSH连接配置
     */
    connect(socketId, config) {
        return new Promise((resolve, reject) => {
            // 首先验证输入参数
            const validationErrors = validateSSHConnectionParams(config);
            if (validationErrors.length > 0) {
                return reject(new Error(`参数验证失败: ${validationErrors.join(', ')}`));
            }

            // 关闭现有连接
            if (this.connections.has(socketId)) {
                this.disconnect(socketId);
            }

            const sshClient = new Client();

            // 准备连接配置
            const connectionConfig = {
                host: config.host,
                port: config.port || 22,
                username: config.username,
                readyTimeout: 20000,
                keepaliveInterval: 30000
            };

            // 根据认证类型设置认证方式
            if (config.authType === 'password') {
                connectionConfig.password = config.password;
            } else if (config.authType === 'privateKey') {
                // 如果提供了私钥文件路径
                if (config.privateKeyPath) {
                    try {
                        connectionConfig.privateKey = fs.readFileSync(config.privateKeyPath);
                        if (config.passphrase) {
                            connectionConfig.passphrase = config.passphrase;
                        }
                    } catch (err) {
                        return reject(new Error(`无法读取私钥文件: ${err.message}`));
                    }
                } else {
                    return reject(new Error('未提供私钥文件'));
                }
            }

            // 连接事件处理
            sshClient.on('ready', () => {
                // 存储连接信息
                const connectionInfo = {
                    client: sshClient,
                    stream: null,
                    sftp: null
                };
                
                this.connections.set(socketId, connectionInfo);
                resolve({
                    host: config.host,
                    username: config.username
                });
            });

            // 处理SSH连接错误
            sshClient.on('error', (err) => {
                reject(new Error(`SSH连接错误: ${err.message}`));
            });

            // 连接到SSH服务器
            sshClient.connect(connectionConfig);
        });
    }

    /**
     * 断开SSH连接
     * @param {string} socketId - Socket连接ID
     */
    disconnect(socketId) {
        if (this.connections.has(socketId)) {
            const connection = this.connections.get(socketId);
            
            if (connection.stream) {
                connection.stream.end();
            }
            
            if (connection.sftp) {
                connection.sftp.end();
            }
            
            if (connection.client) {
                connection.client.end();
            }
            
            this.connections.delete(socketId);
        }
    }

    /**
     * 获取SSH客户端
     * @param {string} socketId - Socket连接ID
     * @returns {Object|null}
     */
    getClient(socketId) {
        const connection = this.connections.get(socketId);
        return connection ? connection.client : null;
    }

    /**
     * 获取SSH流
     * @param {string} socketId - Socket连接ID
     * @returns {Object|null}
     */
    getStream(socketId) {
        const connection = this.connections.get(socketId);
        return connection ? connection.stream : null;
    }

    /**
     * 设置SSH流
     * @param {string} socketId - Socket连接ID
     * @param {Object} stream - SSH流
     */
    setStream(socketId, stream) {
        if (this.connections.has(socketId)) {
            const connection = this.connections.get(socketId);
            connection.stream = stream;
            this.connections.set(socketId, connection);
        }
    }

    /**
     * 设置SFTP连接
     * @param {string} socketId - Socket连接ID
     * @param {Object} sftp - SFTP连接
     */
    setSFTP(socketId, sftp) {
        if (this.connections.has(socketId)) {
            const connection = this.connections.get(socketId);
            connection.sftp = sftp;
            this.connections.set(socketId, connection);
        }
    }

    /**
     * 获取SFTP连接
     * @param {string} socketId - Socket连接ID
     * @returns {Object|null}
     */
    getSFTP(socketId) {
        const connection = this.connections.get(socketId);
        return connection ? connection.sftp : null;
    }

    /**
     * 列出文件
     * @param {string} socketId - Socket连接ID
     * @param {string} remotePath - 远程路径
     */
    listFiles(socketId, remotePath) {
        return new Promise((resolve, reject) => {
            if (!validateFilePath(remotePath)) {
                return reject(new Error('无效的文件路径'));
            }

            const sshClient = this.getClient(socketId);
            if (!sshClient) {
                return reject(new Error('未连接到SSH服务器'));
            }

            sshClient.sftp((err, sftp) => {
                if (err) {
                    return reject(new Error(`SFTP错误: ${err.message}`));
                }

                this.setSFTP(socketId, sftp);

                sftp.readdir(remotePath, (err, list) => {
                    if (err) {
                        return reject(new Error(`无法读取目录: ${err.message}`));
                    }

                    resolve({ path: remotePath, files: list });
                });
            });
        });
    }

    /**
     * 读取文件内容
     * @param {string} socketId - Socket连接ID
     * @param {string} filePath - 文件路径
     */
    readFile(socketId, filePath) {
        return new Promise((resolve, reject) => {
            if (!validateFilePath(filePath)) {
                return reject(new Error('无效的文件路径'));
            }

            const sshClient = this.getClient(socketId);
            if (!sshClient) {
                return reject(new Error('未连接到SSH服务器'));
            }

            sshClient.sftp((err, sftp) => {
                if (err) {
                    return reject(new Error(`SFTP错误: ${err.message}`));
                }

                let content = '';
                const stream = sftp.createReadStream(filePath);

                stream.on('data', (data) => {
                    content += data.toString('utf-8');
                });

                stream.on('end', () => {
                    resolve({ path: filePath, content });
                });

                stream.on('error', (err) => {
                    reject(new Error(`文件读取错误: ${err.message}`));
                });
            });
        });
    }

    /**
     * 写入文件
     * @param {string} socketId - Socket连接ID
     * @param {Object} data - 包含路径和内容的对象
     */
    writeFile(socketId, data) {
        return new Promise((resolve, reject) => {
            if (!validateFilePath(data.path)) {
                return reject(new Error('无效的文件路径'));
            }

            const sshClient = this.getClient(socketId);
            if (!sshClient) {
                return reject(new Error('未连接到SSH服务器'));
            }

            sshClient.sftp((err, sftp) => {
                if (err) {
                    return reject(new Error(`SFTP错误: ${err.message}`));
                }

                const stream = sftp.createWriteStream(data.path);

                stream.write(data.content, (err) => {
                    if (err) {
                        return reject(new Error(`文件写入错误: ${err.message}`));
                    }

                    stream.end();
                    resolve({ path: data.path });
                });

                stream.on('error', (err) => {
                    reject(new Error(`文件写入错误: ${err.message}`));
                });
            });
        });
    }

    /**
     * 创建目录
     * @param {string} socketId - Socket连接ID
     * @param {Object} data - 包含路径的对象
     */
    createDirectory(socketId, data) {
        return new Promise((resolve, reject) => {
            if (!validateFilePath(data.path)) {
                return reject(new Error('无效的文件路径'));
            }

            const sshClient = this.getClient(socketId);
            if (!sshClient) {
                return reject(new Error('未连接到SSH服务器'));
            }

            sshClient.sftp((err, sftp) => {
                if (err) {
                    return reject(new Error(`SFTP错误: ${err.message}`));
                }

                sftp.mkdir(data.path, { mode: 0o755 }, (err) => {
                    if (err) {
                        return reject(new Error(`创建目录错误: ${err.message}`));
                    }

                    resolve({ path: data.path });
                });
            });
        });
    }

    /**
     * 删除文件
     * @param {string} socketId - Socket连接ID
     * @param {string} filePath - 文件路径
     */
    deleteFile(socketId, filePath) {
        return new Promise((resolve, reject) => {
            if (!validateFilePath(filePath)) {
                return reject(new Error('无效的文件路径'));
            }

            const sshClient = this.getClient(socketId);
            if (!sshClient) {
                return reject(new Error('未连接到SSH服务器'));
            }

            sshClient.sftp((err, sftp) => {
                if (err) {
                    return reject(new Error(`SFTP错误: ${err.message}`));
                }

                sftp.unlink(filePath, (err) => {
                    if (err) {
                        return reject(new Error(`删除文件错误: ${err.message}`));
                    }

                    resolve({ path: filePath });
                });
            });
        });
    }

    /**
     * 下载文件
     * @param {string} socketId - Socket连接ID
     * @param {string} filePath - 文件路径
     */
    downloadFile(socketId, filePath) {
        return new Promise((resolve, reject) => {
            if (!validateFilePath(filePath)) {
                return reject(new Error('无效的文件路径'));
            }

            const sshClient = this.getClient(socketId);
            if (!sshClient) {
                return reject(new Error('未连接到SSH服务器'));
            }

            sshClient.sftp((err, sftp) => {
                if (err) {
                    return reject(new Error(`SFTP错误: ${err.message}`));
                }

                const fileName = path.basename(filePath);
                const localPath = path.join(__dirname, '../downloads', fileName);

                // 确保下载目录存在
                if (!fs.existsSync(path.join(__dirname, '../downloads'))) {
                    fs.mkdirSync(path.join(__dirname, '../downloads'), { recursive: true });
                }

                sftp.fastGet(filePath, localPath, (err) => {
                    if (err) {
                        return reject(new Error(`文件下载错误: ${err.message}`));
                    }

                    resolve({
                        fileName,
                        downloadPath: `/downloads/${fileName}`
                    });
                });
            });
        });
    }
}

module.exports = new SSHService();