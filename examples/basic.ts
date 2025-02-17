import { Browser, BrowserConfig, Agent, SystemPrompt } from '../src';
import { Controller } from '../src/controller/service';
import { config } from 'dotenv';
import { Claude } from '../src/llm/claude';

config();  // 加载环境变量

async function main() {
    // 创建浏览器配置
    const config: BrowserConfig = {
        headless: false,  // 设置为 false 以便我们能看到浏览器操作
    };

    // 初始化浏览器
    const browser = new Browser(config);
    
    // 创建系统提示和代理
    const systemPrompt = new SystemPrompt("Navigate and interact with web pages");
    const claude = new Claude();
    const agent = new Agent(systemPrompt.toString(), claude, browser, systemPrompt);
    
    // 初始化控制器
    const controller = new Controller(browser);
    await controller.init(systemPrompt);

    try {
        // 执行一系列动作
        await controller.executeAction({
            type: 'goto',
            params: {
                url: 'https://www.baidu.com'
            }
        });

        // 等待一下以便我们能看到结果
        await new Promise(r => setTimeout(r, 1000));

        // 在搜索框中输入文字
        await controller.executeAction({
            type: 'type',
            params: {
                selector: '#kw',
                text: 'Playwright'
            }
        });

        // 点击搜索按钮
        await controller.executeAction({
            type: 'click',
            params: {
                selector: '#su'
            }
        });

        // 等待一下以便看到搜索结果
        await new Promise(r => setTimeout(r, 2000));

        // 截图
        await controller.executeAction({
            type: 'screenshot',
            params: {
                path: './search-result.png'
            }
        });

        // 创建并运行代理
        const task = 'Find the founders of browser-use and draft them a short personalized message';
        await agent.run();

    } catch (error) {
        console.error('Error:', error);
    } finally {
        // 关闭浏览器
        await controller.close();
    }
}

main().catch(console.error); 