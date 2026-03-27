import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-services',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './services.component.html',
  styleUrl: './services.component.css'
})
export class ServicesComponent {
  private dataService = inject(DataService);

  protected readonly services = computed(() =>
    this.dataService.programs().filter(p => p.type === 'service')
  );

  // ngOnInit is kept for now, but its content is removed as per the change's implication
  // that checkStatuses() is no longer needed here.
  ngOnInit(): void {
    // this.dataService.checkStatuses(); // Removed as per the new logic
  }

  async toggleService(id: string) {
    await this.dataService.toggleService(id);
  }
}
