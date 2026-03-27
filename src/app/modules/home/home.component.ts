import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { Program } from '../../types/Program';
import { ModalService } from '../../services/modal.service';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './home.component.html',
    styleUrl: './home.component.css'
})
export class HomeComponent {
    private dataService = inject(DataService);
    private modalService = inject(ModalService);

    protected readonly programs = computed(() => 
        this.dataService.programs().filter(p => p.type === 'app')
    );

    search(event: any) {
        const term = event.target.value;
        this.dataService.searchPrograms(term);
    }

    install(program: Program) {
        this.dataService.installProgram(program.id);
    }

    /** Executa o setup pós-instalação de qualquer programa (ex: configurar banco). */
    setup(program: Program) {
        if (program.type === 'service') {
            this.dataService.toggleService(program.id);
        } else {
            this.dataService.setupProgram(program.id);
        }
    }

    update(program: Program) {
        this.dataService.updateProgram(program.id);
    }

    open(program: Program) {
        this.dataService.openProgram(program.id);
    }

    async config(program: Program) {
        this.modalService.setShowConfigModal(true, program);
    }

    uninstall(program: Program) {
        this.dataService.uninstallProgram(program.id);
    }
}
