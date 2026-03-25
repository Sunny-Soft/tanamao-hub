import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { map } from 'rxjs';

@Component({
  selector: 'app-services',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './services.component.html',
  styleUrl: './services.component.css'
})
export class ServicesComponent implements OnInit {
  private dataService = inject(DataService);

  postgres$ = this.dataService.getPrograms().pipe(
    map(programs => programs.find(p => p.id === 'postgresql'))
  );

  ngOnInit(): void {
    this.dataService.checkStatuses();
  }

  togglePostgres() {
    this.dataService.toggleService('postgresql');
  }
}
