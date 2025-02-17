import winston from 'winston';

// 创建并导出 logger
export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

export function setupLogging() {
    // 设置全局logger
    global.logger = logger;
}

// 声明全局logger类型
declare global {
    var logger: winston.Logger;
} 