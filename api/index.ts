import { registerRoutes } from '../server/routes.js';
import express from 'express';

const app = express();

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Register routes
await registerRoutes(app);

export default app;