import { getConfigs, getWritablePath } from '../utils/config.js';
import PostgresController from '../programs/postgresql/controller.js';
import { info, warn, error } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = 'backup-service';
let intervalId = null;

class BackupService {
    start() {
        if (intervalId) return;

        info(PROGRAM_ID, 'Iniciando serviço de backup...');
        
        // Verifica a cada minuto
        intervalId = setInterval(() => this.checkAndRun(), 60 * 1000);
        
        // Também executa imediatamente no início
        this.checkAndRun();
    }

    stop() {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
            info(PROGRAM_ID, 'Serviço de backup parado.');
        }
    }

    async checkAndRun() {
        const configs = getConfigs();
        
        if (!configs.backup_enabled) {
            return;
        }

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

        // Se já foi feito backup hoje, pula
        if (configs.last_backup_date === dateStr) {
            return;
        }

        const currentDay = now.getDay(); // 0 (domingo) a 6 (sábado)
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        // Verifica se o dia atual está configurado
        if (!configs.backup_days || !configs.backup_days.includes(currentDay)) {
            return;
        }

        const [configHour, configMinute] = configs.backup_time.split(':').map(Number);
        
        // Verifica se é o horário configurado
        if (currentHour === configHour && currentMinute === configMinute) {
            await this.performBackup(configs, dateStr);
        }
    }

    async performBackup(configs, dateStr) {
        try {
            const backupsDir = configs.backup_path || path.join(getWritablePath(), 'backups');
            if (!fs.existsSync(backupsDir)) {
                fs.mkdirSync(backupsDir, { recursive: true });
            }

            const dbName = configs.database || 'tanamao';
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const dayName = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][new Date().getDay()];
            
            // Backup rotativo por dia da semana
            const filename = `${dbName}_${dayName}_backup.sql`;
            const backupPath = path.join(backupsDir, filename);

            info(PROGRAM_ID, `Iniciando backup automático de ${dbName} para ${backupPath}...`);
            
            await PostgresController.backupDatabase(
                dbName, 
                backupPath, 
                configs.user, 
                configs.password
            );

            // Salva a data do último backup para não repetir no mesmo dia
            import('../utils/config.js').then(({ saveConfigs }) => {
                saveConfigs({ last_backup_date: dateStr });
            });

            info(PROGRAM_ID, `Backup automático concluído com sucesso: ${filename}`);
        } catch (err) {
            error(PROGRAM_ID, `Falha no backup automático: ${err.message}`);
        }
    }
}

export default new BackupService();
