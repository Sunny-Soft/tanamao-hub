import { Injectable } from '@angular/core';
import { BaseHandler } from './base.handler';
import { Program } from '../../types/Program';

@Injectable({ providedIn: 'root' })
export class PostgresHandler extends BaseHandler {
    readonly programId = 'postgresql';

    override init(onProgress: (id: string, status: Program['status'], progress?: number, message?: string) => void): void {
        super.init(onProgress);
    }

    async testConnection(config: any): Promise<{ success: boolean; error?: string }> {
        try {
            return await window.api.postgresTestConnection(config);
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }
}
