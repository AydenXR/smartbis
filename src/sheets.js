import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';

const CREDENTIALS_PATH = path.join(process.cwd(), 'data', 'google_creds.json');

export const registerInSheets = async (sheetId, rowData) => {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        console.warn('[SHEETS] Credenciales de Google no encontradas. Saltando registro.');
        return null;
    }

    try {
        const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
        const serviceAccountAuth = new JWT({
            email: credentials.client_email,
            key: credentials.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0]; // Usar la primera hoja por defecto
        
        // Agregar fila con timestamp
        const sanitizedRowData = { ...rowData };
        // Strip '+' from WhatsApp to prevent Google Sheets formula interpretation
        if (sanitizedRowData['WhatsApp']) {
            sanitizedRowData['WhatsApp'] = sanitizedRowData['WhatsApp'].replace(/^\+/, '').replace(/\s+/g, '');
        }
        const fullRowData = {
            ...sanitizedRowData,
            'Fecha Registro': new Date().toLocaleString(),
            'Status': 'Aprobado'
        };

        const result = await sheet.addRow(fullRowData);
        console.log('[SHEETS] Fila registrada exitosamente en Google Sheets.');
        return result;
    } catch (err) {
        console.error('[SHEETS] Error al registrar en Google Sheets:', err);
        return null;
    }
};
