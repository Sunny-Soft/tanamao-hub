import { Injectable } from '@angular/core';
import { BaseHandler } from './base.handler';
import { Program } from '../../types/Program';

@Injectable({ providedIn: 'root' })
export class TanamaoFoodHandler extends BaseHandler {
    readonly programId = 'tanamao-food';

    override init(onProgress: (id: string, status: Program['status'], progress?: number, message?: string) => void): void {
        super.init(onProgress);
    }

    override async install(): Promise<{ success: boolean; error?: string }> {
        try {
            const configResult = await window.api.configsGet();
            const installPath = configResult.success ? configResult.configs?.tanamao_food_path : undefined;
            return await window.api.programAction(this.programId, 'install', installPath);
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    override async update(): Promise<{ success: boolean; error?: string }> {
        try {
            return await window.api.programAction(this.programId, 'update');
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async testConnection(config: any): Promise<{ success: boolean; error?: string }> {
        try {
            return await window.api.programAction('postgresql', 'testConnection', config);
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }
}
