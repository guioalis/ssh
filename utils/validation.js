// 输入验证工具函数

/**
 * 验证SSH连接参数
 * @param {Object} params - 连接参数
 * @returns {Array} 错误信息数组
 */
function validateSSHConnectionParams(params) {
    const errors = [];

    // 验证主机地址
    if (!params.host || typeof params.host !== 'string' || params.host.length > 255) {
        errors.push('无效的主机地址');
    } else if (!isValidHostnameOrIP(params.host)) {
        errors.push('主机地址格式不正确');
    }

    // 验证端口
    const port = parseInt(params.port);
    if (isNaN(port) || port < 1 || port > 65535) {
        errors.push('端口必须是1-65535之间的数字');
    }

    // 验证用户名
    if (!params.username || typeof params.username !== 'string' || params.username.length > 64) {
        errors.push('用户名不能为空且长度不能超过64字符');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(params.username)) {
        errors.push('用户名只能包含字母、数字、下划线和连字符');
    }

    // 验证认证方式
    if (!['password', 'privateKey'].includes(params.authType)) {
        errors.push('认证方式必须是password或privateKey');
    }

    // 根据认证方式验证相应字段
    if (params.authType === 'password') {
        if (!params.password || typeof params.password !== 'string') {
            errors.push('密码不能为空');
        }
    } else if (params.authType === 'privateKey') {
        if (!params.privateKey) {
            errors.push('私钥不能为空');
        }
        // 如果有密码短语，验证其类型
        if (params.passphrase && typeof params.passphrase !== 'string') {
            errors.push('密码短语格式不正确');
        }
    }

    return errors;
}

/**
 * 验证文件路径
 * @param {string} path - 文件路径
 * @returns {boolean}
 */
function validateFilePath(path) {
    if (!path || typeof path !== 'string') {
        return false;
    }

    // 防止路径遍历攻击
    if (path.includes('../') || path.includes('..\\')) {
        return false;
    }

    // 检查是否包含危险字符
    if (/[<>'"&]/.test(path)) {
        return false;
    }

    return true;
}

/**
 * 验证主机名或IP地址
 * @param {string} hostname - 主机名或IP
 * @returns {boolean}
 */
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

/**
 * 验证命令输入
 * @param {string} command - 命令字符串
 * @returns {boolean}
 */
function validateCommandInput(command) {
    if (!command || typeof command !== 'string' || command.length > 1000) {
        return false;
    }

    // 防止常见的命令注入字符
    const dangerousChars = [';', '&', '|', '`', '$(', '${'];
    for (const char of dangerousChars) {
        if (command.includes(char)) {
            return false;
        }
    }

    return true;
}

module.exports = {
    validateSSHConnectionParams,
    validateFilePath,
    validateCommandInput
};