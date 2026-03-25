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
import { programRegistry } from '../programs/registry.js';
import { initConfigApi } from './config.js';
import { initLogApi } from './log.js';
import { info, error } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

// Controllers usados para consultar status em programs:get
import PostgresController from '../programs/postgresql/controller.js';
import TanamaoFoodController from '../programs/tanamao-food/controller.js';
import { log } from 'console';

/**
 * Mapa de funções que retornam o status atual de cada programa pelo id.
 * Ao adicionar um novo programa com status dinâmico, adicione uma entry aqui.
 */
const statusResolvers = {
    'postgresql': () => {
        const version = PostgresController.getPostgresVersion();
        const isRunning = PostgresController.isPostgresRunning();
        return {
            version: version ? `${version}.0` : null,
            status: version ? 'installed' : 'not-installed',
            isRunning,
        };
    },
    'tanamao-food': () => {
        const isInstalled = TanamaoFoodController.isFoodInstalled();
        const isRunning = TanamaoFoodController.isFoodRunning();
        const version = TanamaoFoodController.getFoodVersion();
        return {
            version,
            status: isInstalled ? 'installed' : 'not-installed',
            isRunning,
        };
    },
};

export default function initIPCApi() {
    // Inicializa a API de cada programa registrado
    for (const { initApi } of programRegistry) {
        initApi();
    }

    // Config é uma API global (não pertence a nenhum programa específico)
    initConfigApi();

    // Logs API — permite a UI ler arquivos de log por programa
    initLogApi();

    // Retorna a lista de programas com status atual
    ipcMain.handle('programs:get', () => {
        return programRegistry
            .map(({ program }) => {
                const resolver = statusResolvers[program.id];
                const dynamicStatus = resolver ? resolver() : {};
                return {
                    hasUpdate: false,
                    isRunning: false,
                    ...program,
                    ...dynamicStatus,
                };
            })
    });

    ipcMain.handle('program:config:get', async (event, programId) => {
        const program = programRegistry.find(p => p.program.id === programId)?.program;
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
        const program = programRegistry.find(p => p.program.id === programId)?.program;
        if (!program) {
            throw new Error(`Programa ${programId} não encontrado`);
        }
        const configPath = path.join(app.getPath('userData'), '..', programId, 'configs.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    });
}