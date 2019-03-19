
export class IpcNetworkError extends Error {

    public constructor(errorName: string, errorMessage?: string) {
        super(errorMessage);
        this.name = errorName;
    }
}
