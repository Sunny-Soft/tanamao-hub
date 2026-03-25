/**
 * Logs API — Handlers IPC
 * Registra os canais ipcMain para leitura de logs.
 *
 * Canais disponíveis:
 *   logs:get   (programId) → retorna o conteúdo do arquivo de log do programa
 *   logs:list              → retorna os programas disponíveis no registry
 */

import { ipcMain } from 'electron';
import { getLogs, getLogFile } from '../utils/logger.js';
import { programRegistry } from '../programs/registry.js';
import fs from 'fs';

const watchers = new Map();

export function initLogApi() {
    // ── Retornar conteúdo do log de um programa ──────────────────────────────
    ipcMain.handle('logs:get', (_, programId) => {
        try {
            const content = getLogs(programId);
            return { success: true, content };
        } catch (e) {
            return { success: false, error: e.message, content: '' };
        }
    });

    // ── Listar programas disponíveis (todos do registry) ─────────────────────
    ipcMain.handle('logs:list', () => {
        try {
            const programs = programRegistry.filter(({ program }) => program.type === 'app').map(({ program }) => ({
                id: program.id,
                name: program.name,
                icon: program.icon,
            }));
            return { success: true, programs };
        } catch (e) {
            return { success: false, error: e.message, programs: [] };
        }
    });

    // ── Assistir mudanças no log ─────────────────────────────────────────────
    ipcMain.on('logs:watch', (event, programId) => {
        const logFile = getLogFile(programId);

        // Se já estiver assistindo outro programa nesta janela, limpa
        if (watchers.has(event.sender.id)) {
            watchers.get(event.sender.id).close();
        }

        if (fs.existsSync(logFile)) {
            const watcher = fs.watch(logFile, (eventType) => {
                if (eventType === 'change') {
                    try {
                        const content = getLogs(programId);
                        event.sender.send('logs:update', { programId, content });
                    } catch (e) {
                        console.error('Erro ao ler log no watch:', e);
                    }
                }
            });
            watchers.set(event.sender.id, watcher);
        }
    });

    ipcMain.on('logs:unwatch', (event) => {
        if (watchers.has(event.sender.id)) {
            watchers.get(event.sender.id).close();
            watchers.delete(event.sender.id);
        }
    });
}
