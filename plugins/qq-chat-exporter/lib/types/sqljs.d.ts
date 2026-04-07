declare module 'sql.js' {
    const initSqlJs: (config?: {
        locateFile?: (file: string) => string;
    }) => Promise<any>;

    export default initSqlJs;
}
