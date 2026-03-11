const multer = require("multer");
const path = require("path");
const fs = require("fs");

const useSupabaseStorage = String(
  process.env.SUPABASE_MEDIA_STORAGE || ""
).trim().toLowerCase() === "true";

const uploadDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const diskStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const memoryStorage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype.startsWith("image/") ||
    file.mimetype.startsWith("video/") ||
    file.mimetype.startsWith("audio/") ||
    file.mimetype.includes("spreadsheet") ||
    file.mimetype.includes("excel") ||
    file.mimetype.includes("csv") ||
    file.originalname.match(/\.(jpg|jpeg|png|gif|mp4|mp3|wav|xlsx|xls|csv)$/)
  ) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type"), false);
  }
};

const upload = multer({
  storage: useSupabaseStorage ? memoryStorage : diskStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: fileFilter,
});

module.exports = upload;
