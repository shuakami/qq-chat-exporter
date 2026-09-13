import assert from 'node:assert/strict';
import net from 'node:net';

/** Select an OS-assigned port for a child fixture that cannot inherit sockets. */
export async function unusedLoopbackPort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.ok(address && typeof address === 'object');
    // Production QCE reserves these ports and may reclaim their owners.
    if (address.port === 40653 || address.port === 40654) return unusedLoopbackPort();
    return address.port;
}
