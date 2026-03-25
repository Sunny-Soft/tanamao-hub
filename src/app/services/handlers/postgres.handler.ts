import { Injectable } from '@angular/core';
import { Program } from '../../types/Program';
import { ProgramHandler } from '../../types/ProgramHandler';


/**
 * PostgresHandler
 * ===============
 * Implementa ProgramHandler para o serviço PostgreSQL.
 * Responsável por: verificar status, instalar, iniciar serviço.
 */
@Injectable({ providedIn: 'root' })
export class PostgresHandler implements ProgramHandler {
    readonly programId = 'postgresql';

    init(onProgress: (id: string, status: Program['status'], progress?: number, message?: string) => void): void {
        if (window.api?.onPostgresProgress) {
            window.api.onPostgresProgress((progress) => {
                if (progress.error) {
                    onProgress(this.programId, 'not-installed');
                } else if (progress.status === 'completed') {
                    onProgress(this.programId, 'installed', 100);
                } else if (progress.status === 'installing') {
                    onProgress(this.programId, 'installing', progress.percentage);
                } else {
                    onProgress(this.programId, 'downloading', progress.percentage);
                }
            });
        }

        if (window.api?.onPostgresConfigProgress) {
            window.api.onPostgresConfigProgress((progress) => {
                if (progress.error) {
                    onProgress(this.programId, 'not-installed');
                } else if (progress.status === 'completed') {
                    onProgress(this.programId, 'installed', 100);
                } else if (progress.status === 'installing') {
                    onProgress(this.programId, 'installing', progress.percentage);
                } else {
                    onProgress(this.programId, 'downloading', progress.percentage);
                }
            });
        }
    }

    async checkStatus(): Promise<Partial<Program>> {
        const result: Partial<Program> = {};
        try {
            const versionResult = await window.api.postgresVersion();
            if (versionResult.success && versionResult.version) {
                result.version = versionResult.version;
                result.status = 'installed';
            } else {
                result.status = 'not-installed';
            }

            const runningResult = await window.api.postgresRunning();
            if (runningResult.success) {
                result.isRunning = runningResult.isRunning;
            }
        } catch (error) {
            console.error('[PostgresHandler] Erro ao verificar status:', error);
        }
        return result;
    }

    async install(): Promise<{ success: boolean; error?: string }> {
        // Verifica se já está instalado antes de instalar
        const status = await this.checkStatus();
        if (status.status === 'installed') {
            console.log('[PostgresHandler] PostgreSQL já está instalado.');
            return { success: true };
        }
        try {
            return await window.api.postgresInstall();
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async open(): Promise<void> {
        // PostgreSQL é um serviço — não tem UI para abrir
    }

    async update(): Promise<{ success: boolean; error?: string }> {
        // no op
        return { success: true };
    }

    async setup(): Promise<{ success: boolean; error?: string }> {
        try {
            return await window.api.postgresSetup();
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    /** Inicia o serviço Windows do PostgreSQL */
    async start(): Promise<{ success: boolean; error?: string }> {
        try {
            return await window.api.postgresStart();
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    /** Para o serviço Windows do PostgreSQL */
    async stop(): Promise<{ success: boolean; error?: string }> {
        try {
            return await window.api.postgresStop();
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async config(): Promise<{ success: boolean; config?: any, error?: string }> {
        // no op
        return { success: true };
    }

    async configSave(config: any): Promise<{ success: boolean; error?: string }> {
        // no op
        return { success: true };
    }

    async uninstall(): Promise<{ success: boolean; error?: string }> {
        try {
            return await window.api.postgresUninstall();
        } catch (error: any) {
            console.error('[PostgresHandler] Erro na chamada uninstall:', error);
            return { success: false, error: error.message };
        }
    }
}
