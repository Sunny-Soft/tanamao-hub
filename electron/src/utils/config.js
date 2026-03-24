import fs from 'fs'
import path from 'path'
import { app } from 'electron'


export function rootPath() {
    return app.isPackaged
        ? path.dirname(app.getPath('exe'))
        : app.getAppPath();
}

export function getConfigPath() {
    const configPath = app.isPackaged
        ? path.join(app.getPath('userData'), 'configs.json')
        : path.join(rootPath(), 'configs.json');

    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({
            host: 'localhost',
            port: 5432,
            user: 'postgres',
            password: 'admin',
            database: 'tanamao',
            tanamao_food_path: 'C:\\Program Files\\Tanamao Food',
            auto_start: true,
            auto_update: false,
            backup_enabled: false,
            backup_time: '03:00',
            backup_days: [1, 2, 3, 4, 5], // segunda a sexta
            backup_path: path.join(rootPath(), 'backups')
        }));
    }

    return configPath
}

export function getMigrationsPath() {
    return path.join(rootPath(), 'migrations');
}

export function getConfigs() {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
        console.error("Error reading configs.json:", err);
        return {};
    }
}


export function saveConfigs(configs) {
    const configPath = getConfigPath();
    const oldConfigs = getConfigs();
    const newConfigs = { ...oldConfigs, ...configs };
    fs.writeFileSync(configPath, JSON.stringify(newConfigs, null, 2));
}

/**
 * Lê um arquivo configs.json de um diretório externo.
 */
export function readExternalConfig(targetDir) {
    const configPath = path.join(targetDir, 'configs.json');
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch (err) {
            console.error(`Erro ao ler config externa em ${targetDir}:`, err);
        }
    }
    return null;
}

/**
 * Escreve ou atualiza um arquivo configs.json em um diretório externo.
 */
export function writeExternalConfig(targetDir, data) {
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    const configPath = path.join(targetDir, 'configs.json');
    const existing = readExternalConfig(targetDir) || {};
    const newConfig = { ...existing, ...data };
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
    return configPath;
}
