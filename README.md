# ipc-network

Inter-process communication network, allows multiple node process to exchange messages using fast datagram unix-socket.
Also support RPC request (command is send to another process, and response is returned as a Promise, resolved when response arrives).

## Installation
```bash
npm i ipc-network --save
```

## Examples
#### Start listening for messages
```typescript
import {IpcNetwork} from "IpcNetwork";
import Message from "Message";

const ipc = new IpcNetwork('process-A');

ipc.on('error', (error: Error) => {
    console.log(error.message);
});

ipc.on('message', (data: Message) => {
    console.log(`New message from ${data.from}: ${data.message.toString()}`);
});

ipc.startListening();
```

#### Sending messages
```typescript
import {IpcNetwork} from "IpcNetwork";

const ipc = new IpcNetwork('process-A');

ipc.on('error', (error: Error) => {
    console.log(error.message);
});

ipc.send('example content', 'process-B');
```

## Additional information 
#### Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests as appropriate.

#### License
[GPL-3.0](https://choosealicense.com/licenses/gpl-3.0/)
