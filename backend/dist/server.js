"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const db_1 = require("./db");
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const projects_1 = __importDefault(require("./routes/projects"));
const tasks_1 = __importDefault(require("./routes/tasks"));
const approvals_1 = __importDefault(require("./routes/approvals"));
const assets_1 = __importDefault(require("./routes/assets"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const messages_1 = __importDefault(require("./routes/messages"));
const reports_1 = __importDefault(require("./routes/reports"));
const categories_1 = __importDefault(require("./routes/categories"));
const internal_chat_1 = __importDefault(require("./routes/internal-chat"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
app.use((0, helmet_1.default)({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || ['http://localhost:5173', 'https://agency.webanatomy.in'],
    credentials: true,
}));
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Static uploads
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../uploads')));
// API Routes
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
app.use('/api/projects', projects_1.default);
app.use('/api/tasks', tasks_1.default);
app.use('/api/approvals', approvals_1.default);
app.use('/api/assets', assets_1.default);
app.use('/api/notifications', notifications_1.default);
app.use('/api/messages', messages_1.default);
app.use('/api/reports', reports_1.default);
app.use('/api/categories', categories_1.default);
app.use('/api/internal-chat', internal_chat_1.default);
app.get('/health', (_req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));
(0, db_1.initDB)()
    .then(() => {
    app.listen(PORT, () => console.log(`Agency API running on port ${PORT}`));
})
    .catch((err) => {
    console.error('DB init failed:', err);
    process.exit(1);
});
exports.default = app;
