import { Browser } from '../browser/browser';
import { BrowserContext } from '../browser/context';
import { SystemPrompt } from './prompts';
import { ActionModel, ActionResult, AgentHistoryList, ActionType, GotoParams, ClickParams, TypeParams, ScreenshotParams, WaitForSelectorParams } from './views';
import { logger } from '../utils/logging';
import { DomService } from '../dom/service';
import { Claude, ClaudeMessage } from '../llm/claude';
import { existsSync, mkdirSync } from 'fs';

interface AgentResponse {
    current_state: {
        page_summary: string;
        evaluation_previous_goal: string;
        memory: string;
        next_goal: string;
    };
    action: ActionModel;
}

export class Agent {
    private browser: Browser;
    private context: BrowserContext | null = null;
    private history: AgentHistoryList = [];
    private systemPrompt: SystemPrompt;
    private domService: DomService | null = null;
    private llm: Claude;
    private task: string;

    constructor(
        task: string,
        llm: Claude,
        browser?: Browser,
        systemPrompt: SystemPrompt = new SystemPrompt()
    ) {
        this.task = task;
        this.llm = llm;
        this.browser = browser || new Browser();
        this.systemPrompt = systemPrompt;
    }

    async run(): Promise<void> {
        try {
            await this.init();
            const page = await this.context!.getPage();
            this.domService = new DomService(page);

            // 初始化对话历史
            const messages: ClaudeMessage[] = [{
                role: 'system',
                content: this.systemPrompt.toString()
            }, {
                role: 'user',
                content: `Task: ${this.task}\n\nI'm starting with a blank page. What should be the first action?`
            }];

            while (true) {
                // 获取当前页面状态
                const pageState = await this.getPageState();
                
                // 将页面状态添加到对话
                messages.push({
                    role: 'assistant',
                    content: `Current page state:
- URL: ${pageState.url}
- Title: ${pageState.title}
- Interactive elements: ${pageState.interactiveElements}
- Clickable elements:
${pageState.clickableElements}
- Visible text: ${pageState.visibleText?.substring(0, 200)}...

Based on this state, analyze the current situation and suggest the next action.
Remember to use the correct element index from the clickable elements list.`
                });

                // 获取 LLM 的响应
                const response = await this.llm.chat(messages);
                logger.info('Claude response:', response);

                // 解析动作
                const actions = this.parseResponse(response);
                if (actions.length === 0) {
                    logger.info('No more actions to execute');
                    break;
                }

                // 执行动作
                const action = actions[0];
                if (action.type === 'complete') {
                    logger.info('Task completed successfully');
                    // 保存最终截图
                    await this.executeAction({
                        type: 'screenshot',
                        params: {
                            path: `screenshots/task-complete-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
                        }
                    });
                    break;
                }

                logger.info('Executing action:', action);
                try {
                    await this.executeAction(action);
                    logger.info(`Action completed: ${action.type}`);
                    
                    // 等待页面稳定
                    await page.waitForLoadState('networkidle');
                    await page.waitForTimeout(1000);

                } catch (error) {
                    logger.error(`Error executing action ${action.type}:`, error);
                    break;
                }

                // 将执行的动作添加到对话
                messages.push({
                    role: 'user',
                    content: `Action executed: ${JSON.stringify(action)}\nWhat should I do next?`
                });
            }

        } catch (error) {
            logger.error('Error in agent run:', error);
            throw error;
        } finally {
            await this.close();
        }
    }

    private async getPageState(): Promise<{
        url: string;
        title: string;
        interactiveElements: number;
        visibleText: string;
        clickableElements: string;
    }> {
        const page = await this.context!.getPage();
        const domTree = await this.getDomTree();

        // 获取可点击元素的描述
        let clickableElements = '';
        if (domTree && domTree.map) {
            clickableElements = Object.values(domTree.map)
                .filter((node: any) => node.isInteractive && node.isVisible)
                .map((node: any) => {
                    return `[${node.index}]<${node.tagName}>${node.textContent || node.placeholder || ''}</${node.tagName}>`;
                })
                .join('\n');
        }

        return {
            url: page.url(),
            title: await page.title(),
            interactiveElements: this.countInteractiveElements(domTree),
            visibleText: await page.evaluate(() => {
                return Array.from(document.querySelectorAll('*'))
                    .map(el => el.textContent)
                    .filter(text => text && text.trim())
                    .join('\n');
            }),
            clickableElements
        };
    }

    private parseResponse(content: string): ActionModel[] {
        try {
            // 打印要解析的内容
            logger.info('Parsing response content:', content);

            // 尝试直接解析 JSON
            let parsed;
            try {
                parsed = JSON.parse(content);
                logger.info('Successfully parsed JSON:', parsed);
            } catch (e) {
                logger.info('Failed to parse directly, trying to extract JSON');
                // 尝试从文本中提取 JSON
                const jsonRegex = /\{(?:[^{}]|(?:\{[^{}]*\}))*\}/g;
                const matches = content.match(jsonRegex);
                
                if (matches) {
                    logger.info('Found JSON matches:', matches);
                    // 尝试解析每个匹配项
                    for (const match of matches) {
                        try {
                            parsed = JSON.parse(match);
                            if (parsed.current_state && parsed.action) {
                                logger.info('Successfully parsed JSON from match:', parsed);
                                break;
                            }
                        } catch (err) {
                            logger.debug('Failed to parse match:', match);
                        }
                    }
                }
            }

            if (!parsed) {
                logger.warn('No valid JSON found in text');
                return [];
            }

            // 记录状态信息
            if (parsed.current_state) {
                logger.info('Current state:', {
                    summary: parsed.current_state.page_summary,
                    evaluation: parsed.current_state.evaluation_previous_goal,
                    memory: parsed.current_state.memory,
                    next_goal: parsed.current_state.next_goal
                });
            }

            // 返回动作
            if (parsed.action) {
                return [parsed.action];
            }

            logger.warn('No valid action found in response');
            return [];
        } catch (error) {
            logger.error('Failed to parse LLM response:', error);
            logger.error('Raw response content:', content);
            return [];
        }
    }

    async init(): Promise<void> {
        if (!this.context) {
            this.context = await this.browser.newContext();
            logger.info('Agent initialized with new browser context');
        }
    }

    async close(): Promise<void> {
        if (this.context) {
            await this.context.close();
            this.context = null;
            logger.info('Agent closed');
        }
    }

    getHistory(): AgentHistoryList {
        return this.history;
    }

    async executeAction(action: ActionModel): Promise<ActionResult> {
        if (!this.context) {
            await this.init();
        }

        const page = await this.context!.getPage();
        const startTime = new Date();

        try {
            let result: ActionResult;
            switch (action.type) {
                case 'goto':
                    await page.goto((action.params as GotoParams).url);
                    await page.waitForLoadState('networkidle');
                    result = { success: true };
                    break;

                case 'waitForSelector':
                    try {
                        await page.waitForSelector((action.params as WaitForSelectorParams).selector, {
                            timeout: 5000  // 减少等待时间到5秒
                        });
                    } catch (error) {
                        // 如果等待特定元素失败，尝试等待任何搜索结果
                        logger.warn(`Failed to find ${(action.params as WaitForSelectorParams).selector}, waiting for general search results`);
                        await page.waitForSelector('.c-container', { timeout: 10000 });
                    }
                    result = { success: true };
                    break;

                case 'click':
                    try {
                        const clickParams = action.params as ClickParams;
                        // 如果是索引，使用索引点击
                        if (clickParams.index !== undefined) {
                            const elements = await this.domService?.getInteractiveElements();
                            const element = elements?.find(e => e.index === clickParams.index);
                            if (element) {
                                await page.click(element.selector);
                                result = { success: true };
                                break;
                            }
                            throw new Error(`Element with index ${clickParams.index} not found`);
                        }
                        // 否则使用选择器点击
                        await page.waitForSelector(clickParams.selector, {
                            timeout: 5000
                        });
                        await page.waitForTimeout(500);
                        await page.click(clickParams.selector);
                        result = { success: true };
                    } catch (error) {
                        logger.error(`Failed to click ${(action.params as ClickParams).selector}:`, error);
                        // 如果失败，可能是页面还没加载完，等待一下再试
                        await page.waitForLoadState('networkidle');
                        await page.waitForTimeout(1000);
                        // 重试一次
                        await page.click((action.params as ClickParams).selector);
                        result = { success: true };
                    }
                    break;

                case 'type':
                    const typeParams = action.params as TypeParams;
                    await page.type(typeParams.selector, typeParams.text);
                    result = { success: true };
                    break;

                case 'screenshot':
                    const screenshotParams = action.params as ScreenshotParams;
                    // 如果没有指定路径，使用默认路径
                    let path = screenshotParams.path || `task-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
                    
                    // 确保路径以 .png 结尾
                    if (!path.toLowerCase().endsWith('.png')) {
                        path += '.png';
                    }

                    // 如果路径不包含目录分隔符，添加到 screenshots 目录
                    if (!path.includes('/')) {
                        path = `screenshots/${path}`;
                    }

                    // 确保目录存在
                    const dir = path.substring(0, path.lastIndexOf('/'));
                    if (dir && !existsSync(dir)) {
                        mkdirSync(dir, { recursive: true });
                    }

                    const buffer = await page.screenshot({ path });
                    logger.info(`Screenshot saved to: ${path}`);
                    result = { success: true, data: buffer };
                    break;

                default:
                    throw new Error(`Unknown action type: ${action.type}`);
            }

            this.history.push({ action, result, timestamp: startTime });
            return result;

        } catch (error) {
            const errorResult: ActionResult = {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
            this.history.push({ action, result: errorResult, timestamp: startTime });
            throw error;
        }
    }

    async getDomTree(): Promise<any | null> {
        if (this.domService) {
            return await this.domService.getDomTree();
        }
        return null;
    }

    private countInteractiveElements(domTree: any): number {
        let count = 0;
        if (domTree.map) {
            Object.values(domTree.map).forEach((node: any) => {
                if (node.isInteractive && node.isVisible) {
                    count++;
                }
            });
        }
        return count;
    }
} 