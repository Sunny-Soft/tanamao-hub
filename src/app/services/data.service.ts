import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Program } from '../types/Program';
import { PostgresHandler } from './handlers/postgres.handler';
import { ProgramRegistryService } from './program-registry.service';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private allPrograms: Program[] = [];
  private programsSubject = new BehaviorSubject<Program[]>([]);

  constructor(
    private registry: ProgramRegistryService,
    private postgresHandler: PostgresHandler,
  ) {
    // Inicializa todos os handlers — cada um registra seus próprios listeners de progresso
    for (const handler of this.registry.handlers) {
      handler.init((id, status, progress, message) => {
        this.updateProgramStatus(id, status, progress, message);
      });
    }

    this.loadPrograms();
  }

  // ─── Carregamento ─────────────────────────────────────────────────────────

  async loadPrograms() {
    try {
      this.allPrograms = await window.api.getPrograms();
      this.programsSubject.next(this.allPrograms);
      await this.checkStatuses();
    } catch (error) {
      console.error('[DataService] Falha ao carregar programas:', error);
    }
  }

  /**
   * Atualiza o status de cada programa consultando seu handler.
   * Nenhum conhecimento específico de programa aqui.
   */
  async checkStatuses() {
    for (const handler of this.registry.handlers) {
      const dynamicStatus = await handler.checkStatus();
      this.allPrograms = this.allPrograms.map(p =>
        p.id === handler.programId
          ? { ...p, ...dynamicStatus }
          : p
      );
    }
    this.programsSubject.next(this.allPrograms);
  }

  // ─── Observable público ───────────────────────────────────────────────────

  getPrograms(): Observable<Program[]> {
    return this.programsSubject.asObservable();
  }

  // ─── Ações genéricas ──────────────────────────────────────────────────────

  async searchPrograms(term: string) {
    if (!term.trim()) {
      this.programsSubject.next(this.allPrograms);
      return;
    }
    const filtered = this.allPrograms.filter(p =>
      p.name.toLowerCase().includes(term.toLowerCase()) ||
      p.description.toLowerCase().includes(term.toLowerCase())
    );
    this.programsSubject.next(filtered);
  }

  /**
   * Instala um programa e, em seguida, executa o setup pós-instalação.
   * Instala as dependências declaradas no Program primeiro.
   */
  async installProgram(id: string) {
    this.updateProgramStatus(id, 'downloading', 0);

    try {
      const program = this.allPrograms.find(p => p.id === id);

      // Instala dependências primeiro
      if (program?.dependencies?.length) {
        for (const depId of program.dependencies) {
          const depHandler = this.registry.getHandler(depId);
          if (!depHandler) continue;

          const depStatus = await depHandler.checkStatus();
          if (depStatus.status !== 'installed') {
            this.updateProgramStatus(id, 'downloading', 0, `Instalando dependência: ${depId}...`);
            const depResult = await depHandler.install();
            if (!depResult.success) {
              console.error(`[DataService] Falha ao instalar dependência ${depId}:`, depResult.error);
              this.updateProgramStatus(id, 'not-installed');
              return;
            }
          }
        }
      }

      // Instala o programa principal
      const handler = this.registry.getHandler(id);
      if (!handler) {
        console.error(`[DataService] Nenhum handler encontrado para: ${id}`);
        this.updateProgramStatus(id, 'not-installed');
        return;
      }

      const result = await handler.install();
      console.log(`[DataService] Resultado da instalação de ${id}:`, result);
      if (!result.success) {
        console.error(`[DataService] Falha ao instalar ${id}:`, result.error);
        this.updateProgramStatus(id, 'not-installed', undefined, result.error);
        return;
      }

      // Setup pós-instalação (ex: configurar banco de dados)
      this.updateProgramStatus(id, 'installing', 0, 'Configurando...');
      await handler.setup();

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

  /**
   * Liga/desliga um serviço (ex: PostgreSQL).
   * Serviços com método start() dedicado (como o postgres) são iniciados via handler.
   */
  async toggleService(id: string) {
    const program = this.allPrograms.find(p => p.id === id);
    if (!program || program.type !== 'service') return;

    if (!program.isRunning) {
      // Por enquanto apenas o postgres tem start() — outros serviços futuros podem
      // implementar uma interface ServiceHandler que estenda ProgramHandler com start().
      if (id === 'postgresql') {
        const result = await this.postgresHandler.start();
        if (result.success) {
          this.allPrograms = this.allPrograms.map(p =>
            p.id === id ? { ...p, isRunning: true } : p
          );
          this.programsSubject.next(this.allPrograms);
        } else {
          console.error('[DataService] Falha ao iniciar serviço:', result.error);
        }
      }
    } else {
      if (id === 'postgresql') {
        const result = await this.postgresHandler.stop();
        if (result.success) {
          this.allPrograms = this.allPrograms.map(p =>
            p.id === id ? { ...p, isRunning: false } : p
          );
          this.programsSubject.next(this.allPrograms);
        } else {
          console.error('[DataService] Falha ao parar serviço:', result.error);
        }
      } else {
        this.allPrograms = this.allPrograms.map(p =>
          p.id === id ? { ...p, isRunning: !p.isRunning } : p
        );
        this.programsSubject.next(this.allPrograms);
      }
    }
  }

  async updateProgram(id: string) {
    const handler = this.registry.getHandler(id);
    if (!handler) {
      console.warn(`[DataService] Nenhum handler para atualizar programa: ${id}`);
      return;
    }

    this.updateProgramStatus(id, 'updating', 0);
    try {
      const result = await handler.update();
      if (result.success) {
        this.updateProgramStatus(id, 'installed');
        await this.checkStatuses();
      } else {
        console.error(`[DataService] Update de ${id} falhou:`, result.error);
        this.updateProgramStatus(id, 'installed');
      }
    } catch (error) {
      console.error(`[DataService] Erro no update de ${id}:`, error);
      this.updateProgramStatus(id, 'installed');
    }
  }

  async uninstallProgram(id: string) {
    const handler = this.registry.getHandler(id);
    if (!handler) {
      console.warn(`[DataService] Nenhum handler para desinstalar programa: ${id}`);
      return;
    }

    if (!confirm(`Tem certeza que deseja desinstalar ${id}? Isso removerá os arquivos do programa e o banco de dados associado.`)) {
      return;
    }

    this.updateProgramStatus(id, 'uninstalling', 0, 'Desinstalando...');
    try {
      const result = await handler.uninstall();
      if (result.success) {
        this.updateProgramStatus(id, 'not-installed');
        await this.checkStatuses();
      } else {
        console.error(`[DataService] Desinstalação de ${id} falhou:`, result.error);
        this.updateProgramStatus(id, 'installed', undefined, result.error);
      }
    } catch (error) {
      console.error(`[DataService] Erro na desinstalação de ${id}:`, error);
      this.updateProgramStatus(id, 'installed');
    }
  }

  // ─── Estado ───────────────────────────────────────────────────────────────

  updateProgramStatus(id: string, status: Program['status'], progress?: number, message?: string) {
    if (!this.allPrograms.find(p => p.id === id)) return;

    this.allPrograms = this.allPrograms.map(p =>
      p.id === id ? { ...p, status, progress, message } : p
    );
    this.programsSubject.next(this.allPrograms);
  }

  async getProgramConfig(id: string) {
    const handler = this.registry.getHandler(id);
    if (!handler) {
      console.warn(`[DataService] Nenhum handler para config do programa: ${id}`);
      return;
    }
    return await handler.config();
  }

  async saveProgramConfig(id: string, config: any) {
    const handler = this.registry.getHandler(id);
    if (!handler) {
      console.warn(`[DataService] Nenhum handler para salvar config do programa: ${id}`);
      return;
    }
    return await handler.configSave(config);
  }

  async testConnection(id: string, config: any) {
    const handler = this.registry.getHandler(id) as any;
    if (handler && handler.testConnection) {
      return await handler.testConnection(config);
    }
    console.warn(`[DataService] Handler para ${id} não suporta teste de conexão.`);
    return { success: false, error: 'Funcionalidade não suportada para este programa.' };
  }
}
