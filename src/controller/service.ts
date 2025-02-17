import { Browser } from '../browser/browser';
import { Agent } from '../agent/service';
import { SystemPrompt } from '../agent/prompts';
import { ActionModel, ActionResult } from '../agent/views';
import { logger } from '../utils/logging';
import { Claude } from '../llm/claude';

export class Controller {
    private browser: Browser;
    private agent: Agent | null = null;

    constructor(browser: Browser) {
        this.browser = browser;
    }

    async init(systemPrompt?: SystemPrompt): Promise<void> {
        if (!this.agent) {
            await this.browser.launch();
            const claude = new Claude();
            const task = 'Navigate and interact with web pages';
            this.agent = new Agent(task, claude, this.browser, systemPrompt);
            await this.agent.init();
            logger.info('Controller initialized');
        }
    }

    async executeAction(action: ActionModel): Promise<ActionResult> {
        if (!this.agent) {
            throw new Error('Controller not initialized. Call init() first.');
        }

        try {
            const result = await this.agent.executeAction(action);
            logger.info('Action executed successfully', { action });
            return result;
        } catch (error) {
            logger.error('Failed to execute action', { action, error });
            throw error;
        }
    }

    async close(): Promise<void> {
        try {
            if (this.agent) {
                await this.agent.close();
                this.agent = null;
            }
            await this.browser.close();
            logger.info('Controller closed');
        } catch (error) {
            logger.error('Failed to close controller', { error });
            throw error;
        }
    }

    getAgent(): Agent {
        if (!this.agent) {
            throw new Error('Controller not initialized. Call init() first.');
        }
        return this.agent;
    }
} 