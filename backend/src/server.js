require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const {
  initRealtimeServer,
  emitRealtimeEvent,
} = require("./realtime/realtime");
const requireAuth = require("./middleware/authMiddleware");
const app = express();
const whitelist = ["chrome-extension://", "http://localhost"];
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || whitelist.some((w) => origin.startsWith(w))) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};
app.use(cors(corsOptions));
app.use(express.json({ extended: false }));
app.get("/", (req, res) => res.json({ msg: "API Running" }));
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
const { sendFlowLogger } = require("./monitorSendFlow");
app.use("/api/messages", sendFlowLogger);
app.use("/api", requireAuth);
app.use("/api/campaigns", require("./routes/campaignRoutes"));
app.use("/api/messages", require("./routes/messageRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ msg: "Invalid payload." });
  }
  return next(err);
});
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
initRealtimeServer(server);
server.listen(PORT, () => {
  emitRealtimeEvent("system.server_started", {
    port: Number(PORT),
    storageProvider: String(
      process.env.STORAGE_PROVIDER || process.env.DB_PROVIDER || "local",
    ).toLowerCase(),
  });
});
