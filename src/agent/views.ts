export type ActionType = 
    | 'goto'
    | 'click'
    | 'type'
    | 'screenshot'
    | 'waitForSelector'
    | 'complete';

export interface BaseParams {
    selector?: string;
}

export interface GotoParams extends BaseParams {
    url: string;
}

export interface ClickParams extends BaseParams {
    selector: string;
}

export interface TypeParams extends BaseParams {
    selector: string;
    text: string;
}

export interface ScreenshotParams extends BaseParams {
    path?: string;
}

export interface WaitForSelectorParams extends BaseParams {
    selector: string;
    timeout?: number;
}

export interface CompleteParams extends BaseParams {
    // complete 动作不需要额外参数
}

export interface ActionModel {
    type: ActionType;
    params: GotoParams | ClickParams | TypeParams | ScreenshotParams | WaitForSelectorParams | CompleteParams;
}

export interface ActionResult {
    success: boolean;
    data?: any;
    error?: string;
}

export type AgentHistoryList = Array<{
    action: ActionModel;
    result: ActionResult;
    timestamp: Date;
}>; 