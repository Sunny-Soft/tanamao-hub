import { Program } from '../../types/Program';
import { ProgramHandler } from '../../types/ProgramHandler';

export abstract class BaseHandler implements ProgramHandler {
    abstract readonly programId: string;

    init(onProgress: (id: string, status: Program['status'], progress?: number, message?: string) => void): void {
        const handleProgress = (data: any) => {
            const incomingStatus = data.status as string;
            const message = data.message;
            const percentage = data.percentage;

            if (incomingStatus === 'completed') return;
            if (data.error) return;

            // Mapeia status específicos ou mantém o original se compatível com Program['status']
            let mappedStatus: Program['status'] = 'downloading';
            
            if (['installing', 'updating', 'uninstalling', 'downloading', 'extracting', 'setup', 'checking', 'info'].includes(incomingStatus)) {
                if (incomingStatus === 'extracting') {
                    mappedStatus = 'installing';
                } else if (incomingStatus === 'checking') {
                    mappedStatus = 'downloading';
                } else if (incomingStatus === 'info') {
                    mappedStatus = 'installing'; // Info geralmente ocorre durante instalação/setup
                } else {
                    mappedStatus = incomingStatus as Program['status'];
                }
            }

            onProgress(this.programId, mappedStatus, percentage, message);
        };

        if (window.api?.onProgramProgress) {
            window.api.onProgramProgress((programId, data) => {
                if (programId === this.programId) {
                    handleProgress(data);
                }
            });
        }

        if (window.api?.onProgramConfigProgress) {
            window.api.onProgramConfigProgress((programId, data) => {
                if (programId === this.programId) {
                    // Config progress geralmente é mapeado para setup ou installing
                    onProgress(this.programId, 'installing', data.percentage, data.message || `Configurando: ${data.file || '...'}`);
                }
            });
        }
    }

    async checkStatus(): Promise<Partial<Program>> {
        const programs = await window.api.getPrograms();
        const program = programs.find(p => p.id === this.programId);
        return program || { status: 'not-installed' };
    }

    async install(): Promise<{ success: boolean; error?: string }> {
        return await window.api.programAction(this.programId, 'install');
    }

    async uninstall(): Promise<{ success: boolean; error?: string }> {
        return await window.api.programAction(this.programId, 'uninstall');
    }

    async open(): Promise<void> {
        return await window.api.programAction(this.programId, 'open');
    }

    async setup(): Promise<{ success: boolean; error?: string }> {
        return await window.api.programAction(this.programId, 'setup');
    }

    async update(): Promise<{ success: boolean; error?: string }> {
        return await window.api.programAction(this.programId, 'update');
    }

    async config(): Promise<{ success: boolean; config?: any }> {
        try {
            const config = await window.api.programConfigGet(this.programId);
            return { success: true, config };
        } catch (error: any) {
            return { success: false, config: {} };
        }
    }

    async configSave(config: any): Promise<{ success: boolean; error?: string }> {
        try {
            await window.api.programConfigSave(this.programId, config);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async start(): Promise<{ success: boolean; error?: string }> {
        return await window.api.programAction(this.programId, 'start');
    }

    async stop(): Promise<{ success: boolean; error?: string }> {
        return await window.api.programAction(this.programId, 'stop');
    }
}
