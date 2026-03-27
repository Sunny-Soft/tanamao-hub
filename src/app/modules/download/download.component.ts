import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { BehaviorSubject, map } from 'rxjs';
import { Program } from '../../types/Program';

@Component({
  selector: 'app-download',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './download.component.html',
  styleUrl: './download.component.css'
})
export class DownloadComponent {
  private dataService = inject(DataService);
  programs$ = this.dataService.getPrograms().pipe(
    map(
      (programs: Program[]) => programs.filter((p: Program) => {
        return p.type === 'app' && p.status !== 'installed'
      })
    )
  );
  hasActiveTask$ = new BehaviorSubject<boolean>(false);
}


