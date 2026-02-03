# 使用官方Node.js运行时作为基础镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制应用代码
COPY . .

# 创建上传和下载目录
RUN mkdir -p uploads downloads

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["npm", "start"]