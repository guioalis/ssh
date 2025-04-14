// 命令提示功能增强
let commandHistory = [];
let currentCommandIndex = -1;
let commandBuffer = '';
let lastCommand = '';
let suggestionTimeout = null;

// 增强getCurrentCommand函数以更准确地获取当前命令
function getCurrentCommand() {
    // 获取终端当前行
    const line = term.buffer.active.getLine(term.buffer.active.cursorY);
    if (!line) return '';
    
    // 获取当前行文本
    const lineText = line.translateToString();
    
    // 查找命令提示符位置（通常是$或#）
    const promptIndex = lineText.lastIndexOf('$');
    const promptIndex2 = lineText.lastIndexOf('#');
    const lastPromptIndex = Math.max(promptIndex, promptIndex2);
    
    // 如果找到提示符，返回提示符后面的内容
    if (lastPromptIndex >= 0) {
        return lineText.substring(lastPromptIndex + 1).trim();
    }
    
    // 如果没有找到提示符，返回整行内容
    return lineText.trim();
}

// 增强命令提示功能
function enhanceCommandSuggestions() {
    // 清除之前的事件监听器
    term.onData((data) => {});
    
    // 重新添加事件监听器
    term.onData((data) => {
        // 如果已连接
        if (isConnected) {
            // 发送数据到SSH服务器
            socket.emit('terminal-input', data);
            
            // 处理特殊键
            if (data === '\r') { // Enter键
                // 保存当前命令到历史记录
                const currentCommand = getCurrentCommand();
                if (currentCommand && currentCommand !== commandHistory[commandHistory.length - 1]) {
                    commandHistory.push(currentCommand);
                    if (commandHistory.length > 50) { // 限制历史记录长度
                        commandHistory.shift();
                    }
                }
                currentCommandIndex = -1;
                lastCommand = currentCommand;
                
                // 清除命令提示
                clearCommandSuggestions();
            } else if (data === '\u001b[A') { // 上箭头
                // 浏览命令历史（向上）
                if (currentCommandIndex === -1) {
                    commandBuffer = getCurrentCommand();
                    currentCommandIndex = commandHistory.length - 1;
                } else if (currentCommandIndex > 0) {
                    currentCommandIndex--;
                }
                
                if (currentCommandIndex >= 0 && commandHistory[currentCommandIndex]) {
                    // 这里不直接修改终端，因为我们只是监听，实际修改由SSH服务器完成
                }
            } else if (data === '\u001b[B') { // 下箭头
                // 浏览命令历史（向下）
                if (currentCommandIndex < commandHistory.length - 1) {
                    currentCommandIndex++;
                    // 这里不直接修改终端，因为我们只是监听，实际修改由SSH服务器完成
                } else {
                    currentCommandIndex = -1;
                    // 这里不直接修改终端，因为我们只是监听，实际修改由SSH服务器完成
                }
            } else if (data === ' ' || data === '\t') { // 空格或Tab键
                // 获取当前命令并请求提示
                const currentCommand = getCurrentCommand();
                if (currentCommand && currentCommand.trim().length > 0) {
                    // 清除之前的超时
                    if (suggestionTimeout) {
                        clearTimeout(suggestionTimeout);
                    }
                    
                    // 设置新的超时，避免频繁请求
                    suggestionTimeout = setTimeout(() => {
                        requestCommandSuggestions(currentCommand.trim());
                    }, 300);
                }
            } else {
                // 其他按键，延迟请求命令提示
                clearTimeout(suggestionTimeout);
                suggestionTimeout = setTimeout(() => {
                    const currentCommand = getCurrentCommand();
                    if (currentCommand && currentCommand.trim().length > 0) {
                        requestCommandSuggestions(currentCommand.trim());
                    } else {
                        clearCommandSuggestions();
                    }
                }, 500);
            }
        }
    });
}

// 请求命令提示
function requestCommandSuggestions(command) {
    if (!isConnected) return;
    
    // 如果命令长度小于2，不请求提示
    if (command.length < 2) {
        clearCommandSuggestions();
        return;
    }
    
    socket.emit('command-suggestion', command);
}

// 清除命令提示
function clearCommandSuggestions() {
    const suggestionsContainer = document.getElementById('suggestions-container');
    suggestionsContainer.innerHTML = '';
}

// 显示命令提示，增强版
function displayCommandSuggestions(suggestions) {
    const suggestionsContainer = document.getElementById('suggestions-container');
    suggestionsContainer.innerHTML = '';
    
    // 解析建议内容
    const suggestionLines = suggestions.split('\n').filter(line => line.trim());
    
    // 如果没有建议，显示一条提示信息
    if (suggestionLines.length === 0) {
        const noSuggestionItem = document.createElement('div');
        noSuggestionItem.className = 'suggestion-item no-suggestion';
        noSuggestionItem.textContent = '没有匹配的命令建议';
        suggestionsContainer.appendChild(noSuggestionItem);
        return;
    }
    
    // 显示建议
    suggestionLines.forEach(suggestion => {
        const suggestionItem = document.createElement('div');
        suggestionItem.className = 'suggestion-item';
        
        // 尝试分离命令和描述
        let command, description;
        if (suggestion.includes(' - ')) {
            [command, description] = suggestion.split(' - ', 2);
        } else if (suggestion.includes(': ')) {
            [command, description] = suggestion.split(': ', 2);
        } else {
            command = suggestion;
            description = '';
        }
        
        // 创建HTML结构
        suggestionItem.innerHTML = `
            <div class="suggestion-command">${command}</div>
            ${description ? `<div class="suggestion-description">${description}</div>` : ''}
        `;
        
        // 点击建议时将命令发送到终端
        suggestionItem.addEventListener('click', () => {
            if (command) {
                // 发送命令到终端
                socket.emit('terminal-input', command + ' ');
            }
        });
        
        suggestionsContainer.appendChild(suggestionItem);
    });
}

// 初始化命令提示样式
function initCommandSuggestionStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .command-suggestions {
            height: 150px;
            background-color: #f8f9fa;
            border-top: 1px solid #dee2e6;
            overflow-y: auto;
            transition: height 0.3s ease;
        }
        
        .suggestion-header {
            padding: 8px 15px;
            background-color: #e9ecef;
            border-bottom: 1px solid #dee2e6;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .suggestion-header h5 {
            margin: 0;
            font-size: 1rem;
        }
        
        .suggestion-toggle {
            cursor: pointer;
            font-size: 0.8rem;
            color: #6c757d;
        }
        
        #suggestions-container {
            padding: 10px 15px;
        }
        
        .suggestion-item {
            padding: 8px 12px;
            margin-bottom: 8px;
            background-color: #fff;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            flex-direction: column;
        }
        
        .suggestion-item:hover {
            background-color: #e9ecef;
            border-color: #ced4da;
            transform: translateY(-2px);
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        
        .suggestion-command {
            font-weight: bold;
            color: #495057;
        }
        
        .suggestion-description {
            font-size: 0.85rem;
            color: #6c757d;
            margin-top: 4px;
        }
        
        .no-suggestion {
            color: #6c757d;
            font-style: italic;
            cursor: default;
        }
        
        .command-suggestions.collapsed {
            height: 40px;
            overflow: hidden;
        }
    `;
    document.head.appendChild(style);
}

// 增强命令提示区域UI
function enhanceCommandSuggestionsUI() {
    const suggestionHeader = document.querySelector('.suggestion-header');
    
    // 添加折叠/展开按钮
    const toggleButton = document.createElement('span');
    toggleButton.className = 'suggestion-toggle';
    toggleButton.textContent = '折叠';
    toggleButton.addEventListener('click', () => {
        const suggestionsContainer = document.querySelector('.command-suggestions');
        suggestionsContainer.classList.toggle('collapsed');
        toggleButton.textContent = suggestionsContainer.classList.contains('collapsed') ? '展开' : '折叠';
    });
    
    suggestionHeader.appendChild(toggleButton);
}

// 在文档加载完成后初始化命令提示增强功能
document.addEventListener('DOMContentLoaded', () => {
    // 初始化命令提示样式
    initCommandSuggestionStyles();
    
    // 在终端初始化后增强命令提示功能
    const originalInitTerminal = initTerminal;
    initTerminal = function() {
        originalInitTerminal();
        enhanceCommandSuggestions();
        
        // 在Socket连接初始化后增强命令提示UI
        const originalInitSocketEvents = initSocketEvents;
        initSocketEvents = function() {
            originalInitSocketEvents();
            enhanceCommandSuggestionsUI();
        };
    };
});
