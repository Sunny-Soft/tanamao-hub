import { ipcMain } from "electron";
import TanamaoFoodController from "./controller.js";
import { setupDatabase } from "../postgresql/db-setup.js";
import { getConfigs, getMigrationsPath, writeExternalConfig } from "../../utils/config.js";
import fs from 'fs';
import path from "path";
import { app } from "electron";
import { error, info } from "../../utils/logger.js";

export default function initTanamaoFoodApi() {
    ipcMain.handle('tanamao-food:is-installed', async () => {
        try {
            const isInstalled = TanamaoFoodController.isFoodInstalled();
            return { success: true, isInstalled };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('tanamao-food:is-running', async () => {
        try {
            const isRunning = TanamaoFoodController.isFoodRunning();
            return { success: true, isRunning };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('tanamao-food:open', async () => {
        try {
            const result = await TanamaoFoodController.openFood();
            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('tanamao-food:install', async (event, installDir) => {
        try {
            info('tanamao-food-api', 'Iniciando IPC: tanamao-food:install');
            const result = await TanamaoFoodController.installFood((progress) => {
                event.sender.send('tanamao-food:progress', progress);
                event.sender.send('program:progress', 'tanamao-food', progress);
            }, installDir);
            info('tanamao-food-api', `Finalizado IPC: tanamao-food:install com sucesso=${result?.success}`);
            return result;
        } catch (err) {
            error('tanamao-food-api', `Erro fatal no IPC tanamao-food:install: ${err.message}`);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('tanamao-food:update', async (event, installDir) => {
        try {
            const result = await TanamaoFoodController.updateFood((progress) => {
                event.sender.send('tanamao-food:progress', progress);
                event.sender.send('program:progress', 'tanamao-food', progress);
            }, installDir);
            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('tanamao-food:version', async () => {
        try {
            if (TanamaoFoodController.isBusy) {
                return { success: true, version: '...' };
            }
            const version = TanamaoFoodController.getFoodVersion();
            return { success: true, version };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('tanamao-food:setup-database', async (event) => {
        try {
            info('tanamao-food-api', 'Iniciando IPC: tanamao-food:setup-database');

            if (TanamaoFoodController.isBusy) {
                const msg = 'Uma operação (instalação/atualização) já está em andamento.';
                return { success: false, error: msg };
            }

            // Medida extra de segurança: não configurar banco se o app não estiver instalado
            if (!TanamaoFoodController.isFoodInstalled()) {
                const msg = 'Tentativa de configurar banco, mas o Tanamao Food não está instalado. Abortando.';
                warn('tanamao-food-api', msg);
                return { success: false, error: msg };
            }

            const migrationsPath = getMigrationsPath();
            const migrationFiles = fs.existsSync(migrationsPath)
                ? fs.readdirSync(migrationsPath)
                    .filter(f => f.endsWith('.sql'))
                    .sort()
                    .map(f => path.join(migrationsPath, f))
                : [];

            const configs = getConfigs();

            // Usa o setupDatabase do diretório programs que é o mais completo
            await setupDatabase(configs.database, configs.user, configs.password, migrationFiles, (progress) => {
                event.sender.send('tanamao-food:config:progress', progress);
                event.sender.send('program:config:progress', 'tanamao-food', progress);
            });

            // O nome da pasta de userData para o Tanamao Food é 'tanamao-food' (conforme seu package.json)
            const foodConfigDir = path.join(app.getPath('userData'), '..', 'tanamao-food');

            const dbConfig = {
                db: {
                    host: configs.host,
                    port: configs.port,
                    password: configs.password,
                    database: configs.database
                }
            };

            writeExternalConfig(foodConfigDir, dbConfig);

            // Também tenta atualizar na pasta de instalação se for diferente (para o modo dev do Food app)
            if (configs.tanamao_food_path && fs.existsSync(configs.tanamao_food_path)) {
                writeExternalConfig(configs.tanamao_food_path, dbConfig);
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('tanamao-food:uninstall', async (event) => {
        try {
            info('tanamao-food-api', 'Iniciando IPC: tanamao-food:uninstall');
            const result = await TanamaoFoodController.uninstallFood((progress) => {
                event.sender.send('tanamao-food:progress', progress);
                event.sender.send('program:progress', 'tanamao-food', progress);
            });
            return result;
        } catch (err) {
            error('tanamao-food-api', `Erro fatal no IPC tanamao-food:uninstall: ${err.message}`);
            return { success: false, error: err.message };
        }
    });
}
