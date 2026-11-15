import { startServer } from './server.ts';

const port = Number(process.env.PORT ?? 3000);
const dataFile = process.env.DATA_FILE ?? 'data/inventory.json';
const server = await startServer({ dataFile, port });
console.log(`Laptop inventory running at ${server.url} (data: ${dataFile})`);
