require('dotenv').config();
const { app, ready } = require('./src/app');
const PORT = Number(process.env.PORT || 3000);
ready.then(() => app.listen(PORT, () => console.log(`RouteX Cloud 3.0 rodando em http://localhost:${PORT}`))).catch((error) => { console.error(error); process.exit(1); });
