import { Program } from "./Program"

export { }

declare global {
    interface Window {
        api: {
            programAction: (programId: string, action: string, ...args: any[]) => Promise<any>
            getPrograms: () => Promise<Program[]>
            postgresInstall: () => Promise<{ success: boolean; error?: string }>
            postgresRunning: () => Promise<{ success: boolean; isRunning?: boolean }>
            postgresVersion: () => Promise<{ success: boolean; version?: string }>
            postgresStart: () => Promise<{ success: boolean; error?: string }>
            postgresStop: () => Promise<{ success: boolean; error?: string }>
            postgresUninstall: () => Promise<{ success: boolean; error?: string }>
            postgresTestConnection: (config: any) => Promise<{ success: boolean; error?: string }>
            onPostgresProgress: (callback: (progress: { status: string; percentage?: number; error?: string }) => void) => void
            tanamaoFoodOpen: () => Promise<void>
            tanamaoFoodIsInstalled: () => Promise<{ success: boolean; isInstalled?: boolean }>
            tanamaoFoodIsRunning: () => Promise<{ success: boolean; isRunning?: boolean }>
            tanamaoFoodInstall: (installDir?: string) => Promise<{ success: boolean; error?: string }>
            tanamaoFoodVersion: () => Promise<{ success: boolean; version?: string }>
            onTanamaoFoodProgress: (callback: (progress: { status: string; percentage?: number; error?: string }) => void) => void
            configsSave: (configs: any) => Promise<{ success: boolean; error?: string }>
            configsGet: () => Promise<{ success: boolean; configs?: any }>
            postgresSetup: () => Promise<{ success: boolean; error?: string }>
            onPostgresConfigProgress: (callback: (progress: { status: string; percentage?: number; error?: string }) => void) => void
            tanamaoFoodSetupDatabase: () => Promise<{ success: boolean; error?: string }>
            onTanamaoFoodConfigProgress: (callback: (progress: { status: string; percentage?: number; error?: string }) => void) => void
            tanamaoFoodUninstall: () => Promise<{ success: boolean; error?: string }>
            tanamaoFoodUpdate: (installDir?: string) => Promise<{ success: boolean; error?: string }>

            programConfigGet: (programId: string) => Promise<{ success: boolean; config?: any }>
            programConfigSave: (programId: string, config: any) => Promise<{ success: boolean; error?: string }>

            logsList: () => Promise<{ success: boolean; programs?: any[] }>
            logsGet: (programId: string) => Promise<{ success: boolean; content?: string }>
            logsClear: (programId: string) => Promise<{ success: boolean; error?: string }>
            logsWatch: (programId: string) => Promise<void>
            logsUnwatch: () => Promise<void>
            onLogsUpdate: (callback: (data: { programId: string; content: string }) => void) => void

            onUpdateAvailable: (callback: (programId: string, data: { current: string; latest: string }) => void) => void

            onProgramProgress: (callback: (programId: string, progress: { status: string; percentage?: number; error?: string; message?: string }) => void) => void
            onProgramConfigProgress: (callback: (programId: string, progress: { status: string; percentage?: number; error?: string; message?: string; file?: string }) => void) => void
        }
    }
}