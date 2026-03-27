import { execSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { rootPath, getWritablePath } from '../../utils/config.js';
import { info, warn, error } from '../../utils/logger.js';
import PostgresController from '../postgresql/controller.js';

const PROGRAM_ID = 'postgis';

class PostgisController {
    checkInstalled() {
        try {
            const pgInstallPath = PostgresController.getInstallPath();
            if (!pgInstallPath) return false;

            // No PostgreSQL portátil, os arquivos ficam no mesmo diretório base
            const postgisPath = path.join(pgInstallPath, 'lib', 'postgis-3.dll');
            return fs.existsSync(postgisPath);
        } catch (e) {
            return false;
        }
    }

    async downloadAndInstall(progressCallback) {
        try {
            const url = 'https://download.osgeo.org/postgis/windows/pg17/postgis-bundle-pg17-3.6.2x64.zip'; 
            const installersPath = path.join(getWritablePath(), 'installers');
            if (!fs.existsSync(installersPath)) {
                fs.mkdirSync(installersPath, { recursive: true });
            }
            const installerPath = path.join(installersPath, 'postgis-bundle.zip');

            info(PROGRAM_ID, 'Baixando PostGIS...');
            if (progressCallback) progressCallback({ status: 'downloading', percentage: 0, message: 'Baixando PostGIS...' });
            
            // Reutiliza logica de download com axios (simplificada aqui ou importada se movermos para utils)
            const writer = fs.createWriteStream(installerPath);
            const response = await axios({ url, method: 'GET', responseType: 'stream' });
            const totalLength = response.headers['content-length'];
            let downloadedLength = 0;

            response.data.on('data', (chunk) => {
                downloadedLength += chunk.length;
                if (progressCallback) {
                    if (totalLength) {
                        const percentage = Math.round((downloadedLength / totalLength) * 100);
                        progressCallback({ status: 'downloading', percentage, message: `Baixando PostGIS... ${percentage}%` });
                    } else {
                        const downloadedMB = (downloadedLength / (1024 * 1024)).toFixed(2);
                        progressCallback({ status: 'downloading', message: `Baixando PostGIS... (${downloadedMB} MB)` });
                    }
                }
            });

            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            info(PROGRAM_ID, 'Iniciando extração do PostGIS...');
            if (progressCallback) progressCallback({ status: 'installing', percentage: 0, message: 'Extraindo PostGIS...' });

            const pgInstallPath = PostgresController.getInstallPath();
            
            // Script PowerShell para extrair sobre o postgres (mesclando pastas)
            const psScript = `
                $zipPath = '${installerPath}';
                $destPath = '${pgInstallPath}';
                Add-Type -AssemblyName System.IO.Compression.FileSystem;
                $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath);
                $entries = $zip.Entries;
                
                # Check if all entries are within a single root folder
                $rootFolder = $null;
                $allInRoot = $true;
                foreach ($entry in $entries) {
                    if ($entry.FullName.Contains('/')) {
                        $parts = $entry.FullName.Split('/');
                        if ($null -eq $rootFolder) {
                            $rootFolder = $parts[0];
                        } elseif ($rootFolder -ne $parts[0]) {
                            $allInRoot = $false;
                            break;
                        }
                    } else {
                        # Root files (not in a folder) mean no common root folder
                        $allInRoot = $false;
                        break;
                    }
                }

                $total = $entries.Count;
                $current = 0;
                foreach ($entry in $entries) {
                    $current++;
                    if ($current % 10 -eq 0) {
                        $percent = [Math]::Floor(($current / $total) * 100);
                        Write-Host "PROGRESS: $percent";
                    }
                    
                    # Remove root folder if it exists
                    $relativePath = $entry.FullName;
                    if ($allInRoot -and $relativePath.StartsWith($rootFolder + "/")) {
                        $relativePath = $relativePath.Substring($rootFolder.Length + 1);
                    }
                    
                    if ([string]::IsNullOrEmpty($relativePath)) { continue; }

                    $targetFile = [System.IO.Path]::Combine($destPath, $relativePath);
                    $targetDir = [System.IO.Path]::GetDirectoryName($targetFile);
                    
                    if (-not (Test-Path $targetDir)) {
                        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null;
                    }
                    
                    if (-not [string]::IsNullOrEmpty($entry.Name)) {
                        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetFile, $true);
                    }
                }
                $zip.Dispose();
            `;

            await new Promise((resolve, reject) => {
                const proc = spawn('powershell', ['-Command', psScript]);
                proc.stdout.on('data', (data) => {
                    const output = data.toString();
                    const match = output.match(/PROGRESS: (\d+)/);
                    if (match && progressCallback) {
                        progressCallback({ status: 'installing', percentage: parseInt(match[1]), message: `Extraindo PostGIS... ${match[1]}%` });
                    }
                });
                proc.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Erro na extração do PostGIS: ${code}`));
                });
                proc.on('error', reject);
            });

            info(PROGRAM_ID, 'PostGIS instalado com sucesso.');
            if (progressCallback) progressCallback({ status: 'completed', percentage: 100, message: 'PostGIS instalado!' });
            return { success: true };

        } catch (err) {
            error(PROGRAM_ID, `Erro ao instalar PostGIS: ${err.message}`);
            if (progressCallback) progressCallback({ status: 'error', error: err.message });
            throw err;
        }
    }

    // ─── Interface Padrão ─────────────────────────────────────────────────────

    isInstalled() {
        return this.checkInstalled();
    }

    getStatus() {
        return {
            status: this.isInstalled() ? 'installed' : 'not-installed',
            isRunning: false, // PostGIS is an extension, not a process
            version: null,
        };
    }

    async install(progressCallback) {
        return this.downloadAndInstall(progressCallback);
    }
}

export default new PostgisController();
