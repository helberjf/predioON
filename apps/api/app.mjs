import express from "express";
import runtime from "./dist/vercel.mjs";

const app = express();
app.use(runtime);
export default app;
