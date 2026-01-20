import express from 'express';
import multer from 'multer';
import { extractPassengerFromDocument } from '../services/passengerDocExtraction.service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();

router.post('/extract-from-document', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'MISSING_FILE' });
  }
  try {
    const data = await extractPassengerFromDocument(req.file);
    return res.json({ success: true, data });
  } catch (e) {
    const message = e && e.message ? e.message : 'Failed to extract passenger details';
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
