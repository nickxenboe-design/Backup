import pdfParse from 'pdf-parse';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';

const fsPromises = fs.promises;

async function extractTextFromPdf(buffer) {
  const data = await pdfParse(buffer);
  return typeof data.text === 'string' ? data.text : '';
}

function runTesseractOnBuffer(buffer, lang = 'eng') {
  return new Promise(async (resolve, reject) => {
    const tmpDir = os.tmpdir();
    const id = `ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const inputPath = path.join(tmpDir, `${id}.png`);
    const outputBase = path.join(tmpDir, `${id}-out`);
    const txtPath = `${outputBase}.txt`;
    try {
      await fsPromises.writeFile(inputPath, buffer);
      execFile('tesseract', [inputPath, outputBase, '-l', lang, '--psm', '6'], (err) => {
        const clean = async () => {
          try {
            await fsPromises.unlink(inputPath);
          } catch {}
          try {
            await fsPromises.unlink(txtPath);
          } catch {}
        };
        if (err) {
          clean().finally(() => {
            if (err.code === 'ENOENT') {
              reject(new Error('tesseract binary not found; install tesseract-ocr on the server'));
            } else {
              reject(err);
            }
          });
          return;
        }
        fsPromises
          .readFile(txtPath, 'utf8')
          .then((text) => {
            resolve(text);
          })
          .catch(reject)
          .finally(() => {
            clean();
          });
      });
    } catch (e) {
      reject(e);
    }
  });
}

function normalizeMrzDate(value, treatAsBirth) {
  if (!value || value.length !== 6) return null;
  const yy = Number(value.slice(0, 2));
  const mm = value.slice(2, 4);
  const dd = value.slice(4, 6);
  if (!yy || !mm || !dd) return null;
  const now = new Date();
  const currentYear2 = now.getFullYear() % 100;
  let fullYear;
  if (treatAsBirth) {
    fullYear = yy > currentYear2 ? 1900 + yy : 2000 + yy;
  } else {
    fullYear = 2000 + yy;
    if (fullYear < now.getFullYear() - 30) {
      fullYear = 1900 + yy;
    }
  }
  const month = mm.padStart(2, '0');
  const day = dd.padStart(2, '0');
  return `${fullYear}-${month}-${day}`;
}

function parseMrzPassport(lines) {
  if (!Array.isArray(lines) || lines.length < 2) return null;
  const l1 = lines[0].replace(/\s+/g, '');
  const l2 = lines[1].replace(/\s+/g, '');
  if (l1.length < 30 || l2.length < 30) return null;
  if (!l1.startsWith('P')) return null;
  const nameField = l1.slice(5);
  const nameParts = nameField.split('<<');
  const surnameRaw = (nameParts[0] || '').replace(/</g, ' ').trim();
  const givenRaw = (nameParts[1] || '').replace(/</g, ' ').trim();
  const fullName = [givenRaw, surnameRaw].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const passportNumberRaw = l2.slice(0, 9).replace(/</g, '');
  const nationality = l2.slice(10, 13).replace(/</g, '') || null;
  const birthRaw = l2.slice(13, 19);
  const expiryRaw = l2.slice(21, 27);
  const dateOfBirth = normalizeMrzDate(birthRaw, true);
  const expiryDate = normalizeMrzDate(expiryRaw, false);
  return {
    fullName: fullName || null,
    dateOfBirth: dateOfBirth || null,
    nationality: nationality || null,
    documentNumber: passportNumberRaw || null,
    expiryDate: expiryDate || null
  };
}

function normalizeDateLike(value) {
  if (!value) return null;
  const m = value.match(/(\d{2})[\.\/-](\d{2})[\.\/-](\d{2,4})/);
  if (!m) return null;
  let d = m[1];
  let mo = m[2];
  let y = m[3];
  if (y.length === 2) {
    const yy = Number(y);
    const now = new Date();
    const currentYear2 = now.getFullYear() % 100;
    const century = yy > currentYear2 ? 1900 : 2000;
    y = String(century + yy);
  }
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function detectGenericDocumentType(lines) {
  const joined = lines.join(' ');
  if (joined.includes('DRIVER') && joined.includes('LICENCE')) return 'drivers_licence';
  if (joined.includes('IDENTITY CARD') || joined.includes('IDENTITY DOCUMENT') || joined.includes('NATIONAL ID') || joined.includes('NATIONAL REGISTRATION CARD')) {
    return 'national_id';
  }
  return 'unknown';
}

function parseGenericFields(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const upperLines = lines.map((l) => l.toUpperCase());
  const documentType = detectGenericDocumentType(upperLines);
  let fullName = null;
  let dateOfBirth = null;
  let expiryDate = null;
  let documentNumber = null;

  for (let i = 0; i < upperLines.length; i += 1) {
    const line = upperLines[i];
    const original = lines[i];
    if (!fullName && (line.includes('SURNAME') || line.includes('NAME'))) {
      const afterColon = original.split(':')[1];
      if (afterColon && afterColon.trim().length > 2) {
        fullName = afterColon.trim();
      } else if (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (next.length > 2) {
          fullName = next;
        }
      }
    }
    if (!documentNumber && (line.includes('PASSPORT') || line.includes('DOCUMENT NO') || line.includes('DOC NO') || line.includes('ID NO') || line.includes('LICENCE NO'))) {
      const match = original.match(/([A-Z0-9]{6,})/i);
      if (match) {
        documentNumber = match[1];
      }
    }
    if (!dateOfBirth && (line.includes('BIRTH') || line.includes('DOB'))) {
      const match = original.match(/(\d{2}[\.\/-]\d{2}[\.\/-]\d{2,4})/);
      if (match) {
        dateOfBirth = normalizeDateLike(match[1]);
      }
    }
    if (!expiryDate && (line.includes('EXPIRY') || line.includes('EXPIRATION') || line.includes('VALID UNTIL') || line.includes('VALID TO'))) {
      const match = original.match(/(\d{2}[\.\/-]\d{2}[\.\/-]\d{2,4})/);
      if (match) {
        expiryDate = normalizeDateLike(match[1]);
      }
    }
  }

  if (!dateOfBirth) {
    const dobMatch = text.match(/(\d{2}[\.\/-]\d{2}[\.\/-]\d{2,4})/);
    if (dobMatch) dateOfBirth = normalizeDateLike(dobMatch[1]);
  }

  return {
    documentType,
    fullName: fullName || null,
    dateOfBirth: dateOfBirth || null,
    expiryDate: expiryDate || null,
    documentNumber: documentNumber || null
  };
}

function parsePassengerFromText(text) {
  if (!text || typeof text !== 'string') {
    return { documentType: 'unknown', fullName: null, dateOfBirth: null, nationality: null, documentNumber: null, expiryDate: null };
  }
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const mrzCandidates = rawLines.filter((l) => l.replace(/\s+/g, '').includes('<') && l.replace(/\s+/g, '').length >= 30);
  if (mrzCandidates.length >= 2) {
    const lastTwo = mrzCandidates.slice(-2).map((l) => l.replace(/\s+/g, ''));
    const mrzResult = parseMrzPassport(lastTwo);
    if (mrzResult) {
      return {
        documentType: 'passport',
        fullName: mrzResult.fullName,
        dateOfBirth: mrzResult.dateOfBirth,
        nationality: mrzResult.nationality,
        documentNumber: mrzResult.documentNumber,
        expiryDate: mrzResult.expiryDate
      };
    }
  }
  const generic = parseGenericFields(text.toUpperCase());
  return {
    documentType: generic.documentType,
    fullName: generic.fullName,
    dateOfBirth: generic.dateOfBirth,
    nationality: null,
    documentNumber: generic.documentNumber,
    expiryDate: generic.expiryDate
  };
}

export async function extractPassengerFromDocument(file) {
  if (!file || !file.buffer) {
    throw new Error('MISSING_FILE');
  }
  const buffer = file.buffer;
  const mimetype = file.mimetype || '';
  const name = (file.originalname || '').toLowerCase();
  let text = '';
  if (mimetype === 'application/pdf' || name.endsWith('.pdf')) {
    text = await extractTextFromPdf(buffer);
    if (!text || text.trim().length < 30) {
      text = await runTesseractOnBuffer(buffer, 'eng');
    }
  } else if (mimetype.startsWith('image/')) {
    text = await runTesseractOnBuffer(buffer, 'eng');
  } else {
    throw new Error('UNSUPPORTED_FILE_TYPE');
  }
  if (!text || !text.trim()) {
    throw new Error('NO_TEXT_DETECTED');
  }
  const parsed = parsePassengerFromText(text);
  return {
    ...parsed,
    rawText: text
  };
}
