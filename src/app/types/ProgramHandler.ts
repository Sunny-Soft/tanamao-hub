import { Program } from './Program';

/**
 * ProgramHandler
 * ==============
 * Contrato que cada programa deve implementar para ser gerenciado pelo DataService.
 *
 * Para adicionar um novo programa ao hub:
 * 1. Crie um serviço Angular implementando esta interface.
 * 2. Registre-o em `program-registry.service.ts`.
 */
export interface ProgramHandler {
    /** ID único do programa — deve bater com o retornado pelo backend */
    readonly programId: string;

    /**
     * Inicializa este handler: registra listeners de progresso no IPC.
     * Chamado uma vez pelo DataService no startup.
     * @param onProgress callback para notificar o DataService de um novo status/progresso
     */
    init(onProgress: (id: string, status: Program['status'], progress?: number, message?: string) => void): void;

    /**
     * Consulta o status atual do programa (instalado, rodando, versão).
     */
    checkStatus(): Promise<Partial<Program>>;

    /**
     * Instala o programa. Deve emitir progresso via o callback registrado em init().
     */
    install(): Promise<{ success: boolean; error?: string }>;

    /**
     * Abre o programa (se aplicável). Pode ser no-op para serviços.
     */
    open(): Promise<void>;

    /**
     * Executa o setup pós-instalação (ex: configurar banco de dados).
     * Pode ser no-op se não houver setup.
     */
    setup(): Promise<{ success: boolean; error?: string }>;

    /**
     * Atualiza o programa.
     */
    update(): Promise<{ success: boolean; error?: string }>;

    /**
     * Configura o programa.
     */
    config(): Promise<{ success: boolean; config?: any }>;

    /**
     * Salva a configuração do programa.
     */
    configSave(config: any): Promise<{ success: boolean; error?: string }>;

    /**
     * Desinstala o programa.
     */
    uninstall(): Promise<{ success: boolean; error?: string }>;
}
