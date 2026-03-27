/**
 * Tanamao Food Controller
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Responsabilidades:
 *   - Detectar se o Tanamao Food está instalado e qual versão está rodando.
 *   - Baixar e instalar o aplicativo a partir do serviço de pacotes Sunny Soft.
 *   - Atualizar o aplicativo quando uma versão mais nova estiver disponível.
 *   - Abrir e encerrar o processo do aplicativo.
 *   - Executar o setup do banco de dados (migrations) após instalar/atualizar.
 *
 * ── Serviço de Pacotes ───────────────────────────────────────────────────
 *
 * Não requer token ou autenticação. Dois endpoints são usados:
 *
 *   1. Busca o ID do pacote mais recente:
 *      GET https://chamados.sunnysoft.com.br/packages/latest?id=90
 *      → Retorna um número inteiro. Ex: 331
 *
 *   2. Baixa o pacote (ZIP) com o instalador e os scripts SQL:
 *      GET https://chamados.sunnysoft.com.br/packages/{idAtual}/{idMaisRecente}
 *      → Retorna um .zip com:
 *          versoes/
 *            tanamao-dashboard.exe   ← instalador do app
 *            scripts/
 *              *.sql                 ← scripts de banco de dados (migrations)
 *
 *      Primeira instalação: idAtual == idMaisRecente (ex: 331/331)
 *      Atualização:         idAtual  = ID salvo na última instalação
 *                           idMaisRecente = ID retornado pelo endpoint acima
 *
 * ── Rastreamento de Versão ───────────────────────────────────────────────
 *
 * Após cada instalação/atualização bem-sucedida, o ID do pacote instalado
 * é salvo em configs.json como `installed_package_id` (número inteiro).
 * Isso permite que `updateFood()` saiba de qual versão partir ao pedir o delta.
 * 
 * 
 * @TODO: 
 * - Futuramente se ouver mais de um sistema, sera preciso salvar o package_id no banco de cada sistema ou no config.json de cada sistema
 * 
 *
 * ── Dependências ─────────────────────────────────────────────────────────
 *
 * O PostgreSQL e o PostGIS são instalados automaticamente antes do Tanamao Food
 * se ainda não estiverem presentes (veja `installFood`).
 */

import { execSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
    getConfigs,
    saveConfigs,
    PACKAGES_API,
    PACKAGE_ID,
    rootPath,
    getWritablePath,
    getMigrationsPath,
    writeExternalConfig
} from '../../utils/config.js';
import { info, warn, error as logError, getLogFile } from '../../utils/logger.js';
import { app } from 'electron';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { setupDatabase } from '../postgresql/db-setup.js';
import ProgramManager from '../program-manager.js';
import { notify } from '../../utils/notify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRAM_ID = 'tanamao-food';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────



/**
 * Baixa o pacote ZIP do servidor, com reporte de progresso.
 *
 * @param {number} fromId        - ID da versão atualmente instalada.
 * @param {number} toId          - ID da versão mais recente (destino).
 * @param {string} destZipPath   - Caminho completo onde o ZIP será salvo.
 * @param {Function} [onProgress] - Callback: ({ percentage: number })
 */
async function downloadPackage(fromId, toId, destZipPath, onProgress) {
    try {
        const url = `${PACKAGES_API}/${fromId}/${toId}`;
        info(PROGRAM_ID, `Baixando pacote: ${url} → ${destZipPath}`);

        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
        });

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        const writer = fs.createWriteStream(destZipPath);

        response.data.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0 && onProgress) {
                onProgress({ percentage: Math.round((downloadedBytes / totalBytes) * 100) });
            }
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', (err) => {
                fs.unlink(destZipPath, () => { }); // Remove arquivo corrompido
                reject(err);
            });
        });
    } catch (error) {
        logError(PROGRAM_ID, `Erro ao baixar pacote: ${error.message}`);
        throw error;
    }
}

/**
 * Extrai o pacote ZIP e organiza os arquivos nos destinos corretos.
 *
 * Estrutura esperada dentro do ZIP:
 *   versoes/
 *     *.exe              → copiado para getWritablePath() e retornado via exePath
 *     scripts/
 *       *.sql            → copiados para getMigrationsPath()
 *
 * @param {string} zipPath - Caminho para o arquivo ZIP baixado.
 * @param {Function} [onProgress] - Callback: ({ percentage: number, message: string })
 * @returns {{ exePath: string, sqlFiles: string[] }} Caminhos dos arquivos extraídos.
 */
function extractPackage(zipPath, onProgress) {
    info(PROGRAM_ID, `Extraindo pacote: ${zipPath}`);

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    const totalEntries = entries.length;

    const writableDir = getWritablePath();
    const migrationsDir = getMigrationsPath();

    if (!fs.existsSync(migrationsDir)) {
        fs.mkdirSync(migrationsDir, { recursive: true });
    }

    let exePath = null;
    const sqlFiles = [];
    let extractedCount = 0;

    for (const entry of entries) {
        extractedCount++;
        const entryName = entry.entryName.replace(/\\/g, '/'); // normaliza separadores
        const fileName = path.basename(entryName);

        if (onProgress) {
            onProgress({
                percentage: Math.round((extractedCount / totalEntries) * 100),
                message: `Extraindo ${fileName}...`
            });
        }

        // Ignora entradas de diretório
        if (entry.isDirectory) continue;

        // ── Instalador (.exe) ─────────────────────────────────────────────
        // Localizado em: versoes/<nome>.exe
        if (entryName.startsWith('versoes/') && fileName.toLowerCase().endsWith('.exe') && !entryName.includes('/scripts/')) {
            const dest = path.join(writableDir, fileName);
            fs.writeFileSync(dest, entry.getData());
            info(PROGRAM_ID, `Instalador extraído: ${dest}`);
            exePath = dest;
        }

        // ── Scripts SQL (migrations) ──────────────────────────────────────
        // Localizados em: versoes/scripts/<nome>.sql
        if (entryName.includes('/scripts/') && fileName.toLowerCase().endsWith('.sql')) {
            const dest = path.join(migrationsDir, fileName);
            fs.writeFileSync(dest, entry.getData());
            info(PROGRAM_ID, `Migration extraída: ${dest}`);
            sqlFiles.push(dest);
        }
    }

    if (!exePath) {
        throw new Error('Nenhum instalador .exe encontrado dentro do pacote ZIP.');
    }

    info(PROGRAM_ID, `Extração concluída. Instalador: ${exePath}, Migrations: ${sqlFiles.length} arquivo(s).`);
    return { exePath, sqlFiles };
}

// ─────────────────────────────────────────────────────────────────────────────
// Controller principal
// ─────────────────────────────────────────────────────────────────────────────

class TanamaoFoodController {
    constructor() {
        this.isBusy = false;
        this.currentBusyStatus = null;
    }

    // ── Detecção ──────────────────────────────────────────────────────────────

    /**
     * Busca o ID do pacote mais recente disponível no servidor.
     *
     * @returns {Promise<number>} ID numérico da versão mais recente. Ex: 331
     */
    async getLatestPackageId() {
        const url = `${PACKAGES_API}/latest?id=${PACKAGE_ID}`;
        info(PROGRAM_ID, `Buscando versão mais recente em: ${url}`);

        const response = await axios.get(url, { responseType: 'text' });
        const id = parseInt(response.data.trim(), 10);

        if (isNaN(id)) {
            throw new Error(`Resposta inesperada ao buscar versão: "${response.data}"`);
        }

        info(PROGRAM_ID, `Versão mais recente disponível: ID ${id}`);
        return id;
    }

    /**
     * Retorna o caminho do executável do Tanamao Food.
     * Usa o caminho da config ou o padrão em C:\Sunny\Tanamao.
     */
    getInstallPath() {
        const configs = getConfigs();
        if (configs && configs.tanamao_food_path) {
            if (!configs.tanamao_food_path.toLowerCase().endsWith('.exe')) {
                return path.join(configs.tanamao_food_path, 'Tanamao Food.exe');
            }
            return configs.tanamao_food_path;
        }
        return path.join('C:', 'Sunny', 'TanamaoFood', 'Tanamao Food.exe');
    }

    /**
     * Retorna o ID do pacote atualmente instalado (salvo em configs.json).
     * Retorna 0 se não houver nenhuma instalação registrada.
     */
    getInstalledPackageId() {
        const configs = getConfigs();
        return configs.installed_package_id || 0;
    }

    /**
     * Verifica se o executável do Tanamao Food existe no caminho esperado.
     */
    isFoodInstalled() {
        return fs.existsSync(this.getInstallPath());
    }

    /**
     * Verifica se o processo do Tanamao Food está rodando.
     */
    isFoodRunning() {
        try {
            const exeName = path.basename(this.getInstallPath());
            const stdout = execSync(`tasklist /FI "IMAGENAME eq ${exeName}" /NH`, { encoding: 'utf8' });
            return stdout.toLowerCase().includes(exeName.toLowerCase());
        } catch (e) {
            logError(PROGRAM_ID, `Erro ao verificar processo: ${e.message}`);
            return false;
        }
    }

    /**
     * Tenta encerrar o processo do Tanamao Food de forma robusta.
     * @returns {Promise<boolean>} True se o processo foi encerrado ou não estava rodando.
     */
    async terminateFoodProcess() {
        if (!this.isFoodRunning()) return true;

        const exeName = path.basename(this.getInstallPath());
        info(PROGRAM_ID, `Solicitando encerramento do processo (e sua árvore): ${exeName}`);

        try {
            // /F = Forçar, /IM = ImageName, /T = Tree (mata processos filhos)
            execSync(`taskkill /F /IM "${exeName}" /T`, { stdio: 'ignore' });
        } catch (e) {
            // Pode falhar se o processo já tiver fechado
        }

        // Aguarda até o processo sumir da lista (timeout de 5 segundos)
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (!this.isFoodRunning()) {
                info(PROGRAM_ID, `Processo ${exeName} encerrado.`);
                // Pequena pausa extra para o Windows liberar os handles de arquivo no FS
                await new Promise(resolve => setTimeout(resolve, 800));
                return true;
            }
        }

        warn(PROGRAM_ID, `Tempo esgotado ao aguardar encerramento de ${exeName}.`);
        return false;
    }

    /**
     * Lê a versão do Tanamao Food a partir do package.json do app instalado.
     * Suporta apps descompactados (resources/app) e compactados (resources/app.asar).
     */
    getFoodVersion() {
        // Se estiver ocupado instalando/atualizando, não tenta ler arquivos para evitar locks
        if (this.isBusy) return '...';

        try {
            const installPath = this.getInstallPath();
            if (!fs.existsSync(installPath)) return '0.0.0';

            const resourceDir = path.join(path.dirname(installPath), 'resources');

            const candidatos = [
                path.join(resourceDir, 'app', 'package.json'),
                path.join(resourceDir, 'app.asar', 'package.json'),
            ];

            for (const pkgPath of candidatos) {
                if (fs.existsSync(pkgPath)) {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                    return pkg.version;
                }
            }
        } catch (e) {
            logError(PROGRAM_ID, `Erro ao ler versão local: ${e.message}`);
        }
        return '0.0.0';
    }

    // ─── Interface Padrão ─────────────────────────────────────────────────────

    isInstalled() {
        return this.isFoodInstalled();
    }

    isRunning() {
        return this.isFoodRunning();
    }

    getVersion() {
        return this.getFoodVersion();
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

    async install(progressCallback, installDir = null) {
        return this.installFood(progressCallback, installDir);
    }

    async update(progressCallback) {
        return this.updateFood(progressCallback);
    }

    async uninstall(progressCallback) {
        return this.uninstallFood(progressCallback);
    }

    async open() {
        return this.openFood();
    }

    // ── Ações ─────────────────────────────────────────────────────────────────

    /**
     * Abre o Tanamao Food em processo separado (detached).
     */
    async openFood() {
        const installPath = this.getInstallPath();
        if (!fs.existsSync(installPath)) {
            warn(PROGRAM_ID, 'Tentativa de abrir o app, mas não está instalado.');
            return { success: false, error: 'Tanamao Food não está instalado.' };
        }

        try {
            // Configura a conexão e o log para que o Food use os mesmos dados do Hub
            const configs = getConfigs();
            const logPath = getLogFile(PROGRAM_ID);
            const foodUserData = path.join(app.getPath('appData'), 'tanamao-food');

            info(PROGRAM_ID, `Sincronizando configurações em ${foodUserData}`);
            writeExternalConfig(foodUserData, {
                log_path: logPath,
                db: {
                    host: configs.host,
                    port: configs.port,
                    user: configs.user,
                    password: configs.password,
                    database: configs.database
                }
            });

            info(PROGRAM_ID, `Abrindo app: ${installPath}`);
            spawn(`"${installPath}"`, [], { detached: true, stdio: 'ignore', shell: true }).unref();
            return { success: true };
        } catch (e) {
            logError(PROGRAM_ID, `Erro ao abrir app: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    // ── Instalação ────────────────────────────────────────────────────────────

    /**
     * Instala o Tanamao Food do início.
     *
     * Fluxo:
     *   1. Instala dependências (PostgreSQL, PostGIS) se necessário.
     *   2. Busca o ID do pacote mais recente no servidor.
     *   3. Baixa o pacote ZIP (fromId == toId na primeira instalação).
     *   4. Extrai o instalador e os scripts SQL.
     *   5. Executa o instalador silenciosamente.
     *   6. Salva o `installed_package_id` em configs.json.
     *   7. Executa o setup do banco de dados (cria DB e roda migrations).
     *
     * @param {Function} [progressCallback] - Callback de progresso chamado com { status, message, percentage }
     * @param {string|null} [installDir]    - Diretório de instalação personalizado (opcional)
     */
    async installFood(progressCallback, installDir = null) {
        if (this.isBusy) {
            throw new Error('Uma operação já está em andamento para o Tanamao Food.');
        }

        this.isBusy = true;
        this.currentBusyStatus = 'installing';

        let currentStep = 0;
        let totalSteps = 1;

        const cb = (data) => { if (progressCallback) progressCallback(data); };

        /** Helper para injetar o prefixo de passos na mensagem */
        const updateProgress = (data) => {
            const stepPrefix = totalSteps > 1 ? `[${currentStep}/${totalSteps}] ` : '';
            const message = data.message ? `${stepPrefix}${data.message}` : data.message;
            cb({ ...data, message });
        };

        try {
            info(PROGRAM_ID, '──── Iniciando instalação do Tanamao Food ────');
            notify('Tanamao Hub', 'Iniciando instalação do Tanamao Food...');

            // ── Cálculo de Passos ───────────────────────────────────────────
            const steps = [];
            const postgresController = ProgramManager.getController('postgresql');
            const postgisController = ProgramManager.getController('postgis');

            if (postgresController && !postgresController.isInstalled()) steps.push('PostgreSQL');
            if (postgisController && !postgisController.isInstalled()) steps.push('PostGIS');
            steps.push('Tanamao Food');

            totalSteps = steps.length;

            // ── Passo: PostgreSQL ────────────────────────────────────────────

            if (postgresController && !postgresController.isInstalled()) {
                currentStep++;
                info(PROGRAM_ID, 'PostgreSQL não encontrado. Instalando dependência...');
                updateProgress({ status: 'info', message: 'Instalando PostgreSQL (dependência)...' });
                await postgresController.install((p) =>
                    updateProgress({ ...p, app: 'postgresql', message: p.message || `PostgreSQL: ${p.status}...` })
                );
            }

            // ── Passo: PostGIS ───────────────────────────────────────────────

            if (postgisController && !postgisController.isInstalled()) {
                currentStep++;
                info(PROGRAM_ID, 'PostGIS não encontrado. Instalando dependência...');
                updateProgress({ status: 'info', message: 'Instalando PostGIS (dependência)...' });
                await postgisController.install((p) =>
                    updateProgress({ ...p, app: 'postgis', message: p.message || `PostGIS: ${p.status}...` })
                );
            }

            currentStep++; // O próprio Tanamao Food (Download, Install, DB)

            // Inicia o PostgreSQL em background (fire-and-forget)
            // A instalação prossegue e só aguardará o banco no momento das migrations.
            if (postgresController) {
                postgresController.start().catch(err => {
                    warn(PROGRAM_ID, `Erro ao tentar iniciar PostgreSQL em background: ${err.message}`);
                });
            }

            // ── Passo: Buscar versão disponível ─────────────────────────────

            updateProgress({ status: 'checking', message: 'Buscando versão mais recente...' });
            let latestId;
            try {
                latestId = await this.getLatestPackageId();
            } catch (err) {
                throw new Error(`Erro ao consultar servidor de pacotes: ${err.message}`);
            }

            // ── Passo: Baixar o pacote ──────────────────────────────────────
            // Na primeira instalação, fromId == toId (baixa o pacote completo)

            const zipPath = path.join(getWritablePath(), `tanamao-food-${latestId}.zip`);
            updateProgress({ status: 'downloading', message: `Baixando Tanamao Food (pacote ${latestId})...` });

            try {
                await downloadPackage(latestId, latestId, zipPath, ({ percentage }) => {
                    updateProgress({ status: 'downloading', percentage, message: `Baixando... ${percentage}%` });
                });
            } catch (err) {
                throw new Error(`Erro ao baixar pacote: ${err.message}`);
            }

            // ── Passo: Extrair ──────────────────────────────────────────────

            updateProgress({ status: 'extracting', message: 'Extraindo pacote...' });
            let exePath, sqlFiles;
            try {
                ({ exePath, sqlFiles } = extractPackage(zipPath, (p) => {
                    updateProgress({ status: 'extracting', ...p });
                }));
            } finally {
                // Sempre remove o ZIP, mesmo em caso de erro
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
            }

            // ── Passo: Executar instalador ──────────────────────────────────

            updateProgress({ status: 'installing', percentage: 0, message: 'Instalando Tanamao Food...' });

            const installerArgs = ['/S'];
            if (installDir) installerArgs.push(`/D=${installDir}`);

            info(PROGRAM_ID, `Executando instalador: "${exePath}" ${installerArgs.join(' ')}`);

            await new Promise((resolve, reject) => {
                const proc = spawn(`"${exePath}"`, installerArgs, {
                    shell: true,
                    windowsVerbatimArguments: true,
                });

                // Simula progresso da instalação visto que o instalador é silencioso (/S)
                let simulatedPercent = 0;
                const interval = setInterval(() => {
                    simulatedPercent += (100 - simulatedPercent) * 0.1; // cresce de forma assintótica
                    if (simulatedPercent > 95) simulatedPercent = 95;
                    updateProgress({ status: 'installing', percentage: Math.round(simulatedPercent), message: `Instalando arquivos do app... ${Math.round(simulatedPercent)}%` });
                }, 2000);

                proc.on('close', (code) => {
                    clearInterval(interval);
                    if (code === 0) {
                        info(PROGRAM_ID, 'Instalador concluído com sucesso.');
                        resolve();
                    } else {
                        reject(new Error(`Instalador finalizado com código de erro: ${code}`));
                    }
                });

                proc.on('error', (err) => {
                    clearInterval(interval);
                    reject(new Error(`Falha ao iniciar o instalador: ${err.message}`));
                });
            });

            // Remove o instalador após uso
            if (fs.existsSync(exePath)) fs.unlinkSync(exePath);

            // ── Passo 6: Salvar versão instalada ──────────────────────────────

            if (installDir) {
                saveConfigs({ tanamao_food_path: installDir, installed_package_id: latestId });
            } else {
                saveConfigs({ installed_package_id: latestId });
            }
            info(PROGRAM_ID, `Pacote instalado registrado: ID ${latestId}`);

            // Verifica se o executável realmente foi criado pelo instalador
            if (!this.isFoodInstalled()) {
                const msg = `Executável não encontrado em "${this.getInstallPath()}" após instalação.`;
                logError(PROGRAM_ID, msg);
                cb({ status: 'error', error: msg });
                return { success: false, error: msg };
            }

            // Sincroniza configurações de banco e log_path para que o Food use os mesmos dados do Hub
            try {
                const configs = getConfigs();
                const logPath = getLogFile(PROGRAM_ID);
                const foodUserData = path.join(app.getPath('appData'), 'tanamao-food');

                writeExternalConfig(foodUserData, {
                    db: {
                        log_path: logPath,
                        host: configs.host,
                        port: configs.port,
                        user: configs.user,
                        password: configs.password,
                        database: configs.database
                    }
                });
            } catch (logErr) {
                warn(PROGRAM_ID, `Não foi possível sincronizar configurações: ${logErr.message}`);
            }

            // ── Passo: Setup do banco de dados ──────────────────────────────

            updateProgress({ status: 'info', message: 'Configurando banco de dados...' });
            try {
                const configs = getConfigs();
                const migrationsDir = getMigrationsPath();

                // Inclui as migrations recém-baixadas + quaisquer existentes, em ordem
                const allSqlFiles = fs.existsSync(migrationsDir)
                    ? fs.readdirSync(migrationsDir)
                        .filter(f => f.endsWith('.sql'))
                        .sort()
                        .map(f => path.join(migrationsDir, f))
                    : [];

                info(PROGRAM_ID, `Executando ${allSqlFiles.length} migration(s) no banco "${configs.database}"...`);

                // Busca por arquivo de template .backup em C:\Sunny\Tanamao Food\resources\db-template
                let templatePath = null;
                const templateDir = path.join(configs.tanamao_food_path, 'resources', 'db-template');
                if (fs.existsSync(templateDir)) {
                    const files = fs.readdirSync(templateDir);
                    const backupFile = files.find(f => f.toLowerCase().endsWith('.backup'));
                    if (backupFile) {
                        templatePath = path.join(templateDir, backupFile);
                        info(PROGRAM_ID, `Template de banco encontrado: ${templatePath}`);
                    }
                } else {
                    warn(PROGRAM_ID, `Template de banco não encontrado em: ${templateDir}`);
                }

                await setupDatabase(
                    configs.database,
                    configs.user,
                    configs.password,
                    allSqlFiles,
                    (p) => updateProgress({ ...p, message: `Banco: ${p.status}...` }),
                    templatePath,
                    'tanamao-food'
                );

                info(PROGRAM_ID, 'Setup do banco de dados concluído.');
            } catch (dbErr) {
                // Não cancela o retorno de sucesso — app está instalado, banco pode ser reconfigurado
                logError(PROGRAM_ID, `Erro no setup do banco: ${dbErr.message}`);
            }

            updateProgress({ status: 'completed', percentage: 100, message: 'Instalação concluída!' });
            info(PROGRAM_ID, '──── Instalação do Tanamao Food concluída ────');
            notify('Tanamao Hub', 'Instalação do Tanamao Food concluída com sucesso!');
            return { success: true, setupDone: true };

        } catch (e) {
            logError(PROGRAM_ID, `Erro no processo de instalação: ${e.message}`);
            updateProgress({ status: 'error', error: e.message });
            return { success: false, error: e.message };
        } finally {
            this.isBusy = false;
            this.currentBusyStatus = null;
        }
    }

    // ── Atualização ───────────────────────────────────────────────────────────

    /**
     * Verifica se há uma versão mais nova disponível e, se houver, atualiza o app.
     *
     * Fluxo:
     *   1. Lê o `installed_package_id` do configs.json.
     *   2. Consulta o ID mais recente no servidor.
     *   3. Se iguais → já está atualizado, encerra.
     *   4. Encerra o processo do Food se estiver rodando.
     *   5. Baixa o pacote delta (de currentId até latestId).
     *   6. Extrai o instalador e as novas migrations.
     *   7. Executa o instalador silenciosamente.
     *   8. Roda apenas as migrations novas.
     *   9. Atualiza o `installed_package_id` em configs.json.
     *
     * @param {Function} [progressCallback] - Callback de progresso
     */
    async updateFood(progressCallback) {
        if (this.isBusy) {
            throw new Error('Uma operação já está em andamento para o Tanamao Food.');
        }

        this.isBusy = true;
        this.currentBusyStatus = 'updating';

        const cb = (data) => { if (progressCallback) progressCallback(data); };

        let currentStep = 0;
        let totalSteps = 6; // Checking, Terminating, Downloading, Extracting, Installing, Migrating

        /** Helper para injetar o prefixo de passos na mensagem */
        const updateProgress = (data) => {
            const stepPrefix = totalSteps > 1 ? `[${currentStep}/${totalSteps}] ` : '';
            const message = data.message ? `${stepPrefix}${data.message}` : data.message;
            cb({ ...data, message });
        };

        try {
            info(PROGRAM_ID, '──── Verificando atualização do Tanamao Food ────');

            // ── Passo 1: Comparar versões ─────────────────────────────────
            currentStep++;
            const currentId = this.getInstalledPackageId();
            updateProgress({ status: 'checking', message: 'Verificando versão disponível...' });

            let latestId;
            try {
                latestId = await this.getLatestPackageId();
            } catch (err) {
                throw new Error(`Erro ao consultar servidor de pacotes: ${err.message}`);
            }

            if (currentId >= latestId) {
                info(PROGRAM_ID, `Tanamao Food já está atualizado (ID instalado: ${currentId}).`);
                return { success: true, message: 'Já atualizado.' };
            }

            info(PROGRAM_ID, `Nova versão disponível: ${currentId} → ${latestId}. Iniciando atualização...`);

            // ── Passo 2: Encerrar processo se estiver rodando ──────────────────
            currentStep++;
            updateProgress({ status: 'info', message: 'Encerrando o aplicativo para atualizar...' });
            await this.terminateFoodProcess();

            // ── Passo 3: Baixar pacote delta ───────────────────────────────────
            currentStep++;
            const zipPath = path.join(getWritablePath(), `tanamao-food-${currentId}-${latestId}.zip`);
            updateProgress({ status: 'downloading', message: `Baixando atualização (${currentId} → ${latestId})...` });

            try {
                await downloadPackage(currentId, latestId, zipPath, ({ percentage }) => {
                    updateProgress({ status: 'downloading', percentage, message: `Baixando... ${percentage}%` });
                });
            } catch (err) {
                throw new Error(`Erro ao baixar pacote de atualização: ${err.message}`);
            }

            // ── Passo 4: Extrair ───────────────────────────────────────────────
            currentStep++;
            updateProgress({ status: 'extracting', message: 'Extraindo atualização...' });
            let exePath, sqlFiles;
            try {
                ({ exePath, sqlFiles } = extractPackage(zipPath, (p) => {
                    updateProgress({ status: 'extracting', ...p });
                }));
            } finally {
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
            }

            // ── Passo 5: Executar instalador ───────────────────────────────────
            currentStep++;
            updateProgress({ status: 'installing', percentage: 0, message: 'Instalando atualização...' });
            info(PROGRAM_ID, `Executando instalador de atualização: "${exePath}"`);

            await new Promise((resolve, reject) => {
                const proc = spawn(`"${exePath}"`, ['/S'], {
                    shell: true,
                    windowsVerbatimArguments: true,
                });

                // Simula progresso da atualização
                let simulatedPercent = 0;
                const interval = setInterval(() => {
                    simulatedPercent += (100 - simulatedPercent) * 0.1;
                    if (simulatedPercent > 95) simulatedPercent = 95;
                    updateProgress({ status: 'installing', percentage: Math.round(simulatedPercent), message: `Aplicando atualização... ${Math.round(simulatedPercent)}%` });
                }, 2000);

                proc.on('close', (code) => {
                    clearInterval(interval);
                    if (code === 0) resolve();
                    else reject(new Error(`Instalador finalizado com código de erro: ${code}`));
                });

                proc.on('error', (err) => {
                    clearInterval(interval);
                    reject(new Error(`Falha ao iniciar o instalador: ${err.message}`));
                });
            });

            if (fs.existsSync(exePath)) fs.unlinkSync(exePath);

            // ── Passo 6: Rodar novas migrations ───────────────────────────────
            currentStep++;
            if (sqlFiles && sqlFiles.length > 0) {
                updateProgress({ status: 'info', message: `Aplicando ${sqlFiles.length} migration(s) nova(s)...` });
                try {
                    const configs = getConfigs();
                    await setupDatabase(
                        configs.database,
                        configs.user,
                        configs.password,
                        sqlFiles.sort(), // garante ordem de execução
                        (p) => updateProgress({ ...p, message: `Banco: ${p.status}...` }),
                        null,
                        'tanamao-food'
                    );
                    info(PROGRAM_ID, 'Migrations da atualização aplicadas com sucesso.');
                } catch (dbErr) {
                    logError(PROGRAM_ID, `Erro ao aplicar migrations: ${dbErr.message}`);
                }
            } else {
                updateProgress({ status: 'info', message: 'Nenhuma migration nova encontrada.' });
            }

            // ── Finalização: Salvar nova versão instalada ──────────────────────────

            saveConfigs({ installed_package_id: latestId });
            info(PROGRAM_ID, `Versão instalada atualizada para ID ${latestId}.`);

            updateProgress({ status: 'completed', percentage: 100, message: 'Atualização concluída!' });
            info(PROGRAM_ID, '──── Atualização do Tanamao Food concluída ────');
            notify('Tanamao Hub', `Atualização para a versão ${latestId} concluída com sucesso!`);
            return { success: true };

        } catch (e) {
            logError(PROGRAM_ID, `Erro durante atualização: ${e.message}`);
            cb({ status: 'error', error: e.message });
            return { success: false, error: e.message };
        } finally {
            this.isBusy = false;
            this.currentBusyStatus = null;
        }
    }

    // ── Desinstalação ─────────────────────────────────────────────────────────

    /**
     * Desinstala o Tanamao Food usando o desinstalador nativo (NSIS).
     * Se o desinstalador não for encontrado, remove a pasta manualmente.
     *
     * @param {Function} [progressCallback]
     */
    async uninstallFood(progressCallback) {
        if (this.isBusy) {
            throw new Error('Uma operação já está em andamento para o Tanamao Food.');
        }

        this.isBusy = true;
        this.currentBusyStatus = 'uninstalling';

        const cb = (data) => { if (progressCallback) progressCallback(data); };

        try {
            info(PROGRAM_ID, '──── Iniciando desinstalação do Tanamao Food ────');

            // Encerra o processo se estiver rodando
            cb({ status: 'info', message: 'Encerrando o aplicativo...' });
            await this.terminateFoodProcess();

            const installDir = path.dirname(this.getInstallPath());
            if (!fs.existsSync(installDir)) {
                info(PROGRAM_ID, 'Pasta de instalação não encontrada. Já desinstalado.');
                return { success: true, message: 'Já desinstalado.' };
            }

            // Localiza o desinstalador NSIS
            const files = fs.readdirSync(installDir);
            const uninstallerName = files.find(
                f => f.toLowerCase().startsWith('uninstall') && f.toLowerCase().endsWith('.exe')
            );

            if (!uninstallerName) {
                warn(PROGRAM_ID, 'Desinstalador não encontrado. Removendo pasta manualmente...');
                fs.rmSync(installDir, { recursive: true, force: true });
                saveConfigs({ installed_package_id: 0 });
                return { success: true };
            }

            const uninstallerPath = path.join(installDir, uninstallerName);
            info(PROGRAM_ID, `Executando desinstalador: ${uninstallerPath}`);
            cb({ status: 'uninstalling', percentage: 50, message: 'Executando desinstalador...' });

            await new Promise((resolve, reject) => {
                const proc = spawn(`"${uninstallerPath}"`, ['/S'], {
                    shell: true,
                    windowsVerbatimArguments: true,
                });

                proc.on('close', (code) => {
                    if (code === 0 || code === null) {
                        info(PROGRAM_ID, 'Desinstalação concluída com sucesso.');
                        // Zera o ID para que o auto-update não tente reinstalar
                        saveConfigs({ installed_package_id: 0 });
                        cb({ status: 'completed', percentage: 100 });
                        resolve({ success: true });
                    } else {
                        const msg = `Desinstalador finalizou com código: ${code}`;
                        logError(PROGRAM_ID, msg);
                        reject(new Error(msg));
                    }
                });

                proc.on('error', (err) => {
                    logError(PROGRAM_ID, `Erro ao iniciar desinstalador: ${err.message}`);
                    reject(err);
                });
            });

            return { success: true };

        } catch (e) {
            logError(PROGRAM_ID, `Erro no processo de desinstalação: ${e.message}`);
            cb({ status: 'error', error: e.message });
            return { success: false, error: e.message };
        } finally {
            this.isBusy = false;
            this.currentBusyStatus = null;
        }
    }
}

export default new TanamaoFoodController();