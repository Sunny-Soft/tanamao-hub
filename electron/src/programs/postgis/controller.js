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
            // URL do bundle ZIP (mais fácil de extrair portatilmente)
            // const url = 'https://download.osgeo.org/postgis/windows/pg18/postgis-bundle-pg18-3.6.2x64.zip';
            const url = 'https://download.osgeo.org/postgis/windows/pg17/postgis-bundle-pg17-3.6.2x64.zip';
            const installersPath = path.join(getWritablePath(), 'installers');
            if (!fs.existsSync(installersPath)) {
                fs.mkdirSync(installersPath, { recursive: true });
            }
            const zipPath = path.join(installersPath, 'postgis-bundle.zip');
            const tempPath = path.join(installersPath, 'postgis-temp');

            info(PROGRAM_ID, 'Baixando bundle do PostGIS...');
            if (progressCallback) progressCallback({ status: 'downloading', percentage: 0 });

            await PostgresController.downloadWithAxios(url, zipPath, progressCallback);

            info(PROGRAM_ID, 'Extraindo PostGIS e mesclando com PostgreSQL...');
            if (progressCallback) progressCallback({ status: 'installing', percentage: 0 });

            const pgInstallPath = PostgresController.getInstallPath();

            // Script PowerShell para extrair para temp e depois mesclar pastas específicas
            const psScript = `
                $zipPath = '${zipPath}';
                $tempPath = '${tempPath}';
                $pgPath = '${pgInstallPath}';

                Add-Type -AssemblyName System.IO.Compression.FileSystem;
                
                # Garante que a pasta temp existe e está limpa
                if (Test-Path $tempPath) { Remove-Item -Path $tempPath -Recurse -Force }
                New-Item -ItemType Directory -Path $tempPath -Force | Out-Null;

                # 1. Extração para pasta temporária com progresso (0-80%)
                $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath);
                $entries = $zip.Entries;
                $total = $entries.Count;
                $current = 0;
                foreach ($entry in $entries) {
                    $current++;
                    $percent = [Math]::Floor(($current / $total) * 80);
                    Write-Host "PROGRESS: $percent";
                    
                    $targetFile = [System.IO.Path]::Combine($tempPath, $entry.FullName);
                    $targetDir = [System.IO.Path]::GetDirectoryName($targetFile);
                    
                    if (-not (Test-Path $targetDir)) {
                        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null;
                    }
                    
                    if (-not [string]::IsNullOrEmpty($entry.Name)) {
                        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetFile, $true);
                    }
                }
                $zip.Dispose();

                # 2. Localizar subpastas bin, lib, share e mesclar (80-100%)
                Write-Host "PROGRESS: 85";
                # Tenta encontrar onde as pastas bin, lib, share estão (pode haver um subdiretório raiz no ZIP)
                $rootSource = $tempPath;
                $binPath = Get-ChildItem -Path $tempPath -Recurse -Directory -Filter "bin" | Select-Object -First 1;
                if ($binPath) {
                    $rootSource = $binPath.Parent.FullName;
                }

                # 3. Mesclar arquivos
                $subfolders = @('bin', 'lib', 'share');
                $i = 0;
                foreach ($sub in $subfolders) {
                    $i++;
                    $percent = 85 + [Math]::Floor(($i / $subfolders.Count) * 15);
                    Write-Host "PROGRESS: $percent";
                    
                    $srcSub = Join-Path $rootSource $sub;
                    $dstSub = Join-Path $pgPath $sub;
                    
                    if (Test-Path $srcSub) {
                        if (-not (Test-Path $dstSub)) { New-Item -ItemType Directory -Path $dstSub -Force | Out-Null }
                        Copy-Item -Path "$srcSub\\*" -Destination $dstSub -Recurse -Force;
                    }
                }

                # 3. Limpeza
                Remove-Item -Path $tempPath -Recurse -Force;
                Write-Host "PROGRESS: 100";
            `;

            return new Promise((resolve, reject) => {
                const proc = spawn('powershell', ['-Command', psScript]);

                proc.stdout.on('data', (data) => {
                    const output = data.toString();
                    const match = output.match(/PROGRESS: (\d+)/);
                    if (match && progressCallback) {
                        const percentage = parseInt(match[1]);
                        progressCallback({ status: 'installing', percentage });
                    }
                    // Também loga mensagens info do PowerShell se houver (opcional)
                });

                proc.stderr.on('data', (data) => {
                    warn(PROGRAM_ID, `PowerShell: ${data.toString()}`);
                });

                proc.on('close', (code) => {
                    if (code === 0) {
                        info(PROGRAM_ID, 'PostGIS instalado e mesclado com sucesso.');
                        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                        if (progressCallback) progressCallback({ status: 'completed', percentage: 100 });
                        resolve(true);
                    } else {
                        error(PROGRAM_ID, `Erro ao instalar PostGIS. Código: ${code}`);
                        if (progressCallback) progressCallback({ status: 'error', error: `Código: ${code}` });
                        reject(new Error(`Erro ${code}`));
                    }
                });
            });
        } catch (err) {
            error(PROGRAM_ID, `Falha no PostGIS: ${err.message}`);
            if (progressCallback) progressCallback({ status: 'error', error: err.message });
            throw err;
        }
    }
}

export default new PostgisController();
