import { ipcMain } from "electron";
import PostgresController from "../programs/postgresql/controller.js";
import { testDatabaseConnection } from "../programs/postgresql/db-setup.js";
import { getConfigs, getMigrationsPath, rootPath } from "../utils/config.js";
import fs from 'fs';
import path from 'path';

export function initPostgresApi() {
    ipcMain.handle('postgres:install', async (event) => {
        try {
            await PostgresController.downloadAndInstall((progress) => {
                event.sender.send('postgres:progress', progress);
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('postgres:uninstall', async (event) => {
        try {
            await PostgresController.uninstallPostgres((progress) => {
                event.sender.send('postgres:progress', progress);
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('postgres:running', async () => {
        try {
            const isRunning = PostgresController.isPostgresRunning();
            return { success: true, isRunning };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('postgres:version', async () => {
        try {
            const version = PostgresController.getPostgresVersion();
            return { success: true, version };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('postgres:start', async () => {
        try {
            const result = await PostgresController.startPostgres();
            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('postgres:stop', async () => {
        try {
            const result = await PostgresController.stopPostgres();
            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('postgres:test-connection', async (event, config) => {
        try {
            return await testDatabaseConnection(
                config.database,
                config.user,
                config.password,
                config.host,
                config.port
            );
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('postgres:setup', async (event) => {
        try {
            const migrationsPath = getMigrationsPath();
            const migrationFiles = fs.existsSync(migrationsPath) 
                ? fs.readdirSync(migrationsPath)
                    .filter(f => f.endsWith('.sql'))
                    .sort()
                    .map(f => path.join(migrationsPath, f))
                : [];
            const configs = getConfigs();

            await PostgresController.setupDatabase(
                configs.database, 
                configs.user, 
                configs.password, 
                migrationFiles, 
                (progress) => {
                    event.sender.send('postgres:config:progress', progress);
                }
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
}