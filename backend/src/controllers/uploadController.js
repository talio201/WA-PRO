const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { emitRealtimeEvent } = require("../realtime/realtime");

const SUPABASE_BUCKET = "campaign-media";
const useSupabaseStorage =
  String(process.env.SUPABASE_MEDIA_STORAGE || "").trim().toLowerCase() === "true";

function getSupabaseStorageClient() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ""
  ).trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function uploadToSupabase(fileBuffer, originalName, mimetype) {
  const client = getSupabaseStorageClient();
  if (!client) throw new Error("Supabase não configurado para storage de mídia.");

  const ext = path.extname(originalName) || "";
  const uniqueName = `${Date.now()}-${crypto.randomUUID()}${ext}`;

  const { data, error } = await client.storage
    .from(SUPABASE_BUCKET)
    .upload(uniqueName, fileBuffer, {
      contentType: mimetype,
      upsert: false,
    });

  if (error) throw new Error(`Supabase Storage upload error: ${error.message}`);

  const { data: publicData } = client.storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(uniqueName);

  return {
    fileName: uniqueName,
    originalName,
    fileUrl: publicData.publicUrl,
    mimetype,
  };
}

exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: "Nenhum arquivo enviado." });
    }

    let result;

    if (useSupabaseStorage && req.file.buffer) {
      result = await uploadToSupabase(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    } else {
      const baseUrl =
        String(process.env.BASE_URL || "").trim() ||
        `${req.protocol}://${req.get("host")}`;
      result = {
        fileName: req.file.filename,
        originalName: req.file.originalname,
        filePath: req.file.path,
        fileUrl: `${baseUrl}/uploads/${req.file.filename}`,
        mimetype: req.file.mimetype,
      };
    }

    res.json(result);

    emitRealtimeEvent("upload.completed", {
      fileName: result.fileName,
      fileUrl: result.fileUrl,
      mimetype: result.mimetype,
      size: Number(req.file.size || req.file.buffer?.length || 0),
      storage: useSupabaseStorage ? "supabase" : "local",
    });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ msg: err.message || "Erro no upload." });
  }
};
