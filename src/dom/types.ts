interface BuildDomTreeOptions {
    doHighlightElements?: boolean;
    focusHighlightIndex?: number;
    viewportExpansion?: number;
}

interface DomTreeResult {
    rootId: string;
    map: {
        [key: string]: {
            tagName?: string;
            attributes: { [key: string]: string };
            xpath?: string;
            children: string[];
            isInteractive?: boolean;
            isVisible?: boolean;
            isTopElement?: boolean;
            highlightIndex?: number;
            type?: string;
            text?: string;
        };
    };
}

declare global {
    interface Window {
        buildDomTree: (options: BuildDomTreeOptions) => DomTreeResult;
    }
}

export { BuildDomTreeOptions, DomTreeResult }; 