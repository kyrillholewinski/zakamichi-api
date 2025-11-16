import os from 'os';

export function printServerInfo(port) {
    const interfaces = os.networkInterfaces();
    console.log('--- Server available on: ---');
    Object.keys(interfaces).forEach((ifaceName) => {
        interfaces[ifaceName].forEach((iface) => {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`  ${ifaceName}: http://${iface.address}:${port}`);
            }
        });
    });
    console.log('------------------------------');
}