import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

/**
 * Creates a bidirectional proxy between two transports
 * @param params The transport connections to proxy between
 */
export function mcpProxy({
  transportToClient,
  transportToServer,
}: {
  transportToClient: Transport;
  transportToServer: Transport;
}) {
  let transportToClientClosed = false;
  let transportToServerClosed = false;

  transportToClient.onmessage = (message) => {
    console.error('[Local→Remote]', message.method || message.id);
    transportToServer.send(message).catch(onServerError);
  };

  transportToServer.onmessage = (message) => {
    console.error('[Remote→Local]', message.method || message.id);
    transportToClient.send(message).catch(onClientError);
  };

  transportToClient.onclose = () => {
    if (transportToServerClosed) {
      return;
    }

    transportToClientClosed = true;
    transportToServer.close().catch(onServerError);
  };

  transportToServer.onclose = () => {
    if (transportToClientClosed) {
      return;
    }
    transportToServerClosed = true;
    transportToClient.close().catch(onClientError);
  };

  transportToClient.onerror = onClientError;
  transportToServer.onerror = onServerError;

  function onClientError(error: Error) {
    console.error('Error from local client:', error);
  }

  function onServerError(error: Error) {
    console.error('Error from remote server:', error);
  }
}
