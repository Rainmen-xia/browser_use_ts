import { Page } from 'playwright';
import { logger } from '../utils/logging';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface DomNode {
    tag: string;
    attrs: { [key: string]: string };
    text?: string;
    children: DomNode[];
}

export class DomService {
    private page: Page;
    private buildDomTreeFn: string;

    constructor(page: Page) {
        this.page = page;
        // 读取 buildDomTree.js 文件内容
        this.buildDomTreeFn = readFileSync(
            join(__dirname, 'buildDomTree.js'),
            'utf-8'
        );
    }

    async getDomTree(selector: string = 'body'): Promise<any> {
        try {
            // 直接在 evaluate 中定义函数
            const result = await this.page.evaluate(`
                const buildDomTreeFn = ${this.buildDomTreeFn};
                buildDomTreeFn({
                    doHighlightElements: false,
                    focusHighlightIndex: -1,
                    viewportExpansion: 0
                });
            `);

            return result;
        } catch (error) {
            logger.error('Error getting DOM tree:', error);
            // 打印更详细的错误信息
            if (error instanceof Error) {
                logger.error('Error details:', {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                });
            }
            return null;
        }
    }

    async getTextContent(selector: string): Promise<string | null> {
        try {
            const element = await this.page.$(selector);
            if (!element) {
                logger.warn(`Element not found: ${selector}`);
                return null;
            }

            return await element.textContent();
        } catch (error) {
            logger.error('Error getting text content:', error);
            return null;
        }
    }

    async querySelector(selector: string): Promise<string | null> {
        try {
            const element = await this.page.$(selector);
            if (!element) {
                return null;
            }
            return selector;
        } catch (error) {
            logger.error('Failed to query selector', { selector, error });
            throw error;
        }
    }

    async querySelectorAll(selector: string): Promise<string[]> {
        try {
            const elements = await this.page.$$(selector);
            return elements.length > 0 ? [selector] : [];
        } catch (error) {
            logger.error('Failed to query selector all', { selector, error });
            throw error;
        }
    }

    async getInnerText(selector: string): Promise<string | null> {
        try {
            const text = await this.page.$eval(selector, (el) => el.textContent);
            return text?.trim() || null;
        } catch (error) {
            logger.error('Failed to get inner text', { selector, error });
            return null;
        }
    }

    async getInnerHTML(selector: string): Promise<string | null> {
        try {
            const html = await this.page.$eval(selector, (el) => el.innerHTML);
            return html || null;
        } catch (error) {
            logger.error('Failed to get inner HTML', { selector, error });
            return null;
        }
    }

    async getAttribute(selector: string, attributeName: string): Promise<string | null> {
        try {
            const value = await this.page.$eval(
                selector,
                (el, attr) => el.getAttribute(attr),
                attributeName
            );
            return value;
        } catch (error) {
            logger.error('Failed to get attribute', { selector, attributeName, error });
            return null;
        }
    }
} 