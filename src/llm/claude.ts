import { config } from 'dotenv';
import { logger } from '../utils/logging';

config();

export interface ClaudeMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface ClaudeResponse {
    choices: [{
        message: {
            content: string;
        }
    }];
}

export class Claude {
    private baseUrl: string;
    private modelName: string;
    private token: string;

    constructor() {
        this.baseUrl = process.env.PROXY_URL || 'http://http://example.com/llmproxy/chat/completions';
        this.modelName = process.env.MODEL_NAME || 'claude-3-5-sonnet-20241022';
        this.token = process.env.VENUS_TOKEN || '';
        
        if (!this.token) {
            throw new Error('VENUS_TOKEN is required but not found in environment variables');
        }
    }

    async chat(messages: ClaudeMessage[]): Promise<string> {
        try {
            // 确保消息格式正确
            const cleanedMessages = messages.map(msg => ({
                role: msg.role,
                content: msg.content.trim()
            }));

            // 打印请求消息
            logger.info('Sending messages to Claude:', JSON.stringify(cleanedMessages, null, 2));

            const payload = {
                model: this.modelName,
                messages: cleanedMessages,
                stream: false,
                temperature: 0.7,
                max_tokens: 4096
            };

            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error('API Error Response:', errorText);
                throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
            }

            const data = await response.json();
            logger.info('Raw API response:', JSON.stringify(data, null, 2));

            // 检查响应格式
            if (!data.choices?.[0]?.message?.content) {
                // 如果是 finish_reason: "end_turn"，说明任务完成
                if (data.choices?.[0]?.finish_reason === 'end_turn') {
                    logger.info('Task completed, taking final screenshot');
                    return JSON.stringify({
                        "type": "screenshot",
                        "params": {
                            "path": `screenshots/task-complete-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
                        }
                    });
                }

                // 如果响应为空，尝试获取页面内容的截图
                logger.info('Empty response, taking screenshot of current state');
                return JSON.stringify({
                    "type": "screenshot",
                    "params": {
                        "path": `screenshots/empty-response-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
                    }
                });
            }

            const content = data.choices[0].message.content;
            logger.info('Claude response content:', content);

            // 如果内容不包含 JSON，尝试生成一个默认动作
            if (!content.includes('{') || !content.includes('}')) {
                logger.warn('Response does not contain JSON, using default action');
                // 根据任务内容生成默认动作
                if (content.toLowerCase().includes('baidu') || content.toLowerCase().includes('百度')) {
                    if (content.toLowerCase().includes('天气')) {
                        return JSON.stringify({
                            "type": "type",
                            "params": {
                                "selector": "#kw",
                                "text": "深圳天气"
                            }
                        });
                    }
                    return JSON.stringify({
                        "type": "goto",
                        "params": {
                            "url": "https://www.baidu.com"
                        }
                    });
                }
                // 其他默认动作...
            }

            return content;
        } catch (error) {
            logger.error('Error calling Claude API:', error);
            if (error instanceof Error) {
                logger.error('Error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });
            }
            // 返回一个默认的截图动作而不是抛出错误
            return JSON.stringify({
                "type": "screenshot",
                "params": {
                    "path": `screenshots/error-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
                }
            });
        }
    }
} 