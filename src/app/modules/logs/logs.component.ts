import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface LogProgram {
    id: string;
    name: string;
    icon: string;
}

@Component({
    selector: 'app-logs',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './logs.component.html',
    styleUrl: './logs.component.css',
})
export class LogsComponent implements OnInit, OnDestroy {
    programs = signal<LogProgram[]>([]);
    selectedProgramId = signal<string>('');
    logContent = signal<string>('');
    isLoading = signal<boolean>(false);
    error = signal<string>('');

    async ngOnInit() {
        await this.loadPrograms();

        // Configura o listener para atualizações em tempo real
        window.api.onLogsUpdate((data: any) => {
            if (data.programId === this.selectedProgramId()) {
                this.logContent.set(data.content);
                // Scroll to bottom after content loads
                setTimeout(() => this.scrollToBottom(), 50);
            }
        });
    }

    ngOnDestroy() {
        window.api.logsUnwatch();
    }

    async loadPrograms() {
        try {
            const result: any = await window.api.logsList();
            if (result.success) {
                this.programs.set(result.programs);
                if (this.programs().length > 0) {
                    this.selectedProgramId.set(this.programs()[0].id);
                    await this.loadLogs();
                }
            }
        } catch (e: any) {
            this.error.set('Erro ao carregar lista de programas.');
        }
    }

    async onProgramChange() {
        await this.loadLogs();
    }

    async loadLogs() {
        if (!this.selectedProgramId()) return;
        this.isLoading.set(true);
        this.error.set('');
        try {
            const result = await window.api.logsGet(this.selectedProgramId());

            if (result.success) {
                this.logContent.set(result.content || '(nenhum log registrado ainda)');
                // Inicia o monitoramento em tempo real para este programa
                window.api.logsWatch(this.selectedProgramId());
            } else {
                this.error.set(result.content || 'Erro ao ler logs.');
                this.logContent.set('');
            }
        } catch (e: any) {
            this.error.set('Erro ao carregar logs.');
            this.logContent.set('');
        } finally {
            this.isLoading.set(false);
            // Scroll to bottom after content loads
            setTimeout(() => this.scrollToBottom(), 50);
        }
    }

    async clearLogs() {
        if (!this.selectedProgramId()) return;
        try {
            await (window.api as any).logsClear(this.selectedProgramId());
            this.logContent.set('');
        } catch (e: any) {
            this.error.set('Erro ao limpar logs.');
        }
    }

    scrollToBottom() {
        const el = document.getElementById('log-area');
        if (el) el.scrollTop = el.scrollHeight;
    }

    get selectedProgram(): LogProgram | undefined {
        return this.programs().find(p => p.id === this.selectedProgramId());
    }

    logLines(): string[] {
        console.log(this.logContent());

        return this.logContent().split('\n').filter(l => l.trim() !== '');
    }

    levelOf(line: string): 'info' | 'warn' | 'error' | 'default' {
        if (line.includes('[ERROR]')) return 'error';
        if (line.includes('[WARN]')) return 'warn';
        if (line.includes('[INFO]')) return 'info';
        return 'default';
    }
}
