const path = require('path');
const { emitRealtimeEvent } = require('../realtime/realtime');

exports.uploadFile = (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No file uploaded.');
        }

        // Return the URL to access the file
        // Prefer the request host so URLs keep working when PORT changes.
        // BASE_URL can still override this in production/reverse-proxy setups.
        const baseUrl = String(process.env.BASE_URL || '').trim()
            || `${req.protocol}://${req.get('host')}`;
        const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;

        res.json({
            fileName: req.file.filename,
            filePath: req.file.path,
            fileUrl: fileUrl,
            mimetype: req.file.mimetype
        });

        emitRealtimeEvent('upload.completed', {
            fileName: req.file.filename,
            fileUrl,
            mimetype: req.file.mimetype,
            size: Number(req.file.size || 0),
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};
