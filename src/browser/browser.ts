import { Browser as PlaywrightBrowser, BrowserContext as PlaywrightBrowserContext, Page, chromium } from 'playwright';
import { BrowserConfig, BrowserContextConfig, ProxySettings, DEFAULT_VIEWPORT } from './types';
import { logger } from '../utils/logging';
import * as http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BrowserContext } from './context';

const execAsync = promisify(exec);

// 常量定义
const CHROME_DEBUG_PORT = 9222;
const CHROME_DEBUG_URL = `http://localhost:${CHROME_DEBUG_PORT}`;
const CHROME_CONNECT_TIMEOUT = 20000;
const CHROME_START_RETRIES = 10;
const CHROME_START_RETRY_INTERVAL = 1000;
const CDP_CONNECT_TIMEOUT = 20000;
const WSS_CONNECT_TIMEOUT = 20000;
const BROWSER_LAUNCH_TIMEOUT = 30000;  // 添加浏览器启动超时时间

export class Browser {
    private playwrightBrowser: PlaywrightBrowser | null = null;
    private disableSecurityArgs: string[] = [];
    private config: BrowserConfig;

    constructor(config: BrowserConfig = {}) {
        this.config = {
            headless: false,
            disableSecurity: true,
            extraChromiumArgs: [],
            chromeInstancePath: null,
            wssUrl: null,
            cdpUrl: null,
            proxy: null,
            newContextConfig: {
                viewport: DEFAULT_VIEWPORT,  // 使用默认视口
            },
            forceKeepBrowserAlive: false,
            slowMo: undefined,
            ...config
        };

        if (this.config.disableSecurity) {
            this.disableSecurityArgs = [
                '--disable-web-security',
                '--disable-site-isolation-trials',
                '--disable-features=IsolateOrigins,site-per-process',
            ];
        }
    }

    async launch(): Promise<void> {
        if (this.playwrightBrowser) {
            return;
        }

        try {
            await this._init();
            logger.info('Browser launched successfully');
        } catch (error) {
            logger.error('Failed to launch browser', { error });
            throw error;
        }
    }

    async newContext(config: BrowserContextConfig = {}): Promise<BrowserContext> {
        const context = new BrowserContext(config, this);
        await context.init();
        return context;
    }

    async close(): Promise<void> {
        try {
            if (!this.config.forceKeepBrowserAlive) {
                if (this.playwrightBrowser) {
                    await this.playwrightBrowser.close();
                    this.playwrightBrowser = null;
                }
            }
        } catch (error) {
            logger.debug('Failed to close browser properly:', error);
        } finally {
            this.playwrightBrowser = null;
        }
    }

    async getPlaywrightBrowser(): Promise<PlaywrightBrowser> {
        if (!this.playwrightBrowser) {
            return await this._init();
        }
        return this.playwrightBrowser;
    }

    private async _init(): Promise<PlaywrightBrowser> {
        try {
            // 在 TypeScript 中，我们不需要 async_playwright().start()
            // 直接使用 chromium 即可
            const browser = await this._setupBrowser();
            this.playwrightBrowser = browser;
            return this.playwrightBrowser;
        } catch (error) {
            logger.error('Failed to initialize browser:', error);
            throw error;
        }
    }

    private async _setupBrowser(): Promise<PlaywrightBrowser> {
        try {
            if (this.config.cdpUrl) {
                return await this._setupCdp();
            }
            if (this.config.wssUrl) {
                return await this._setupWss();
            }
            if (this.config.chromeInstancePath) {
                return await this._setupBrowserWithInstance();
            }
            return await this._setupStandardBrowser();
        } catch (error) {
            logger.error('Failed to initialize Playwright browser:', error);
            throw error;
        }
    }

    private async _setupStandardBrowser(): Promise<PlaywrightBrowser> {
        const defaultArgs = [
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--disable-background-timer-throttling',
            '--disable-popup-blocking',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-window-activation',
            '--disable-focus-on-load',
            '--no-first-run',
            '--no-default-browser-check',
            '--no-startup-window',
            '--window-position=0,0',
            '--start-maximized',
            '--disable-notifications',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ];

        return await chromium.launch({
            headless: this.config.headless,
            slowMo: this.config.slowMo,
            args: [
                ...defaultArgs,
                ...this.disableSecurityArgs,
                ...(this.config.extraChromiumArgs || [])
            ],
            proxy: this.config.proxy || undefined,
            timeout: BROWSER_LAUNCH_TIMEOUT,
            ignoreDefaultArgs: false,
            handleSIGINT: true,
            handleSIGTERM: true,
            handleSIGHUP: true,
        });
    }

    private async _setupCdp(): Promise<PlaywrightBrowser> {
        if (!this.config.cdpUrl) {
            throw new Error('CDP URL is required');
        }
        logger.info(`Connecting to remote browser via CDP ${this.config.cdpUrl}`);
        return await chromium.connectOverCDP({
            endpointURL: this.config.cdpUrl,
            timeout: CDP_CONNECT_TIMEOUT
        });
    }

    private async _setupWss(): Promise<PlaywrightBrowser> {
        if (!this.config.wssUrl) {
            throw new Error('WSS URL is required');
        }
        logger.info(`Connecting to remote browser via WSS ${this.config.wssUrl}`);
        return await chromium.connect({
            wsEndpoint: this.config.wssUrl,
            timeout: WSS_CONNECT_TIMEOUT
        });
    }

    private async _setupBrowserWithInstance(): Promise<PlaywrightBrowser> {
        if (!this.config.chromeInstancePath) {
            throw new Error('Chrome instance path is required');
        }

        const checkDebuggerEndpoint = (): Promise<boolean> => {
            return new Promise((resolve) => {
                http.get(`${CHROME_DEBUG_URL}/json/version`, (res: http.IncomingMessage) => {
                    resolve(res.statusCode === 200);
                }).on('error', () => {
                    resolve(false);
                });
            });
        };

        const isRunning = await checkDebuggerEndpoint();
        if (isRunning) {
            logger.info('Reusing existing Chrome instance');
            return await chromium.connectOverCDP({
                endpointURL: CHROME_DEBUG_URL,
                timeout: CHROME_CONNECT_TIMEOUT
            });
        }

        logger.debug('No existing Chrome instance found, starting a new one');
        const args = [
            `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
            ...(this.config.extraChromiumArgs || [])
        ];

        try {
            await execAsync(`"${this.config.chromeInstancePath}" ${args.join(' ')}`);
        } catch (error) {
            logger.error('Failed to start Chrome instance:', error);
            throw error;
        }

        for (let i = 0; i < CHROME_START_RETRIES; i++) {
            const isReady = await checkDebuggerEndpoint();
            if (isReady) {
                return await chromium.connectOverCDP({
                    endpointURL: CHROME_DEBUG_URL,
                    timeout: CHROME_CONNECT_TIMEOUT
                });
            }
            await new Promise(resolve => setTimeout(resolve, CHROME_START_RETRY_INTERVAL));
        }

        throw new Error(
            'To start chrome in Debug mode, you need to close all existing Chrome instances and try again otherwise we can not connect to the instance.'
        );
    }
} 