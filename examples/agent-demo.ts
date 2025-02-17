import { config } from 'dotenv';
import { Agent } from '../src';
import { Claude } from '../src/llm/claude';

config();  // 加载环境变量

async function main() {
    const claude = new Claude();

    // const task = '通过百度搜索深圳的天气，截图保存';
    const task = '获取深圳今天的天气，并截图保存';
    // const task = '北京飞深圳的机票价格，截图保存';
    const agent = new Agent(task, claude);
    await agent.run();
}

main().catch(console.error); 