import { Browser } from '../browser/browser';
import { BrowserContext } from '../browser/context';
import { SystemPrompt } from './prompts';
import { ActionModel, ActionResult, AgentHistoryList, ActionType, GotoParams, ClickParams, TypeParams, ScreenshotParams, WaitForSelectorParams } from './views';
import { logger } from '../utils/logging';
import { DomService } from '../dom/service';
import { Claude, ClaudeMessage } from '../llm/claude';
import { existsSync, mkdirSync } from 'fs';
import { DomTreeResult } from '../dom/types';

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
                
                // 获取历史总结
                const historySummary = await this.summarizeHistory();
                
                // 将页面状态和历史总结添加到对话
                messages.push({
                    role: 'assistant',
                    content: `Current page state:
- URL: ${pageState.url}
- Title: ${pageState.title}
- Interactive elements: ${pageState.interactiveElements}
- Clickable elements:
${pageState.clickableElements}
- Visible text: ${pageState.visibleText?.substring(0, 200)}...
- Action history: ${historySummary}

Based on this state:
1. Analyze the current page content and available interactions
2. Compare with the task goal: "${this.task}"
3. Determine if all required steps for the task are complete
4. If not complete, decide the most appropriate next action using the available elements
5. If complete, return {"type": "complete"}

Remember:
- Use the correct element index from the clickable elements list
- Wait for any dynamic content to load after interactions
- Only mark as complete when ALL required steps are done
- Consider the full task requirements before completion`
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
            const elements = Object.values(domTree.map)
                .filter((node: any) => node.isInteractive && node.isVisible)
                .map((node: any) => {
                    // 构建更详细的元素描述
                    const text = node.textContent || node.placeholder || '';
                    const attrs = Object.entries(node.attributes || {})
                        .filter(([key]) => ['type', 'role', 'aria-label', 'placeholder', 'name', 'id', 'class'].includes(key))
                        .map(([key, value]) => `${key}="${value}"`)
                        .join(' ');
                    
                    // 包含更多上下文信息
                    const context = node.xpath?.split('/')?.slice(-2).join('/') || '';
                    return `[${node.index}]<${node.tagName} ${attrs}>${text}</${node.tagName}> (${context})`;
                });
            
            if (elements.length > 0) {
                clickableElements = 'Interactive elements on page:\n' + elements.join('\n');
                logger.info('Found clickable elements:', elements.length);
                logger.debug('Sample elements:', elements.slice(0, 3));
            } else {
                clickableElements = 'No interactive elements found on the page';
                logger.warn(clickableElements);
                
                // 如果没有找到交互元素，打印页面内容以便调试
                const pageContent = await page.content();
                logger.debug('Page content:', pageContent.substring(0, 1000));
            }
        }

        // 获取页面状态
        const state = {
            url: page.url(),
            title: await page.title(),
            interactiveElements: domTree ? Object.values(domTree.map)
                .filter((node: any) => node.isInteractive && node.isVisible).length : 0,
            visibleText: await page.evaluate(() => {
                return Array.from(document.querySelectorAll('*'))
                    .map(el => el.textContent)
                    .filter(text => text && text.trim())
                    .join('\n')
                    .substring(0, 500); // 限制文本长度
            }),
            clickableElements
        };

        logger.info('Current page state:', state);
        return state;
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
                    // 尝试合并状态和动作
                    let currentState;
                    let action;

                    for (const match of matches) {
                        try {
                            const obj = JSON.parse(match);
                            if (obj.page_summary) {
                                currentState = obj;
                            } else if (obj.type && obj.params) {
                                action = obj;
                            }
                        } catch (err) {
                            logger.debug('Failed to parse match:', match);
                        }
                    }

                    if (currentState && action) {
                        parsed = {
                            current_state: currentState,
                            action: action
                        };
                        logger.info('Successfully combined state and action:', parsed);
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

                // 检查任务是否真的完成
                if (parsed.action?.type === 'complete') {
                    // 检查 memory 中是否包含未完成的步骤
                    const memory = parsed.current_state.memory?.toLowerCase() || '';
                    const nextGoal = parsed.current_state.next_goal?.toLowerCase() || '';
                    const task = this.task.toLowerCase();
                    
                    // 检查是否需要搜索
                    if (task.includes('search') || task.includes('查询') || task.includes('预订') || task.includes('book')) {
                        const hasSearched = this.history.some(item => 
                            (item.action.type === 'click' && 
                             (item.action.params as ClickParams).selector.includes('search-btn')) ||
                            memory.includes('searched') || 
                            memory.includes('found results')
                        );
                        
                        if (!hasSearched) {
                            logger.warn('Search not performed yet, ignoring complete action');
                            return [];
                        }
                    }
                    
                    // 检查其他未完成的步骤
                    if (memory.includes('need to') || 
                        memory.includes('waiting for') || 
                        memory.includes('not yet') ||
                        nextGoal.includes('need to') ||
                        nextGoal.includes('waiting for') ||
                        nextGoal.includes('enter') ||
                        nextGoal.includes('select') ||
                        nextGoal.includes('search') ||
                        nextGoal.includes('click')) {
                        logger.warn('Task not actually complete, ignoring complete action');
                        return [];
                    }
                }
            }

            // 返回动作
            if (parsed.action) {
                // 如果是截图动作，确保有路径
                if (parsed.action.type === 'screenshot' && !parsed.action.params.path) {
                    parsed.action.params.path = `screenshots/task-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
                }
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
        let result: ActionResult;

        try {
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
                            const elements = await this.domService?.getInteractiveElements() || [];
                            const element = elements.find(e => e.index === clickParams.index);
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
                    try {
                        // 等待元素出现
                        const element = await page.waitForSelector(typeParams.selector, { timeout: 5000 });
                        if (!element) {
                            throw new Error(`Element not found: ${typeParams.selector}`);
                        }

                        // 先清空输入框
                        await element.fill('');
                        
                        // 等待一下以确保清空完成
                        await page.waitForTimeout(100);

                        // 输入新文本
                        await element.type(typeParams.text, { delay: 50 });
                        
                        // 等待一下以确保输入完成
                        await page.waitForTimeout(500);

                        result = { success: true };
                    } catch (error) {
                        logger.error(`Failed to type into ${typeParams.selector}:`, error);
                        throw error;
                    }
                    break;

                case 'screenshot':
                    const screenshotParams = action.params as ScreenshotParams;
                    let path = screenshotParams.path || `screenshots/task-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
                    
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

                    try {
                        // 等待页面加载完成
                        await page.waitForLoadState('networkidle');
                        await page.waitForTimeout(1000);

                        // 确保页面稳定
                        await page.evaluate(() => {
                            return new Promise((resolve) => {
                                if (document.readyState === 'complete') {
                                    resolve(true);
                                } else {
                                    window.addEventListener('load', () => resolve(true));
                                }
                            });
                        });

                        // 截图前记录
                        logger.info(`Taking screenshot: ${path}`);
                        const buffer = await page.screenshot({ 
                            path,
                            fullPage: true  // 捕获整个页面
                        });
                        logger.info(`Screenshot saved to: ${path}`);
                        
                        // 验证文件是否创建
                        if (existsSync(path)) {
                            logger.info(`Screenshot file exists at: ${path}`);
                        } else {
                            logger.error(`Failed to create screenshot at: ${path}`);
                        }

                        result = { success: true, data: buffer };
                    } catch (error) {
                        logger.error(`Screenshot error:`, error);
                        throw error;
                    }
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

    private async getDomTree(): Promise<DomTreeResult | null> {
        if (this.domService) {
            return await this.domService.getDomTree();
        }
        return null;
    }

    private countInteractiveElements(domTree: DomTreeResult | null): number {
        if (!domTree || !domTree.map) {
            return 0;
        }
        return Object.values(domTree.map)
            .filter(node => node.isInteractive && node.isVisible)
            .length;
    }

    private async summarizeHistory(): Promise<string> {
        if (this.history.length === 0) {
            return 'Just starting';
        }

        const summaries = this.history.map(item => {
            const action = item.action;
            switch (action.type) {
                case 'goto':
                    return `Navigated to ${(action.params as GotoParams).url}`;
                case 'type':
                    return `Typed "${(action.params as TypeParams).text}" into ${(action.params as TypeParams).selector}`;
                case 'click':
                    const selector = (action.params as ClickParams).selector;
                    if (selector.includes('search-btn')) {
                        return 'Clicked search button';
                    }
                    return `Clicked ${selector}`;
                case 'waitForSelector':
                    return `Waited for ${(action.params as WaitForSelectorParams).selector}`;
                case 'screenshot':
                    return 'Took screenshot';
                default:
                    return `Performed ${action.type} action`;
            }
        });

        return summaries.join(' -> ');
    }
}