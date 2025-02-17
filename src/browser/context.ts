import { BrowserContext as PlaywrightBrowserContext, Page } from 'playwright';
import { BrowserContextConfig, DEFAULT_VIEWPORT } from './types';
import { logger } from '../utils/logging';
import type { Browser } from './browser';

export class BrowserContext {
    private context: PlaywrightBrowserContext | null = null;
    private page: Page | null = null;

    constructor(
        private config: BrowserContextConfig = {},
        private browser: Browser
    ) {}

    async init(): Promise<PlaywrightBrowserContext> {
        if (!this.context) {
            const playwrightBrowser = await this.browser.getPlaywrightBrowser();
            this.context = await playwrightBrowser.newContext({
                viewport: this.config.viewport || DEFAULT_VIEWPORT,
                userAgent: this.config.userAgent,
                locale: this.config.locale,
                geolocation: this.config.geolocation,
                permissions: this.config.permissions,
                extraHTTPHeaders: this.config.extraHTTPHeaders,
                offline: this.config.offline,
                httpCredentials: this.config.httpCredentials,
                deviceScaleFactor: this.config.deviceScaleFactor,
                isMobile: this.config.isMobile,
                hasTouch: this.config.hasTouch,
                colorScheme: this.config.colorScheme,
                reducedMotion: this.config.reducedMotion,
                forcedColors: this.config.forcedColors,
            });
            logger.info('Browser context created successfully');
        }
        return this.context;
    }

    async getPage(): Promise<Page> {
        if (!this.context) {
            await this.init();
        }
        if (!this.page) {
            this.page = await this.context!.newPage();
            logger.info('New page created');
        }
        return this.page;
    }

    async close(): Promise<void> {
        try {
            await this.context?.close();
            this.context = null;
            this.page = null;
            logger.info('Browser context closed');
        } catch (error) {
            logger.error('Failed to close browser context', { error });
            throw error;
        }
    }
} 