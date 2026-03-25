import fs from 'fs';
import path from 'path';
import { app } from 'electron';

let logDirInitialized = false;

export function getLogDir() {
    const LOG_DIR = path.join(app.getPath('userData'), 'logs');
    if (!logDirInitialized) {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }
        logDirInitialized = true;
    }
    return LOG_DIR;
}

export function getLogFile(programId = 'hub') {
    return path.join(getLogDir(), `${programId}.log`);
}

function formatMessage(level, message) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
}

function writeLog(programId, level, message) {
    const logFile = getLogFile(programId);
    const detailedLogFile = getLogFile('hub-detailed');
    const formattedMessage = formatMessage(level, message);
    
    // Também loga no console para desenvolvimento
    console.log(formattedMessage.trim());

    try {
        // Log específico do programa
        fs.appendFileSync(logFile, formattedMessage);
        
        // Log detalhado geral (Hub)
        if (programId !== 'hub-detailed') {
            const hubMessage = `[${programId}] ${formattedMessage}`;
            fs.appendFileSync(detailedLogFile, hubMessage);
        }
    } catch (err) {
        console.error('Falha ao escrever no arquivo de log:', err);
    }
}

export function info(programId, message) {
    writeLog(programId, 'info', message);
}

export function warn(programId, message) {
    writeLog(programId, 'warn', message);
}

export function error(programId, message) {
    writeLog(programId, 'error', message);
}

/**
 * Loga uma mensagem detalhada (vinda de comandos shell, etc)
 */
export function logDetailed(programId, message) {
    const detailedLogFile = getLogFile('hub-detailed');
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [DETALHADO] [${programId}] ${message}\n`;
    
    try {
        fs.appendFileSync(detailedLogFile, formatted);
    } catch (err) {
        // ignore
    }
}

/**
 * Lê o conteúdo do arquivo de log de um programa.
 * @param {string} programId 
 * @returns {string}
 */
export function getLogs(programId) {
    const logFile = getLogFile(programId);
    if (fs.existsSync(logFile)) {
        return fs.readFileSync(logFile, 'utf-8');
    }
    return '';
}
