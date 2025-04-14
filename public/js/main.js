// 全局变量
let socket;
let term;
let fitAddon;
let currentPath = '/';
let isConnected = false;

// 初始化函数
document.addEventListener('DOMContentLoaded', () => {
    // 初始化Socket.io连接
    socket = io();

    // 初始化终端
    initTerminal();

    // 初始化事件监听器
    initEventListeners();

    // 初始化Socket事件处理
    initSocketEvents();
});

// 初始化终端
function initTerminal() {
    // 创建终端实例
    term = new Terminal({
        cursorBlink: true,
        theme: {
            background: '#1e1e1e',
            foreground: '#f0f0f0'
        },
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        scrollback: 1000
    });

    // 创建自适应插件
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    // 将终端挂载到DOM
    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    // 监听终端输入
    term.onData(data => {
        if (isConnected) {
            socket.emit('terminal-input', data);
        }
    });

    // 监听窗口大小变化
    window.addEventListener('resize', () => {
        fitAddon.fit();
        if (isConnected) {
            socket.emit('terminal-resize', {
                cols: term.cols,
                rows: term.rows
            });
        }
    });
}

// 初始化事件监听器
function initEventListeners() {
    // SSH连接表单提交
    document.getElementById('ssh-form').addEventListener('submit', (e) => {
        e.preventDefault();
        connectToSSH();
    });

    // 认证类型切换
    document.getElementById('auth-type').addEventListener('change', (e) => {
        const authType = e.target.value;
        if (authType === 'password') {
            document.querySelector('.auth-password').classList.remove('hidden');
            document.querySelector('.auth-key').classList.add('hidden');
        } else {
            document.querySelector('.auth-password').classList.add('hidden');
            document.querySelector('.auth-key').classList.remove('hidden');
        }
    });

    // 文件上传按钮
    document.getElementById('upload-file').addEventListener('click', () => {
        document.getElementById('file-upload').click();
    });

    // 文件上传处理
    document.getElementById('file-upload').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            uploadFile(e.target.files[0]);
        }
    });

    // 创建文件夹按钮
    document.getElementById('create-folder').addEventListener('click', () => {
        const folderName = prompt('请输入文件夹名称:');
        if (folderName) {
            createDirectory(currentPath + '/' + folderName);
        }
    });

    // 刷新文件列表按钮
    document.getElementById('refresh-files').addEventListener('click', () => {
        listFiles(currentPath);
    });

    // 保存文件按钮
    document.getElementById('save-file-btn').addEventListener('click', () => {
        const filePath = document.getElementById('file-edit-modal-label').getAttribute('data-path');
        const content = document.getElementById('file-editor').value;
        saveFile(filePath, content);
    });

    // 终端输入命令提示
    term.onData((data) => {
        // 当用户输入空格或Tab键时，获取当前命令并请求提示
        if (data === ' ' || data === '\t') {
            const currentLine = getCurrentCommand();
            if (currentLine.trim().length > 0) {
                socket.emit('command-suggestion', currentLine.trim());
            }
        }
    });
}

// 初始化Socket事件处理
function initSocketEvents() {
    // 连接成功
    socket.on('connect', () => {
        console.log('已连接到服务器');
    });

    // SSH连接成功
    socket.on('ssh-connected', (data) => {
        isConnected = true;
        updateConnectionStatus(true, `已连接到 ${data.username}@${data.host}`);
        term.clear();
        term.focus();
        
        // 连接成功后获取根目录文件列表
        listFiles('/');
    });

    // SSH连接错误
    socket.on('ssh-error', (error) => {
        showNotification('错误', error, 'danger');
        updateConnectionStatus(false, '连接失败');
    });

    // SSH连接关闭
    socket.on('ssh-closed', () => {
        isConnected = false;
        updateConnectionStatus(false, '未连接');
        showNotification('信息', 'SSH连接已关闭', 'info');
    });

    // 终端输出
    socket.on('terminal-output', (data) => {
        term.write(data);
    });

    // 文件列表
    socket.on('file-list', (data) => {
        displayFileList(data.path, data.files);
        currentPath = data.path;
        updateBreadcrumb(data.path);
    });

    // 文件内容
    socket.on('file-content', (data) => {
        displayFileContent(data.path, data.content);
    });

    // 文件保存成功
    socket.on('file-saved', (data) => {
        showNotification('成功', `文件 ${data.path} 已保存`, 'success');
        // 关闭编辑模态框
        const modal = bootstrap.Modal.getInstance(document.getElementById('file-edit-modal'));
        modal.hide();
    });

    // 目录创建成功
    socket.on('directory-created', (data) => {
        showNotification('成功', `目录 ${data.path} 已创建`, 'success');
        listFiles(currentPath);
    });

    // 文件删除成功
    socket.on('file-deleted', (data) => {
        showNotification('成功', `文件 ${data.path} 已删除`, 'success');
        listFiles(currentPath);
    });

    // 文件下载完成
    socket.on('download-complete', (data) => {
        showNotification('成功', `文件 ${data.fileName} 下载完成`, 'success');
        // 创建下载链接
        const a = document.createElement('a');
        a.href = data.downloadPath;
        a.download = data.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    // 文件上传完成
    socket.on('upload-complete', (data) => {
        showNotification('成功', `文件 ${data.fileName} 上传完成`, 'success');
        listFiles(data.path);
    });

    // 命令提示
    socket.on('command-suggestions', (suggestions) => {
        displayCommandSuggestions(suggestions);
    });
}

// 连接到SSH服务器
function connectToSSH() {
    const host = document.getElementById('host').value;
    const port = document.getElementById('port').value;
    const username = document.getElementById('username').value;
    const authType = document.getElementById('auth-type').value;
    
    let authData = {};
    
    if (authType === 'password') {
        authData = {
            password: document.getElementById('password').value
        };
    } else {
        const privateKeyFile = document.getElementById('private-key').files[0];
        if (!privateKeyFile) {
            showNotification('错误', '请选择私钥文件', 'danger');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const privateKey = e.target.result;
            const passphrase = document.getElementById('passphrase').value;
            
            completeConnection(host, port, username, authType, { privateKey, passphrase });
        };
        reader.readAsText(privateKeyFile);
        return;
    }
    
    completeConnection(host, port, username, authType, authData);
}

// 完成SSH连接
function completeConnection(host, port, username, authType, authData) {
    updateConnectionStatus(false, '正在连接...');
    
    socket.emit('ssh-connect', {
        host,
        port,
        username,
        authType,
        ...authData
    });
}

// 更新连接状态
function updateConnectionStatus(connected, statusText) {
    const statusIndicator = document.getElementById('status-indicator');
    const statusTextElement = document.getElementById('status-text');
    const connectionInfoText = document.getElementById('connection-info-text');
    
    if (connected) {
        statusIndicator.className = 'status-indicator status-online';
        statusTextElement.textContent = '已连接';
        connectionInfoText.textContent = statusText;
    } else {
        statusIndicator.className = 'status-indicator status-offline';
        statusTextElement.textContent = statusText;
        connectionInfoText.textContent = '';
    }
}

// 显示通知
function showNotification(title, message, type) {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} notification`;
    notification.innerHTML = `
        <strong>${title}:</strong> ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    
    // 添加到页面
    document.body.appendChild(notification);
    
    // 设置自动消失
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// 列出文件
function listFiles(path) {
    if (!isConnected) {
        showNotification('错误', '未连接到SSH服务器', 'danger');
        return;
    }
    
    socket.emit('list-files', path);
}

// 显示文件列表
function displayFileList(path, files) {
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';
    
    // 如果不是根目录，添加返回上级目录选项
    if (path !== '/') {
        const parentPath = path.substring(0, path.lastIndexOf('/'));
        const parentDir = parentPath || '/';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><i class="bi bi-arrow-up-circle"></i> 返回上级目录</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
        `;
        row.addEventListener('click', () => {
            listFiles(parentDir);
        });
        fileList.appendChild(row);
    }
    
    // 添加文件和目录
    files.forEach(file => {
        const row = document.createElement('tr');
        const isDirectory = file.longname.startsWith('d');
        const fileSize = formatFileSize(file.attrs.size);
        const modTime = new Date(file.attrs.mtime * 1000).toLocaleString();
        const permissions = file.longname.substring(0, 10);
        
        row.innerHTML = `
            <td>
                <i class="bi ${isDirectory ? 'bi-folder' : 'bi-file'}"></i>
                ${file.filename}
            </td>
            <td>${fileSize}</td>
            <td>${modTime}</td>
            <td>${permissions}</td>
            <td>
                <div class="btn-group">
                    ${isDirectory ? '' : `
                        <button class="btn btn-sm btn-primary download-btn">
                            <i class="bi bi-download"></i>
                        </button>
                        <button class="btn btn-sm btn-info edit-btn">
                            <i class="bi bi-pencil"></i>
                        </button>
                    `}
                    <button class="btn btn-sm btn-danger delete-btn">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </td>
        `;
        
        // 添加点击事件
        if (isDirectory) {
            row.addEventListener('click', (e) => {
                if (!e.target.closest('.btn')) {
                    listFiles(path + '/' + file.filename);
                }
            });
        }
        
        // 添加下载按钮事件
        const downloadBtn = row.querySelector('.download-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                downloadFile(path + '/' + file.filename);
            });
        }
        
        // 添加编辑按钮事件
        const editBtn = row.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                readFile(path + '/' + file.filename);
            });
        }
        
        // 添加删除按钮事件
        const deleteBtn = row.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                if (confirm(`确定要删除 ${file.filename} 吗？`)) {
                    deleteFile(path + '/' + file.filename);
                }
            });
        }
        
        fileList.appendChild(row);
    });
}

// 格式化文件大小
function formatFileSize(size) {
    if (size < 1024) {
        return size + ' B';
    } else if (size < 1024 * 1024) {
        return (size / 1024).toFixed(2) + ' KB';
    } else if (size < 1024 * 1024 * 1024) {
        return (size / (1024 * 1024)).toFixed(2) + ' MB';
    } else {
        return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
}

// 更新面包屑导航
function updateBreadcrumb(path) {
    const breadcrumb = document.getElementById('path-breadcrumb');
    breadcrumb.innerHTML = '';
    
    // 添加根目录
    const rootItem = document.createElement('li');
    rootItem.className = 'breadcrumb-item';
    rootItem.innerHTML = '<a href="#" data-path="/">根目录</a>';
    rootItem.querySelector('a').addEventListener('click', () => {
        listFiles('/');
    });
    breadcrumb.appendChild(rootItem);
    
    // 如果不是根目录，添加路径
    if (path !== '/') {
        const parts = path.split('/').filter(p => p);
        let currentPath = '';
        
        parts.forEach((part, index) => {
            currentPath += '/' + part;
            
            const item = document.createElement('li');
            item.className = 'breadcrumb-item';
            
            if (index === parts.length - 1) {
                item.textContent = part;
                item.classList.add('active');
            } else {
                item.innerHTML = `<a href="#" data-path="${currentPath}">${part}</a>`;
                item.querySelector('a').addEventListener('click', (e) => {
                    listFiles(e.target.getAttribute('data-path'));
                });
            }
            
            breadcrumb.appendChild(item);
        });
    }
}

// 下载文件
function downloadFile(filePath) {
    if (!isConnected) {
        showNotification('错误', '未连接到SSH服务器', 'danger');
        return;
    }
    
    socket.emit('download-file', filePath);
}

// 上传文件
function uploadFile(file) {
    if (!isConnected) {
        showNotification('错误', '未连接到SSH服务器', 'danger');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('socketId', socket.id);
    formData.append('remotePath', currentPath);
    
    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            showNotification('错误', data.error, 'danger');
        }
    })
    .catch(error => {
        showNotification('错误', '文件上传失败', 'danger');
    });
    
    // 清空文件输入
    document.getElementById('file-upload').value = '';
}

// 读取文件
function readFile(filePath) {
    if (!isConnected) {
        showNotification('错误', '未连接到SSH服务器', 'danger');
        return;
    }
    
    socket.emit('read-file', filePath);
}

// 显示文件内容
function displayFileContent(filePath, content) {
    const modal = new bootstrap.Modal(document.getElementById('file-edit-modal'));
    document.getElementById('file-edit-modal-label').textContent = '编辑文件: ' + filePath;
    document.getElementById('file-edit-modal-label').setAttribute('data-path', filePath);
    document.getElementById('file-editor').value = content;
    modal.show();
}

// 保存文件
function saveFile(filePath, content) {
    if (!isConnected) {
        showNotification('错误', '未连接到SSH服务器', 'danger');
        return;
    }
    
    socket.emit('write-file', {
        path: filePath,
        content: content
    });
}

// 创建目录
function createDirectory(path) {
    if (!isConnected) {
        showNotification('错误', '未连接到SSH服务器', 'danger');
        return;
    }
    
    socket.emit('create-directory', {
        path: path
    });
}

// 删除文件
function deleteFile(filePath) {
    if (!isConnected) {
        showNotification('错误', '未连接到SSH服务器', 'danger');
        return;
    }
    
    socket.emit('delete-file', filePath);
}

// 获取当前命令
function getCurrentCommand() {
    // 这是一个简化的实现，实际上需要更复杂的逻辑来获取当前命令行
    // 在真实实现中，需要跟踪终端的光标位置和当前行内容
    const lines = term.buffer.active.getLine(term.buffer.active.cursorY).translateToString();
    const cursorX = term.buffer.active.cursorX;
    
    // 简单地获取光标前的内容
    return lines.substring(0, cursorX);
}

// 显示命令提示
function displayCommandSuggestions(suggestions) {
    const suggestionsContainer = document.getElementById('suggestions-container');
    suggestionsContainer.innerHTML = '';
    
    // 解析建议内容（可能需要根据API返回格式调整）
    const suggestionLines = suggestions.split('\n').filter(line => line.trim());
    
    suggestionLines.forEach(suggestion => {
        const suggestionItem = document.createElement('div');
        suggestionItem.className = 'suggestion-item';
        suggestionItem.textContent = suggestion;
        
        // 点击建议时将命令发送到终端
        suggestionItem.addEventListener('click', () => {
            // 提取命令部分（假设格式为"命令 - 描述"）
            const command = suggestion.split(' - ')[0];
            if (command) {
                // 发送命令到终端
                socket.emit('terminal-input', command + ' ');
            }
        });
        
        suggestionsContainer.appendChild(suggestionItem);
    });
}

// 添加CSS样式以支持通知
document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            min-width: 300px;
            max-width: 500px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
    `;
    document.head.appendChild(style);
});
