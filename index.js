import app from './server/app.js';
import { PORT } from './config/config.js';
import { printServerInfo } from './utils/network.js';

async function main() {
    try {
        console.log('--- 🚀 Starting Application ---');
        // Start the Express web server
        app.listen(PORT, () => {
            console.log(`✅ Server listening on port ${PORT}`);
            printServerInfo(PORT);
        });

    } catch (err) {
        console.error('❌ Fatal error during startup:', err);
        process.exit(1);
    }
}

// Listen for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

main();