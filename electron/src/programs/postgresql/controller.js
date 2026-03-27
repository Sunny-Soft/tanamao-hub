/**
 * PostgreSQL Controller
 * Responsável por: detectar, baixar, instalar e iniciar o PostgreSQL.
 * Setup do banco de dados está em db-setup.js.
 */

import { execSync, spawn } from 'child_process';
import { rootPath, getConfigs, getWritablePath } from '../../utils/config.js';
import { info, warn, error as logError, logDetailed, getLogDir } from '../../utils/logger.js';
import path from 'path';
import axios from 'axios';
import fs from 'fs';
import pkg from 'pg';
const { Pool } = pkg;

const PROGRAM_ID = 'postgres';

class PostgresController {
    constructor() {
        this.isBusy = false;
        this.currentBusyStatus = null;
    }

    // ─── Detecção ─────────────────────────────────────────────────────────────

    /**
     * Verifica onde o PostgreSQL está instalado.
     * Tenta primeiro o diretório local (installers/pgsql) e depois o padrão do sistema.
     * Retorna o caminho base da instalação ou null.
     */
    getInstallPath() {
        // 1. Usa o caminho em installers/pgsql dentro da pasta editável
        const localPath = path.join(getWritablePath(), 'installers', 'pgsql');
        if (fs.existsSync(path.join(localPath, 'bin', 'postgres.exe'))) {
            return localPath;
        }

        return localPath; // Retorna o caminho mesmo que não exista, para instaladores
    }

    isInstalled() {
        return fs.existsSync(path.join(getWritablePath(), 'installers', 'pgsql', 'bin', 'postgres.exe'));
    }

    /**
     * Retorna o caminho do diretório de dados (data).
     */
    getDataPath() {
        return path.join(this.getInstallPath(), 'data');
    }

    /**
     * Retorna o caminho completo do binário postgres (ex: psql.exe, postgres.exe).
     * @throws {Error} Se o PostgreSQL não for encontrado.
     */
    getBinaryPath(binaryName) {
        const installPath = this.getInstallPath();
        if (!installPath) throw new Error('PostgreSQL não encontrado.');
        return path.join(installPath, 'bin', `${binaryName}.exe`);
    }

    /**
     * Mantido para compatibilidade. Retorna a versão maior se instalado.
     */
    checkDefaultDirectory() {
        return this.getPostgresVersion();
    }

    /**
     * Retorna o environment com o diretório bin do PostgreSQL no PATH.
     */
    getEnvWithBinPath(extraEnv = {}) {
        const binPath = path.join(this.getInstallPath(), 'bin');
        const env = { ...process.env, ...extraEnv };

        const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'Path';
        const oldPath = env[pathKey] || '';
        env[pathKey] = `${binPath}${path.delimiter}${oldPath}`;

        return env;
    }

    /**
     * Retorna a versão instalada do PostgreSQL ou null.
     */
    getPostgresVersion() {
        try {
            const postgresPath = this.getBinaryPath('postgres');
            const versionOutput = execSync(`"${postgresPath}" -V`, { env: this.getEnvWithBinPath() }).toString();
            const match = versionOutput.match(/\d+/);
            return match ? parseInt(match[0]) : null;
        } catch (e) {
            const installPath = this.getInstallPath();
            if (installPath) {
                const match = installPath.match(/(\d+)$/);
                return match ? parseInt(match[1]) : null;
            }
            return null;
        }
    }

    /**
     * Verifica se o processo postgres.exe está ativo e respondendo.
     */
    isPostgresRunning() {
        try {
            const configs = getConfigs();
            const port = configs.port || 5432;
            const pgIsReadyPath = this.getBinaryPath('pg_isready');

            // 1. Tenta conexação leve via pg_isready (mais confiável)
            try {
                // -t 1: timeout de 1 segundo
                const cmd = `"${pgIsReadyPath}" -p ${port} -h localhost -t 1`;
                console.log(`[PostgresController] Checking status: ${cmd}`);
                execSync(cmd, { stdio: 'ignore', shell: true });
                console.log(`[PostgresController] PostgreSQL is running on port ${port}`);
                return true;
            } catch (e) {
                console.log(`[PostgresController] pg_isready check failed on port ${port}`);
                // pg_isready retorna código != 0 se não estiver pronto
            }

            // 2. Fallback: Verifica arquivo PID e lista de processos
            const dataPath = this.getDataPath();
            const pidFile = path.join(dataPath, 'postmaster.pid');
            if (fs.existsSync(pidFile)) {
                const content = fs.readFileSync(pidFile, 'utf8').trim();
                const pid = parseInt(content.split(/\r?\n/)[0]);
                if (pid && !isNaN(pid)) {
                    try {
                        const stdout = execSync(`tasklist /FI "PID eq ${pid}" /NH`).toString();
                        if (stdout.toLowerCase().includes('postgres.exe')) {
                            // O processo existe, mas o pg_isready falhou. 
                            // Pode estar em inicialização ou travado.
                            // Por segurança, consideramos "rodando" para evitar tentar startar por cima.
                            return true;
                        }
                    } catch (err) {
                        // ignore tasklist errors
                    }
                }
            }

            // 3. Last Fallback: Check if port is listening using netstat
            try {
                const netstatOutput = execSync(`netstat -ano | findstr :${port}`, { shell: true }).toString();
                if (netstatOutput.includes('LISTENING')) {
                    console.log(`[PostgresController] Port ${port} is LISTENING. Considering running.`);
                    return true;
                }
            } catch (err) {
                // ignore errors
            }

            return false;
        } catch (e) {
            console.error(`[PostgresController] isPostgresRunning error: ${e.message}`);
            return false;
        }
    }

    // ─── Interface Padrão ─────────────────────────────────────────────────────

    isRunning() {
        return this.isPostgresRunning();
    }

    getVersion() {
        const v = this.getPostgresVersion();
        return v ? `${v}.0` : null;
    }

    getStatus() {
        if (this.isBusy) {
            return {
                status: this.currentBusyStatus || 'busy',
                isRunning: false,
                version: '...',
            };
        }

        return {
            status: this.isInstalled() ? 'installed' : 'not-installed',
            isRunning: this.isRunning(),
            version: this.getVersion(),
        };
    }

    async install(progressCallback) {
        if (this.isBusy) {
            throw new Error('Uma operação já está em andamento para o PostgreSQL.');
        }

        this.isBusy = true;
        this.currentBusyStatus = 'installing';

        try {
            return await this.downloadAndInstall(progressCallback);
        } finally {
            this.isBusy = false;
            this.currentBusyStatus = null;
        }
    }

    async uninstall(progressCallback) {
        if (this.isBusy) {
            throw new Error('Uma operação já está em andamento para o PostgreSQL.');
        }

        this.isBusy = true;
        this.currentBusyStatus = 'uninstalling';

        try {
            return await this.uninstallPostgres(progressCallback);
        } finally {
            this.isBusy = false;
            this.currentBusyStatus = null;
        }
    }

    async start() {
        return this.startPostgres();
    }

    async stop() {
        return this.stopPostgres();
    }

    // ─── Serviço ──────────────────────────────────────────────────────────────

    /**
     * Inicializa o diretório de dados se ele não existir.
     */
    async initDatabaseDir() {
        const dataPath = this.getDataPath();
        if (fs.existsSync(path.join(dataPath, 'PG_VERSION'))) {
            info(PROGRAM_ID, 'Diretório de dados já inicializado.');
            return;
        }

        info(PROGRAM_ID, 'Inicializando diretório de dados do PostgreSQL...');
        const initdbPath = this.getBinaryPath('initdb');

        try {
            // initdb -D <path> -U postgres --auth=trust
            // Usamos spawn para evitar travar a UI durante a inicialização (que pode demorar)
            await new Promise((resolve, reject) => {
                const proc = spawn(`"${initdbPath}"`, ['-D', dataPath, '-U', 'postgres', '--auth=trust'], {
                    shell: true,
                    env: this.getEnvWithBinPath()
                });
                proc.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`initdb falhou com código ${code}`));
                });
                proc.on('error', reject);
            });
            info(PROGRAM_ID, 'Diretório de dados inicializado com sucesso.');
        } catch (e) {
            logError(PROGRAM_ID, `Erro ao inicializar banco: ${e.message}`);
            throw e;
        }
    }

    /**
     * Inicia o PostgreSQL usando pg_ctl de forma assíncrona.
     */
    async startPostgres() {
        try {
            const configs = getConfigs();
            const port = configs.port || 5432;
            const dataPath = this.getDataPath();
            const logFile = path.join(getLogDir(), 'postgres_service.log');

            // Garante que o diretório de dados existe
            await this.initDatabaseDir();

            if (this.isPostgresRunning()) {
                info(PROGRAM_ID, 'PostgreSQL já está rodando.');
                return { success: true };
            }

            info(PROGRAM_ID, `Iniciando PostgreSQL na porta ${port}...`);

            // pg_ctl start -D <dataPath> -l <logFile> -o "-p <port>"
            // Usamos -W (no wait) porque temos nossa própria lógica de waitForReady.
            const args = ['start', '-W', '-D', dataPath, '-l', logFile, '-o', `"-p ${port}"`];
            await this.runPgCtlAsync(args);

            // Aguarda ficar pronto por alguns segundos (opcional aqui, já que runPgCtlAsync retornou)
            await this.waitForReady(10, 2000);

            info(PROGRAM_ID, 'PostgreSQL iniciado com sucesso.');
            return { success: true };
        } catch (e) {
            logError(PROGRAM_ID, `Erro ao iniciar PostgreSQL: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    /**
     * Para o PostgreSQL usando pg_ctl.
     */
    async stopPostgres() {
        try {
            const dataPath = this.getDataPath();

            info(PROGRAM_ID, 'Parando PostgreSQL...');
            await this.runPgCtlAsync(['stop', '-D', dataPath, '-m', 'fast']);
            info(PROGRAM_ID, 'PostgreSQL parado.');
            return { success: true };
        } catch (e) {
            logError(PROGRAM_ID, `Erro ao parar PostgreSQL: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    /**
     * Aguarda até que o PostgreSQL esteja pronto para receber conexões.
     * @param {number} retries - Número de tentativas
     * @param {number} delay - Atraso entre tentativas em ms
     */
    async waitForReady(retries = 10, delay = 2000) {
        info(PROGRAM_ID, 'Aguardando PostgreSQL ficar pronto para conexões...');
        for (let i = 0; i < retries; i++) {
            const configs = getConfigs();
            // Conecta sempre no banco 'postgres' (padrão, sempre existe)
            // para não depender do banco de dados da aplicação que ainda pode não ter sido criado.
            const pool = new Pool({
                host: configs.host || 'localhost',
                port: configs.port,
                user: configs.user,
                password: configs.password,
                database: 'postgres',
                connectionTimeoutMillis: 2000,
            });

            try {
                await pool.query('SELECT 1');
                await pool.end();
                info(PROGRAM_ID, 'PostgreSQL está pronto!');
                return true;
            } catch (err) {
                await pool.end();
                warn(PROGRAM_ID, `PostgreSQL ainda não está pronto (tentativa ${i + 1}/${retries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error('PostgreSQL não ficou pronto após várias tentativas.');
    }

    // ─── Instalação ───────────────────────────────────────────────────────────

    /**
     * Baixa o instalador do PostgreSQL via HTTP com callback de progresso.
     */
    async downloadWithAxios(url, outputPath, progressCallback) {
        const writer = fs.createWriteStream(outputPath);
        const response = await axios({ url, method: 'GET', responseType: 'stream' });

        const totalLength = response.headers['content-length'];
        let downloadedLength = 0;

        response.data.on('data', (chunk) => {
            downloadedLength += chunk.length;
            if (progressCallback) {
                if (totalLength) {
                    const percentage = Math.round((downloadedLength / totalLength) * 100);
                    progressCallback({ status: 'downloading', percentage, message: `Baixando... ${percentage}%` });
                } else {
                    // Se não temos o total, apenas reportamos que está baixando (sem porcentagem)
                    const downloadedMB = (downloadedLength / (1024 * 1024)).toFixed(2);
                    progressCallback({ status: 'downloading', message: `Baixando... (${downloadedMB} MB)` });
                }
            }
        });

        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }

    /**
     * Executa o instalador do PostgreSQL em modo silencioso.
     */
    async installPostgres(installerPath, pass, progressCallback) {
        info(PROGRAM_ID, 'Iniciando extração do binário do PostgreSQL...');
        if (progressCallback) progressCallback({ status: 'installing', percentage: 0 });

        const installersDir = path.join(getWritablePath(), 'installers');

        if (!fs.existsSync(installersDir)) {
            fs.mkdirSync(installersDir, { recursive: true });
        }

        // Script PowerShell para extrair com progresso
        // Usamos [System.IO.Compression.ZipFile] para iterar sobre os arquivos e reportar progresso
        const psScript = `
            $zipPath = '${installerPath}';
            $destPath = '${installersDir}';
            Add-Type -AssemblyName System.IO.Compression.FileSystem;
            $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath);
            $entries = $zip.Entries;
            $total = $entries.Count;
            $current = 0;
            foreach ($entry in $entries) {
                $current++;
                $percent = [Math]::Floor(($current / $total) * 100);
                Write-Host "PROGRESS: $percent";
                
                $targetFile = [System.IO.Path]::Combine($destPath, $entry.FullName);
                $targetDir = [System.IO.Path]::GetDirectoryName($targetFile);
                
                if (-not (Test-Path $targetDir)) {
                    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null;
                }
                
                if (-not [string]::IsNullOrEmpty($entry.Name)) {
                    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetFile, $true);
                }
            }
            $zip.Dispose();
        `;

        return new Promise((resolve, reject) => {
            const proc = spawn('powershell', ['-Command', psScript]);

            proc.stdout.on('data', (data) => {
                const output = data.toString();
                const match = output.match(/PROGRESS: (\d+)/);
                if (match && progressCallback) {
                    const percentage = parseInt(match[1]);
                    progressCallback({ status: 'installing', percentage });
                }
            });

            proc.stderr.on('data', (data) => {
                const msg = data.toString();
                warn(PROGRAM_ID, `Aviso PowerShell: ${msg}`);
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    if (progressCallback) progressCallback({ status: 'completed', percentage: 100 });
                    info(PROGRAM_ID, 'Extração concluída com sucesso.');
                    resolve('PostgreSQL extraído com sucesso!');
                } else {
                    const msg = `Erro na extração. Código: ${code}`;
                    logError(PROGRAM_ID, msg);
                    if (progressCallback) progressCallback({ status: 'error', error: `Código: ${code}` });
                    reject(new Error(msg));
                }
            });
        });
    }

    /**
     * Fluxo completo: baixa e instala o PostgreSQL com callback de progresso.
     */
    async downloadAndInstall(progressCallback) {
        try {
            const url = 'https://sbp.enterprisedb.com/getfile.jsp?fileid=1260117';
            const installersPath = path.join(getWritablePath(), 'installers');
            if (!fs.existsSync(installersPath)) {
                fs.mkdirSync(installersPath);
            }
            const installerPath = path.join(installersPath, 'postgresql-18.3-2-windows-x64-binaries.zip');

            info(PROGRAM_ID, 'Baixando instalador...');
            if (progressCallback) progressCallback({ status: 'downloading', percentage: 0 });
            await this.downloadWithAxios(url, installerPath, progressCallback);

            info(PROGRAM_ID, `Instalador baixado em: ${installerPath}. Iniciando instalação silenciosa...`);
            if (progressCallback) progressCallback({ status: 'installing', percentage: 0 });
            await this.installPostgres(installerPath, 'admin', progressCallback);

            info(PROGRAM_ID, 'Download e instalação do PostgreSQL concluídos com sucesso!');
        } catch (err) {
            if (err.name === 'AggregateError') {
                logError(PROGRAM_ID, `Erro no download/instalação (AggregateError): ${err.message}`);
                err.errors.forEach((e, i) => {
                    logError(PROGRAM_ID, `  Erro [${i}]: ${e.message || e}`);
                });
            } else {
                logError(PROGRAM_ID, `Erro no download/instalação: ${err.message || err}`);
            }
            if (progressCallback) progressCallback({ status: 'error', error: err.message });
            throw err;
        }
    }

    // ─── Backup e Restore ─────────────────────────────────────────────────────

    /**
     * Realiza o backup de um banco de dados específico.
     * @param {string} dbName - Nome do banco
     * @param {string} backupPath - Caminho onde o arquivo .sql será salvo
     * @param {string} user - Usuário admin
     * @param {string} password - Senha
     */
    async backupDatabase(dbName, backupPath, user = 'postgres', password = 'admin') {
        return new Promise((resolve, reject) => {
            try {
                const configs = getConfigs();
                const port = configs.port || 5432;
                const pgDumpPath = this.getBinaryPath('pg_dump');
                info(PROGRAM_ID, `Iniciando backup do banco ${dbName} na porta ${port} para ${backupPath}...`);

                // pg_dump não aceita senha por argumento direto por segurança
                // Usamos a variável de ambiente PGPASSWORD
                const env = this.getEnvWithBinPath({ PGPASSWORD: password });

                // No Windows, caminhos com espaços precisam de cuidado. 
                // Se usamos shell: true, o comando inteiro vai pro shell. 
                // O ideal é não usar shell se possível, ou citar corretamente.
                const args = [
                    '-U', user,
                    '-h', 'localhost',
                    '-p', port.toString(),
                    '-Fc',          // Formato custom: binário comprimido, restaurável via pg_restore
                    '--clean',
                    '--if-exists',
                    '-f', backupPath,
                    dbName
                ];

                const proc = spawn(`"${pgDumpPath}"`, args, { env, shell: true });

                let errorOutput = '';
                proc.stdout.on('data', (data) => logDetailed(PROGRAM_ID, `pg_dump stdout: ${data}`));
                proc.stderr.on('data', (data) => {
                    const msg = data.toString();
                    errorOutput += msg;
                    logDetailed(PROGRAM_ID, `pg_dump stderr: ${msg}`);
                });

                // Timeout de 2 minutos para backup
                const timeout = setTimeout(() => {
                    proc.kill();
                    reject(new Error('Timeout de 2 minutos excedido durante o backup.'));
                }, 120000);

                proc.on('close', (code) => {
                    clearTimeout(timeout);
                    if (code === 0) {
                        info(PROGRAM_ID, `Backup concluído com sucesso: ${backupPath}`);
                        resolve({ success: true, path: backupPath });
                    } else {
                        const msg = `Erro no backup. Código: ${code}. Saída: ${errorOutput}`;
                        logError(PROGRAM_ID, msg);
                        reject(new Error(msg));
                    }
                });

                proc.on('error', (err) => {
                    clearTimeout(timeout);
                    logError(PROGRAM_ID, `Erro ao iniciar pg_dump: ${err.message}`);
                    reject(err);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Restaura um banco de dados a partir de um backup .sql.
     * @param {string} dbName - Nome do banco (deve existir ou ser recriado)
     * @param {string} backupPath - Caminho do arquivo .sql
     * @param {string} user - Usuário admin
     * @param {string} password - Senha
     */
    async restoreDatabase(dbName, backupPath, user = 'postgres', password = 'admin') {
        return new Promise((resolve, reject) => {
            try {
                const configs = getConfigs();
                const port = configs.port || 5432;
                const psqlPath = this.getBinaryPath('psql');
                info(PROGRAM_ID, `Restaurando banco ${dbName} na porta ${port} a partir de ${backupPath}...`);

                const env = this.getEnvWithBinPath({ PGPASSWORD: password });

                const args = [
                    '-U', user,
                    '-h', 'localhost',
                    '-p', port.toString(),
                    '-d', dbName,
                    '-f', backupPath
                ];

                const proc = spawn(`"${psqlPath}"`, args, { env, shell: true });

                let errorOutput = '';
                proc.stdout.on('data', (data) => logDetailed(PROGRAM_ID, `psql stdout: ${data}`));
                proc.stderr.on('data', (data) => {
                    const msg = data.toString();
                    errorOutput += msg;
                    logDetailed(PROGRAM_ID, `psql stderr: ${msg}`);
                });

                proc.on('close', (code) => {
                    if (code === 0) {
                        info(PROGRAM_ID, `Restauração concluída com sucesso.`);
                        resolve({ success: true });
                    } else {
                        const msg = `Erro na restauração. Código: ${code}. Saída: ${errorOutput}`;
                        logError(PROGRAM_ID, msg);
                        reject(new Error(msg));
                    }
                });

                proc.on('error', (err) => {
                    logError(PROGRAM_ID, `Erro ao iniciar psql para restauração: ${err.message}`);
                    reject(err);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Restaura um banco de dados a partir de um arquivo binário (.backup ou custom).
     * @param {string} dbName - Nome do banco alvo
     * @param {string} backupPath - Caminho do arquivo de backup
     * @param {string} user - Usuário admin
     * @param {string} password - Senha
     */
    async restoreBinaryBackup(dbName, backupPath, user = 'postgres', password = 'admin') {
        return new Promise((resolve, reject) => {
            try {
                const configs = getConfigs();
                const port = configs.port || 5432;
                const pgRestorePath = this.getBinaryPath('pg_restore');
                info(PROGRAM_ID, `Restaurando backup binário em ${dbName} (porta ${port}) a partir de ${backupPath}...`);

                const env = this.getEnvWithBinPath({ PGPASSWORD: password });

                // pg_restore -U {user} -h localhost -p {port} -d {dbName} -v {backupPath}
                const args = [
                    '-U', user,
                    '-h', 'localhost',
                    '-p', port.toString(),
                    '-d', dbName,
                    '-v',
                    `"${backupPath}"`
                ];

                const proc = spawn(pgRestorePath, args, {
                    env,
                    shell: true,
                    windowsVerbatimArguments: true
                });

                let errorOutput = '';
                proc.stdout.on('data', (data) => logDetailed(PROGRAM_ID, `pg_restore stdout: ${data}`));
                proc.stderr.on('data', (data) => {
                    const msg = data.toString();
                    errorOutput += msg;
                    logDetailed(PROGRAM_ID, `pg_restore stderr: ${msg}`);
                });

                proc.on('close', (code) => {
                    if (code === 0) {
                        info(PROGRAM_ID, `Restauração binária concluída com sucesso.`);
                        resolve({ success: true });
                    } else {
                        const msg = `Erro na restauração binária (pg_restore). Código: ${code}. Saída: ${errorOutput}`;
                        logError(PROGRAM_ID, msg);
                        reject(new Error(msg));
                    }
                });

                proc.on('error', (err) => {
                    logError(PROGRAM_ID, `Erro ao iniciar pg_restore: ${err.message}`);
                    reject(err);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    async startPortable() {
        try {
            const configs = getConfigs();
            const port = configs.port || 5432;
            const pgDataPath = this.getDataPath();

            // Garante que o diretório de dados existe
            await this.initDatabaseDir();

            if (this.isPostgresRunning()) {
                info(PROGRAM_ID, 'PostgreSQL já está rodando.');
                return { success: true };
            }

            info(PROGRAM_ID, `Iniciando PostgreSQL na porta ${port} a partir de ${pgDataPath}...`);

            const logFile = path.join(getLogDir(), 'postgres_service.log');

            // pg_ctl start -D <dataPath> -l <logFile> -o "-p <port>"
            // Usamos -W (no wait) para não travar o processo principal.
            const args = ['start', '-W', '-D', pgDataPath, '-l', logFile, '-o', `"-p ${port}"`];
            await this.runPgCtlAsync(args);

            // Aguarda ficar pronto
            await this.waitForReady(15, 2000);

            info(PROGRAM_ID, 'PostgreSQL iniciado com sucesso.');
            return { success: true };
        } catch (e) {
            const msg = `Erro ao iniciar PostgreSQL: ${e.message}`;
            logError(PROGRAM_ID, msg);
            return { success: false, error: e.message };
        }
    }

    /**
     * Executa pg_ctl de forma assíncrona para evitar travar o processo principal.
     */
    async runPgCtlAsync(args) {
        return new Promise((resolve, reject) => {
            try {
                const pgBinPath = this.getBinaryPath('pg_ctl');
                info(PROGRAM_ID, `Executando pg_ctl com argumentos: ${args.join(' ')}`);

                const proc = spawn(`"${pgBinPath}"`, args, {
                    shell: true,
                    windowsVerbatimArguments: true,
                    env: this.getEnvWithBinPath()
                });

                let stdoutOutput = '';
                let stderrOutput = '';

                proc.stdout.on('data', (data) => {
                    const msg = data.toString();
                    stdoutOutput += msg;
                    logDetailed(PROGRAM_ID, `pg_ctl stdout: ${msg.trim()}`);
                });

                proc.stderr.on('data', (data) => {
                    const msg = data.toString();
                    stderrOutput += msg;
                    logDetailed(PROGRAM_ID, `pg_ctl stderr: ${msg.trim()}`);
                });

                proc.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        const errorMsg = stderrOutput || stdoutOutput || 'Sem saída de erro';
                        reject(new Error(`pg_ctl retornou erro (${code}): ${errorMsg}`));
                    }
                });

                proc.on('error', (err) => {
                    logError(PROGRAM_ID, `Erro ao spawnar pg_ctl: ${err.message}`);
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Desinstala a versão portável do PostgreSQL.
     * Para o serviço e deleta a pasta installers/pgsql.
     */
    async uninstallPostgres(progressCallback) {
        try {
            info(PROGRAM_ID, 'Iniciando desinstalação do PostgreSQL portável...');

            // 1. Para o postgres se estiver rodando
            if (this.isPostgresRunning()) {
                if (progressCallback) progressCallback({ status: 'uninstalling', percentage: 20, message: 'Parando serviço PostgreSQL...' });
                await this.stopPostgres();
            }

            // 2. Deleta a pasta de instalação
            const installPath = this.getInstallPath();
            if (fs.existsSync(installPath)) {
                info(PROGRAM_ID, `Deletando pasta do PostgreSQL: ${installPath}`);
                if (progressCallback) progressCallback({ status: 'uninstalling', percentage: 60, message: 'Removendo arquivos do PostgreSQL...' });

                // Tenta deletar várias vezes caso haja locks (comum no Windows)
                let deleted = false;
                for (let i = 0; i < 3; i++) {
                    try {
                        fs.rmSync(installPath, { recursive: true, force: true });
                        deleted = true;
                        break;
                    } catch (err) {
                        warn(PROGRAM_ID, `Falha ao deletar pasta (tentativa ${i + 1}): ${err.message}`);
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }

                if (!deleted) {
                    throw new Error('Não foi possível remover a pasta do PostgreSQL. O diretório pode estar em uso por outro programa.');
                }
            }

            // 3. Deleta o instalador .zip se existir
            const installerPath = path.join(getWritablePath(), 'installers', 'postgresql-18.3-2-windows-x64-binaries.zip');
            if (fs.existsSync(installerPath)) {
                fs.unlinkSync(installerPath);
            }

            info(PROGRAM_ID, 'PostgreSQL desinstalado com sucesso.');
            if (progressCallback) progressCallback({ status: 'completed', percentage: 100 });
            return { success: true };
        } catch (e) {
            logError(PROGRAM_ID, `Erro ao desinstalar PostgreSQL: ${e.message}`);
            return { success: false, error: e.message };
        }
    }
}

export default new PostgresController();
