interface Window {
    buildDomTree: (args?: {
        doHighlightElements?: boolean;
        focusHighlightIndex?: number;
        viewportExpansion?: number;
    }) => {
        rootId: string;
        map: {
            [key: string]: any;
        };
    };
} 