import { Page } from 'playwright';
import { logger } from '../utils/logging';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BuildDomTreeOptions, DomTreeResult } from './types';

export interface DomNode {
    tag: string;
    attrs: { [key: string]: string };
    text?: string;
    children: DomNode[];
}

export interface DomElement {
    index: number;
    selector: string;
    tagName: string;
    isInteractive: boolean;
    isVisible: boolean;
    textContent?: string;
    placeholder?: string;
}

export class DomService {
    private page: Page;
    private buildDomTreeFn: string;

    constructor(page: Page) {
        this.page = page;
        try {
            // 读取 buildDomTree.js 文件内容
            const scriptPath = join(__dirname, 'buildDomTree.js');
            this.buildDomTreeFn = readFileSync(scriptPath, 'utf-8');
            logger.info(`Successfully loaded buildDomTree.js from ${scriptPath}`);
        } catch (error) {
            logger.error('Failed to load buildDomTree.js:', error);
            throw error;
        }
    }

    async getDomTree(selector: string = 'body'): Promise<DomTreeResult | null> {
        try {
            // 注入并执行 buildDomTree 函数
            const result = await this.page.evaluate<DomTreeResult>(
                // 先注入函数定义
                this.buildDomTreeFn + 
                // 然后立即执行函数
                `
                (() => {
                    const result = buildDomTree({
                        doHighlightElements: false,
                        focusHighlightIndex: -1,
                        viewportExpansion: 0
                    });
                    return result;
                })()
                `
            );

            if (!result || !result.map) {
                logger.warn('DOM tree result is empty or invalid');
                return {
                    rootId: '0',
                    map: {}
                };
            }

            // 打印找到的元素数量和一些示例
            const interactiveElements = Object.values(result.map)
                .filter((node: any) => node.isInteractive && node.isVisible);
            logger.info(`Found ${interactiveElements.length} interactive elements`);
            
            if (interactiveElements.length > 0) {
                logger.info('Sample elements:', 
                    interactiveElements.slice(0, 3).map((node: any) => ({
                        index: node.index,
                        tagName: node.tagName,
                        text: node.textContent || node.placeholder,
                        selector: node.xpath || node.attributes?.['data-selector'] || node.attributes?.['id'],
                        attributes: node.attributes
                    }))
                );
            } else {
                logger.warn('No interactive elements found on the page');
                // 打印页面内容以便调试
                const pageContent = await this.page.content();
                logger.debug('Page content:', pageContent.substring(0, 1000));
            }

            return result;
        } catch (error) {
            logger.error('Error getting DOM tree:', error);
            if (error instanceof Error) {
                logger.error('Error details:', {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                });
            }
            return {
                rootId: '0',
                map: {}
            };
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

    async getInteractiveElements(): Promise<DomElement[]> {
        const domTree = await this.getDomTree();
        if (!domTree || !domTree.map) {
            return [];
        }

        return Object.values(domTree.map)
            .filter((node: any) => node.isInteractive && node.isVisible)
            .map((node: any) => ({
                index: node.index,
                selector: node.selector,
                tagName: node.tagName,
                isInteractive: node.isInteractive,
                isVisible: node.isVisible,
                textContent: node.textContent,
                placeholder: node.placeholder
            }));
    }
} 