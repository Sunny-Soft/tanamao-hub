export interface Program {
    id: string;
    name: string;
    version: string;
    description: string;
    icon: string;
    status: 'installed' | 'not-installed' | 'updating' | 'downloading' | 'installing' | 'setup' | 'error' | 'running' | 'stopped' | 'uninstalling';
    progress?: number;
    message?: string;
    hasUpdate: boolean;
    newVersion?: string;
    type: 'app' | 'service';
    isRunning?: boolean;
    dependencies?: string[];
}
