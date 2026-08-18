const allowedOrigins = [
    'https://www.yoursite.com',
    'http://127.0.0.1:5500',
    'http://localhost:3500',
    'http://localhost:3000',
    'http://localhost:5173',        // Vite dev server (front-end)
    'http://127.0.0.1:5173'
];

module.exports = allowedOrigins;