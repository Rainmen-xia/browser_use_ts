declare module '@anthropic-ai/sdk' {
    export interface Message {
        role: 'user' | 'assistant' | 'system';
        content: string;
    }

    export interface ChatResponse {
        content: Array<{ text: string }>;
    }
} 