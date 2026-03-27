/**
 * IPC API Loader
 * ==============
 * Inicializa todos os handlers ipcMain de forma centralizada.
 *
 * O `programs:get` lê os metadados de cada programa no registry e consulta
 * o status atual (instalado, versão, rodando) usando o controller de cada um.
 * Para adicionar um novo programa, edite apenas `programs/registry.js`.
 */

import { ipcMain } from 'electron';
import { ProgramManager, programRegistry, initializeRegistry } from '../programs/registry.js';
import { initConfigApi } from './config.js';
import { initLogApi } from './log.js';
import { info, error } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';


export default async function initIPCApi() {
    // Inicializa o registro de programas dinamicamente
    await initializeRegistry();

    // Inicializa a API de cada programa registrado
    for (const { initApi } of programRegistry) {
        if (typeof initApi === 'function') {
            initApi();
        }
    }

    // Config é uma API global (não pertence a nenhum programa específico)
    initConfigApi();

    // Logs API — permite a UI ler arquivos de log por programa
    initLogApi();

    // Retorna a lista de programas com status atual
    ipcMain.handle('programs:get', () => {
        return ProgramManager.getProgramsWithStatus();
    });

    /**
     * Handler genérico para ações em programas.
     * Substitui gradualmente chamadas específicas por programa.
     */
    ipcMain.handle('program:action', async (event, programId, action, ...args) => {
        info('API', `Action "${action}" requested for program: ${programId}`);
        const controller = ProgramManager.getController(programId);
        if (!controller) {
            throw new Error(`Controller para o programa ${programId} não encontrado.`);
        }

        if (typeof controller[action] !== 'function') {
            throw new Error(`Ação "${action}" não suportada pelo programa ${programId}.`);
        }

        // Se for uma ação que suporta reporte de progresso, injeta o callback
        const progressActions = ['install', 'update', 'uninstall', 'setup'];
        if (progressActions.includes(action)) {
            const progressCallback = (data) => {
                // Emite evento genérico e também o legado para compatibilidade
                event.sender.send('program:progress', programId, data);
                event.sender.send(`${programId}:progress`, data);
            };
            return await controller[action](progressCallback, ...args);
        }

        return await controller[action](...args);
    });

    ipcMain.handle('program:config:get', async (event, programId) => {
        const program = programRegistry.find(p => p.metadata.id === programId)?.metadata;
        if (!program) {
            throw new Error(`Programa ${programId} não encontrado`);
        }
        const configPath = path.join(app.getPath('userData'), '..', programId, 'configs.json');
        console.log(configPath);

        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
        return {};
    });

    ipcMain.handle('program:config:save', async (event, programId, config) => {
        const program = programRegistry.find(p => p.metadata.id === programId)?.metadata;
        if (!program) {
            throw new Error(`Programa ${programId} não encontrado`);
        }
        const configPath = path.join(app.getPath('userData'), '..', programId, 'configs.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    });
}