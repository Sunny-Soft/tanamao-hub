/**
 * Update Service — Tanamao Hub
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Verifica automaticamente se há atualizações para o Tanamao Food.
 *
 * Comportamento:
 *   - Ao ser iniciado (`start()`), agenda uma verificação a cada 1 hora.
 *   - A verificação só roda se `auto_update: true` estiver em configs.json.
 *   - O Food só é atualizado se houver um pacote mais recente disponível
 *     (comparado via `installed_package_id` salvo no configs.json).
 *
 * Ver também:
 *   - programs/tanamao-food/controller.js → lógica de download e instalação
 *   - utils/config.js                     → constantes do serviço de pacotes
 */

import { getConfigs } from '../utils/config.js';
import TanamaoFoodController from '../programs/tanamao-food/controller.js';
import { info, error as logError } from '../utils/logger.js';
import { BrowserWindow } from 'electron';
import { notify } from '../utils/notify.js';

const PROGRAM_ID = 'update-service';

class UpdateService {
    constructor() {
        /** @type {NodeJS.Timeout | null} */
        this.interval = null;
    }

    /**
     * Inicia o serviço de verificação periódica de atualizações.
     * Só tem efeito se o Tanamao Food já estiver instalado.
     */
    start() {
        if (this.interval) return; // já está rodando
        if (!TanamaoFoodController.isFoodInstalled()) return;

        info(PROGRAM_ID, 'Serviço de atualização automática iniciado (intervalo: 1h).');

        // Verifica após 5 segundos para garantir que a janela e o front estejam prontos
        setTimeout(() => this.checkUpdates(), 5000);

        // Agenda verificações a cada 1 hora
        this.interval = setInterval(() => this.checkUpdates(), 60 * 60 * 1000);
    }

    /**
     * Para o serviço de atualização automática.
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            info(PROGRAM_ID, 'Serviço de atualização automática parado.');
        }
    }

    /**
     * Consulta o servidor de pacotes e atualiza o Tanamao Food se necessário.
     * Só executa se `auto_update: true` estiver em configs.json.
     */
    async checkUpdates() {
        const configs = getConfigs();

        if (!configs.auto_update) return;

        // Não tenta atualizar se o app não estiver instalado
        // (ex: após uma desinstalação, o intervalo ainda pode estar ativo)
        if (!TanamaoFoodController.isFoodInstalled()) {
            info(PROGRAM_ID, 'Tanamao Food não está instalado. Pulando verificação de atualização.');
            return;
        }

        try {
            info(PROGRAM_ID, 'Verificando atualizações para o Tanamao Food...');

            const latest = await TanamaoFoodController.getLatestPackageId();
            const current = configs.installed_package_id;

            if (latest > current) {
                info(PROGRAM_ID, 'Atualização disponível...');

                notify('Tanamao Hub', `Nova versão do Tanamao Food disponível (v${latest}).`);

                const [win] = BrowserWindow.getAllWindows();
                if (win) {
                    win.webContents.send('update:available', 'tanamao-food', {
                        current: current,
                        latest: latest
                    });
                }
            } else {
                info(PROGRAM_ID, 'Tanamao Food já está atualizado.');
            }
        } catch (err) {
            logError(PROGRAM_ID, `Erro na verificação automática de atualizações: ${err.message}`);
        }
    }
}

export default new UpdateService();
