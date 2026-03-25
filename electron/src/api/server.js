import http from 'http';
import { info, error } from '../utils/logger.js';

const PORT = 3001; // Porta padrão para o Hub Server
const PROGRAM_ID = 'hub-server';

export function initHubServer() {
    const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
        }

        if (req.url === '/status' && req.method === 'GET') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: 'ok', version: '1.0.0' }));
            return;
        }

        res.statusCode = 404;
        res.end('Not Found');
    });

    server.listen(PORT, () => {
        info(PROGRAM_ID, `Hub Server rodando na porta ${PORT}`);
    });

    server.on('error', (err) => {
        error(PROGRAM_ID, `Erro no Hub Server: ${err.message}`);
    });

    return server;
}
