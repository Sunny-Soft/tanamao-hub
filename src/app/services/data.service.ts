import { Injectable, signal, computed } from '@angular/core';
import { Program } from '../types/Program';
import { ProgramRegistryService } from './program-registry.service';
import { toObservable } from '@angular/core/rxjs-interop';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private _programs = signal<Program[]>([]);
  readonly programs = this._programs.asReadonly();

  constructor(
    private registry: ProgramRegistryService,
  ) {
    // Inicializa todos os handlers — cada um registra seus próprios listeners de progresso
    for (const handler of this.registry.handlers) {
      handler.init((id: string, status: Program['status'], progress?: number, message?: string) => {
        this.updateProgramStatus(id, status, progress, message);
      });
    }

    window.api.onUpdateAvailable((programId, data) => {
      this.updateProgramStatus(programId, 'installed', undefined, undefined, undefined, true);
    });

    this.loadPrograms();
  }

  // ─── Carregamento ─────────────────────────────────────────────────────────

  async loadPrograms() {
    try {
      const programs = await window.api.getPrograms();
      this._programs.set(programs);
      // checkStatuses() era redundante aqui pois getPrograms() já traz o status completo
    } catch (error) {
      console.error('[DataService] Falha ao carregar programas:', error);
    }
  }

  getPrograms() {
    return toObservable(this._programs);
  }

  /**
   * Atualiza o status de todos os programas com uma única chamada ao backend.
   */
  async checkStatuses() {
    try {
      const programs = await window.api.getPrograms();
      this._programs.set(programs);
    } catch (error) {
      console.error('[DataService] Erro ao atualizar status:', error);
    }
  }

  // ─── Ações genéricas ──────────────────────────────────────────────────────

  async searchPrograms(term: string) {
    if (!term.trim()) {
      await this.loadPrograms();
      return;
    }
    const filtered = this._programs().filter(p =>
      p.name.toLowerCase().includes(term.toLowerCase()) ||
      p.description.toLowerCase().includes(term.toLowerCase())
    );
    this._programs.set(filtered);
  }

  /**
   * Instala um programa e, em seguida, executa o setup pós-instalação.
   * Instala as dependências declaradas no Program primeiro.
   */
  async installProgram(id: string) {
    this.updateProgramStatus(id, 'downloading', 0);

    try {
      const program = this._programs().find(p => p.id === id);

      // Instala dependências primeiro
      // if (program?.dependencies?.length) {
      //   for (const depId of program.dependencies) {
      //     const depHandler = this.registry.getHandler(depId);
      //     if (!depHandler) continue;

      //     const depStatus = await depHandler.checkStatus();
      //     if (depStatus.status !== 'installed') {
      //       // Se o depId for postgresql ou postgis e o programa for tanamao-food,
      //       // o próprio controller do tanamao-food já vai lidar com isso.
      //       // Mas para garantir visibilidade no card da dependência, mantemos a chamada.
      //       // IMPORTANTE: Atualizamos o status do programa PAI também.
      //       this.updateProgramStatus(id, 'downloading', 0, `Instalando dependência: ${depId}...`);
            
      //       const depResult = await depHandler.install();
      //       if (!depResult.success) {
      //         console.error(`[DataService] Falha ao instalar dependência ${depId}:`, depResult.error);
      //         this.updateProgramStatus(id, 'error', undefined, `Falha na dependência: ${depId}`);
      //         return;
      //       }
      //     }
      //   }
      // }

      // Instala o programa principal
      const handler = this.registry.getHandler(id);
      if (!handler) {
        console.error(`[DataService] Nenhum handler encontrado para: ${id}`);
        this.updateProgramStatus(id, 'not-installed');
        return;
      }

      const result = await handler.install();
      if (!result.success) {
        console.error(`[DataService] Falha ao instalar ${id}:`, result.error);
        this.updateProgramStatus(id, 'not-installed', undefined, result.error);
        return;
      }

      // Setup pós-instalação (ex: configurar banco de dados)
      if (!(result as any).setupDone) {
        this.updateProgramStatus(id, 'installing', 0, 'Configurando...');
        await handler.setup();
      }

      this.updateProgramStatus(id, 'installed');
      await this.checkStatuses();
    } catch (error) {
      console.error(`[DataService] Erro ao instalar ${id}:`, error);
      this.updateProgramStatus(id, 'not-installed');
    }
  }

  /** Abre o programa pelo seu handler. */
  async openProgram(id: string) {
    const handler = this.registry.getHandler(id);
    if (handler) {
      await handler.open();
    } else {
      console.warn(`[DataService] Nenhum handler para abrir programa: ${id}`);
    }
  }

  /** Executa o setup de um programa já instalado (ex: reconfigurar banco). */
  async setupProgram(id: string) {
    const handler = this.registry.getHandler(id);
    if (!handler) {
      console.warn(`[DataService] Nenhum handler para setup do programa: ${id}`);
      return;
    }

    this.updateProgramStatus(id, 'installing', 0);
    try {
      const result = await handler.setup();
      if (result.success) {
        this.updateProgramStatus(id, 'installed');
        await this.checkStatuses();
      } else {
        console.error(`[DataService] Setup de ${id} falhou:`, result.error);
        this.updateProgramStatus(id, 'installed');
      }
    } catch (error) {
      console.error(`[DataService] Erro no setup de ${id}:`, error);
      this.updateProgramStatus(id, 'installed');
    }
  }

  async updateProgram(id: string) {
    const handler = this.registry.getHandler(id);
    if (!handler) return;

    this.updateProgramStatus(id, 'updating', 0);
    try {
      const result = await handler.update();
      if (result.success) {
        this.updateProgramStatus(id, 'installed');
        await this.checkStatuses();
      } else {
        this.updateProgramStatus(id, 'not-installed');
      }
    } catch (error) {
      this.updateProgramStatus(id, 'not-installed');
    }
  }

  async uninstallProgram(id: string) {
    const handler = this.registry.getHandler(id);
    if (!handler) return;

    if (!confirm(`Tem certeza que deseja desinstalar ${id}?`)) return;

    this.updateProgramStatus(id, 'uninstalling', 0, 'Desinstalando...');
    try {
      const result = await handler.uninstall();
      if (result.success) {
        this.updateProgramStatus(id, 'not-installed');
        await this.checkStatuses();
      } else {
        this.updateProgramStatus(id, 'installed', undefined, result.error);
      }
    } catch (error) {
      this.updateProgramStatus(id, 'installed');
    }
  }

  async toggleService(id: string) {
    const program = this._programs().find(p => p.id === id);
    if (!program || program.type !== 'service') return;

    const handler = this.registry.getHandler(id);
    if (!handler) return;

    try {
      if (!program.isRunning) {
        if (handler.start) {
          const result = await handler.start();
          if (result.success) {
            this.updateProgramStatus(id, program.status, undefined, undefined, true);
          }
        }
      } else {
        if (handler.stop) {
          const result = await handler.stop();
          if (result.success) {
            this.updateProgramStatus(id, program.status, undefined, undefined, false);
          }
        }
      }
    } catch (error) {
      console.error(`[DataService] Erro ao alternar serviço ${id}:`, error);
    }
  }

  // ─── Estado ───────────────────────────────────────────────────────────────

  updateProgramStatus(id: string, status: Program['status'], progress?: number, message?: string, isRunning?: boolean, hasUpdate?: boolean) {
    const currentList = this._programs();
    if (!currentList.find(p => p.id === id)) return;

    const updatedList = currentList.map(p =>
      p.id === id ? {
        ...p,
        status,
        progress,
        message,
        isRunning: isRunning !== undefined ? isRunning : p.isRunning,
        hasUpdate: hasUpdate !== undefined ? hasUpdate : p.hasUpdate
      } : p
    );
    this._programs.set(updatedList);
  }

  async getProgramConfig(id: string) {
    const handler = this.registry.getHandler(id);
    return handler ? await handler.config() : { success: false, error: 'Handler not found' };
  }

  async saveProgramConfig(id: string, config: any) {
    const handler = this.registry.getHandler(id);
    return handler ? await handler.configSave(config) : { success: false, error: 'Handler not found' };
  }

  async testConnection(id: string, config: any) {
    const handler = this.registry.getHandler(id) as any;
    if (handler && handler.testConnection) {
      return await handler.testConnection(config);
    }
    return { success: false, error: 'Funcionalidade não suportada para este programa.' };
  }


}
