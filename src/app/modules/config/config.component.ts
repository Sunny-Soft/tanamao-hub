import { Component, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Program } from '../../types/Program';

@Component({
    selector: 'app-config',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './config.component.html'
})
export class ConfigComponent implements OnInit {
    private dataService = inject(DataService);

    protected readonly services = computed(() =>
        this.dataService.programs().filter(p => p.type === 'service')
    );

    diasDaSemana = [
        { label: 'Dom', value: 0 },
        { label: 'Seg', value: 1 },
        { label: 'Ter', value: 2 },
        { label: 'Qua', value: 3 },
        { label: 'Qui', value: 4 },
        { label: 'Sex', value: 5 },
        { label: 'Sáb', value: 6 }
    ];

    configForm = new FormGroup({
        auto_start: new FormControl<boolean>(false),
        auto_update: new FormControl<boolean>(false),
        tanamao_food_path: new FormControl<string>(''),
        backup_enabled: new FormControl<boolean>(false),
        backup_time: new FormControl<string>('03:00'),
        backup_days: new FormControl<number[]>([]),
        backup_path: new FormControl<string>(''),
    });

    toggle(id: string) {
        this.dataService.toggleService(id);
    }

    toggleDay(day: number) {
        const currentDays = this.configForm.get('backup_days')?.value || [];
        if (currentDays.includes(day)) {
            this.configForm.patchValue({
                backup_days: currentDays.filter(d => d !== day)
            });
        } else {
            this.configForm.patchValue({
                backup_days: [...currentDays, day]
            });
        }
    }

    isDaySelected(day: number): boolean {
        return (this.configForm.get('backup_days')?.value || []).includes(day);
    }

    async ngOnInit() {
        try {
            const result = await window.api.configsGet();
            if (result.success && result.configs) {
                this.configForm.patchValue({
                    auto_start: result.configs.auto_start || false,
                    auto_update: result.configs.auto_update || false,
                    tanamao_food_path: result.configs.tanamao_food_path || 'C:\\Program Files\\Tanamao Food',
                    backup_enabled: result.configs.backup_enabled || false,
                    backup_time: result.configs.backup_time || '03:00',
                    backup_days: (result.configs.backup_days || [1, 2, 3, 4, 5]) as number[],
                    backup_path: result.configs.backup_path || '',
                }, { emitEvent: false });
            }
        } catch (error) {
            console.error('Failed to load configs:', error);
        }

        this.configForm.valueChanges.subscribe(async (value) => {
            try {
                await window.api.configsSave(value);
            } catch (error) {
                console.error('Failed to save configs:', error);
            }
        });
    }
}
