// 共享常量
export const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

export interface ProxySettings {
    server: string;
    bypass?: string;
    username?: string;
    password?: string;
}

export interface BrowserConfig {
    headless?: boolean;
    disableSecurity?: boolean;
    extraChromiumArgs?: string[];
    chromeInstancePath?: string | null;
    wssUrl?: string | null;
    cdpUrl?: string | null;
    proxy?: ProxySettings | null;
    newContextConfig?: BrowserContextConfig;
    forceKeepBrowserAlive?: boolean;
    slowMo?: number;
}

export interface BrowserContextConfig {
    viewport?: {
        width: number;
        height: number;
    };
    userAgent?: string;
    locale?: string;
    geolocation?: {
        latitude: number;
        longitude: number;
        accuracy?: number;
    };
    permissions?: string[];
    extraHTTPHeaders?: Record<string, string>;
    offline?: boolean;
    httpCredentials?: {
        username: string;
        password: string;
    };
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
    colorScheme?: 'light' | 'dark' | 'no-preference';
    reducedMotion?: 'reduce' | 'no-preference';
    forcedColors?: 'active' | 'none';
} 