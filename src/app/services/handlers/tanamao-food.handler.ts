import { Injectable } from '@angular/core';
import { Program } from '../../types/Program';
import { ProgramHandler } from '../../types/ProgramHandler';


/**
 * TanamaoFoodHandler
 * ==================
 * Implementa ProgramHandler para o Tanamao Food.
 * Responsável por: verificar status, instalar (com setup de banco), abrir o app.
 */
@Injectable({ providedIn: 'root' })
export class TanamaoFoodHandler implements ProgramHandler {
    readonly programId = 'tanamao-food';

    init(onProgress: (id: string, status: Program['status'], progress?: number, message?: string) => void): void {
        if (window.api?.onTanamaoFoodProgress) {
            window.api.onTanamaoFoodProgress((progress) => {
                if (progress.error) {
                    onProgress(this.programId, 'not-installed', undefined, progress.error);
                } else if (progress.status === 'completed') {
                    onProgress(this.programId, 'installed', 100);
                } else if (progress.status === 'installing') {
                    onProgress(this.programId, 'installing', progress.percentage, (progress as any).message);
                } else {
                    onProgress(this.programId, 'downloading', progress.percentage, (progress as any).message);
                }
            });
        }

        if (window.api?.onTanamaoFoodConfigProgress) {
            window.api.onTanamaoFoodConfigProgress((progress) => {
                if (progress.error) {
                    onProgress(this.programId, 'installed', undefined, progress.error);
                } else if (progress.status === 'completed') {
                    onProgress(this.programId, 'installed', 100, 'Configuração concluída!');
                } else if (progress.status === 'migrating') {
                    onProgress(this.programId, 'installing', progress.percentage, `Configurando banco: ${(progress as any).file || '...'}`);
                }
            });
        }
    }

    async checkStatus(): Promise<Partial<Program>> {
        const result: Partial<Program> = {};
        try {
            const installedResult = await window.api.tanamaoFoodIsInstalled();
            if (installedResult.success) {
                result.status = installedResult.isInstalled ? 'installed' : 'not-installed';
            }

            const runningResult = await window.api.tanamaoFoodIsRunning();
            if (runningResult.success) {
                result.isRunning = runningResult.isRunning;
            }

            const versionResult = await window.api.tanamaoFoodVersion();
            if (versionResult.success) {
                result.version = versionResult.version;
            }
        } catch (error) {
            console.error('[TanamaoFoodHandler] Erro ao verificar status:', error);
        }
        return result;
    }

    async install(): Promise<{ success: boolean; error?: string }> {
        try {
            console.log('[TanamaoFoodHandler] Chamando window.api.tanamaoFoodInstall...');
            const configResult = await window.api.configsGet();
            const installPath = configResult.success ? configResult.configs?.tanamao_food_path : undefined;
            const result = await window.api.tanamaoFoodInstall(installPath);
            console.log('[TanamaoFoodHandler] Resultado do IPC install:', result);
            return result;
        } catch (error: any) {
            console.error('[TanamaoFoodHandler] Erro na chamada install:', error);
            return { success: false, error: error.message };
        }
    }

    async open(): Promise<void> {
        try {
            await window.api.tanamaoFoodOpen();
        } catch (error) {
            console.error('[TanamaoFoodHandler] Erro ao abrir:', error);
        }
    }

    /** Setup pós-instalação: cria banco de dados e roda migrations */
    async setup(): Promise<{ success: boolean; error?: string }> {
        try {
            return await window.api.tanamaoFoodSetupDatabase();
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async update(): Promise<{ success: boolean; error?: string }> {
        try {
            const configResult = await window.api.configsGet();
            const installPath = configResult.success ? configResult.configs?.tanamao_food_path : undefined;
            const result = await window.api.tanamaoFoodUpdate(installPath);
            return result;
        } catch (error: any) {
            console.error('[TanamaoFoodHandler] Erro na chamada update:', error);
            return { success: false, error: error.message };
        }
    }

    async uninstall(): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await window.api.tanamaoFoodUninstall();
            return result;
        } catch (error: any) {
            console.error('[TanamaoFoodHandler] Erro na chamada uninstall:', error);
            return { success: false, error: error.message };
        }
    }

    async config(): Promise<{ success: boolean; config?: any, error?: string }> {
        try {
            const result = await window.api.programConfigGet(this.programId);
            return result;
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async configSave(config: any): Promise<{ success: boolean; error?: string }> {
        try {
            return await window.api.programConfigSave(this.programId, config);
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async testConnection(config: any): Promise<{ success: boolean; error?: string }> {
        try {
            return await window.api.postgresTestConnection(config);
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }
}
