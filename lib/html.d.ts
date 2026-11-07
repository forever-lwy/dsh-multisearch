export interface HtmlDocument {
    title?: string;
    markdown: string;
    links: {
        url: string;
        text: string;
    }[];
    publishedAt?: string;
}
export declare function htmlToMarkdown(html: string, baseUrl: string): HtmlDocument;
/** Organic results of DuckDuckGo's HTML endpoint (links are `/l/?uddg=<target>` redirects). */
export declare function parseDuckDuckGo(html: string): {
    url: string;
    title?: string;
    snippet?: string;
}[];
/** Markdown links, for crawling over services that return markdown only. */
export declare function markdownLinks(markdown: string, baseUrl: string): {
    url: string;
    text: string;
}[];
