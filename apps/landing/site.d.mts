export declare const siteOrigin: string;
export declare const repositoryUrl: string;
export declare const locales: readonly string[];
export declare const baseLocale: string;
export declare const pagePaths: readonly string[];
export declare function localizedPath(locale: string, path: string): string;
export declare const prerenderPaths: readonly string[];
export declare function pageUrl(path: string, locale: string): string;
export declare function xDefaultUrl(path: string): string;
