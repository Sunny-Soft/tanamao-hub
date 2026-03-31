import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import dotenv from 'dotenv'

dotenv.config()

/** URL base da API de pacotes Sunny Soft (não requer token). */
export const PACKAGES_API = 'https://chamados.sunnysoft.com.br/packages';

/** ID do produto Tanamao Food no serviço de pacotes. */
export const PACKAGE_ID = 90;

export function rootPath() {
    return app.isPackaged
        ? path.dirname(app.getPath('exe'))
        : app.getAppPath();
}

/**
 * Retorna um caminho que temos certeza de ter permissão de escrita.
 * Em desenvolvimento: a raiz do projeto (rootPath).
 * Em produção: a pasta de dados do usuário (%AppData%/tanamao-hub).
 */
export function getWritablePath() {
    return app.isPackaged
        ? app.getPath('userData')
        : rootPath();
}

export function getConfigPath() {
    return app.isPackaged
        ? path.join(app.getPath('userData'), 'configs.json')
        : path.join(rootPath(), 'configs.json');
}

export function getMigrationsPath() {
    return path.join(getWritablePath(), 'migrations');
}

export function getConfigs() {
    const configPath = getConfigPath();
    
    // Se o arquivo não existir, criamos com os valores default
    if (!fs.existsSync(configPath)) {
        const defaults = {
            host: 'localhost',
            port: 5433,
            user: 'postgres',
            password: 'admin',
            database: 'dados',
            tanamao_food: {
                path: 'C:\\Sunny\\TanamaoFood',
                installed_package_id: 0,
                version: '0.0.0'
            },
            auto_start: true,
            auto_update: true,
            backup_enabled: false,
            backup_time: '03:00',
            backup_days: [1, 2, 3, 4, 5], // segunda a sexta
            backup_path: path.join(getWritablePath(), 'backups')
        };
        fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2));
        return defaults;
    }

    try {
        let content = '';
        let configs = null;
        
        // Tenta ler e parsear com uma pequena re-tentativa em caso de erro (ex: arquivo bloqueado)
        for (let i = 0; i < 2; i++) {
            try {
                content = fs.readFileSync(configPath, 'utf-8');
                if (content && content.trim()) {
                    configs = JSON.parse(content);
                    break;
                }
            } catch (e) {
                if (i === 1) throw e;
                // Em caso de erro na primeira tentativa, espera um ínfimo instante (busy wait)
                // e tenta de novo. Útil para locks temporários no Windows.
                const start = Date.now();
                while (Date.now() - start < 50) { /* busy wait 50ms */ }
            }
        }

        if (!configs) return {};
        
        let changed = false;

        // Migração/Validação de campos obrigatórios
        if (!configs.backup_path) {
            configs.backup_path = path.join(getWritablePath(), 'backups');
            changed = true;
        }
        if (configs.auto_update === undefined) {
            configs.auto_update = true;
            changed = true;
        }
        if (!configs.port || configs.port == 5432) {
            configs.port = 5433;
            changed = true;
        }

        // Migração tanamao_food (campos flats para objeto)
        if (!configs.tanamao_food) {
            configs.tanamao_food = {
                path: configs.tanamao_food_path || 'C:\\Sunny\\TanamaoFood',
                installed_package_id: configs.installed_package_id || 0,
                version: '0.0.0'
            };
            delete configs.tanamao_food_path;
            delete configs.installed_package_id;
            changed = true;
        } else {
            // Caso já exista o objeto mas campos legados ainda estejam lá
            if (configs.tanamao_food_path) {
                configs.tanamao_food.path = configs.tanamao_food_path;
                delete configs.tanamao_food_path;
                changed = true;
            }
            if (configs.installed_package_id) {
                configs.tanamao_food.installed_package_id = configs.installed_package_id;
                delete configs.installed_package_id;
                changed = true;
            }
        }

        if (changed) {
            fs.writeFileSync(configPath, JSON.stringify(configs, null, 2));
        }

        return configs;
    } catch (err) {
        console.error("Error reading/parsing configs.json:", err);
        return {};
    }
}


export function saveConfigs(configs) {
    const configPath = getConfigPath();
    const oldConfigs = getConfigs();
    
    // Deep merge para o objeto tanamao_food para não perder campos como version ou installed_package_id
    // se a UI mandar apenas o path ou vice-versa.
    const newConfigs = { ...oldConfigs, ...configs };
    if (configs.tanamao_food && oldConfigs.tanamao_food) {
        newConfigs.tanamao_food = {
            ...oldConfigs.tanamao_food,
            ...configs.tanamao_food
        };
    }

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
