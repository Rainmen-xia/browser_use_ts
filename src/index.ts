import { setupLogging } from './utils/logging';

// 初始化日志
setupLogging();

// 导出所有需要的类型和类
export { SystemPrompt } from './agent/prompts';
export { Agent } from './agent/service';
export { ActionModel, ActionResult, AgentHistoryList } from './agent/views';
export { Browser } from './browser/browser';
export { BrowserConfig, BrowserContextConfig } from './browser/types';
export { Controller } from './controller/service';
export { DomService } from './dom/service'; 