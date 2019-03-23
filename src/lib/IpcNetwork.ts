import nanoId = require("nanoid/non-secure");
import {EventEmitter} from "events";
import {UnixDgramSocket} from "unix-dgram-socket";
import {IpcNetworkError} from "./IpcNetworkError";
import {JobItems} from "./JobItems";

// TODO: Use Async to queue RPC jobs

export class IpcNetwork extends EventEmitter {

    public static readonly ERROR_RPC_SEND       = 'rpc_send_error';
    public static readonly ERROR_RPC_TIMEOUT    = 'rpc_timeout_error';
    public static readonly ERROR_RPC_EXEC       = 'rpc_exec_error';
    private static readonly TYPE_MESSAGE    = 0x01;
    private static readonly TYPE_RPC_JOB    = 0xA0;
    private static readonly TYPE_RPC_RESULT = 0xA1;
    private static readonly TYPE_RPC_ERROR  = 0xAA;
    private static readonly JOB_ID_LENGTH   = 25;

    protected processName: string;
    protected unixSocketPath: string;
    protected unixSocket: UnixDgramSocket;
    protected jobsItems: JobItems;

    public constructor(processName?: string, private rpcCallback?: (jobName: string, from: string) => Buffer | string) {
        super();
        this.jobsItems = {};
        this.processName = (processName) ? processName : `pid-${process.ppid}-${process.pid}`;
        this.unixSocketPath = IpcNetwork.getSocketPathFromName(this.processName);
        this.unixSocket = new UnixDgramSocket();

        this.unixSocket.on('error', (error: Error) => {
            this.emit('error', error);
        });

        this.unixSocket.on('message', (message: Buffer, info: any) => {
            const remoteSocketName = IpcNetwork.getSocketNameFromPath(info.remoteSocket);
            const messageType = message.readUInt8(0);

            if (messageType === IpcNetwork.TYPE_MESSAGE) {
                this.emit('message', {
                    message: message.slice(1),
                    from: remoteSocketName,
                });
            } else if (messageType === IpcNetwork.TYPE_RPC_JOB) {
                const jobId = message.slice(1, IpcNetwork.JOB_ID_LENGTH + 1).toString(UnixDgramSocket.payloadEncoding);
                const jobName = message.slice(1 + IpcNetwork.JOB_ID_LENGTH).toString(UnixDgramSocket.payloadEncoding);
                const socketPath = IpcNetwork.getSocketPathFromName(remoteSocketName);
                let sendResult: boolean = false;

                try {
                    if (this.rpcCallback) {
                        const jobResult = this.rpcCallback(jobName, remoteSocketName);
                        const messageReply = IpcNetwork.composeMessage(IpcNetwork.TYPE_RPC_RESULT, jobResult, jobId);
                        sendResult = this.unixSocket.send(messageReply, socketPath);
                    } else {
                        const noSupport = 'This process has disabled support for RPC commands.';
                        const messageReply = IpcNetwork.composeMessage(IpcNetwork.TYPE_RPC_ERROR, noSupport, jobId);
                        sendResult = this.unixSocket.send(messageReply, socketPath);
                    }
                } catch (error) {
                    const messageReply = IpcNetwork.composeMessage(IpcNetwork.TYPE_RPC_ERROR, error.message, jobId);
                    sendResult = this.unixSocket.send(messageReply, socketPath);
                }

                if (!sendResult) {
                    this.emit('error', `Unable to send job results to remote process: ${remoteSocketName}`);
                }
            } else if (messageType === IpcNetwork.TYPE_RPC_RESULT || messageType === IpcNetwork.TYPE_RPC_ERROR) {
                const jobId = message.slice(1, IpcNetwork.JOB_ID_LENGTH + 1).toString(UnixDgramSocket.payloadEncoding);
                if (this.jobsItems[jobId]) {
                    if (this.jobsItems[jobId].timeoutTimer) {
                        clearTimeout(<number><unknown>this.jobsItems[jobId].timeoutTimer);
                    }

                    const contentStart = 1 + IpcNetwork.JOB_ID_LENGTH;
                    if (messageType === IpcNetwork.TYPE_RPC_ERROR) {
                        const errorMessage = message.slice(contentStart).toString(UnixDgramSocket.payloadEncoding);
                        this.jobsItems[jobId].reject(new IpcNetworkError(IpcNetwork.ERROR_RPC_EXEC, errorMessage));
                    } else {
                        this.jobsItems[jobId].resolve(message.slice(contentStart));
                    }

                    delete this.jobsItems[jobId];
                }
            } else {
                this.emit('error', new Error(`Received unknown message type from: ${remoteSocketName}`));
            }
        });
    }

    public startListening(): void {
        this.unixSocket.bind(this.unixSocketPath);
    }

    public stopListening(): void {
        this.unixSocket.close();
    }

    public send(data: Buffer | string, socketName: string): boolean {
        const socketPath = IpcNetwork.getSocketPathFromName(socketName);
        return this.unixSocket.send(IpcNetwork.composeMessage(IpcNetwork.TYPE_MESSAGE, data), socketPath);
    }

    public sendRpc(jobName: string, socketName: string, timeout?: number): Promise<Buffer> {
        return new Promise( (resolve, reject) => {
            const jobId = nanoId(IpcNetwork.JOB_ID_LENGTH);
            const socketPath = IpcNetwork.getSocketPathFromName(socketName);
            const message: Buffer = IpcNetwork.composeMessage(IpcNetwork.TYPE_RPC_JOB, jobName, jobId);
            let timeoutTimer: NodeJS.Timeout | undefined;

            if (timeout) {
                timeoutTimer = setTimeout(() => {
                    reject(new IpcNetworkError(IpcNetwork.ERROR_RPC_TIMEOUT, `Job timeout (> ${timeout}ms)`));
                    delete this.jobsItems[jobId];
                }, timeout);
            }

            this.jobsItems[jobId] = {resolve, reject, timeoutTimer};
            const result = this.unixSocket.send(message, socketPath);

            // Reject promise if message send was unsuccessful
            if (!result) {
                delete this.jobsItems[jobId];
                const errorMessage = `Unable to send job to remote process: ${socketPath}`;
                reject(new IpcNetworkError(IpcNetwork.ERROR_RPC_SEND, errorMessage));
            }
        });
    }

    protected static composeMessage(messageType: number, messageData: Buffer | string, jobId?: string): Buffer {
        // const jobId = message.slice(2, IpcNetwork.JOB_ID_LENGTH);
        const resultBuffer: Uint8Array[] = [];

        // Compose message type byte
        const type = Buffer.allocUnsafe(1);
        type.writeUInt8(messageType, 0);
        resultBuffer.push(type);

        // Compose jobId if is set
        if (jobId) {
            resultBuffer.push(Buffer.from(jobId, UnixDgramSocket.payloadEncoding));
        }

        // Convert string to Buffer
        if (typeof messageData === 'string') {
            resultBuffer.push(Buffer.from(messageData, UnixDgramSocket.payloadEncoding));
        }

        // Return concatenated data
        return Buffer.concat(resultBuffer);
    }

    protected static getSocketPathFromName(socketName: string): string {
        return `@/tmp/nodejs/.internal/ipc-network/nodes/${socketName}`;
    }

    protected static getSocketNameFromPath(socketPath: string): string {
        return socketPath.replace(IpcNetwork.getSocketPathFromName(''), '');
    }
}
