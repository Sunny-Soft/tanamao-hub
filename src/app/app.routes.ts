import { Routes } from '@angular/router';
import { HomeComponent } from './modules/home/home.component';
import { DownloadComponent } from './modules/download/download.component';
import { ConfigComponent } from './modules/config/config.component';
import { LogsComponent } from './modules/logs/logs.component';
import { ServicesComponent } from './modules/services/services.component';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent },
  { path: 'services', component: ServicesComponent },
  { path: 'download', component: DownloadComponent },
  { path: 'config', component: ConfigComponent},
  { path: 'logs', component: LogsComponent },
];
