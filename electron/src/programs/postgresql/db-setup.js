/**
 * PostgreSQL DB Setup
 * Responsável por: criar banco, configurar usuário local, rodar migrations.
 * Separado do controller de instalação para clareza de responsabilidade.
 */

import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import { getConfigs, rootPath, getMigrationsPath, getWritablePath } from '../../utils/config.js';
import { info, warn, error as logError, logDetailed } from '../../utils/logger.js';
import PostgresController from './controller.js';

const { Pool } = pkg;
const PROGRAM_ID = 'postgres';

/**
 * Configura o banco de dados completo:
 * 1. Cria o banco se não existir
 * 2. Se for novo, cria as extensões necessárias
 * 3. Se houver templatePath, restaura o backup binário
 * 4. Configura o usuário local
 * 5. Executa as migrations pendentes
 *
 * @param {string} dbName - Nome do banco de dados
 * @param {string} user - Usuário administrador do postgres
 * @param {string} password - Senha do usuário administrador
 * @param {string[]} migrationFiles - Caminhos dos arquivos .sql de migration
 * @param {Function} callback - Callback de progresso
 * @param {string} templatePath - Opcional: caminho para o arquivo .backup de template
 * @param {string} systemId - ID do sistema para organizar os backups (ex: 'system', 'tanamao-food')
 */
export async function setupDatabase(dbName = 'dados', user = 'postgres', password = 'admin', migrationFiles = [], callback, templatePath = null, systemId = 'system') {
    info(PROGRAM_ID, `Configurando banco: ${dbName} (sistema: ${systemId})...`);
    if (callback) callback({ status: 'initializing', percentage: 0 });

    // Garante que o banco está pronto antes de tentar conectar
    await PostgresController.waitForReady(15, 2000);

    const configs = getConfigs();
    const port = configs.port || 5432;

    const adminPool = new Pool({
        user,
        host: 'localhost',
        database: 'postgres', // conecta no banco padrão primeiro
        password,
        port,
    });

    try {
        // 1. Garante que o banco existe
        info(PROGRAM_ID, `Verificando se o banco ${dbName} já existe...`);
        const dbCheck = await adminPool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
        let dbExists = dbCheck.rowCount > 0;

        if (!dbExists) {
            info(PROGRAM_ID, `Banco ${dbName} não encontrado. Criando banco de dados...`);
            await adminPool.query(`CREATE DATABASE ${dbName}`);
            info(PROGRAM_ID, `Banco de dados ${dbName} criado com sucesso.`);
        } else {
            info(PROGRAM_ID, `Banco ${dbName} já existe.`);
        }

        // 1.1 Verifica se o banco precisa de configuração inicial (extensões e template)
        const targetPool = new Pool({ user, host: 'localhost', database: dbName, password, port });
        try {
            // Verifica se a tabela de migrations_history existe para saber se o banco já foi inicializado
            const histCheck = await targetPool.query(`
                SELECT 1 FROM pg_tables 
                WHERE schemaname = 'public' 
                AND tablename = 'migrations_history'
            `);
            const isInitialized = histCheck.rowCount > 0;

            if (!isInitialized) {
                info(PROGRAM_ID, `Banco ${dbName} não inicializado. Realizando configuração inicial...`);
                
                info(PROGRAM_ID, 'Criando extensões necessárias (pgcrypto, postgis, unaccent)...');
                await targetPool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
                await targetPool.query('CREATE EXTENSION IF NOT EXISTS postgis');
                await targetPool.query('CREATE EXTENSION IF NOT EXISTS unaccent');
                
                if (templatePath && fs.existsSync(templatePath)) {
                    info(PROGRAM_ID, `Usando template de backup: ${templatePath}`);
                    if (callback) callback({ status: 'restoring_template', percentage: 5 });

                    await PostgresController.restoreBinaryBackup(dbName, templatePath, user, password);
                }
            } else {
                info(PROGRAM_ID, `Banco ${dbName} já inicializado anteriormente.`);
            }
        } finally {
            await targetPool.end();
        }

        await adminPool.end();

        // 2. Se o banco já existe, fazemos um backup de segurança antes das migrations
        let backupPath = null;
        if (dbExists) {
            const backupsDir = path.join(getWritablePath(), 'backups', systemId);
            if (!fs.existsSync(backupsDir)) {
                fs.mkdirSync(backupsDir, { recursive: true });
            } else {
                // Limpeza: remove backups antigos deste sistema antes de criar o novo
                // para evitar o acúmulo de arquivos em caso de falhas consecutivas.
                try {
                    const oldBackups = fs.readdirSync(backupsDir).filter(f => f.endsWith('.backup'));
                    for (const oldFile of oldBackups) {
                        fs.unlinkSync(path.join(backupsDir, oldFile));
                    }
                } catch (cleanErr) {
                    warn(PROGRAM_ID, `Erro ao limpar backups antigos: ${cleanErr.message}`);
                }
            }
            // Usa o formato custom do pg_dump (-Fc): comprimido, restaurável via pg_restore,
            // o mesmo formato do .backup de template — muito mais eficiente que SQL puro.
            backupPath = path.join(backupsDir, `${dbName}_pre_migration_${Date.now()}.backup`);
            await PostgresController.backupDatabase(dbName, backupPath, user, password);
        }

        // 3. Reconecta no banco alvo para operações
        const dbPool = new Pool({
            user,
            host: 'localhost',
            database: dbName,
            password,
            port,
        });

        try {
            // 4. Configura usuário local
            await setupLocalUser(dbPool, dbName, callback);

            // 5. Roda migrations
            await runMigrations(dbPool, dbName, migrationFiles, callback);

            await dbPool.end();
            info(PROGRAM_ID, 'Banco de dados e migrações concluídos!');

            // Se deu tudo certo e havia um backup de segurança, podemos removê-lo
            if (backupPath && fs.existsSync(backupPath)) {
                try {
                    fs.unlinkSync(backupPath);
                    info(PROGRAM_ID, 'Backup pré-migração removido após sucesso.');
                } catch (unlinkErr) {
                    warn(PROGRAM_ID, `Não foi possível remover backup temporário: ${unlinkErr.message}`);
                }
            }
        } catch (migrationError) {
            logError(PROGRAM_ID, `Erro durante migrações: ${migrationError.message}`);

            if (backupPath && fs.existsSync(backupPath)) {
                warn(PROGRAM_ID, `Tentando restaurar backup devido a erro: ${backupPath}`);
                if (callback) callback({ status: 'info', message: 'Erro detectado. Restaurando backup...' });

                await dbPool.end(); // Fecha pool antes de restaurar
                // Usa pg_restore (formato custom .backup) em vez do psql para .sql
                await PostgresController.restoreBinaryBackup(dbName, backupPath, user, password);
                warn(PROGRAM_ID, 'Backup restaurado com sucesso.');
            }

            throw migrationError;
        }
    } catch (error) {
        logError(PROGRAM_ID, `Erro no setup do banco: ${error.message}`);
        if (callback) callback({ status: 'error', error: error.message });
        throw error;
    }
}

/**
 * Garante que o usuário local_user existe e tem as permissões corretas.
 */
async function setupLocalUser(pool, dbName, callback) {
    info(PROGRAM_ID, 'Garantindo existência do local_user...');
    if (callback) callback({ status: 'setup_user', percentage: 10 });

    const users = await pool.query(`SELECT usename FROM pg_user WHERE usename = 'local_user';`);
    if (users.rowCount === 0) {
        info(PROGRAM_ID, 'Criando local_user...');
        await pool.query(`CREATE USER local_user WITH PASSWORD 'sunny1011';`);
    } else {
        await pool.query(`ALTER USER local_user WITH PASSWORD 'sunny1011';`);
    }

    await grantPermissions(pool, dbName);
}

/**
 * Revoga temporariamente as permissões do local_user (antes de rodar migrations).
 */
async function revokePermissions(pool, dbName) {
    info(PROGRAM_ID, `Revogando permissões do local_user em ${dbName}...`);
    await pool.query(`REVOKE CONNECT ON DATABASE ${dbName} FROM local_user;`);
    await pool.query(`
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = $1
          AND usename = 'local_user'
          AND pid <> pg_backend_pid();
    `, [dbName]);
}

/**
 * Concede permissões completas ao local_user.
 */
async function grantPermissions(pool, dbName) {
    info(PROGRAM_ID, `Concedendo permissões ao local_user em ${dbName}...`);
    await pool.query(`GRANT CONNECT ON DATABASE ${dbName} TO local_user;`);
    await pool.query(`GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO local_user;`);
    await pool.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO local_user;`);
    await pool.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO local_user;`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO local_user;`);
}

/**
 * Executa os arquivos de migration pendentes (somente os que ainda não foram executados).
 *
 * @param {object} pool - Pool de conexão com o banco alvo
 * @param {string} dbName - Nome do banco de dados
 * @param {string[]} migrationFiles - Lista de caminhos dos arquivos .sql
 * @param {Function} callback - Callback de progresso
 */
export async function runMigrations(pool, dbName, migrationFiles, callback) {
    info(PROGRAM_ID, '--- INICIANDO MIGRATIONS ---');
    if (callback) callback({ status: 'migrating', percentage: 20 });

    try {
        await revokePermissions(pool, dbName);

        // Tabela de controle de migrations
        await pool.query(`
            CREATE TABLE IF NOT EXISTS migrations_history (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) UNIQUE NOT NULL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Se nenhum arquivo foi passado, busca no diretório padrão
        let filesToRun = migrationFiles;
        if (!filesToRun || filesToRun.length === 0) {
            const migrationsDir = getMigrationsPath();
            info(PROGRAM_ID, `Buscando migrations no diretório: ${migrationsDir}`);
            if (fs.existsSync(migrationsDir)) {
                filesToRun = fs.readdirSync(migrationsDir)
                    .filter(f => f.endsWith('.sql'))
                    .sort()
                    .map(f => path.join(migrationsDir, f));
                info(PROGRAM_ID, `Encontradas ${filesToRun.length} migrations no diretório.`);
            } else {
                warn(PROGRAM_ID, `Diretório de migrations não encontrado: ${migrationsDir}`);
                return;
            }
        }

        for (let i = 0; i < filesToRun.length; i++) {
            const filePath = filesToRun[i];
            const fileName = path.basename(filePath);

            const alreadyRun = await pool.query(`SELECT id FROM migrations_history WHERE filename = $1`, [fileName]);
            if (alreadyRun.rowCount > 0) {
                info(PROGRAM_ID, `Migration já executada: ${fileName}`);
                continue;
            }

            info(PROGRAM_ID, `Executando migration: ${fileName}`);
            const sql = fs.readFileSync(filePath, 'utf8');
            
            // Log do conteúdo SQL se for pequeno ou apenas o início
            logDetailed(PROGRAM_ID, `SQL [${fileName}]: ${sql.substring(0, 200)}${sql.length > 200 ? '...' : ''}`);
            
            await pool.query(sql);
            await pool.query(`INSERT INTO migrations_history (filename) VALUES ($1)`, [fileName]);
            info(PROGRAM_ID, `Migration concluída com sucesso: ${fileName}`);

            if (callback) {
                const percentage = 20 + ((i + 1) / filesToRun.length * 80);
                callback({ status: 'migrating', percentage, file: fileName });
            }
        }

        info(PROGRAM_ID, '--- MIGRATIONS CONCLUÍDAS COM SUCESSO ---');
    } finally {
        await grantPermissions(pool, dbName);
    }
}

/**
 * Testa a conexão com o banco de dados.
 */
export async function testDatabaseConnection(dbName, user, password, host = 'localhost', port = 5433) {
    info(PROGRAM_ID, `Testando conexão: host=${host}, port=${port}, user=${user}, database=${dbName}`);

    const pool = new Pool({
        user,
        host,
        database: dbName,
        password,
        port,
        connectionTimeoutMillis: 5000,
    });

    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        await pool.end();
        info(PROGRAM_ID, 'Teste de conexão bem-sucedido!');
        return { success: true };
    } catch (err) {
        logError(PROGRAM_ID, `Falha no teste de conexão: ${err.message}`);
        await pool.end();
        return { success: false, error: err.message };
    }
}
