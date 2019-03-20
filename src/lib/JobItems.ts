export interface JobItems {
    [key: string]: {
        resolve: (value?: any) => void,
        reject: (value?: any) => void,
        timeoutTimer?: NodeJS.Timeout,
    };
}
