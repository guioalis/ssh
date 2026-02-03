// 应用配置文件
require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    host: process.env.HOST || 'localhost',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760, // 10MB 默认
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    allowedFileTypes: process.env.ALLOWED_FILE_TYPES ? 
        process.env.ALLOWED_FILE_TYPES.split(',') : 
        ['text/plain', 'text/html', 'application/javascript', 'application/json'],
    commandSuggestionApiKey: process.env.COMMAND_SUGGESTION_API_KEY
};