// Local only. There is no deployed origin: the model service needs a GPU and
// runs on a workstation, so the dashboard is served from Vite beside it.
const allowedOrigins = [
    'http://localhost:5173',    // Vite dev server, default port
    'http://127.0.0.1:5173',
    'http://localhost:5174',    // Vite's fallback when 5173 is taken
    'http://127.0.0.1:5174',
    'http://localhost:3500',    // this API, for direct calls
    'http://127.0.0.1:3500'
];

module.exports = allowedOrigins;
